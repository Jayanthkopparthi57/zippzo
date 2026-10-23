import uuid

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
        # scans the tote over to the rider and reads the customer's code off
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
        # one store could collect a tote staged at another. The profile's own
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
    OrderStatusHistory.objects.create(
        order=order, from_status=previous, to_status=new_status,
        actor_type=actor.role, actor_id=str(actor.user_id))
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
TASK_TRANSITIONS = {
    'AT_DS': ({'UNASSIGNED', 'OFFERED', 'ACCEPTED'}, None),
    'EN_ROUTE': ({'AT_DS', 'PICKED_UP'}, 'OUT_FOR_DELIVERY'),
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

    @action(detail=False, methods=['get'], url_path='me/qr')
    def me_qr(self, request):
        """The rider's personal scan code — stable for the life of the profile.

        The store counter scans this to hand jobs over (see
        DeliveryTaskViewSet.assign_by_rider). One iam.QRCode row per rider,
        keyed on RIDER:<rider_id>, so the image never changes between app
        opens and the row doubles as the scan ledger (scan_count).
        """
        profile = _my_profile(request.user)
        if profile is None:
            return Response(
                {'error': 'This account has no rider profile yet.'}, status=404)

        site = profile.current_site
        data = {
            'kind': 'rider',
            'rider_id': str(profile.rider_id),
            'user_id': str(request.user.user_id),
            'name': profile.name,
            'site': site.code if site else '',
        }
        code = f'RIDER:{profile.rider_id}'
        qr, created = QRCode.objects.get_or_create(
            code=code, defaults={'qr_type': 'USER', 'data': data})
        if not created and qr.data != data:
            qr.data = data
            qr.save(update_fields=['data'])
        return Response({
            'code': qr.code,
            'payload': qr.code,
            'name': profile.name,
            'site': site.code if site else None,
            'is_online': profile.is_online,
            'scan_count': qr.scan_count,
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
        # a store - and the store is where the totes are staged, so it is exactly
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

        now = timezone.now()
        task.rider = profile
        task.status = 'ACCEPTED'
        task.accepted_at = task.accepted_at or now
        task.offered_at = task.offered_at or now
        task.save(update_fields=['rider', 'status', 'accepted_at', 'offered_at'])

        previous = task.order.status
        _record_order_status(task.order, 'RIDER_ASSIGNED', request.user,
                             previous)
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

        allowed_from, order_status = TASK_TRANSITIONS[target]
        if task.status not in allowed_from:
            return Response({
                'error': f'Task is {task.status}; it cannot move to {target} '
                         f'from there. Allowed from: '
                         f'{", ".join(sorted(allowed_from))}.'
            }, status=409)

        task.status = target
        task.save(update_fields=['status'])
        if order_status:
            previous = task.order.status
            _record_order_status(task.order, order_status, request.user,
                                 previous)

        return Response(DeliveryTaskSerializer(task).data)

    @action(detail=False, methods=['post'], url_path='assign-by-rider')
    @transaction.atomic
    def assign_by_rider(self, request):
        """Hand a staged job to a rider by scanning their personal QR.

        The counter scans the rider's code (GET /rider-profiles/me/qr/)
        instead of hunting them in a dropdown: the physical scan at the
        handoff counter IS the rider's consent, so the task moves straight
        to ACCEPTED — the state the rider's own accept would reach — and the
        order records RIDER_ASSIGNED. Fencing rides on get_queryset, so an
        operator can only assign tasks at their own stores and riders are
        excluded outright: their path is accept/decline, which enforces the
        online rule this endpoint deliberately does not.
        """
        raw = str(request.data.get('qr_code') or request.data.get('qr')
                  or '').strip()
        if not raw:
            return Response({'error': 'qr_code is required.'}, status=400)

        text = raw
        lowered = text.lower()
        if lowered.startswith('zippzo:rider:'):
            text = text[len('zippzo:rider:'):]
        elif lowered.startswith('rider:'):
            text = text[len('rider:'):]
        try:
            rider_id = uuid.UUID(text.strip())
        except ValueError:
            return Response(
                {'error': f'Not a rider QR code ({raw[:40]}).'}, status=404)
        profile = RiderProfile.objects.filter(rider_id=rider_id).first()
        if profile is None:
            return Response(
                {'error': 'No rider profile matches this QR code.'},
                status=404)

        if RiderProfile.objects.filter(user_id=request.user.user_id).exists():
            return Response(
                {'error': 'Riders take jobs from their own console (Accept), '
                          'not by scanning at the counter.'},
                status=403)

        # The scan itself lands on the rider's QR row before task resolution,
        # so an allowed scan counts even when the job it is aimed at turns
        # out to be ineligible — a code nobody ever scans (or one scanned
        # constantly) stays visible from the model.
        qr = QRCode.objects.filter(code=f'RIDER:{profile.rider_id}').first()
        if qr is not None:
            qr.scan_count = (qr.scan_count or 0) + 1
            qr.save(update_fields=['scan_count'])

        task_id = request.data.get('task_id')
        if not task_id:
            return Response({'error': 'task_id is required.'}, status=400)
        task = self.get_queryset().filter(task_id=task_id).first()
        if task is None:
            return Response(
                {'error': 'Delivery task not found at your store.'},
                status=404)

        if task.rider_id == profile.rider_id:
            return Response({
                'rider': {'rider_id': str(profile.rider_id),
                          'name': profile.name},
                'assigned': [str(task.task_id)],
                'already_assigned': True,
            })
        if task.rider_id:
            return Response(
                {'error': 'This delivery task is already assigned to another '
                          'rider.'}, status=409)
        if task.status not in {'UNASSIGNED', 'OFFERED'}:
            return Response(
                {'error': f'Task is {task.status}; it cannot be assigned.'},
                status=409)

        now = timezone.now()
        task.rider = profile
        task.status = 'ACCEPTED'
        task.accepted_at = task.accepted_at or now
        task.offered_at = task.offered_at or now
        task.save(update_fields=['rider', 'status', 'accepted_at',
                                 'offered_at'])
        previous = task.order.status
        _record_order_status(task.order, 'RIDER_ASSIGNED', request.user,
                             previous)

        return Response({
            'rider': {'rider_id': str(profile.rider_id),
                      'name': profile.name},
            'assigned': [str(task.task_id)],
            'already_assigned': False,
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
    """Collect a staged order: verify the tote, move it to the rider, ship it."""
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
                task=task, actor=request.user,
                lpn_barcode=request.data.get('lpn_barcode'))
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
        if kyc_status == 'REJECTED':
            # A rejected rider must not keep receiving offers.
            profile.is_online = False
            profile.save(update_fields=['kyc_status', 'is_online'])
        else:
            profile.save(update_fields=['kyc_status'])
        return Response(RiderProfileSerializer(profile).data)
