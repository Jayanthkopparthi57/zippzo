"""Chart-aligned dark-store hand-offs: rack drop, assignment, live tracking.

The flowchart separates four floor steps:

    Pick -> Rack Drop -> Confirm -> Picking Completed

Picking already stops at ``PICKED`` (each unit is scanned off a shelf). Rack
Drop is the walk from the shelf to the packing rack, and Confirm is the picker
telling the store the goods are physically there. Those two are one operation
here because there is no useful state between "I am at the rack" and "the rack
has the tote": ``POST /ds-ops/rack-drop`` records the rack label, the time and
the order status ``RACK_DROPPED``. Packing still owns the sealed tote and the
rider job, so this cannot be used to skip the pack station.

The same module carries the manager's live views (department status and order
tracking) and the manual assignment controls. They are thin read models over
the same tables the floor writes, so the console and the phone cannot disagree.
"""
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bounded.iam.permissions import IsFieldSurface

PICKED_STATUSES = {'PICKED', 'RACK_DROPPED'}


def _session_site(user):
    session = getattr(user, 'session', None)
    if session is not None and session.facility_id:
        return session.facility
    return None


def _order_for(request, order_id):
    from bounded.orders.models import CustomerOrder
    from bounded.ds_ops.access import require_order_access, require_session_facility

    if not order_id:
        raise ValueError('order_id is required')
    try:
        order = CustomerOrder.objects.select_related('site', 'customer').get(
            order_id=order_id)
    except (CustomerOrder.DoesNotExist, ValueError, TypeError):
        raise LookupError('Order not found')
    require_order_access(request.user, order)
    require_session_facility(request.user, order.site.code)
    return order


class DSRackDropView(APIView):
    """Confirm a fully-picked order has reached the packing rack."""

    permission_classes = [IsAuthenticated, IsFieldSurface]

    def post(self, request):
        from bounded.orders.models import CustomerOrderLine, OrderStatusHistory
        from bounded.outbox.services import enqueue_event

        try:
            order = _order_for(request, request.data.get('order_id'))
        except LookupError as exc:
            return Response({'error': str(exc)}, status=404)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        except Exception as exc:  # PermissionDenied from the access helpers
            return Response({'detail': str(exc)}, status=403)

        from bounded.ds_ops.access import require_department
        require_department(request.user, order.site, 'PICK')

        if order.status == 'RACK_DROPPED':
            # Idempotent retry: the picker tapped twice or the response was lost.
            return Response({
                'order_id': str(order.order_id),
                'order_no': order.order_no,
                'status': order.status,
                'rack_location': order.rack_location,
                'rack_dropped_at': (order.rack_dropped_at.isoformat()
                                    if order.rack_dropped_at else None),
                'already_dropped': True,
            })

        if order.status not in PICKED_STATUSES:
            return Response({
                'error': (
                    f'Order {order.order_no} is {order.status}; only a fully '
                    f'picked order can be dropped at the rack.'),
                'status': order.status,
            }, status=409)

        short = [
            {
                'line_id': str(line.line_id),
                'line_no': line.line_no,
                'qty': line.qty,
                'picked_qty': line.picked_qty,
                'outstanding': line.qty - line.picked_qty,
            }
            for line in CustomerOrderLine.objects.filter(order=order)
            if line.picked_qty < line.qty
        ]
        if short:
            return Response({
                'error': (
                    f'Order {order.order_no} is not fully picked: '
                    f'{len(short)} line(s) still short.'),
                'short_lines': short,
            }, status=409)

        rack = str(
            request.data.get('rack_location')
            or request.data.get('rack')
            or request.data.get('bin')
            or 'RACK-01'
        ).strip()[:50] or 'RACK-01'

        with transaction.atomic():
            previous_status = order.status
            now = timezone.now()
            order.status = 'RACK_DROPPED'
            order.rack_location = rack
            order.rack_dropped_at = now
            order.save(update_fields=['status', 'rack_location', 'rack_dropped_at'])
            OrderStatusHistory.objects.create(
                order=order, from_status=previous_status,
                to_status='RACK_DROPPED',
                actor_type=request.user.role,
                actor_id=str(request.user.user_id),
                remark=f'Rack drop at {rack}',
            )

        enqueue_event(
            aggregate_type='CustomerOrder', aggregate_id=order.order_id,
            event_type='order.rack_dropped',
            payload_json={
                'order_id': str(order.order_id),
                'order_no': order.order_no,
                'site_code': order.site.code,
                'rack_location': rack,
                'dropped_by': str(request.user.user_id),
            },
        )
        return Response({
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'status': order.status,
            'previous_status': previous_status,
            'rack_location': rack,
            'rack_dropped_at': now.isoformat(),
            'already_dropped': False,
        })


class DSAssignOrderView(APIView):
    """Send one waiting order to the picker with the fewest open tasks."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from bounded.ds_ops.assignment import assign_order, lowest_workload_picker
        from bounded.iam.models import User

        try:
            order = _order_for(request, request.data.get('order_id'))
        except LookupError as exc:
            return Response({'error': str(exc)}, status=404)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=403)

        picker = None
        picker_id = request.data.get('picker_id') or request.data.get('picker')
        if picker_id:
            try:
                picker = User.objects.get(user_id=picker_id)
            except (User.DoesNotExist, ValueError, TypeError):
                return Response({'error': 'Picker not found'}, status=404)
            # An order may only be handed to somebody who actually picks at this
            # store. Otherwise a manager can assign work to a rider, a customer,
            # or a picker at another site and the order never reaches a shelf.
            from bounded.ds_ops.assignment import picker_candidates
            candidates = {c.user_id for c in picker_candidates(order.site)}
            if picker.user_id not in candidates:
                return Response({
                    'error': f'{picker.full_name or picker.email} is not an '
                             f'active picker at {order.site.code}.',
                }, status=400)
        else:
            picker = lowest_workload_picker(order.site)

        if picker is None:
            return Response({
                'error': 'No picker is free. The order stays in the pending queue.',
                'queued': True,
                'order_id': str(order.order_id),
                'order_no': order.order_no,
            }, status=409)

        assigned = assign_order(order, picker=picker, actor=request.user)
        if assigned is None:
            return Response({
                'error': 'Order has no open pick tasks.',
                'order_id': str(order.order_id),
                'status': order.status,
            }, status=409)
        return Response({
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'picker_id': str(assigned.user_id),
            'picker_name': assigned.full_name or assigned.email,
            'assigned': True,
        })


class DSMyPicksView(APIView):
    """The picker's own queue, plus what is still waiting for an owner.

    The chart's first screen after sign-in is "orders assigned to me"; the
    pending queue underneath is what the manager can hand out when a picker
    frees up. One request answers both so the phone does not fan out into
    pick-tasks + orders + customers.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.orders.models import CustomerOrder
        from .assignment import pending_pick_orders

        site = _site_from(request)
        if site is None:
            return Response({'error': 'Choose a store.'}, status=400)

        open_statuses = ['NOT_STARTED', 'IN_PROGRESS']
        rows = []
        mine = (CustomerOrder.objects
                .filter(site=site, pick_tasks__status__in=open_statuses,
                        pick_tasks__assigned_to=request.user.user_id)
                .exclude(status__in=['CANCELLED', 'FAILED', 'CLOSED_RTO',
                                     'REFUNDED'])
                .distinct()
                .order_by('promise_at', 'placed_at'))

        for order in mine:
            lines = list(order.lines.all())
            units = sum(line.qty for line in lines)
            picked = sum(line.picked_qty for line in lines)
            rows.append({
                'order_id': str(order.order_id),
                'order_no': order.order_no,
                'status': order.status,
                'customer_name': (order.customer.name or None)
                                  if order.customer_id else None,
                'grand_total': str(order.grand_total),
                'payment_method': order.payment_method,
                'promise_at': (order.promise_at.isoformat()
                               if order.promise_at else None),
                'placed_at': (order.placed_at.isoformat()
                              if order.placed_at else None),
                'line_count': len(lines),
                'units_total': units,
                'units_picked': picked,
                'units_outstanding': max(0, units - picked),
                'assigned_to_me': True,
            })

        waiting = []
        for order in pending_pick_orders(site)[:25]:
            waiting.append({
                'order_id': str(order.order_id),
                'order_no': order.order_no,
                'status': order.status,
                'promise_at': (order.promise_at.isoformat()
                               if order.promise_at else None),
                'placed_at': (order.placed_at.isoformat()
                              if order.placed_at else None),
            })

        return Response({
            'site_code': site.code,
            'site_name': site.name,
            'mine': rows,
            'count': len(rows),
            'pending': waiting,
            'pending_count': len(waiting),
        })


class DSPendingPicksView(APIView):
    """The pending queue plus a one-shot "assign everything possible" pass."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        site = _site_from(request)
        if site is None:
            return Response({'error': 'Choose a store.'}, status=400)
        from bounded.ds_ops.assignment import pending_pick_orders
        orders = []
        for order in pending_pick_orders(site)[:50]:
            orders.append({
                'order_id': str(order.order_id),
                'order_no': order.order_no,
                'status': order.status,
                'grand_total': str(order.grand_total),
                'promise_at': order.promise_at.isoformat() if order.promise_at else None,
                'placed_at': order.placed_at.isoformat() if order.placed_at else None,
            })
        return Response({'site_code': site.code, 'count': len(orders),
                         'orders': orders})

    def post(self, request):
        site = _site_from(request)
        if site is None:
            return Response({'error': 'Choose a store.'}, status=400)
        from bounded.ds_ops.assignment import assign_pending_orders
        assigned, remaining = assign_pending_orders(site, actor=request.user)
        return Response({'site_code': site.code, 'assigned': assigned,
                         'remaining': remaining})


class DSDeliveryQueueView(APIView):
    """Chart step "Ready for Rider": packed totes with no rider yet."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        site = _site_from(request)
        if site is None:
            return Response({'error': 'Choose a store.'}, status=400)
        from bounded.delivery.models import DeliveryTask
        ready = []
        for task in (DeliveryTask.objects
                     .filter(site=site, status__in=['UNASSIGNED', 'OFFERED'])
                     .select_related('order', 'rider')
                     .order_by('created_at')[:50]):
            ready.append({
                'task_id': str(task.task_id),
                'order_id': str(task.order_id),
                'order_no': task.order.order_no if task.order_id else None,
                'status': task.status,
                'staging_bin': task.staging_bin,
                'rider_id': str(task.rider_id) if task.rider_id else None,
                'offer_count': task.offer_count,
                'packed_at': task.packed_at.isoformat() if task.packed_at else None,
            })
        return Response({'site_code': site.code, 'count': len(ready), 'tasks': ready})


class DSDepartmentStatusView(APIView):
    """Per-department workload for the manager overview."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        site = _site_from(request, allow_any_estate=True)
        if site is None:
            return Response({'error': 'Choose a store.'}, status=400)

        from bounded.ds_ops.models import PickTask
        from bounded.supply.models import PutawayTask, GrnLine
        from bounded.counting.models import CycleCount
        from bounded.orders.models import CustomerOrder

        open_picks = PickTask.objects.filter(
            order__site=site, status__in=['NOT_STARTED', 'IN_PROGRESS'])
        unassigned_picks = open_picks.filter(assigned_to__isnull=True).count()

        inbound_lines = 0
        for line in GrnLine.objects.filter(grn__asn__dest_site=site).only(
                'received_qty', 'accepted_qty', 'damaged_qty'):
            if (line.received_qty or 0) - (line.accepted_qty or 0) - (line.damaged_qty or 0) > 0:
                inbound_lines += 1

        putaway = PutawayTask.objects.filter(
            grn_line__grn__asn__dest_site=site
        ).exclude(status='CONFIRMED')

        counts = {
            row['status']: row['n']
            for row in CustomerOrder.objects.filter(site=site)
            .values('status').annotate(n=Count('order_id'))
        }

        return Response({
            'site_code': site.code,
            'site_name': site.name,
            'departments': [
                {
                    'key': 'INBOUND',
                    'label': 'Inbound',
                    'pending': inbound_lines,
                    'detail': 'GRN lines still to receive',
                    'href': '/ds-ops/incoming-lpns',
                },
                {
                    'key': 'PUTAWAY',
                    'label': 'Putaway',
                    'pending': putaway.count(),
                    'detail': 'Totes waiting for a shelf',
                    'href': '/ds-ops/putaway',
                },
                {
                    'key': 'PICKING',
                    'label': 'Picking',
                    'pending': open_picks.count(),
                    'unassigned': unassigned_picks,
                    'detail': 'Open pick tasks',
                    'href': '/ds-ops/order-picking',
                },
                {
                    'key': 'RACK_DROP',
                    'label': 'Rack Drop',
                    'pending': counts.get('PICKED', 0),
                    'detail': 'Picked orders waiting at the rack',
                    'href': '/ds-ops/packing',
                },
                {
                    'key': 'PACKING',
                    'label': 'Packing',
                    'pending': counts.get('RACK_DROPPED', 0),
                    'detail': 'Dropped orders waiting for a tote',
                    'href': '/ds-ops/packing',
                },
                {
                    'key': 'INVENTORY',
                    'label': 'Inventory',
                    'pending': CycleCount.objects.filter(
                        site=site, status__in=['DRAFT', 'IN_PROGRESS']).count(),
                    'detail': 'Cycle counts open',
                    'href': '/ds-ops/cycle-count',
                },
                {
                    'key': 'DELIVERY',
                    'label': 'Ready for Rider',
                    'pending': counts.get('PACKED', 0) + counts.get('STAGED', 0),
                    'detail': 'Packed totes at the staging slot',
                    'href': '/ds-ops/dispatch',
                },
            ],
        })


class DSOrderTrackView(APIView):
    """Order tracking board: one row per order with the clerk's next step."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.orders.models import CustomerOrder

        site = _site_from(request, allow_any_estate=True)
        if site is None:
            return Response({'error': 'Choose a store.'}, status=400)

        status_filter = str(request.query_params.get('status') or '').strip().upper()
        qs = CustomerOrder.objects.filter(site=site).select_related(
            'customer', 'address').prefetch_related('delivery_tasks')
        if status_filter:
            qs = qs.filter(status=status_filter)
        else:
            qs = qs.exclude(status__in=['DELIVERED', 'CANCELLED', 'FAILED',
                                        'CLOSED_RTO', 'REFUNDED'])
        qs = qs.order_by('-placed_at')[:200]

        rows = []
        for order in qs:
            tasks = list(order.delivery_tasks.all())
            task = tasks[0] if tasks else None
            rows.append({
                'order_id': str(order.order_id),
                'order_no': order.order_no,
                'status': order.status,
                'payment_method': order.payment_method,
                'payment_status': order.payment_status,
                'grand_total': str(order.grand_total),
                'customer_name': order.customer.name if order.customer_id else None,
                'promise_at': order.promise_at.isoformat() if order.promise_at else None,
                'placed_at': order.placed_at.isoformat() if order.placed_at else None,
                'rack_location': order.rack_location,
                'rack_dropped_at': (order.rack_dropped_at.isoformat()
                                    if order.rack_dropped_at else None),
                'picked_up_at': (order.picked_up_at.isoformat()
                                 if order.picked_up_at else None),
                'delivered_at': (order.delivered_at.isoformat()
                                 if order.delivered_at else None),
                'delivery': None if task is None else {
                    'task_id': str(task.task_id),
                    'status': task.status,
                    'staging_bin': task.staging_bin,
                    'rider_id': str(task.rider_id) if task.rider_id else None,
                },
            })
        return Response({'site_code': site.code, 'count': len(rows), 'orders': rows})


def _site_from(request, allow_any_estate=False):
    """Resolve the store a read view is about, preferring the session store."""
    from bounded.ds_ops.access import is_estate_role
    from bounded.network.models import Site

    requested = str(
        request.query_params.get('site_code')
        or request.query_params.get('store_code')
        or ''
    ).strip().upper()
    session = getattr(request.user, 'session', None)
    if requested:
        from bounded.ds_ops.access import require_site_access
        require_site_access(request.user, requested)
        return Site.objects.filter(code=requested).first()
    if session is not None and session.facility_id:
        return session.facility
    if allow_any_estate and is_estate_role(request.user):
        return Site.objects.filter(site_type='DS').order_by('code').first()
    return None
