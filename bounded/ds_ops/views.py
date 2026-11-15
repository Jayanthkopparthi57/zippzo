# DS Ops Views
import logging

from django.db import transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from rest_framework.views import APIView
from django.db.models import Count, Min, Q, Sum
from bounded.iam.names import AttributionContextMixin, acting_user_id
from bounded.iam.permissions import IsFieldSurface
from .models import PickTask, PackTask, SortingWave, StagedAging, TransferOrder, TransferOrderLine, BinTransfer, Droplist
from .serializers import PickTaskSerializer, PackTaskSerializer, SortingWaveSerializer, StagedAgingSerializer, TransferOrderSerializer, TransferOrderLineSerializer, BinTransferSerializer, DroplistSerializer

logger = logging.getLogger(__name__)

# Below this many units on hand a lot is reported as LOW_STOCK. There is no
# per-SKU reorder point in the catalog, so the store console uses one flat rule
# and says so rather than inventing a threshold from an unrelated field.
DS_LOW_STOCK_THRESHOLD = 10


def _transfer_transit_ref(lpn):
    """Stable SITE-balance reference for stock riding in one transfer LPN."""
    import uuid

    return str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        f'zippzo:transfer-transit:{lpn.transfer_id}:{lpn.lpn_id}',
    ))


def _notify_task_assignee(*, event_type, task_type, task_id, aggregate_id,
                          user_id, order=None):
    from bounded.outbox.services import enqueue_event

    enqueue_event(
        aggregate_type=task_type.title().replace('_', '') + 'Task',
        aggregate_id=aggregate_id,
        event_type=event_type,
        payload_json={
            'recipient_user_id': str(user_id),
            'task_id': str(task_id),
            'task_type': task_type,
            'site_code': order.site.code if order and order.site_id else '',
            'order_id': str(order.order_id) if order else None,
            'order_no': order.order_no if order else None,
        },
    )

class PickTaskViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    # `site_code` is rendered from the order on every row; without these joins
    # a 100-row page costs 200 extra queries (one order + one site each).
    queryset = PickTask.objects.select_related('order__site').all()
    serializer_class = PickTaskSerializer
    attribution_fields = ('assigned_to', 'started_by', 'completed_by')
    # `batch` is the transfer this pick belongs to. Packing reads a transfer's
    # lines through ?batch=, and without it here the param was silently ignored:
    # a lookup for one transfer returned every pick task in the system, and
    # PickTask ordering is -created_at, so the packer adopted another batch's
    # lines and "verified" a tote against stock that was never on it.
    # Actor + window lookups feed the outbound ledger's "who picked, when".
    filterset_fields = {
        'status': ['exact'],
        'sku': ['exact'],
        'batch': ['exact'],
        'picklist_id': ['exact'],
        'order': ['exact'],
        'assigned_to': ['exact'],
        'started_by': ['exact'],
        'completed_by': ['exact'],
        'created_at': ['gte', 'lte'],
        'completed_at': ['gte', 'lte'],
    }

    @action(detail=False, methods=['get'])
    def picklists(self, request):
        """Open picklists, one row per picklist_id — the web "Picking Summary".

        The line endpoint answers workers, not planners: reconstructing one
        row per picklist in the browser from a 200-line page would silently
        drop picklists once the page fills, so the grouping happens here, in
        one GROUP BY over the same site-fenced queryset as the lines.

        Only picklists with unfinished work are returned: a picklist whose
        every line is COMPLETED/CANCELLED is history, and the line views
        already answer for it. Totals include the finished lines, so Assigned
        / Picked stay truthful as work lands.
        """
        from bounded.iam.names import user_display_map

        open_tasks = self.get_queryset().exclude(
            status__in=['COMPLETED', 'CANCELLED'])

        # batch is uniform within a picklist (enforced by every create path);
        # one representative per picklist is enough to name its transfer.
        batches = (
            open_tasks.values('picklist_id', 'batch')
            .distinct()
        )
        batches_by_picklist = {}
        for row in batches:
            batches_by_picklist.setdefault(
                str(row['picklist_id']), str(row['batch']))

        grouped = (
            self.get_queryset()
            .values('picklist_id')
            .annotate(
                lines=Count('id'),
                sku_count=Count('sku', distinct=True),
                assigned_qty=Sum('qty'),
                picked_qty=Sum('picked_qty'),
                short_qty=Sum('short_qty'),
                in_progress_lines=Count(
                    'id', filter=Q(status='IN_PROGRESS')),
                open_lines=Count('id', filter=~Q(
                    status__in=['COMPLETED', 'CANCELLED'])),
                first_started_at=Min('started_at'),
                first_created_at=Min('created_at'),
            )
            .filter(open_lines__gt=0)
            .order_by('first_created_at')
        )
        picklist_ids = [str(row['picklist_id']) for row in grouped]

        # Picker names + zones + order site come from the open lines in one
        # pass. A picklist can carry several pickers, so collect them all
        # rather than picking one.
        open_lines = open_tasks.filter(picklist_id__in=picklist_ids)
        line_rows = list(open_lines.values(
            'picklist_id', 'assigned_to', 'zone',
            'order__site__code'))
        picker_ids = []
        zones_by_picklist = {}
        picker_ids_by_picklist = {}
        order_sites = {}
        for line in line_rows:
            pid = str(line['picklist_id'])
            if line['assigned_to']:
                picker_ids.append(line['assigned_to'])
                picker_ids_by_picklist.setdefault(pid, [])
                if line['assigned_to'] not in picker_ids_by_picklist[pid]:
                    picker_ids_by_picklist[pid].append(line['assigned_to'])
            if line['zone']:
                zones_by_picklist.setdefault(pid, set()).add(line['zone'])
            if line['order__site__code']:
                order_sites[pid] = line['order__site__code']
        user_map = user_display_map(picker_ids)
        picker_names_by_picklist = {
            pid: [user_map.get(str(uid), str(uid)) for uid in uids]
            for pid, uids in picker_ids_by_picklist.items()
        }
        transfer_ids = {
            batch for batch in batches_by_picklist.values()
            if batch
        }
        transfer_sites = {
            str(t.transfer_id): t.source_site.code
            for t in TransferOrder.objects.filter(
                pk__in=list(transfer_ids),
            ).select_related('source_site')
        }

        results = []
        for row in grouped:
            pid = str(row['picklist_id'])
            batch = batches_by_picklist.get(pid)
            assigned_qty = row['assigned_qty'] or 0
            results.append({
                'picklist_id': pid,
                'batch': batch,
                'site_code': order_sites.get(pid) or transfer_sites.get(batch)
                if batch else order_sites.get(pid),
                'status': 'IN_PROGRESS' if row['in_progress_lines'] > 0 else 'NOT_STARTED',
                'lines': row['lines'],
                'sku_count': row['sku_count'],
                'assigned_qty': assigned_qty,
                'picked_qty': row['picked_qty'] or 0,
                'pending_qty': assigned_qty - (row['picked_qty'] or 0),
                'short_qty': row['short_qty'] or 0,
                'open_lines': row['open_lines'],
                'pickers': picker_names_by_picklist.get(pid, []),
                'zones': sorted(zones_by_picklist.get(pid, ())),
                'started_at': row['first_started_at'],
                'created_at': row['first_created_at'],
            })
        return Response(results[:500])

    def get_queryset(self):
        from django.db.models import Q
        from .access import is_superuser, operator_site_codes
        if is_superuser(self.request.user):
            return self.queryset.exclude(order__status='PAYMENT_PENDING')
        codes = operator_site_codes(self.request.user)
        transfer_ids = TransferOrder.objects.filter(
            Q(source_site__code__in=codes) | Q(dest_site__code__in=codes)
        ).values_list('transfer_id', flat=True)
        return self.queryset.exclude(order__status='PAYMENT_PENDING').filter(
            Q(order__site__code__in=codes) | Q(batch__in=transfer_ids))

    def _check_task_access(self, order, batch_id):
        from .access import is_superuser, require_site_access, require_session_facility
        if is_superuser(self.request.user):
            return
        if order:
            require_site_access(self.request.user, order.site.code)
            require_session_facility(self.request.user, order.site.code)
            return
        transfer = TransferOrder.objects.filter(pk=batch_id).select_related('source_site').first()
        if transfer:
            require_site_access(self.request.user, transfer.source_site.code)
            require_session_facility(self.request.user, transfer.source_site.code)
            return
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied('Pick task must be linked to an assigned order or transfer.')

    def perform_create(self, serializer):
        data = serializer.validated_data
        self._check_task_access(data.get('order'), data.get('batch'))
        serializer.save()

    def _apply_pick_to_ledger(self, task, actor_id=''):
        """Decrement source stock exactly once when a pick completes."""
        from bounded.catalog.models import InventoryLot, Sku
        from bounded.inventory.stock import apply_stock, InsufficientStock
        from bounded.network.models import Location, Site

        if not task.bin:
            return None
        loc = Location.objects.filter(location_id=task.bin).select_related('site').first()
        site = loc.site if loc else None
        if site is None:
            return None
        from .access import require_site_access, require_session_facility
        require_site_access(self.request.user, site.code)
        require_session_facility(self.request.user, site.code)

        sku = Sku.objects.filter(sku_id=task.sku).first()
        lot = InventoryLot.objects.filter(lot_id=task.lot).first() if task.lot else None
        if sku is None:
            return None

        try:
            apply_stock(
                site=site, sku=sku, lot=lot, qty=task.picked_qty,
                direction='OUT', movement_type='PICK',
                ref_type='PICKTASK', ref_id=task.pk,
                actor_id=actor_id or task.assigned_to or '',
                container='BIN', container_ref=task.bin,
                enforce_available=True,
            )
        except InsufficientStock:
            # Fall back to site-level stock (e.g. units sitting on a pallet/LPN
            # rather than in the exact pick bin) before rejecting the pick.
            try:
                apply_stock(
                    site=site, sku=sku, lot=lot, qty=task.picked_qty,
                    direction='OUT', movement_type='PICK',
                    ref_type='PICKTASK', ref_id=task.pk,
                    actor_id=actor_id or task.assigned_to or '',
                    container='SITE', container_ref='',
                    enforce_available=True,
                )
            except InsufficientStock as e:
                from rest_framework import serializers as _s
                raise _s.ValidationError({'stock': str(e)})
        return site

    @transaction.atomic
    def perform_update(self, serializer):
        task = serializer.instance
        order = serializer.validated_data.get('order', task.order)
        batch_id = serializer.validated_data.get('batch', task.batch)
        self._check_task_access(order, batch_id)
        previous_assignee = task.assigned_to
        was_completed = task.status == 'COMPLETED'
        was_started = task.started_at is not None
        serializer.save()
        stamp = []
        if task.status == 'COMPLETED' and not was_completed:
            # The PATCH path never stamped completion, so avg-pick reporting
            # silently dropped every task closed from the queue screen.
            if task.completed_at is None:
                from django.utils import timezone as _tz
                task.completed_at = _tz.now()
                stamp.append('completed_at')
            task.completed_by = acting_user_id(self.request)
            stamp.append('completed_by')
            self._apply_pick_to_ledger(task)
        # Claiming a task (assigned_to set or status flips to IN_PROGRESS)
        # stamps started_at so avg pick time is real, not null forever.
        if task.status == 'IN_PROGRESS' and not was_started:
            from django.utils import timezone as _tz
            task.started_at = _tz.now()
            stamp.append('started_at')
            task.started_by = acting_user_id(self.request)
            stamp.append('started_by')
        if stamp:
            task.save(update_fields=stamp)
        if (task.assigned_to and
                str(previous_assignee or '') != str(task.assigned_to)):
            _notify_task_assignee(
                event_type='darkstore.pick.assigned', task_type='PICK',
                task_id=task.pk, aggregate_id=task.picklist_id,
                user_id=task.assigned_to, order=task.order,
            )

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def assign(self, request, pk=None):
        """Hand this pick to one worker. Unassign by sending user=null."""
        task = self.get_object()
        if task.status in ('COMPLETED', 'CANCELLED'):
            return Response({'error': f'Task is {task.status} and cannot be reassigned.'}, status=400)
        user = request.data.get('user')
        if user in (None, '', 'null'):
            task.assigned_to = None
            task.save(update_fields=['assigned_to'])
            return Response({'success': True, 'assigned_to': None, 'status': task.status})
        previous_assignee = task.assigned_to
        task.assigned_to = user
        if task.status == 'NOT_STARTED':
            from django.utils import timezone as _tz
            task.status = 'IN_PROGRESS'
            task.started_at = task.started_at or _tz.now()
            # Work attribution: the assignee is who will do the picking, so
            # they are who the start is recorded against, not the manager
            # handing the task over.
            task.started_by = user
        task.save()
        if str(previous_assignee or '') != str(task.assigned_to):
            _notify_task_assignee(
                event_type='darkstore.pick.assigned', task_type='PICK',
                task_id=task.pk, aggregate_id=task.picklist_id,
                user_id=task.assigned_to, order=task.order,
            )
        return Response({'success': True, 'assigned_to': str(task.assigned_to), 'status': task.status})

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        task = self.get_object()
        if task.status in ('COMPLETED', 'CANCELLED'):
            return Response({'error': f'Task is {task.status}.'}, status=400)
        task.assigned_to = None
        task.save(update_fields=['assigned_to'])
        return Response({'success': True, 'assigned_to': None})

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def complete(self, request, pk=None):
        from django.utils import timezone as _tz
        task = self.get_object()
        if task.status == 'COMPLETED':
            return Response({'success': True, 'already_completed': True, 'picked_qty': task.picked_qty})
        if not task.picked_qty:
            task.picked_qty = task.qty
        task.status = 'COMPLETED'
        task.completed_at = task.completed_at or _tz.now()
        # Stamped from the token; a body-supplied actor_id can never claim
        # someone else's completion (same rule as the pick-scan endpoint).
        task.completed_by = acting_user_id(request)
        if task.started_at is None:
            task.started_at = task.completed_at
            if task.started_by is None:
                task.started_by = task.completed_by
        task.save()
        site = self._apply_pick_to_ledger(task, str(acting_user_id(request) or ''))
        return Response({'success': True, 'picklist_id': str(task.picklist_id),
                         'picked_qty': task.picked_qty, 'status': task.status,
                         'site': site.code if site else None})

class PackTaskViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = PackTask.objects.select_related('order__site').all()
    serializer_class = PackTaskSerializer
    attribution_fields = ('assigned_to', 'completed_by')
    filterset_fields = {
        'status': ['exact'],
        'assigned_to': ['exact'],
        'completed_by': ['exact'],
        'order': ['exact'],
        'created_at': ['gte', 'lte'],
        'completed_at': ['gte', 'lte'],
    }

    def get_queryset(self):
        from .access import is_superuser, operator_site_codes
        if is_superuser(self.request.user):
            return self.queryset
        return self.queryset.filter(order__site__code__in=operator_site_codes(self.request.user))

    def perform_create(self, serializer):
        order = serializer.validated_data.get('order')
        if order is None:
            from .access import is_superuser
            if not is_superuser(self.request.user):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Pack task must be linked to an order at your facility.')
        else:
            from .access import require_site_access, require_session_facility
            require_site_access(self.request.user, order.site.code)
            require_session_facility(self.request.user, order.site.code)
        serializer.save()

    @transaction.atomic
    def perform_update(self, serializer):
        task = serializer.instance
        order = serializer.validated_data.get('order', task.order)
        if order:
            from .access import require_site_access, require_session_facility
            require_site_access(self.request.user, order.site.code)
            require_session_facility(self.request.user, order.site.code)
        previous_assignee = task.assigned_to
        serializer.save()
        if (task.assigned_to and
                str(previous_assignee or '') != str(task.assigned_to)):
            _notify_task_assignee(
                event_type='darkstore.pack.assigned', task_type='PACK',
                task_id=task.pk, aggregate_id=task.packlist_id,
                user_id=task.assigned_to, order=task.order,
            )

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def assign(self, request, pk=None):
        task = self.get_object()
        if task.status in ('COMPLETED', 'CANCELLED'):
            return Response({'error': f'Task is {task.status} and cannot be reassigned.'}, status=400)
        user = request.data.get('user')
        if user in (None, '', 'null'):
            task.assigned_to = None
            task.save(update_fields=['assigned_to'])
            return Response({'success': True, 'assigned_to': None, 'status': task.status})
        previous_assignee = task.assigned_to
        task.assigned_to = user
        if task.status == 'NOT_STARTED':
            task.status = 'IN_PROGRESS'
            from django.utils import timezone as _tz
            task.started_at = task.started_at or _tz.now()
        task.save()
        if str(previous_assignee or '') != str(task.assigned_to):
            _notify_task_assignee(
                event_type='darkstore.pack.assigned', task_type='PACK',
                task_id=task.pk, aggregate_id=task.packlist_id,
                user_id=task.assigned_to, order=task.order,
            )
        return Response({'success': True, 'assigned_to': str(task.assigned_to), 'status': task.status})

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        task = self.get_object()
        if task.status in ('COMPLETED', 'CANCELLED'):
            return Response({'error': f'Task is {task.status}.'}, status=400)
        task.assigned_to = None
        task.save(update_fields=['assigned_to'])
        return Response({'success': True, 'assigned_to': None})

class SortingWaveViewSet(viewsets.ModelViewSet):
    queryset = SortingWave.objects.all()
    serializer_class = SortingWaveSerializer
    filterset_fields = ['status', 'type']

    def get_queryset(self):
        from .access import is_superuser, operator_site_codes
        if is_superuser(self.request.user):
            return self.queryset
        codes = operator_site_codes(self.request.user)
        transfer_ids = TransferOrder.objects.filter(
            source_site__code__in=codes,
        ).values_list('transfer_id', flat=True)
        from bounded.fulfilment.models import Batch
        site_batch_ids = Batch.objects.filter(site__code__in=codes).values_list('batch_id', flat=True)
        return self.queryset.filter(batch__in=list(transfer_ids) + list(site_batch_ids))

class StagedAgingViewSet(viewsets.ReadOnlyModelViewSet):
    """How long a packed order has been sitting before a rider collects it.

    Read-only and narrowed to the caller's stores: staged ageing says how much
    work is waiting at each site, and an operator at one store has no business
    watching another store's queue.
    """
    queryset = StagedAging.objects.all()
    serializer_class = StagedAgingSerializer
    filterset_fields = ['site', 'current_stage']

    def get_queryset(self):
        from .access import is_superuser, operator_site_codes

        user = self.request.user
        if user is None or not getattr(user, 'is_authenticated', False):
            return self.queryset.none()
        if is_superuser(user):
            return self.queryset
        return self.queryset.filter(site__in=operator_site_codes(user))

class TransferOrderViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = TransferOrder.objects.select_related(
        'source_site', 'dest_site',
    ).all()
    serializer_class = TransferOrderSerializer
    attribution_fields = ('created_by', 'dispatched_by')
    filterset_fields = {
        'status': ['exact'],
        'source_site': ['exact'],
        'dest_site': ['exact'],
        'created_by': ['exact'],
        'dispatched_by': ['exact'],
        'created_at': ['gte', 'lte'],
    }

    def get_queryset(self):
        from django.db.models import (
            Count, IntegerField, OuterRef, Q, Subquery, Sum, Value,
        )
        from django.db.models.functions import Coalesce
        from bounded.catalog.models import Sku
        from bounded.inventory.models import LpnContent
        from .access import is_superuser, operator_site_codes

        qs = self.queryset
        # One correlated projection for the whole page. The pick lines are
        # linked by the bare `batch` UUID (not an FK), so a join is impossible;
        # a subquery keeps a 100-row ledger at one query instead of 300.
        picks = PickTask.objects.filter(batch=OuterRef('transfer_id'))
        pick_totals = picks.values('batch').annotate(
            lines=Count('id'),
            skus=Count('sku', distinct=True),
            ordered=Sum('qty'),
            picked=Sum('picked_qty'),
            short=Sum('short_qty'),
        )
        contents = LpnContent.objects.filter(lpn__transfer=OuterRef('transfer_id'))
        packed = contents.values('lpn__transfer').annotate(total=Sum('qty'))
        packed_skus = contents.values('lpn__transfer').annotate(
            skus=Count('sku', distinct=True))
        # There is no "section" column on a transfer order. The closest real
        # value is the category of the first SKU on the pick list, so it is
        # resolved through the pick rows rather than invented. Two annotations:
        # the first SKU id is projected onto the transfer, then the category is
        # looked up from that annotation (an OuterRef cannot be nested inside
        # another model's filter).
        first_sku = picks.order_by('pick_seq').values('sku')[:1]
        section = Sku.objects.filter(
            sku_id=OuterRef('first_sku_id')
        ).values('category__name')[:1]

        def total(subquery):
            return Coalesce(
                Subquery(subquery.values('total')[:1], output_field=IntegerField()),
                Value(0),
            )

        def count(subquery):
            return Coalesce(
                Subquery(subquery.values('skus')[:1], output_field=IntegerField()),
                Value(0),
            )

        qs = qs.annotate(
            pick_lines=Coalesce(
                Subquery(pick_totals.values('lines')[:1], output_field=IntegerField()),
                Value(0)),
            sku_count=Coalesce(
                Subquery(pick_totals.values('skus')[:1], output_field=IntegerField()),
                Value(0)),
            ordered_units=Coalesce(
                Subquery(pick_totals.values('ordered')[:1], output_field=IntegerField()),
                Value(0)),
            picked_units=Coalesce(
                Subquery(pick_totals.values('picked')[:1], output_field=IntegerField()),
                Value(0)),
            short_units=Coalesce(
                Subquery(pick_totals.values('short')[:1], output_field=IntegerField()),
                Value(0)),
            lpn_units=total(packed),
            lpn_sku_count=count(packed_skus),
            first_sku_id=Subquery(first_sku),
        )
        qs = qs.annotate(section=Subquery(section))

        if is_superuser(self.request.user):
            return qs
        codes = operator_site_codes(self.request.user)
        return qs.filter(
            Q(source_site__code__in=codes) | Q(dest_site__code__in=codes))

    def perform_create(self, serializer):
        from .access import is_superuser, operator_site_codes
        if not is_superuser(self.request.user):
            codes = operator_site_codes(self.request.user)
            source = serializer.validated_data['source_site'].code
            dest = serializer.validated_data['dest_site'].code
            if source not in codes and dest not in codes:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('You must be assigned to the source or destination facility.')
        serializer.save(created_by=acting_user_id(self.request))

    def _lpns_for(self, to):
        """LPNs explicitly packed against this transfer.

        Matching on source/dest lane alone would sweep up unrelated LPNs when two
        transfers share a lane, so the LPN must name its transfer.
        """
        from bounded.inventory.models import LpnMaster
        return LpnMaster.objects.filter(
            transfer_id=to.pk,
            status__in=['PACKED', 'CREATED'],
        )

    def _mark_in_transit(self, to):
        """Move packed LPN stock into a source-site transit balance."""
        from django.db.models import F
        from bounded.inventory.models import LpnContent, StockBalance
        from bounded.inventory.stock import apply_stock
        moved = []
        for lpn in self._lpns_for(to):
            contents = list(LpnContent.objects.filter(lpn=lpn).select_related('sku', 'lot'))
            if not contents:
                continue
            lpn.status = 'IN_TRANSIT'
            lpn.save(update_fields=['status'])
            moved.append(lpn.barcode)

            # Relieve source site LPN custody on dispatch so goods move cleanly to transit
            source_site = lpn.current_site or lpn.source_site or to.source_site
            if source_site:
                transit_ref = _transfer_transit_ref(lpn)
                for c in contents:
                    bal = StockBalance.objects.filter(
                        site=source_site, container='LPN',
                        container_ref=str(lpn.lpn_id), sku=c.sku, lot=c.lot,
                    ).first()
                    available = int(bal.qty) if bal else 0
                    if available < int(c.qty):
                        from rest_framework import serializers
                        raise serializers.ValidationError({
                            'stock': (f'{lpn.barcode} has {available} {c.sku.sku_code} '
                                      f'in its LPN balance, but its manifest contains {c.qty}.'),
                        })
                    ref_id = f'{to.transfer_id}:{lpn.lpn_id}'
                    apply_stock(
                        site=source_site, sku=c.sku, lot=c.lot,
                        qty=c.qty, direction='OUT',
                        movement_type='TRANSFER_DISPATCH', ref_type='TRANSFER',
                        ref_id=ref_id,
                        actor_id=str(to.dispatched_by or ''),
                        container='LPN', container_ref=str(lpn.lpn_id),
                        enforce_available=True,
                    )
                    # SITE is a supported stock-balance container. A unique
                    # per-LPN reference keeps each tote's transit balance
                    # separate while preserving the network ledger total.
                    apply_stock(
                        site=source_site, sku=c.sku, lot=c.lot,
                        qty=c.qty, direction='IN',
                        movement_type='TRANSFER_DISPATCH', ref_type='TRANSFER',
                        ref_id=ref_id,
                        actor_id=str(to.dispatched_by or ''),
                        container='SITE', container_ref=transit_ref,
                        supply_from='LPN', supply_from_ref=str(lpn.lpn_id),
                        sellable=False,
                    )
                    TransferOrderLine.objects.filter(
                        transfer=to, sku=c.sku, lot=c.lot,
                    ).update(shipped_qty=F('shipped_qty') + c.qty)
        return moved

    def _enqueue_dispatch_event(self, to):
        """Publish a transfer-dispatched event inside the same transaction."""
        try:
            from bounded.outbox.services import enqueue_event
            enqueue_event(
                aggregate_type='TransferOrder',
                aggregate_id=to.transfer_id,
                event_type='warehouse.transfer.dispatched',
                payload_json={
                    'transfer_id': str(to.transfer_id),
                    'source_site': to.source_site.code if to.source_site_id else '',
                    # Supervisors at the destination need the heads-up.
                    'site_code': to.dest_site.code if to.dest_site_id else '',
                    'status': to.status,
                    'dispatched_by': str(to.dispatched_by) if to.dispatched_by else '',
                },
            )
        except Exception:  # noqa: BLE001
            pass

    @transaction.atomic
    def perform_update(self, serializer):
        to = serializer.instance
        from .access import is_superuser, operator_site_codes
        if not is_superuser(self.request.user):
            codes = operator_site_codes(self.request.user)
            source = serializer.validated_data.get('source_site', to.source_site).code
            dest = serializer.validated_data.get('dest_site', to.dest_site).code
            if source not in codes and dest not in codes:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('You must be assigned to the source or destination facility.')
        was = to.status
        serializer.save()
        if to.status == 'IN_TRANSIT' and was != 'IN_TRANSIT':
            # The PUT path to dispatch must record who put it on the road,
            # exactly like the dedicated dispatch action below.
            to.dispatched_by = acting_user_id(self.request)
            to.save(update_fields=['dispatched_by'])
            self._mark_in_transit(to)
            self._enqueue_dispatch_event(to)

    @action(detail=True, methods=['post'], url_path='dispatch',
            permission_classes=[IsAuthenticated, IsFieldSurface])
    @transaction.atomic
    def mark_dispatch(self, request, pk=None):
        to = self.get_object()
        if to.status == 'IN_TRANSIT':
            return Response({'success': True, 'already_dispatched': True,
                             'transfer_id': str(to.transfer_id),
                             'status': to.status, 'lpns_dispatched': []})
        to.status = 'IN_TRANSIT'
        to.dispatched_by = acting_user_id(request)
        to.save()
        moved = self._mark_in_transit(to)
        self._enqueue_dispatch_event(to)
        return Response({'success': True, 'transfer_id': str(to.transfer_id),
                         'status': to.status, 'lpns_dispatched': moved})


class TransferOrderLineViewSet(viewsets.ModelViewSet):
    queryset = TransferOrderLine.objects.select_related(
        'transfer', 'transfer__source_site', 'transfer__dest_site', 'sku', 'lot').all()
    serializer_class = TransferOrderLineSerializer
    filterset_fields = {
        'transfer': ['exact'],
        'status': ['exact'],
        'sku': ['exact'],
        'lot': ['exact'],
    }
    search_fields = ['sku__sku_code', 'sku__name', 'lot__batch_number']
    ordering_fields = ['transfer', 'line_no', 'ordered_qty']

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsFieldSurface()]

    def get_queryset(self):
        from django.db.models import Q
        from .access import is_superuser, operator_site_codes

        if is_superuser(self.request.user):
            return self.queryset
        codes = operator_site_codes(self.request.user)
        return self.queryset.filter(
            Q(transfer__source_site__code__in=codes) | Q(transfer__dest_site__code__in=codes))

    def _require_transfer_access(self, transfer):
        from rest_framework.exceptions import PermissionDenied
        from .access import is_superuser, operator_site_codes

        if is_superuser(self.request.user):
            return
        codes = operator_site_codes(self.request.user)
        if transfer.source_site.code not in codes and transfer.dest_site.code not in codes:
            raise PermissionDenied('You must be assigned to the source or destination facility.')

    @transaction.atomic
    def perform_create(self, serializer):
        transfer = serializer.validated_data['transfer']
        self._require_transfer_access(transfer)
        if serializer.validated_data.get('line_no') is None:
            from django.db.models import Max
            last = (TransferOrderLine.objects.filter(transfer=transfer)
                    .aggregate(m=Max('line_no'))['m'])
            serializer.validated_data['line_no'] = (last or 0) + 1
        serializer.save()

    def perform_update(self, serializer):
        transfer = serializer.validated_data.get('transfer', serializer.instance.transfer)
        self._require_transfer_access(transfer)
        serializer.save()


class BinTransferViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = BinTransfer.objects.all()
    serializer_class = BinTransferSerializer
    attribution_fields = ('created_by', 'completed_by')

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsFieldSurface()]
    filterset_fields = {
        'status': ['exact'],
        'source_bin': ['exact'],
        'dest_bin': ['exact'],
        'created_by': ['exact'],
        'completed_by': ['exact'],
        'created_at': ['gte', 'lte'],
    }

    def get_queryset(self):
        from django.db.models import Q
        from bounded.network.models import Location
        from .access import is_superuser, operator_site_codes
        if is_superuser(self.request.user):
            return self.queryset
        codes = operator_site_codes(self.request.user)
        bins = Location.objects.filter(site__code__in=codes).values_list('location_id', flat=True)
        return self.queryset.filter(Q(source_bin__in=bins) | Q(dest_bin__in=bins))

    @transaction.atomic
    def perform_create(self, serializer):
        from bounded.network.models import Location
        from .access import require_site_access, require_session_facility
        from rest_framework.exceptions import ValidationError

        data = serializer.validated_data
        sites = {}
        for field in ('source_bin', 'dest_bin'):
            loc = Location.objects.filter(location_id=data[field]).select_related('site').first()
            if not loc:
                raise ValidationError({field: 'Bin does not exist.'})
            require_site_access(self.request.user, loc.site.code)
            require_session_facility(self.request.user, loc.site.code)
            sites[field] = loc.site_id
        if data['source_bin'] == data['dest_bin']:
            raise ValidationError({'dest_bin': 'Source and destination are the same bin.'})
        # A bin move happens inside one building. Allowing two sites here would
        # produce a "completed" transfer that silently changed ownership without
        # a transfer order, a dispatch or a custody record.
        if sites['source_bin'] != sites['dest_bin']:
            raise ValidationError({
                'dest_bin': 'A bin transfer cannot cross sites. Use a transfer order.'
            })
        serializer.save(created_by=acting_user_id(self.request))

    @transaction.atomic
    def perform_update(self, serializer):
        from bounded.network.models import Location
        from .access import require_site_access, require_session_facility
        from rest_framework.exceptions import ValidationError

        task = serializer.instance
        was_completed = task.status == 'COMPLETED'
        sites = {}
        for field in ('source_bin', 'dest_bin'):
            location_id = serializer.validated_data.get(field, getattr(task, field))
            loc = Location.objects.filter(location_id=location_id).select_related('site').first()
            if not loc:
                raise ValidationError({field: 'Bin does not exist.'})
            require_site_access(self.request.user, loc.site.code)
            require_session_facility(self.request.user, loc.site.code)
            sites[field] = loc.site_id
        source_id = serializer.validated_data.get('source_bin', task.source_bin)
        dest_id = serializer.validated_data.get('dest_bin', task.dest_bin)
        if source_id == dest_id:
            raise ValidationError({'dest_bin': 'Source and destination are the same bin.'})
        if sites['source_bin'] != sites['dest_bin']:
            raise ValidationError({
                'dest_bin': 'A bin transfer cannot cross sites. Use a transfer order.'
            })
        new_status = serializer.validated_data.get('status', task.status)
        if new_status == 'COMPLETED' and not was_completed:
            if task.status == 'CANCELLED':
                raise ValidationError({'status': 'A cancelled transfer cannot be completed.'})
            scanned_items = serializer.validated_data.get('scanned_items', task.scanned_items)
            self._validate_scanned_items(task, scanned_items)
        serializer.save()
        if task.status == 'COMPLETED' and not was_completed:
            self._move_bin_stock(task)
            serializer.instance.completed_by = acting_user_id(self.request)
            serializer.instance.save(update_fields=['completed_by'])

    def _move_bin_stock(self, transfer):
        """Move every unit in the source bin to the destination bin.

        A BinTransfer row on its own is only an instruction. Completing it used
        to change a status and nothing else, so the stock stayed on the source
        shelf and the destination appeared empty - while the completed record
        said the move had happened. Each balance is moved through the same
        ledger every other stock change uses.
        """
        from bounded.inventory.models import StockBalance
        from bounded.inventory.stock import InsufficientStock, apply_stock
        from bounded.network.models import Location
        from rest_framework.exceptions import ValidationError

        source = Location.objects.select_related('site').filter(
            location_id=transfer.source_bin).first()
        if source is None:
            raise ValidationError({'source_bin': 'Source bin no longer exists.'})

        balances = list(
            StockBalance.objects.filter(
                site=source.site, container='BIN',
                container_ref=transfer.source_bin, qty__gt=0,
            ).select_for_update().select_related('sku', 'lot')
        )
        if not balances:
            # An empty source is a valid completion (clearing an already empty
            # shelf). The point of this method is that when stock *is* present
            # it actually moves; it is not a requirement that stock exist.
            return

        for bal in balances:
            ref_id = str(transfer.transfer_id)
            try:
                apply_stock(
                    site=source.site, sku=bal.sku, lot=bal.lot, qty=bal.qty,
                    direction='OUT', movement_type='BIN_TRANSFER',
                    ref_type='BINTRANSFER', ref_id=ref_id,
                    actor_id=str(acting_user_id(self.request) or ''),
                    actor_type='STAFF', container='BIN',
                    container_ref=transfer.source_bin,
                )
                apply_stock(
                    site=source.site, sku=bal.sku, lot=bal.lot, qty=bal.qty,
                    direction='IN', movement_type='BIN_TRANSFER',
                    ref_type='BINTRANSFER', ref_id=ref_id,
                    actor_id=str(acting_user_id(self.request) or ''),
                    actor_type='STAFF', container='BIN',
                    container_ref=transfer.dest_bin,
                    sellable=bal.sellable,
                    custody=bal.counts_toward_site_custody,
                    supply_from='BIN', supply_from_ref=transfer.source_bin,
                )
            except InsufficientStock as exc:
                raise ValidationError({'stock': str(exc)})

    def _validate_scanned_items(self, transfer, scanned_items):
        from bounded.inventory.models import StockBalance
        from bounded.network.models import Location
        from rest_framework.exceptions import ValidationError

        if not isinstance(scanned_items, dict):
            raise ValidationError({'scanned_items': 'A scanned SKU-to-quantity manifest is required.'})
        source = Location.objects.filter(location_id=transfer.source_bin).first()
        if source is None:
            raise ValidationError({'source_bin': 'Source bin no longer exists.'})
        actual = {}
        balances = StockBalance.objects.filter(
            site=source.site, container='BIN',
            container_ref=transfer.source_bin, qty__gt=0,
        ).select_for_update().values_list('sku_id', 'qty')
        for sku_id, qty in balances:
            key = str(sku_id)
            actual[key] = actual.get(key, 0) + int(qty)
        try:
            scanned = {str(sku_id): int(qty) for sku_id, qty in scanned_items.items()}
        except (TypeError, ValueError):
            raise ValidationError({'scanned_items': 'Each scanned quantity must be an integer.'})
        if any(qty <= 0 for qty in scanned.values()) or scanned != actual:
            raise ValidationError({
                'scanned_items': 'Scanned products and quantities must exactly match the current source-bin stock.',
                'expected': actual,
            })


class DroplistViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = Droplist.objects.select_related('site').all()
    serializer_class = DroplistSerializer
    attribution_fields = ('created_by', 'completed_by')
    filterset_fields = {
        'site': ['exact'],
        'status': ['exact'],
        'source_bin': ['exact'],
        'dest_bin': ['exact'],
        'created_at': ['gte', 'lte'],
    }
    search_fields = ['code', 'site__code', 'source_bin', 'dest_bin', 'notes']
    ordering_fields = ['created_at', 'code', 'dropped_count']

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsFieldSurface()]

    def get_queryset(self):
        from .access import is_superuser, operator_site_codes
        if is_superuser(self.request.user):
            return self.queryset
        codes = operator_site_codes(self.request.user)
        return self.queryset.filter(site__code__in=codes)

    def _validate_bins(self, site, source_bin, dest_bin):
        from bounded.network.models import Location
        from .access import require_site_access, require_session_facility
        from rest_framework.exceptions import ValidationError

        require_site_access(self.request.user, site.code)
        require_session_facility(self.request.user, site.code)
        if source_bin == dest_bin:
            raise ValidationError({'dest_bin': 'Source and destination bins must differ.'})
        for field, bin_id in (('source_bin', source_bin), ('dest_bin', dest_bin)):
            location = Location.objects.filter(location_id=bin_id).first()
            if location is None:
                raise ValidationError({field: 'Bin does not exist.'})
            if location.site_id != site.site_id:
                raise ValidationError({field: 'Bin does not belong to the droplist site.'})

    def perform_create(self, serializer):
        data = serializer.validated_data
        self._validate_bins(data['site'], data['source_bin'], data['dest_bin'])
        serializer.save(created_by=acting_user_id(self.request))

    def perform_update(self, serializer):
        droplist = serializer.instance
        site = serializer.validated_data.get('site', droplist.site)
        source_bin = serializer.validated_data.get('source_bin', droplist.source_bin)
        dest_bin = serializer.validated_data.get('dest_bin', droplist.dest_bin)
        self._validate_bins(site, source_bin, dest_bin)
        was_completed = droplist.status == 'COMPLETED'
        new_status = serializer.validated_data.get('status', droplist.status)
        if new_status == 'COMPLETED' and not was_completed and droplist.status == 'CANCELLED':
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'status': 'A cancelled droplist cannot be completed.'})
        serializer.save()
        if serializer.instance.status == 'COMPLETED' and not was_completed:
            serializer.instance.completed_by = acting_user_id(self.request)
            serializer.instance.save(update_fields=['completed_by'])


# Dark Store Standalone Views (local imports to avoid circular dependencies)
class DSOverviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import timedelta
        from django.utils import timezone
        from django.db.models import (
            Sum, Count, Avg, Q, F, DurationField, ExpressionWrapper,
        )
        from django.db.models.functions import Extract
        from bounded.network.models import Site
        from bounded.orders.models import CustomerOrder
        from bounded.inventory.models import LpnMaster, StockBalance
        from bounded.delivery.models import RiderProfile
        from bounded.ds_ops.models import PickTask
        from bounded.network.models import EmployeeSiteAssignment
        from bounded.supply.models import PutawayTask

        store_code = request.query_params.get('store_code', '')
        site = None
        if store_code:
            try:
                site = Site.objects.get(code=store_code)
            except Site.DoesNotExist:
                return Response({'error': 'Site not found'}, status=404)

        orders = CustomerOrder.objects.all()
        if site:
            orders = orders.filter(site=site)
        today_start = timezone.now() - timedelta(days=1)

        def _orders():
            return CustomerOrder.objects.filter(site=site) if site else CustomerOrder.objects.all()

        total_orders = _orders().count()
        active_orders = _orders().filter(
            status__in=['PLACED', 'PAYMENT_PENDING', 'CONFIRMED', 'PICKING',
                        'INTERRUPTED', 'PARTIALLY_FULFILLED', 'PICKED',
                        'RACK_DROPPED', 'PACKED', 'PRICE_FINALIZED', 'STAGED']
        ).count()
        out_for_delivery = _orders().filter(status__in=['RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED']).count()

        # Delivered in the last 24h, and the money actually collected for them.
        delivered_today = _orders().filter(status='DELIVERED', delivered_at__gte=today_start)
        today_dispatched_orders = delivered_today.count()
        revenue = delivered_today.aggregate(s=Sum('grand_total'))['s'] or 0

        # SLA: delivered vs. cancelled-after-placement, over the same window.
        settled_today = _orders().filter(
            Q(status='DELIVERED', delivered_at__gte=today_start)
            | Q(status__in=['CANCELLED', 'CANCELLED_PENDING_RETURN', 'EXPIRED', 'FAILED', 'REFUNDED'],
                placed_at__gte=today_start)
        ).count()
        delivered_today_count = delivered_today.count()
        # Null (not 0) when nothing settled: "no data" must not read as "0% SLA".
        sla_compliance_pct = round(100.0 * delivered_today_count / settled_today, 2) if settled_today else None

        # Real pick duration: completed tasks that recorded start and finish.
        # Subtracting two timestamps gives an interval, not a float. Wrapping
        # the difference in FloatField made Postgres hand back a timedelta that
        # Django's float converter could not cast, so this dashboard 500'd as
        # soon as one pick had both timestamps. Extract epoch seconds from an
        # explicit DurationField instead.
        picks = PickTask.objects.filter(completed_at__isnull=False, started_at__isnull=False)
        avg_pick = picks.annotate(
            duration=ExpressionWrapper(
                F('completed_at') - F('started_at'), output_field=DurationField(),
            )
        ).annotate(
            secs=Extract('duration', 'epoch'),
        ).aggregate(a=Avg('secs'))['a']

        pickers = EmployeeSiteAssignment.objects.filter(is_active=True)
        if site:
            pickers = pickers.filter(site=site)
        active_pickers_count = pickers.filter(role_at_site__icontains='pick').count()

        riders = RiderProfile.objects.filter(is_online=True)
        if site:
            riders = riders.filter(current_site=site)
        online_riders_count = riders.count()

        if site:
            lpn_qs = LpnMaster.objects.filter(current_site=site)
            incoming_lpns = LpnMaster.objects.filter(dest_site=site, status='IN_TRANSIT').count()
            shelf_inventory = StockBalance.objects.filter(site=site).aggregate(
                total_units=Sum('qty'),
                total_skus=Count('sku', distinct=True)
            )
        else:
            lpn_qs = LpnMaster.objects.all()
            incoming_lpns = LpnMaster.objects.filter(dest_site__isnull=False, status='IN_TRANSIT').count()
            shelf_inventory = StockBalance.objects.all().aggregate(
                total_units=Sum('qty'),
                total_skus=Count('sku', distinct=True)
            )
        total_lpns = lpn_qs.count()

        open_putaways = PutawayTask.objects.all()
        if site:
            open_putaways = open_putaways.filter(grn_line__grn__asn__dest_site=site)
        pending_putaways = open_putaways.exclude(status='CONFIRMED').count()

        status_counts = {
            row['status']: row['n']
            for row in _orders().values('status').annotate(n=Count('order_id'))
        }
        pending_pick_queue = 0
        if site:
            pending_pick_queue = PickTask.objects.filter(
                order__site=site, status__in=['NOT_STARTED', 'IN_PROGRESS'],
                assigned_to__isnull=True).count()

        return Response({
            'scope': {'site': site.code if site else None, 'site_name': site.name if site else None},
            'sla_compliance_pct': sla_compliance_pct,
            'avg_pick_time_sec': round(avg_pick, 1) if avg_pick is not None else None,
            'active_pickers_count': active_pickers_count,
            'online_riders_count': online_riders_count,
            'today_dispatched_orders': today_dispatched_orders,
            'today_revenue': str(revenue),
            'total_orders': total_orders,
            'active_orders': active_orders,
            'out_for_delivery': out_for_delivery,
            'total_lpns': total_lpns,
            'incoming_lpns': incoming_lpns,
            'pending_putaways': pending_putaways,
            'shelf_inventory': shelf_inventory,
            # Chart tiles: the four queues a shift actually watches.
            'orders_pending': (
                status_counts.get('PLACED', 0)
                + status_counts.get('CONFIRMED', 0)),
            'orders_picking': (
                status_counts.get('PICKING', 0)
                + status_counts.get('INTERRUPTED', 0)
                + status_counts.get('PARTIALLY_FULFILLED', 0)),
            'orders_picked': status_counts.get('PICKED', 0),
            'orders_rack_dropped': status_counts.get('RACK_DROPPED', 0),
            'orders_ready': (
                status_counts.get('PACKED', 0)
                + status_counts.get('STAGED', 0)
                + status_counts.get('PRICE_FINALIZED', 0)),
            'orders_delivered_24h': delivered_today_count,
            'pending_pick_queue': pending_pick_queue,
        })

class DSIncomingLpnsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.network.models import Site
        from bounded.inventory.models import LpnMaster
        store_code = request.query_params.get('store_code', '')
        site = None
        if store_code:
            try:
                site = Site.objects.get(code=store_code)
            except Site.DoesNotExist:
                return Response({'error': 'Site not found'}, status=404)

        lpns = LpnMaster.objects.filter(dest_site=site, status='IN_TRANSIT') if site else LpnMaster.objects.filter(status='IN_TRANSIT')
        data = []
        for lpn in lpns:
            contents = list(lpn.contents.all())
            data.append({
                'id': lpn.lpn_id,
                'barcode': lpn.barcode,
                'lpn_type': lpn.lpn_type,
                'status': lpn.status,
                'mother_hub': lpn.source_site.code if lpn.source_site else 'UNKNOWN',
                'item_count': len(contents),
                'total_units': sum(c.qty for c in contents),
                'created_at': str(lpn.created_at),
            })
        return Response(data)


class DSShelfPutawayView(APIView):
    """Break a received LPN down onto the dark store's pick-face bins.

    Receipt parks the stock in the LPN container; this is the step that makes it
    pickable, mirroring the mother-hub putaway flow.
    """
    permission_classes = [IsAuthenticated, IsFieldSurface]

    @transaction.atomic
    def post(self, request):
        from bounded.catalog.models import InventoryLot, Sku
        from bounded.inventory.models import LpnContent, LpnMaster, StockBalance
        from bounded.inventory.stock import apply_stock, InsufficientStock
        from bounded.network.models import Location

        data = request.data
        lpn = LpnMaster.objects.filter(lpn_id=data.get('lpn')).first()
        if lpn is None:
            return Response({'error': 'LPN not found'}, status=404)
        if lpn.status != 'RECEIVED':
            return Response({'error': f'LPN status is {lpn.status}; must be RECEIVED'},
                            status=400)
        site = lpn.current_site
        if site is None:
            return Response({'error': 'LPN has no current site'}, status=400)
        from .access import require_site_access, require_session_facility
        require_site_access(request.user, site.code)
        require_session_facility(request.user, site.code)

        placements = data.get('placements') or []
        if not placements:
            return Response({'error': 'placements[] with {sku, lot, bin, qty} is required'},
                            status=400)

        moved = []
        for p in placements:
            bin_id = p.get('bin') or p.get('location_id')
            loc = Location.objects.filter(location_id=bin_id).first()
            if loc is None:
                return Response({'error': f'Location {bin_id} not found'}, status=400)
            if loc.site_id != site.pk:
                return Response({'error': f'Bin {bin_id} does not belong to {site.code}'},
                                status=400)
            sku = Sku.objects.filter(sku_id=p.get('sku')).first()
            lot = InventoryLot.objects.filter(lot_id=p.get('lot')).first() if p.get('lot') else None
            qty = int(p.get('qty') or 0)
            if sku is None or qty <= 0:
                continue
            try:
                ok = apply_stock(
                    site=site, sku=sku, lot=lot, qty=qty, direction='OUT',
                    movement_type='SHELF_PICK', ref_type='LPN',
                    ref_id=f"{lpn.lpn_id}:{loc.location_id}",
                    container='LPN', container_ref=str(lpn.lpn_id),
                    enforce_available=True,
                )
            except InsufficientStock as e:
                return Response({'error': str(e)}, status=400)
            if not ok:
                continue
            apply_stock(
                site=site, sku=sku, lot=lot, qty=qty, direction='IN',
                movement_type='SHELF_PUTAWAY', ref_type='LPN',
                ref_id=f"{lpn.lpn_id}:{loc.location_id}",
                container='BIN', container_ref=loc.location_id,
            )
            moved.append({'sku': sku.sku_code,
                          'lot': str(lot.lot_id) if lot else None,
                          'bin': loc.location_id, 'qty': qty})

        # Once nothing is left in the tote the LPN is free to re-use.
        remaining = StockBalance.objects.filter(
            site=site, container='LPN', container_ref=str(lpn.lpn_id)
        ).aggregate(t=Sum('qty'))['t'] or 0
        fully_shelved = remaining == 0
        if fully_shelved:
            lpn.status = 'EMPTY'
            lpn.current_container = None
            lpn.current_ref_id = None
            lpn.save(update_fields=['status', 'current_container', 'current_ref_id'])

        # Notify dark-store supervisors that stock has been placed on shelf and is available for picking
        try:
            from bounded.outbox.services import enqueue_event
            enqueue_event(
                aggregate_type='LpnMaster',
                aggregate_id=lpn.lpn_id,
                event_type='warehouse.shelf.putaway',
                payload_json={
                    'lpn_id': str(lpn.lpn_id),
                    'barcode': lpn.barcode,
                    'site_code': site.code,
                    'placed_count': len(moved),
                    'lpn_emptied': fully_shelved,
                },
            )
        except Exception:  # noqa: BLE001
            pass

        return Response({'success': True, 'lpn': str(lpn.lpn_id),
                         'site': site.code, 'shelved': moved,
                         'lpn_status': lpn.status,
                         'lpn_emptied': fully_shelved})

class DSInventoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.network.models import Site
        from bounded.catalog.models import InventoryLot
        from bounded.inventory.models import StockBalance
        store_code = request.query_params.get('store_code', '')
        site = None
        if store_code:
            try:
                site = Site.objects.get(code=store_code)
            except Site.DoesNotExist:
                return Response({'error': 'Site not found'}, status=404)

        qty_by_lot = dict(
            StockBalance.objects.filter(site=site)
            .values_list('lot_id')
            .annotate(total=Sum('qty'))
        ) if site else {}

        # The bin a lot is actually shelved in is the BIN container's ref, not
        # InventoryLot.bucket — `bucket` is a quality state (Good / BAD /
        # QC_HOLD) and reading it as a location made every row report "Bin: Good".
        # A lot split across several bins keeps its first ref; this field is a
        # display hint, and the authoritative per-bin position is StockBalance.
        bin_by_lot = {}
        if site:
            for lot_id, ref in StockBalance.objects.filter(
                site=site, container='BIN'
            ).values_list('lot_id', 'container_ref'):
                if ref:
                    bin_by_lot.setdefault(lot_id, ref)

        # The store holds stock through `StockBalance`, and the lots those
        # balances point at are raised at the warehouse that owns the product
        # (WH-02A599 for DS-02A599), never at the dark store. Selecting
        # `InventoryLot` by this site therefore matched nothing at all: every
        # dark store rendered "no stock" here while the command centre beside
        # it reported units, because that tile sums `StockBalance`. Pick the
        # lots this store actually holds instead.
        #
        # With no store selected there is no shelf to describe, so the answer
        # is an empty list rather than every lot in the network wearing a
        # zero balance.
        held = (StockBalance.objects.filter(site=site)
                if site else StockBalance.objects.none())
        lots = (InventoryLot.objects.filter(lot_id__in=held.values('lot_id'))
                .select_related('sku').distinct())
        data = []
        for lot in lots:
            on_hand = qty_by_lot.get(lot.lot_id, 0)
            data.append({
                'id': str(lot.lot_id),
                'sku': str(lot.sku.sku_id),
                'sku_code': lot.sku.sku_code,
                'product_name': lot.sku.name,
                'category': lot.sku.sub_category or 'General',
                'batch_code': lot.batch_number,
                'expiry_date': str(lot.expiry_date) if lot.expiry_date else None,
                'stock_qty': on_hand,
                # InventoryLot has no `available_qty`. The old status expression
                # read one, so this endpoint raised AttributeError and 500'd on
                # every request; the badge now derives from the same on-hand sum
                # this endpoint reports as `stock_qty`, so the two agree.
                'min_threshold': None,
                'mrp': float(lot.mrp) if lot.mrp else 0,
                'shelf_bin': bin_by_lot.get(lot.lot_id),
                'status': 'OPTIMAL' if on_hand > DS_LOW_STOCK_THRESHOLD
                          else 'LOW_STOCK' if on_hand > 0
                          else 'OUT_OF_STOCK',
                'lot_bucket': lot.bucket,
                'storage_zone': lot.sku.storage_zone,
            })
        return Response(data)

class DSReceiveLpnView(APIView):
    permission_classes = [IsAuthenticated, IsFieldSurface]

    @transaction.atomic
    def post(self, request):
        from bounded.inventory.models import LpnContent, LpnMaster, StockBalance
        from bounded.inventory.stock import apply_stock
        from bounded.network.models import Site
        data = request.data
        barcode = data.get('barcode')
        seal = data.get('seal_number')
        # The receiving operator is whoever holds the token. Trusting
        # `received_by` from the body let any caller sign a receipt in another
        # person's name; it is accepted only as a harmless label and never used
        # for the ledger.
        received_by = acting_user_id(request) or ''
        actor_type = getattr(request.user, 'role', 'STAFF') or 'STAFF'
        store_code = data.get('store_code', '')

        if not store_code:
            return Response({'error': 'store_code is required'}, status=400)
        try:
            site = Site.objects.get(code=store_code)
        except Site.DoesNotExist:
            return Response({'error': 'Store not found'}, status=404)

        from .access import require_site_access, require_session_facility
        require_site_access(request.user, site.code)
        require_session_facility(request.user, site.code)

        lpn = LpnMaster.objects.filter(barcode=barcode).first()
        if not lpn:
            return Response({'error': 'LPN not found'}, status=404)

        if lpn.status == 'RECEIVED' and lpn.current_site_id == site.pk:
            return Response({'success': True, 'already_received': True,
                             'lpn_barcode': lpn.barcode,
                             'site': site.code,
                             'stock_moved': [],
                             'message': 'LPN already received in dark store custody'})

        if lpn.dest_site_id and lpn.dest_site_id != site.pk:
            return Response({
                'error': f'That tote is destined for {lpn.dest_site.code}, not {site.code}. Do not receive it here.'
            }, status=400)

        from_site = lpn.current_site or lpn.source_site
        moved = []
        if from_site and from_site.pk != site.pk:
            # Move each item out of its source-site transit balance and into
            # destination LPN custody. Legacy LPNs that predate transit balance
            # accounting may still hold stock directly in the source LPN.
            for c in LpnContent.objects.filter(lpn=lpn).select_related('sku', 'lot'):
                try:
                    transit_ref = _transfer_transit_ref(lpn)
                    from_bal = StockBalance.objects.filter(
                        site=from_site, container='SITE', container_ref=transit_ref,
                        sku=c.sku, lot=c.lot,
                    ).first()
                    source_lpn_bal = StockBalance.objects.filter(
                        site=from_site, container='LPN', container_ref=str(lpn.lpn_id),
                        sku=c.sku, lot=c.lot
                    ).first()
                    transit_qty = int(from_bal.qty) if from_bal else 0
                    legacy_lpn_qty = int(source_lpn_bal.qty) if source_lpn_bal else 0
                    if transit_qty >= int(c.qty):
                        apply_stock(
                            site=from_site, sku=c.sku, lot=c.lot, qty=c.qty,
                            direction='OUT', movement_type='LPN_RECEIPT',
                            ref_type='TRANSFER', ref_id=str(lpn.transfer_id or lpn.lpn_id),
                            actor_id=str(received_by or ''), actor_type=actor_type,
                            container='SITE',
                            container_ref=transit_ref, enforce_available=True,
                        )
                    elif legacy_lpn_qty >= int(c.qty):
                        apply_stock(
                            site=from_site, sku=c.sku, lot=c.lot, qty=c.qty,
                            direction='OUT', movement_type='LPN_RECEIPT',
                            ref_type='TRANSFER', ref_id=str(lpn.transfer_id or lpn.lpn_id),
                            actor_id=str(received_by or ''), actor_type=actor_type,
                            container='LPN',
                            container_ref=str(lpn.lpn_id), enforce_available=True,
                        )
                    else:
                        raise ValueError(
                            f'{lpn.barcode} has only {transit_qty + legacy_lpn_qty} '
                            f'{c.sku.sku_code} in source/transit balances; {c.qty} required.'
                        )

                    if apply_stock(
                            site=site, sku=c.sku, lot=c.lot, qty=c.qty,
                            direction='IN', movement_type='LPN_RECEIPT',
                            ref_type='LPN', ref_id=lpn.lpn_id,
                            actor_id=received_by or '', actor_type=actor_type,
                            container='LPN', container_ref=str(lpn.lpn_id),
                            supply_from='TRANSFER', supply_from_ref=str(lpn.transfer_id or lpn.lpn_id)):
                        moved.append({'sku': c.sku.sku_code, 'qty': c.qty})
                        if lpn.transfer_id:
                            from django.db.models import F
                            from bounded.ds_ops.models import TransferOrderLine
                            TransferOrderLine.objects.filter(
                                transfer_id=lpn.transfer_id, sku=c.sku, lot=c.lot,
                            ).update(received_qty=F('received_qty') + c.qty)
                except Exception as e:
                    transaction.set_rollback(True)
                    return Response({'error': f'Stock receipt failed: {e}'}, status=400)

        lpn.status = 'RECEIVED'
        lpn.dest_site = site
        lpn.current_site = site
        lpn.save()
        # If this LPN belongs to a TransferOrder, check whether all LPNs on that transfer are now received
        if lpn.transfer_id:
            from bounded.ds_ops.models import TransferOrder
            to = TransferOrder.objects.filter(pk=lpn.transfer_id).first()
            if to and to.status == 'IN_TRANSIT':
                transfer_lpns = LpnMaster.objects.filter(transfer=to)
                if transfer_lpns.exists() and not transfer_lpns.filter(status__in=['IN_TRANSIT', 'PACKED', 'CREATED']).exists():
                    to.status = 'RECEIVED'
                    to.save(update_fields=['status'])

        # Notify dark-store supervisors that an inbound transfer LPN has been scanned into custody
        try:
            from bounded.outbox.services import enqueue_event
            enqueue_event(
                aggregate_type='LpnMaster',
                aggregate_id=lpn.lpn_id,
                event_type='warehouse.lpn.received',
                payload_json={
                    'lpn_id': str(lpn.lpn_id),
                    'barcode': lpn.barcode,
                    'site_code': site.code,
                    'from_site': from_site.code if from_site else '',
                    'transfer_id': str(lpn.transfer_id) if lpn.transfer_id else '',
                    'received_by': str(received_by or ''),
                    'item_count': len(moved),
                },
            )
        except Exception:  # noqa: BLE001
            pass

        return Response({'success': True, 'lpn_barcode': lpn.barcode,
                         'from_site': from_site.code if from_site else None,
                         'site': site.code,
                         'stock_moved': moved,
                         'message': 'LPN received, stock in dark store custody, ready for shelf putaway'})

class DSOrderActionView(APIView):
    permission_classes = [IsAuthenticated, IsFieldSurface]

    # action -> (target status, allowed source statuses)
    #
    # COMPLETE_PICK lands on PICKED, not PACKED. It used to jump straight to
    # PACKED, which made "packed" mean two different things: stock had been
    # scanned off a shelf, and stock was in a tote with an LPN. Nothing could
    # tell them apart, so there was no point at which the pack station could be
    # told to do its job. Picking now stops at PICKED; the pack endpoint owns
    # PICKED -> PACKED.
    #
    # HANDOFF_RIDER and DELIVERED used to live here too, which made this a
    # back door around the whole last mile: one call moved an order to
    # OUT_FOR_DELIVERY without a tote scan, and another to DELIVERED without a
    # pickup code or any cash recorded. Both are now owned by operations that
    # cannot be skipped:
    #
    #   PACKED -> PICKED_UP   POST /delivery/handoff/pickup  (scans the tote)
    #   PICKED_UP -> DELIVERED  POST /delivery/handoff/pod   (needs the customer's
    #                                                   pickup code, and the cash
    #                                                   actually collected for COD)
    #
    # COMPLETE_PICK is the only action a dark-store operator can reach here, and
    # it is the only one that makes sense on a screen in a store.
    ORDER_ACTIONS = {
        'COMPLETE_PICK': ('PICKED', {'CONFIRMED', 'PICKING', 'INTERRUPTED',
                                     'PARTIALLY_FULFILLED'}),
    }

    # Named so the 400 says why, instead of "Unsupported action".
    RETIRED_ACTIONS = {
        'HANDOFF_RIDER': 'Use POST /delivery/handoff/pickup: it verifies the tote '
                         'barcode and moves the units out of the store.',
        'DELIVERED': 'Use POST /delivery/handoff/pod: it requires the pickup code '
                     'the customer reads, and the amount collected on a COD order.',
    }

    def post(self, request):
        from django.utils import timezone
        from bounded.orders.models import CustomerOrder, OrderStatusHistory
        data = request.data
        order_id = data.get('order_id')
        action_val = data.get('action')
        picker = data.get('picker')

        if not order_id:
            return Response({'error': 'order_id is required'}, status=400)
        if action_val not in self.ORDER_ACTIONS:
            retired = self.RETIRED_ACTIONS.get(action_val)
            return Response(
                {
                    'error': (
                        f'{action_val} is no longer available: {retired}'
                        if retired else
                        f'Unsupported action: {action_val!r}'
                    ),
                    'action': action_val,
                    'supported_actions': sorted(self.ORDER_ACTIONS),
                },
                # 410, not 400: the action used to be valid here, so a client
                # that still sends it needs to be moved rather than corrected.
                status=410 if retired else 400,
            )

        try:
            order = CustomerOrder.objects.select_related('site').get(order_id=order_id)
        except (CustomerOrder.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Order not found'}, status=404)

        # An operator can only act on orders belonging to a store they are
        # assigned to. Without this, a picker at DS-A could complete the pick on
        # DS-B's order and mark it PACKED.
        from bounded.ds_ops.access import (
            require_department, require_order_access, require_session_facility,
        )
        require_order_access(request.user, order)
        require_session_facility(request.user, order.site.code)
        require_department(request.user, order.site, 'PICK')

        target_status, allowed_from = self.ORDER_ACTIONS[action_val]
        if order.status not in allowed_from:
            return Response(
                {
                    'error': (
                        f'Cannot {action_val} an order in status {order.status}. '
                        f'Expected one of: {", ".join(sorted(allowed_from))}.'
                    ),
                    'order_id': str(order.order_id),
                    'status': order.status,
                },
                status=409,
            )

        # A pick cannot be declared complete while stock is still on the shelf.
        # Previously the client sent a session tally that the server never saw,
        # and completing a pick moved the order to PACKED without a single unit
        # leaving stock. The authoritative count is CustomerOrderLine.picked_qty,
        # written by DSPickLineView as each unit is scanned off the shelf.
        if action_val == 'COMPLETE_PICK':
            from bounded.orders.models import CustomerOrderLine
            short = [
                {
                    'line_id': str(l.line_id),
                    'line_no': l.line_no,
                    'sku': str(l.sku_id),
                    'qty': l.qty,
                    'picked_qty': l.picked_qty,
                    'outstanding': l.qty - l.picked_qty,
                }
                for l in CustomerOrderLine.objects.filter(order=order)
                if l.picked_qty < l.qty
            ]
            if short:
                return Response(
                    {
                        'error': (
                            f'Order {order.order_no} is not fully picked: '
                            f'{len(short)} line(s) still short. Scan the remaining '
                            f'units, or drop out to put them back.'
                        ),
                        'short_lines': short,
                        'order_id': str(order.order_id),
                        'status': order.status,
                    },
                    status=409,
                )

        previous_status = order.status
        order.status = target_status
        # Only COMPLETE_PICK is reachable, and it stamps no timestamp of its own:
        # picked_up_at and delivered_at belong to the handoff endpoints, which
        # are the only operations that actually move goods and money.
        order.save(update_fields=['status'])

        # CustomerOrder has no assigned_picker column. PickTask.assigned_to is a
        # user UUID (not a display name), so only accept a real user id.
        if action_val == 'COMPLETE_PICK' and picker:
            from bounded.iam.models import User
            from bounded.ds_ops.models import PickTask
            from bounded.network.models import Location
            try:
                picker_user = User.objects.get(user_id=picker)
            except (User.DoesNotExist, ValueError, TypeError):
                picker_user = None
            if picker_user:
                # Fence the sweep to THIS order's tasks. Two earlier bugs are
                # fixed here:
                #  - it used to sweep every open task the operator held anywhere
                #    in the network, so one pick closed out unrelated work;
                #  - it then swept by site bin, which still caught another
                #    order's tasks in the same store.
                # PickTask.order is the honest boundary. `order=None` tasks
                # (legacy allocation rows) are deliberately left alone: they
                # cannot be attributed to this order, so closing them would be a
                # guess. Their own completion endpoint still moves their stock.
                PickTask.objects.filter(
                    order=order,
                    assigned_to=picker_user.user_id,
                ).exclude(status='COMPLETED').update(
                    status='COMPLETED', completed_at=timezone.now(),
                    completed_by=picker_user.user_id,
                )

        OrderStatusHistory.objects.create(
            order=order,
            from_status=previous_status,
            to_status=target_status,
            actor_type=request.user.role,
            actor_id=request.user.user_id,
        )

        # A completed pick frees the picker's slot, so this is the moment the
        # waiting queue gets its next chance. The scheduler does the same thing
        # every minute; doing it here makes the hand-off immediate instead of
        # leaving the next order waiting for the next tick. One order per pass
        # keeps the load balanced.
        if action_val == 'COMPLETE_PICK':
            try:
                from bounded.ds_ops.assignment import assign_pending_orders

                assign_pending_orders(order.site, actor=request.user)
            except Exception:  # noqa: BLE001 - draining the queue is best-effort
                logger.exception(
                    'Could not re-check the pending pick queue for %s', order.site.code)

        return Response({
            'success': True,
            'order_id': str(order.order_id),
            'status': order.status,
            'previous_status': previous_status,
            'message': f'Order {order.order_no}: {previous_status} -> {target_status}',
        })
