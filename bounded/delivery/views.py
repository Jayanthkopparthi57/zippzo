import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .handoff import HandoffError, complete_pod, rider_pickup
from django.db.models import Q

from bounded.iam.models import QRCode
from bounded.iam.permissions import IsAdminUser
from .models import (RiderProfile, RiderShift, DeliveryTask, RoutePlan,
                     RouteStop)
from .serializers import (RiderProfileSerializer, RiderShiftSerializer,
                          DeliveryTaskSerializer, RoutePlanSerializer,
                          RouteStopSerializer)

# DeliveryTask fields that only the pickup / POD endpoints may write. They were
# writable here, which turned PATCH /delivery/delivery-tasks/<id>/ into a second
# unaudited path through the last mile: any authenticated caller could mark a
# task DELIVERED without collecting the goods or settling cash, and no order
# status, shipped_qty or status-history row moved with it.
TASK_LIFECYCLE_FIELDS = {
    'status', 'pickup_at', 'delivered_at', 'accepted_at', 'offered_at',
    'offer_count', 'attempt_no', 'staging_bin', 'packed_at',
}


def _refuse_lifecycle_write(request, fields=TASK_LIFECYCLE_FIELDS):
    attempted = fields.intersection(request.data or {})
    if attempted:
        raise ValidationError({
            field: 'Delivery task lifecycle fields are written by '
                   'POST /delivery/handoff/pickup, /delivery/handoff/pod and '
                   'the accept / advance actions.'
            for field in sorted(attempted)
        })


def _owned_task(user, task):
    """The caller must be the assigned rider, an admin, or the store itself."""
    from bounded.ds_ops.access import is_superuser, require_site_access

    if is_superuser(user) or getattr(user, 'role', '') == 'ADMIN':
        return task
    profile = RiderProfile.objects.filter(user_id=user.user_id).first()
    if profile is None:
        # The handoff screen belongs to the store: the person at the counter
        # hands the staged bag to the rider and reads the customer's code off
        # their phone, so both of its buttons have to work for an operator.
        # Requiring a rider profile here made that screen a 403 for the very
        # account it is written for - it could list the jobs and never record
        # one. The assignment, not the profile, is what earns the right, and a
        # refusal from here carries DRF's normal 403 detail so the console can
        # show which store the caller would need.
        require_site_access(user, task.site.code)
        return task
    if task.rider_id and task.rider_id != profile.rider_id:
        raise ValidationError({'task': 'This delivery task is assigned to another rider.'})
    if not task.rider_id and profile.current_site_id and profile.current_site_id != task.site_id:
        # Unassigned work was readable by every rider in the fleet: nothing in
        # the task ties it to a store the caller works at, so a rider based at
        # one store could collect a staged bag meant for another. The profile's own
        # store is what the offers are built from, so it is the line here.
        # A rider with no store yet is not blocked - going online already
        # requires picking one - but the comparison stays honest and refuses
        # only a rider who is plainly based somewhere else.
        raise ValidationError({'task': 'This job is at a store you are not working at.'})
    return task


def _my_profile(user):
    return RiderProfile.objects.select_related('current_site').filter(
        user_id=user.user_id).first()


def _delivery_queryset_for(user, qs, rider_lookup, site_lookup):
    """Scope a delivery row set the way DeliveryTask already is.

    RoutePlan/RouteStop/RiderShift used to run `filter(rider=_my_profile(user))`
    unconditionally, so any account that is not itself a rider (the WMS console,
    the store operator, an admin) got an empty list even though the routes
    exist. The Dispatch screen therefore always rendered "No route plans".

    Riders still only see their own work; everyone else is scoped to the sites
    they operate; superusers see everything.
    """
    if user is None or not getattr(user, 'is_authenticated', False):
        return qs.none()

    from bounded.ds_ops.access import is_superuser, operator_site_codes

    if is_superuser(user) or getattr(user, 'role', '') == 'ADMIN':
        return qs

    profile = _my_profile(user)
    if profile is not None:
        return qs.filter(**{rider_lookup: profile})

    codes = operator_site_codes(user)
    if codes:
        return qs.filter(**{f'{site_lookup}__code__in': codes})
    return qs.none()


def _notify_delivery_transition(event_type, task):
    """Queue an inbox event with recipient and order-routing metadata."""
    from bounded.outbox.services import enqueue_event

    order = task.order
    rider_user_id = task.rider.user_id if task.rider_id else None
    enqueue_event(
        aggregate_type='DeliveryTask', aggregate_id=task.task_id,
        event_type=event_type, correlation_id=order.order_id,
        payload_json={
            'task_id': str(task.task_id),
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'site_code': task.site.code,
            'rider_user_id': str(rider_user_id) if rider_user_id else None,
        },
    )


def _require_profile(user):
    profile = _my_profile(user)
    if profile is None:
        raise ValidationError({
            'profile': 'This account has no rider profile yet. Create one '
                       'with POST /delivery/rider-profiles/bootstrap before '
                       'taking jobs.'
        })
    return profile


def _record_order_status(order, new_status, actor, previous):
    """Move the customer order forward and append the tracking history row.

    The rider's task status and the order the customer sees are two views of
    the same journey. Only ever moves forward inside the rider's window and
    never resurrects a cancelled or delivered order - a stale task action must
    not rewind the customer's order to RIDER_ASSIGNED after a refund.
    """
    from bounded.orders.models import OrderStatusHistory

    allowed_from = ORDER_STEP_WINDOWS.get(new_status)
    if allowed_from is None or previous not in allowed_from:
        return False
    order.status = new_status
    order.save(update_fields=['status'])
    # `actor=None` is the no-human path (the auto-assign calls without an
    # operator behind them). The UUID is nullable; 'SYSTEM' keeps the audit.
    OrderStatusHistory.objects.create(
        order=order, from_status=previous, to_status=new_status,
        actor_type=(actor.role if actor is not None else 'SYSTEM'),
        actor_id=(str(actor.user_id) if getattr(actor, 'user_id', None) else None))
    return True


# Where each rider-driven order status is allowed to start from. Anything not
# listed (DELIVERED, CANCELLED, REFUNDED, PLACED...) is deliberately excluded.
ORDER_STEP_WINDOWS = {
    'RIDER_ASSIGNED': {'PACKED', 'PRICE_FINALIZED', 'STAGED'},
    'OUT_FOR_DELIVERY': {'PACKED', 'PRICE_FINALIZED', 'STAGED',
                         'RIDER_ASSIGNED', 'PICKED_UP'},
    'ARRIVED': {'PACKED', 'PRICE_FINALIZED', 'STAGED', 'RIDER_ASSIGNED',
                'PICKED_UP', 'OUT_FOR_DELIVERY'},
}

# Rider task transitions the rider drives themselves. Pickup and POD are not
# here: they move stock and money and have their own guarded endpoints.
#
# EN_ROUTE only opens once the store has physically handed the bag over. The
# rider's own phone cannot create the handoff - it belongs to the counter
# screen, where the bag is staging-verified and handed over. Letting a rider
# advance into EN_ROUTE straight from AT_DS meant they could "collect" bags
# nobody had packed or handed over.
TASK_TRANSITIONS = {
    'AT_DS': ({'UNASSIGNED', 'OFFERED', 'ACCEPTED'}, None),
    'EN_ROUTE': ({'PICKED_UP'}, 'OUT_FOR_DELIVERY'),
    'ARRIVED': ({'EN_ROUTE', 'POD_PENDING'}, 'ARRIVED'),
}


class RiderProfileViewSet(viewsets.ModelViewSet):
    queryset = RiderProfile.objects.select_related('user','current_site').all()
    serializer_class = RiderProfileSerializer
    filterset_fields = ['vehicle_type','kyc_status','is_online']

    def get_queryset(self):
        user = getattr(self.request, 'user', None)
        if user is None or not getattr(user, 'is_authenticated', False):
            return self.queryset.none()
        from bounded.ds_ops.access import is_superuser, operator_site_codes
        if is_superuser(user):
            return self.queryset
        profile = _my_profile(user)
        if profile is not None:
            # A rider is their own profile. Without this every authenticated
            # account could PATCH somebody else's is_online, phone or KYC state.
            return self.queryset.filter(rider_id=profile.rider_id)
        # The store's fleet board: an operator *reads* the riders based at the
        # stores they operate. Writes are refused in update/destroy below, so
        # widening the read never widens the right to edit somebody's phone.
        codes = operator_site_codes(user)
        if codes:
            return self.queryset.filter(current_site__code__in=codes)
        return self.queryset.none()

    def create(self, request, *args, **kwargs):
        # Profiles are born through bootstrap, which pins the account's own
        # user id. A generic POST here would let anyone mint a rider row tied
        # to somebody else's user.
        raise PermissionDenied(
            'Rider profiles are created with POST /delivery/rider-profiles/bootstrap.')

    def _require_self_or_admin(self, request, profile):
        from bounded.ds_ops.access import is_superuser
        if is_superuser(request.user) or getattr(request.user, 'role', '') == 'ADMIN':
            return
        if profile.user_id != request.user.user_id:
            raise PermissionDenied('Riders edit their own profile; the store '
                                   'cannot change it from here.')

    def update(self, request, *args, **kwargs):
        self._require_self_or_admin(request, self.get_object())
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._require_self_or_admin(request, self.get_object())
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._require_self_or_admin(request, self.get_object())
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def bootstrap(self, request):
        """Create this account's rider profile the first time they open the app.

        Rider accounts are provisioned as iam users with no delivery rows, so
        the first login had nothing to show and the old UI invented a demo
        delivery instead. This gives them a real profile pinned to their own
        user id, at the store they say they are working.
        """
        from bounded.network.models import Site

        if _my_profile(request.user) is not None:
            return Response(
                {'error': 'This account already has a rider profile.'},
                status=409)

        site_code = request.data.get('site_code') or request.data.get('site')
        site = None
        if site_code:
            site = Site.objects.filter(code=site_code).first()
            if site is None:
                return Response({'error': f'No store with code {site_code}.'},
                                status=404)

        serializer = RiderProfileSerializer(data={
            **request.data,
            'user': str(request.user.user_id),
            'name': request.data.get('name') or request.user.full_name,
        })
        serializer.is_valid(raise_exception=True)
        profile = serializer.save(current_site=site)
        return Response(RiderProfileSerializer(profile).data, status=201)

    @action(detail=False, methods=['post'], url_path='activate-by-qr')
    @transaction.atomic
    def activate_by_qr(self, request):
        """Activate this rider by scanning the store check-in QR.

        The rider is active for FIFO assignment only after this scan: the
        profile goes online at that store and an open RiderShift is started,
        which is also the timestamp checkout's FIFO ordering uses. The store
        QR payload is `zippzo:site:<SITE_CODE>` (also accepts `SITE:<CODE>`
        or the bare code); one QRCode row per store records the scan.
        """
        from bounded.network.models import Site

        profile = _my_profile(request.user)
        if profile is None:
            return Response({'error': 'No rider profile to activate.'}, status=404)
        raw = str(request.data.get('qr') or request.data.get('qr_code')
                  or request.data.get('site_code') or '').strip()
        if not raw:
            return Response({'error': 'Scan the store QR to activate.'}, status=400)
        code = raw
        lowered = code.lower()
        if lowered.startswith('zippzo:site:'):
            code = code[len('zippzo:site:'):]
        elif lowered.startswith('site:'):
            code = code[len('site:'):]
        elif lowered.startswith('store:'):
            code = code[len('store:'):]
        site = Site.objects.filter(code=code.strip().upper()).first()
        if site is None:
            return Response({'error': f'No store matches this QR ({raw[:40]}).'}, status=404)

        qr_code = f'SITE:{site.code}'
        qr, _created = QRCode.objects.get_or_create(
            code=qr_code,
            defaults={'qr_type': 'LOCATION', 'data': {'kind': 'site-checkin', 'site': site.code}},
        )
        qr.scan_count = (qr.scan_count or 0) + 1
        qr.save(update_fields=['scan_count'])

        # One open shift per rider: activating at another store ends the prior
        # shift so the FIFO queue cannot hold the same rider twice.
        now = timezone.now()
        for old in RiderShift.objects.select_for_update().filter(
            rider=profile, status='OPEN',
        ).exclude(site=site):
            old.status = 'CLOSED'
            old.ended_at = now
            old.end_reason = 'FORCED'
            old.save(update_fields=['status', 'ended_at', 'end_reason'])
        shift = RiderShift.objects.select_for_update().filter(
            rider=profile, site=site, status='OPEN').first()
        if shift is None:
            shift = RiderShift.objects.create(rider=profile, site=site, qr_in=qr)
        elif shift.qr_in_id is None:
            shift.qr_in = qr
            shift.save(update_fields=['qr_in'])

        profile.current_site = site
        profile.is_online = True
        profile.save(update_fields=['current_site', 'is_online'])
        return Response({
            'profile': RiderProfileSerializer(profile).data,
            'shift': RiderShiftSerializer(shift).data,
            'active': True,
            'site': site.code,
        })

    @action(detail=False, methods=['post'], url_path='admin-bootstrap')
    @transaction.atomic
    def admin_bootstrap(self, request):
        """Create a rider profile for another user (admin/ops only).

        Self-bootstrap stays the rider's own path; this exists so the store
        can register an employee and hand them a QR without them tapping
        through first-run setup. The profile is pre-pinned to the store but
        starts offline â€” the rider still activates by scanning the QR.
        """
        from bounded.iam.models import User
        from bounded.network.models import Site

        if getattr(request.user, 'role', None) not in ('SUPER_ADMIN', 'OPS_MANAGER', 'ADMIN'):
            raise PermissionDenied('Only administrators or ops can register riders.')
        user_id = request.data.get('user') or request.data.get('user_id')
        user = User.objects.filter(user_id=user_id).first() if user_id else None
        if user is None:
            return Response({'error': 'A valid user is required.'}, status=400)
        if RiderProfile.objects.filter(user=user).exists():
            return Response({'error': 'This account already has a rider profile.'}, status=409)
        site_code = request.data.get('site_code') or request.data.get('site')
        site = Site.objects.filter(code=site_code).first() if site_code else None
        if site_code and site is None:
            return Response({'error': f'No store with code {site_code}.'}, status=404)
        serializer = RiderProfileSerializer(data={
            **request.data,
            'user': str(user.user_id),
            'name': request.data.get('name') or user.full_name,
            'phone': request.data.get('phone') or user.phone or '0000000000',
            'vehicle_type': request.data.get('vehicle_type') or 'BIKE',
            'kyc_status': request.data.get('kyc_status') or 'VERIFIED',
        })
        serializer.is_valid(raise_exception=True)
        profile = serializer.save(current_site=site, is_online=False)
        return Response({
            'profile': RiderProfileSerializer(profile).data,
        }, status=201)

    @action(detail=True, methods=['post'])
    def set_online(self, request, pk=None):
        profile = self.get_object()
        if profile.user_id != request.user.user_id:
            return Response({'error': 'Not your profile.'}, status=403)
        online = str(request.data.get('is_online', '')).lower() in ('1', 'true', 'yes')
        if online and profile.current_site_id is None:
            return Response({
                'error': 'Pick a store before going online - jobs are offered '
                         'by store.'
            }, status=400)
        profile.is_online = online
        profile.save(update_fields=['is_online'])
        if online and profile.current_site_id is not None:
            # Going online is when waiting jobs at this store find a rider.
            from bounded.delivery.dispatch import assign_pending_at
            assign_pending_at(profile.current_site, request.user)
        return Response(RiderProfileSerializer(profile).data)

    @action(detail=False, methods=['post'], url_path='me/location')
    def me_location(self, request):
        """Where the rider is right now, pushed by their own app.

        The fleet board needs a live pin, but no operator ever *enters* one -
        the rider's device is the only source allowed here, on their own
        profile, and a browser that refuses the permission simply leaves the
        last pin where it was. lat/lng are validated as real coordinates
        rather than stored blind, so a bad payload cannot poison the board.
        """
        profile = _my_profile(request.user)
        if profile is None:
            return Response(
                {'error': 'This account has no rider profile yet.'}, status=404)
        try:
            lat = float(request.data.get('lat'))
            lng = float(request.data.get('lng'))
        except (TypeError, ValueError):
            return Response(
                {'error': 'lat and lng must both be numbers.'}, status=400)
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
            return Response(
                {'error': 'That is not a location on earth.'}, status=400)
        profile.last_lat = lat
        profile.last_lng = lng
        profile.last_seen_at = timezone.now()
        profile.save(update_fields=['last_lat', 'last_lng', 'last_seen_at'])
        return Response(RiderProfileSerializer(profile).data)

    @action(detail=False, methods=['get'])
    def me(self, request):
        profile = _my_profile(request.user)
        if profile is None:
            return Response({'has_profile': False})
        return Response({'has_profile': True,
                         **RiderProfileSerializer(profile).data})

    @action(detail=False, methods=['get'], url_path='me/summary')
    def me_summary(self, request):
        """One snapshot for the rider's home screen.

        The rider app used to fan out to four endpoints (profile, tasks,
        earnings, custody) and still could not answer "how many did I deliver
        today, what did I earn, how much cash am I carrying, and may I take
        jobs yet". This joins those answers server-side in a fixed number of
        queries and states the activation flag explicitly: an open shift plus
        online is the only state in which the DS has handed this rider a store.
        """
        from decimal import Decimal

        from django.db.models import Sum
        from django.db.models.functions import Coalesce

        from bounded.money.models import (CashMovement, RiderCustodyState,
                                          RiderEarnings)

        profile = _my_profile(request.user)
        if profile is None:
            return Response({'has_profile': False})

        now = timezone.now()
        today = timezone.localdate(now)
        week_start = today - timedelta(days=today.weekday())

        tasks = DeliveryTask.objects.filter(rider=profile)
        delivered = tasks.filter(status='DELIVERED')
        active_states = ['ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE',
                         'ARRIVED', 'POD_PENDING']

        earnings = RiderEarnings.objects.filter(rider=profile)

        def money_sum(qs, field='amount'):
            return qs.aggregate(
                total=Coalesce(Sum(field), Decimal('0.00')))['total']

        cust = RiderCustodyState.objects.filter(
            rider_id=profile.rider_id).first()
        cash_today = money_sum(CashMovement.objects.filter(
            movement_type='COD_COLLECT', to_ref_id=str(profile.rider_id),
            created_at__date=today))

        active_cod = tasks.filter(
            status__in=active_states,
            order__payment_method='COD',
            order__payment_status='PENDING').aggregate(
                total=Coalesce(Sum('order__grand_total'), Decimal('0.00')))['total']

        shift = RiderShift.objects.filter(
            rider=profile, status='OPEN').select_related('site').first()
        site = shift.site if shift else profile.current_site
        offers = DeliveryTask.objects.filter(
            site_id=profile.current_site_id, rider__isnull=True,
            status__in=['UNASSIGNED', 'OFFERED']).count() \
            if profile.current_site_id else 0

        movements = CashMovement.objects.filter(
            Q(to_ref_id=str(profile.rider_id))
            | Q(from_ref_id=str(profile.rider_id))
        ).order_by('-created_at')[:20]
        recent_earnings = earnings.select_related('order').order_by(
            '-created_at')[:20]

        return Response({
            'has_profile': True,
            'profile': RiderProfileSerializer(profile).data,
            'activation': {
                'active': bool(profile.is_online and shift),
                'online': bool(profile.is_online),
                'site': site.code if site else None,
                'site_id': str(site.site_id) if site else None,
                'shift_id': str(shift.shift_id) if shift else None,
                'shift_started_at': shift.started_at if shift else None,
            },
            'stats': {
                'deliveries_today': delivered.filter(
                    delivered_at__date=today).count(),
                'deliveries_week': delivered.filter(
                    delivered_at__date__gte=week_start).count(),
                'deliveries_total': delivered.count(),
                'active_jobs': tasks.filter(status__in=active_states).count(),
                'offers': offers,
                'earnings_today': money_sum(earnings.filter(
                    created_at__date=today)),
                'earnings_week': money_sum(earnings.filter(
                    created_at__date__gte=week_start)),
                'earnings_total': money_sum(earnings),
                'earnings_pending': money_sum(
                    earnings.filter(status='PENDING')),
                'earnings_paid': money_sum(earnings.filter(status='PAID')),
                'cod_cash_today': cash_today,
                'cod_cash_total': money_sum(CashMovement.objects.filter(
                    movement_type='COD_COLLECT',
                    to_ref_id=str(profile.rider_id))),
                'cod_due_on_active_jobs': active_cod,
                'cash_to_remit': getattr(cust, 'current_cash', Decimal('0.00'))
                if cust else Decimal('0.00'),
            },
            'custody': {
                'current_cash': getattr(cust, 'current_cash', None),
                'current_float': getattr(cust, 'current_float', None),
                'bags_in_custody': getattr(cust, 'bags_in_custody', 0),
                'ceiling_amount': getattr(cust, 'ceiling_amount', None),
                'site': getattr(cust, 'site', None),
                'updated_at': getattr(cust, 'updated_at', None),
            } if cust else None,
            'earnings': [{
                'earning_id': str(e.earning_id),
                'order_id': str(e.order_id),
                'order_no': getattr(e.order, 'order_no', None),
                'amount': e.amount,
                'delivery_fee': e.delivery_fee,
                'tips': e.tips,
                'status': e.status,
                'created_at': e.created_at,
            } for e in recent_earnings],
            'cash_movements': [{
                'entry_id': m.entry_id,
                'movement_type': m.movement_type,
                'amount': m.amount,
                'site': m.site,
                'from_container': m.from_container,
                'to_container': m.to_container,
                'ref_type': m.ref_type,
                'ref_id': m.ref_id,
                'actor_type': m.actor_type,
                'created_at': m.created_at,
            } for m in movements],
        })


class RiderShiftViewSet(viewsets.ModelViewSet):
    queryset = RiderShift.objects.select_related('rider','site').all()
    serializer_class = RiderShiftSerializer
    filterset_fields = ['status']

    def get_queryset(self):
        return _delivery_queryset_for(
            getattr(self.request, 'user', None), self.queryset, 'rider', 'site')

    def perform_create(self, serializer):
        profile = _require_profile(self.request.user)
        if serializer.validated_data.get('rider_id') not in (None, profile.rider_id):
            raise ValidationError({'rider': 'You can only open a shift for yourself.'})
        if RiderShift.objects.filter(rider=profile, status='OPEN').exists():
            raise ValidationError({'shift': 'You already have an open shift.'})
        serializer.save(rider=profile)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def close(self, request, pk=None):
        shift = self.get_object()
        if shift.status == 'CLOSED':
            return Response(RiderShiftSerializer(shift).data)
        shift.status = 'CLOSED'
        shift.ended_at = timezone.now()
        shift.end_reason = request.data.get('reason') or 'MANUAL'
        shift.save(update_fields=['status', 'ended_at', 'end_reason'])
        return Response(RiderShiftSerializer(shift).data)

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def open(self, request):
        profile = _require_profile(request.user)
        existing = RiderShift.objects.select_for_update().filter(
            rider=profile, status='OPEN').first()
        if existing:
            return Response(RiderShiftSerializer(existing).data)

        from bounded.network.models import Site
        code = request.data.get('site_code') or request.data.get('store_code')
        site = None
        if code:
            site = Site.objects.filter(code=code).first()
            if site is None:
                return Response({'error': f'No store with code {code}.'},
                                status=404)
        else:
            site = profile.current_site
        if site is None:
            return Response({
                'error': 'No store to start a shift at. Set current_site on '
                         'your rider profile first.'
            }, status=400)

        shift = RiderShift.objects.create(rider=profile, site=site)
        return Response(RiderShiftSerializer(shift).data, status=201)


class DeliveryTaskViewSet(viewsets.ModelViewSet):
    queryset = DeliveryTask.objects.select_related(
        'order', 'order__customer', 'order__address', 'site', 'rider', 'rider__user'
    ).prefetch_related('order__lines').all()
    serializer_class = DeliveryTaskSerializer
    # `?status__in=PICKED_UP,EN_ROUTE,...` is what both the rider handoff
    # counter and the rider's own queue send. An exact-only declaration left
    # `status__in` out of the filterset entirely, so it was ignored and the
    # whole history for the site came back - harmless only because the screens
    # re-filter client-side, but it made the request lie about what it asked
    # for and shipped every delivered job down the wire on a 30s poll.
    filterset_fields = {
        'status': ['exact', 'in'],
        'site': ['exact'],
        'rider': ['exact'],
    }

    def get_queryset(self):
        """A rider sees their own jobs; a store operator sees their own store."""
        from bounded.ds_ops.access import is_superuser, operator_site_codes

        user = self.request.user
        if not user or not getattr(user, 'is_authenticated', False):
            return self.queryset.none()
        if is_superuser(user) or getattr(user, 'role', '') == 'ADMIN':
            return self.queryset

        profile = RiderProfile.objects.filter(user_id=user.user_id).first()
        if profile is not None:
            return self.queryset.filter(Q(rider=profile) | Q(rider__isnull=True))

        # No rider profile, but the account may still be an operator assigned to
        # a store - and the store is where the bags are staged, so it is exactly
        # this operator who has to see them to hand them over. Without this the
        # queryset returned none() for anyone who was not also a rider, and the
        # counter screen had nothing to list.
        codes = operator_site_codes(user)
        if codes:
            return self.queryset.filter(site__code__in=codes)
        return self.queryset.none()

    def perform_update(self, serializer):
        _refuse_lifecycle_write(self.request)
        return super().perform_update(serializer)

    @action(detail=True, methods=['post'], url_path='toggle-cash-collected')
    def toggle_cash_collected(self, request, pk=None):
        """Mark/unmark whether the rider handed this job's COD cash in at the
        counter. Store operators only â€” riders can flag a job delivered, but
        the counter is the one that settles the cash."""
        from django.utils import timezone

        user = request.user
        role = getattr(user, 'role', '') or ''
        allowed = bool(getattr(user, 'is_superuser', False)) or role in (
            'SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER',
        )
        if not allowed:
            return Response({'error': 'Only a store operator can settle COD cash.'}, status=403)
        task = self.get_object()
        task.cash_collected_at = None if task.cash_collected_at else timezone.now()
        task.save(update_fields=['cash_collected_at'])
        return Response(DeliveryTaskSerializer(task).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def accept(self, request, pk=None):
        """Take an offered job. The task must be unclaimed or already mine."""
        profile = _require_profile(request.user)
        task = self.get_object()

        if task.rider_id and task.rider_id != profile.rider_id:
            return Response(
                {'error': 'Another rider has already taken this job.'},
                status=409)
        if task.status not in {'UNASSIGNED', 'OFFERED', 'ACCEPTED'}:
            return Response({
                'error': f'Task is {task.status}; it can no longer be accepted.'
            }, status=409)
        if not profile.is_online:
            return Response({
                'error': 'You are offline. Go online before taking a job.'
            }, status=409)
        # One delivery at a time. A rider who is already carrying (or has been
        # offered) another job must finish it before taking this one.
        from .dispatch import ACTIVE_RIDER_STATES
        busy = DeliveryTask.objects.filter(
            rider=profile, status__in=ACTIVE_RIDER_STATES,
        ).exclude(pk=task.pk).exists()
        if busy:
            return Response({
                'error': 'Finish your current delivery before taking another job.',
                'code': 'one_delivery_at_a_time',
            }, status=409)

        now = timezone.now()
        task.rider = profile
        task.status = 'ACCEPTED'
        task.accepted_at = task.accepted_at or now
        task.offered_at = task.offered_at or now
        task.save(update_fields=['rider', 'status', 'accepted_at', 'offered_at'])

        previous = task.order.status
        if _record_order_status(task.order, 'RIDER_ASSIGNED', request.user,
                                previous):
            _notify_delivery_transition('delivery.rider_assigned', task)
        return Response(DeliveryTaskSerializer(task).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def decline(self, request, pk=None):
        """Hand a job back to the pool. The order itself is untouched."""
        profile = _require_profile(request.user)
        task = self.get_object()

        if task.rider_id != profile.rider_id:
            return Response({'error': 'This job is not yours to decline.'},
                            status=409)
        if task.status not in {'UNASSIGNED', 'OFFERED', 'ACCEPTED'}:
            return Response({
                'error': f'Task is {task.status}; it can no longer be declined.'
            }, status=409)

        task.rider = None
        task.status = 'UNASSIGNED'
        task.accepted_at = None
        task.offer_count = (task.offer_count or 0) + 1
        task.save(update_fields=['rider', 'status', 'accepted_at',
                                 'offer_count'])
        return Response(DeliveryTaskSerializer(task).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def reoffer(self, request, pk=None):
        """Counter/ops reoffer after decline (FIFO next rider at the store)."""
        from bounded.ds_ops.access import is_superuser
        if not is_superuser(request.user) and getattr(request.user, 'role', '') not in ('SUPER_ADMIN', 'OPS_MANAGER', 'ADMIN'):
            return Response({'error': 'Operators only.'}, status=403)
        task = self.get_object()
        if task.status not in ('UNASSIGNED', 'OFFERED'):
            return Response({'error': f'Task is {task.status}; it cannot be reoffered.'}, status=409)
        order_weight = Decimal('0')
        for line in task.order.lines.select_related('sku').all():
            order_weight += Decimal(line.sku.weight_g or 0) / Decimal('1000') * line.qty
        candidates = list(
            RiderProfile.objects
            .filter(current_site=task.site, is_online=True, kyc_status='VERIFIED')
            .exclude(rider_id=task.rider_id)
            .exclude(rider_id__in=DeliveryTask.objects.filter(status__in=['OFFERED', 'ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'POD_PENDING']).values_list('rider_id', flat=True))
            .prefetch_related('shifts')
            .order_by('-rating', 'created_at')
        )
        candidates = [
            profile for profile in candidates
            if profile.vehicle_capacity_kg is None or Decimal(str(profile.vehicle_capacity_kg)) >= order_weight
        ]
        if not candidates:
            task.rider = None
            task.status = 'UNASSIGNED'
            task.save(update_fields=['rider', 'status'])
            return Response({'offered': False, 'error': 'No free rider is currently in the FIFO queue.'}, status=409)
        def _queue_key(profile):
            open_shifts = [s for s in profile.shifts.all() if s.status == 'OPEN' and str(s.site_id) == str(task.site_id)]
            return (0, min(s.started_at for s in open_shifts)) if open_shifts else (1, profile.created_at)
        candidates.sort(key=_queue_key)
        chosen = candidates[0]
        now = timezone.now()
        task.rider = chosen
        task.status = 'OFFERED'
        task.offer_count = (task.offer_count or 0) + 1
        task.offered_at = now
        task.save(update_fields=['rider', 'status', 'offer_count', 'offered_at'])
        return Response({'offered': True, 'rider': {'rider_id': str(chosen.rider_id), 'name': chosen.name}, 'task': DeliveryTaskSerializer(task).data})

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def advance(self, request, pk=None):
        """Move an accepted job to AT_DS / EN_ROUTE / ARRIVED.

        Pickup and POD are excluded on purpose: those two cross a stock or cash
        boundary and live behind /delivery/handoff/pickup and /handoff/pod.
        """
        target = str(request.data.get('to') or '').upper()
        if target not in TASK_TRANSITIONS:
            return Response({
                'error': f"'to' must be one of {', '.join(sorted(TASK_TRANSITIONS))}."
            }, status=400)

        profile = _require_profile(request.user)
        task = self.get_object()
        if task.rider_id != profile.rider_id:
            return Response({'error': 'This job is not assigned to you.'},
                            status=409)

        if task.status == target:
            # Idempotent retry: task is already in target status
            return Response(DeliveryTaskSerializer(task).data)

        allowed_from, order_status = TASK_TRANSITIONS[target]
        if task.status not in allowed_from:
            return Response({
                'error': f'Task is {task.status}; it cannot move to {target} '
                         f'from there. Allowed from: '
                         f'{", ".join(sorted(allowed_from))}.'
            }, status=409)

        profile.refresh_from_db(fields=['last_lat', 'last_lng'])
        address = getattr(task.order, 'address', None)
        origin_lat = getattr(task.site, 'geo_lat', None)
        origin_lng = getattr(task.site, 'geo_lng', None)
        dest_lat = getattr(address, 'geo_lat', None)
        dest_lng = getattr(address, 'geo_lng', None)
        rider_lat = profile.last_lat
        rider_lng = profile.last_lng

        def _distance_m(a_lat, a_lng, b_lat, b_lng):
            try:
                lat1, lng1, lat2, lng2 = map(float, (a_lat, a_lng, b_lat, b_lng))
            except (TypeError, ValueError):
                return None
            from math import sin, cos, sqrt, atan2
            r = 6371000.0
            p1, p2 = lat1 * 3.141592653589793 / 180, lat2 * 3.141592653589793 / 180
            dp = (lat2 - lat1) * 3.141592653589793 / 180
            dl = (lng2 - lng1) * 3.141592653589793 / 180
            a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
            return 2 * r * atan2(sqrt(min(1.0, max(0.0, a))), sqrt(max(0.0, 1 - min(1.0, max(0.0, a)))))

        if target == 'ARRIVED' and None not in (rider_lat, rider_lng, dest_lat, dest_lng):
            distance = _distance_m(rider_lat, rider_lng, dest_lat, dest_lng)
            if distance is not None and distance > 1000:
                return Response({'error': f'Arrive geofence is 1000 m. Latest rider location is {round(distance)} m away.'}, status=409)

        task.status = target
        update_fields = ['status']
        if target == 'EN_ROUTE':
            distance = _distance_m(origin_lat, origin_lng, dest_lat, dest_lng) if None not in (origin_lat, origin_lng, dest_lat, dest_lng) else None
            if distance is None and None not in (rider_lat, rider_lng, dest_lat, dest_lng):
                distance = _distance_m(rider_lat, rider_lng, dest_lat, dest_lng)
            if distance is not None:
                task.distance_m = round(distance, 2)
                task.eta_at = timezone.now() + timedelta(seconds=distance / 4.2)  # ~15 km/h
                update_fields.extend(['distance_m', 'eta_at'])
        task.save(update_fields=update_fields)
        status_recorded = False
        if order_status:
            previous = task.order.status
            status_recorded = _record_order_status(
                task.order, order_status, request.user, previous)
        if status_recorded and target == 'EN_ROUTE':
            _notify_delivery_transition('delivery.out_for_delivery', task)
        elif status_recorded and target == 'ARRIVED':
            _notify_delivery_transition('delivery.arrived', task)

        return Response(DeliveryTaskSerializer(task).data)

    @action(detail=True, methods=['post'], url_path='start-payment')
    @transaction.atomic
    def start_payment(self, request, pk=None):
        """Open a Cashfree checkout for a COD order at the customer's door.

        Card, UPI and the UPI QR all arrive through the same Cashfree session
        the shopper app already uses, so the rider does not re-implement a
        payment page. Only the rider carrying the job may start it, and only
        after pickup - before that there is nothing to hand over.
        """
        from django.conf import settings

        from bounded.orders.payments import CashfreeError, create_attempt

        profile = _require_profile(request.user)
        task = self.get_object()
        if task.rider_id != profile.rider_id:
            return Response({'error': 'This job is not assigned to you.'},
                            status=409)
        order = task.order
        if order.payment_method != 'COD' or order.payment_status == 'CAPTURED':
            return Response({
                'error': 'This order is already paid online; collect nothing at the door.'
            }, status=409)
        if task.status not in {'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'POD_PENDING'}:
            return Response({
                'error': f'Task is {task.status}; collect the bag first.'
            }, status=409)

        phone = str(request.data.get('phone') or '').strip()
        if not phone:
            customer_user = getattr(order.customer, 'user', None)
            phone = getattr(customer_user, 'phone', '') or ''
        digits = ''.join(ch for ch in phone if ch.isdigit())
        if len(digits) < 10:
            return Response({
                'error': 'Enter the customer mobile number to start the payment.',
                'phone_required': True,
            }, status=400)

        now = timezone.now()
        attempt = order.payment_attempts.filter(
            status__in=['CREATED', 'PENDING'],
            expires_at__gt=now).order_by('-created_at').first()
        if attempt is None:
            try:
                attempt = create_attempt(
                    order, phone=digits,
                    provider_order_id=f'zp_cod_{uuid.uuid4().hex[:32]}')
            except CashfreeError as exc:
                return Response({'error': str(exc)}, status=503)

        return Response({
            'attempt_id': str(attempt.attempt_id),
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'amount': str(attempt.amount),
            'cashfree': {
                'payment_session_id': attempt.payment_session_id,
                'order_id': attempt.provider_order_id,
                'environment': getattr(settings, 'CASHFREE_ENV', 'sandbox'),
            },
        })

    @action(detail=True, methods=['get'], url_path='payment-status')
    def payment_status(self, request, pk=None):
        """Refresh the door-step Cashfree attempt and report the order state."""
        from bounded.orders.payments import CashfreeError, verify_doorstep_attempt

        profile = _require_profile(request.user)
        task = self.get_object()
        if task.rider_id != profile.rider_id:
            return Response({'error': 'This job is not assigned to you.'},
                            status=409)
        order = task.order
        attempt = order.payment_attempts.order_by('-created_at').first()
        if attempt is None:
            return Response(
                {'error': 'No online payment has been started for this order.'},
                status=404)
        if attempt.status == 'PENDING':
            try:
                order = verify_doorstep_attempt(attempt)
            except CashfreeError as exc:
                return Response({'error': str(exc)}, status=503)
        attempt.refresh_from_db()
        order.refresh_from_db()
        return Response({
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'payment_method': order.payment_method,
            'payment_status': order.payment_status,
            'attempt_status': attempt.status,
            'amount': str(attempt.amount),
        })


class RoutePlanViewSet(viewsets.ModelViewSet):
    queryset = RoutePlan.objects.select_related('rider','shift','site').all()
    serializer_class = RoutePlanSerializer
    filterset_fields = ['status','site']

    def get_queryset(self):
        return _delivery_queryset_for(
            getattr(self.request, 'user', None), self.queryset, 'rider', 'site')


class RouteStopViewSet(viewsets.ModelViewSet):
    queryset = RouteStop.objects.select_related('route','task').all()
    serializer_class = RouteStopSerializer

    def get_queryset(self):
        return _delivery_queryset_for(
            getattr(self.request, 'user', None), self.queryset,
            'route__rider', 'route__site')


class DeliveryPickupView(APIView):
    """Collect a staged order: ship it to the rider (bag handed over at the counter)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        task_id = request.data.get('task_id')
        if not task_id:
            return Response({'error': 'task_id is required'}, status=400)
        task = DeliveryTask.objects.select_related('order').filter(
            task_id=task_id).first()
        if task is None:
            return Response({'error': 'Delivery task not found'}, status=404)
        try:
            _owned_task(request.user, task)
        except PermissionDenied as e:
            # An operator at the wrong store (or with no store at all) gets the
            # real reason, not "Not your task" - they are not a rider and the
            # message has to name the store they would need.
            return Response({'detail': str(e)}, status=403)
        except ValidationError as e:
            return Response({'error': 'Not your task.', **e.detail}, status=403)

        try:
            result = rider_pickup(
                task=task, actor=request.user)
        except HandoffError as e:
            return Response({'error': e.message, **e.detail}, status=e.status)
        return Response({'success': True, **result})


class DeliveryPodView(APIView):
    """Close a delivery against the customer's pickup code."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        task_id = request.data.get('task_id')
        if not task_id:
            return Response({'error': 'task_id is required'}, status=400)
        task = DeliveryTask.objects.select_related('order').filter(
            task_id=task_id).first()
        if task is None:
            return Response({'error': 'Delivery task not found'}, status=404)
        try:
            _owned_task(request.user, task)
        except PermissionDenied as e:
            # Same contract as pickup: an operator with no store, or the wrong
            # one, is told which store the job belongs to instead of a bare
            # "Not your task", and the refusal reads as DRF's normal 403.
            return Response({'detail': str(e)}, status=403)
        except ValidationError as e:
            return Response({'error': 'Not your task.', **e.detail}, status=403)

        try:
            result = complete_pod(
                task=task, actor=request.user,
                otp=request.data.get('otp'),
                cod_amount=request.data.get('cod_amount'),
                # Evidence of who accepted the bag. Optional - a door handover
                # without a signature still happened - but recorded when given.
                signature=request.data.get('signature'),
                method=request.data.get('method'))
        except HandoffError as e:
            return Response({'error': e.message, **e.detail}, status=e.status)

        if result.get('otp_required'):
            return Response({
                'error': 'This order needs a pickup code before it can be '
                         'closed. It has been sent to the customer.',
                **result,
            }, status=409)
        return Response({'success': True, **result})


class RiderAdminRosterView(APIView):
    """The store admin's rider board.

    The fleet screen answers "who can take this job right now"; this answers
    the roster questions an admin asks at review time: is this rider verified,
    are they on shift, how much did they deliver today, what did they earn, and
    is their account active. One request per site instead of a task join per
    rider.

    GET  /api/delivery/admin/riders?site=DS-XXX
    POST /api/delivery/admin/riders  {"rider_id": "...", "kyc_status": "VERIFIED"}
    """

    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        from django.db.models import Count, Sum

        from bounded.money.models import RiderEarnings

        site_code = (request.query_params.get('site') or '').strip()
        qs = RiderProfile.objects.select_related('user', 'current_site')
        if site_code:
            qs = qs.filter(current_site__code=site_code)
        profiles = list(qs)
        profiles.sort(key=lambda p: (p.name or '').lower())
        ids = [p.rider_id for p in profiles]
        today = timezone.localdate()

        open_shifts = {
            shift.rider_id: shift
            for shift in RiderShift.objects.filter(
                rider_id__in=ids, status='OPEN').select_related('site')
        }
        delivered_today = {
            row['rider_id']: row['n']
            for row in DeliveryTask.objects.filter(
                rider_id__in=ids, status='DELIVERED',
                delivered_at__date=today,
            ).values('rider_id').annotate(n=Count('task_id'))
        }
        active_jobs = {
            row['rider_id']: row['n']
            for row in DeliveryTask.objects.filter(rider_id__in=ids)
            .exclude(status__in=['DELIVERED', 'FAILED', 'RETURNED',
                                 'WITHDRAWN', 'RECALLED'])
            .values('rider_id').annotate(n=Count('task_id'))
        }
        earnings_today = {
            row['rider_id']: str(row['total'] or 0)
            for row in RiderEarnings.objects.filter(
                rider_id__in=ids, created_at__date=today,
            ).values('rider_id').annotate(total=Sum('amount'))
        }

        rows = []
        for p in profiles:
            shift = open_shifts.get(p.rider_id)
            rows.append({
                'rider_id': str(p.rider_id),
                'name': p.name,
                'phone': p.phone,
                'email': getattr(p.user, 'email', ''),
                'user_status': getattr(p.user, 'status', ''),
                'vehicle_type': p.vehicle_type,
                'vehicle_number': p.vehicle_number,
                'kyc_status': p.kyc_status,
                'kyc_number': p.kyc_number,
                'kyc_document_type': p.kyc_document_type,
                'kyc_document_url': p.kyc_document_url,
                'kyc_reviewed_at': p.kyc_reviewed_at,
                'is_online': p.is_online,
                'current_site': p.current_site.code if p.current_site else '',
                'rating': str(p.rating) if p.rating is not None else '',
                'last_seen_at': p.last_seen_at,
                'on_shift': bool(shift),
                'shift_id': str(shift.shift_id) if shift else '',
                'shift_started_at': shift.started_at if shift else None,
                'delivered_today': delivered_today.get(p.rider_id, 0),
                'active_jobs': active_jobs.get(p.rider_id, 0),
                'earnings_today': earnings_today.get(p.rider_id, '0'),
            })
        return Response({'count': len(rows), 'results': rows})

    def post(self, request):
        rider_id = request.data.get('rider_id')
        kyc_status = str(request.data.get('kyc_status') or '').upper()
        if kyc_status not in dict(RiderProfile.KYC_CHOICES):
            return Response(
                {'error': f'kyc_status must be one of '
                          f'{sorted(dict(RiderProfile.KYC_CHOICES))}.'}, status=400)
        profile = RiderProfile.objects.filter(rider_id=rider_id).first()
        if profile is None:
            return Response({'error': 'No such rider.'}, status=404)
        profile.kyc_status = kyc_status
        profile.kyc_reviewed_at = timezone.now()
        profile.kyc_reviewed_by = str(request.user.user_id)
        if kyc_status == 'REJECTED':
            # A rejected rider must not keep receiving offers.
            profile.is_online = False
            profile.save(update_fields=['kyc_status', 'kyc_reviewed_at', 'kyc_reviewed_by', 'is_online'])
        else:
            profile.save(update_fields=['kyc_status', 'kyc_reviewed_at', 'kyc_reviewed_by'])
        return Response(RiderProfileSerializer(profile).data)
