import uuid

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from rest_framework.views import APIView
from django.db import models
from django.db.models import Count, Sum
from django.utils import timezone
from bounded.orders.models import CustomerOrder
from bounded.inventory.models import LpnMaster
from bounded.catalog.models import InventoryLot
from bounded.iam.permissions import IsAdminUser
from bounded.iam.names import acting_user_id
from .models import (
    Site, Location, Zone, DockDoor, VehicleType, EmployeeSiteAssignment,
    CityDeliveryConfig, StaffShift, EmployeeCompensation,
)
from .serializers import (
    SiteSerializer, LocationSerializer, ZoneSerializer, DockDoorSerializer,
    VehicleTypeSerializer, EmployeeSiteAssignmentSerializer,
    CityDeliveryConfigSerializer, StaffShiftSerializer,
    EmployeeCompensationSerializer,
)


class SiteViewSet(viewsets.ModelViewSet):
    queryset = Site.objects.all()
    serializer_class = SiteSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    filterset_fields = ['site_type', 'status']
    search_fields = ['code', 'name']


class LocationViewSet(viewsets.ModelViewSet):
    """Bins and the coordinates that name them.

    Reads used to sit behind IsAdminUser, so the store app's own screens -
    returns putaway, shelf putaway, bin contents, bin transfer, inbound
    receiving and packing - all failed their bin lookup with a 403 for anyone
    whose role is not SUPER_ADMIN or OPS_MANAGER. Reading a bin at a store you
    are assigned to is the job, so GET is open to any authenticated caller and
    scoped to their sites below; creating, moving and renaming bins stays admin
    work.
    """
    queryset = Location.objects.select_related('site', 'zone').all()
    serializer_class = LocationSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['site', 'location_type', 'zone']
    search_fields = ['barcode', 'aisle', 'rack']

    def get_queryset(self):
        from bounded.ds_ops.access import operator_site_codes

        user = getattr(self.request, 'user', None)
        if getattr(user, 'role', None) in IsAdminUser.ADMIN_ROLES:
            return self.queryset
        codes = operator_site_codes(user)
        if not codes:
            # No assignment reads no bins: the empty set, not the whole estate.
            return self.queryset.none()
        return self.queryset.filter(site__code__in=codes)

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAdminUser()]


class ZoneViewSet(viewsets.ModelViewSet):
    queryset = Zone.objects.select_related('site').all()
    serializer_class = ZoneSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    filterset_fields = ['site', 'zone_type']


class DockDoorViewSet(viewsets.ModelViewSet):
    queryset = DockDoor.objects.select_related('site').all()
    serializer_class = DockDoorSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    filterset_fields = ['site', 'capability', 'status']


class VehicleTypeViewSet(viewsets.ModelViewSet):
    queryset = VehicleType.objects.all()
    serializer_class = VehicleTypeSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]


class EmployeeSiteAssignmentViewSet(viewsets.ModelViewSet):
    queryset = EmployeeSiteAssignment.objects.select_related('user', 'site').all()
    serializer_class = EmployeeSiteAssignmentSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    filterset_fields = ['mode', 'is_active', 'site', 'user']
    search_fields = ['employee', 'user__email', 'user__full_name', 'site__code']


class StaffShiftViewSet(viewsets.ModelViewSet):
    """Warehouse / dark-store clock-in and clock-out.

    Mirrors delivery.RiderShift's open/close contract so the console can use
    one pattern for both rider and staff attendance. Opening a second shift
    for the same user is refused; closing stamps ended_at + reason.
    """
    queryset = StaffShift.objects.select_related('user', 'site').all()
    serializer_class = StaffShiftSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['status', 'site', 'user', 'role_at_site']

    def get_queryset(self):
        user = getattr(self.request, 'user', None)
        if getattr(user, 'role', None) in IsAdminUser.ADMIN_ROLES:
            return self.queryset
        # Staff see their own shifts plus everyone at their assigned sites
        # (the roster tab needs the site view), never the whole estate.
        from bounded.ds_ops.access import operator_site_codes
        codes = operator_site_codes(user)
        return self.queryset.filter(
            models.Q(user_id=getattr(user, 'user_id', None))
            | models.Q(site__code__in=codes)
        )

    def perform_create(self, serializer):
        # A shift always starts OPEN and is stamped server-side.
        serializer.save(status='OPEN')

    @action(detail=False, methods=['post'])
    def open(self, request):
        """Clock in. Idempotent: an already-open shift is returned as-is."""
        user_id = request.data.get('user') or request.user.user_id
        site_code = request.data.get('site_code') or request.data.get('site')
        if not site_code:
            return Response({'error': 'site_code is required'}, status=400)

        site = Site.objects.filter(code=site_code).first()
        if site is None:
            return Response({'error': f'Unknown site {site_code}'}, status=404)

        existing = StaffShift.objects.filter(user_id=user_id, status='OPEN').first()
        if existing:
            return Response({
                'already_open': True,
                'shift_id': str(existing.shift_id),
                'site_code': existing.site.code,
                'started_at': existing.started_at,
            })

        shift = StaffShift.objects.create(
            user_id=user_id,
            site=site,
            role_at_site=request.data.get('role_at_site', ''),
            notes=request.data.get('notes', ''),
            status='OPEN',
        )
        return Response({
            'shift_id': str(shift.shift_id),
            'site_code': site.code,
            'started_at': shift.started_at,
            'status': shift.status,
        }, status=201)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        """Clock out. Idempotent: closing a closed shift is a no-op."""
        shift = self.get_object()
        if shift.status == 'CLOSED':
            return Response({
                'already_closed': True,
                'shift_id': str(shift.shift_id),
                'ended_at': shift.ended_at,
            })
        shift.status = 'CLOSED'
        shift.ended_at = timezone.now()
        shift.end_reason = request.data.get('reason', 'MANUAL')
        if request.data.get('notes'):
            shift.notes = request.data['notes']
        shift.save()
        duration_min = int((shift.ended_at - shift.started_at).total_seconds() // 60)
        return Response({
            'shift_id': str(shift.shift_id),
            'status': shift.status,
            'ended_at': shift.ended_at,
            'duration_minutes': duration_min,
        })


class EmployeeCompensationViewSet(viewsets.ModelViewSet):
    """Payroll reference data — who is paid what, per site.

    Admin-only on every method: pay rates are not staff-visible. Creation
    stamps created_by from the token like every other attribution column.
    """
    queryset = EmployeeCompensation.objects.select_related('user', 'site').all()
    serializer_class = EmployeeCompensationSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    filterset_fields = ['site', 'user', 'basis', 'is_active']
    search_fields = ['user__email', 'user__full_name', 'employee', 'site__code']

    def perform_create(self, serializer):
        serializer.save(created_by=str(acting_user_id(self.request) or ''))


class ManpowerView(APIView):
    """Live staffing board: every active site assignment with its clock-in state.

    One row per active EmployeeSiteAssignment — who is rostered at each site,
    their employee code, and whether they are clocked in RIGHT NOW at that
    site (an open StaffShift matching both user and site). Unlinked seeded
    rows (employee code with no user) come through with linked=false so the
    roster can show staffing gaps. Non-admins are fenced to their own rows
    plus their operator sites, mirroring StaffShiftViewSet.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = EmployeeSiteAssignment.objects.select_related('user', 'site')
        user = getattr(request, 'user', None)
        if getattr(user, 'role', None) not in IsAdminUser.ADMIN_ROLES:
            from bounded.ds_ops.access import operator_site_codes
            codes = operator_site_codes(user)
            qs = qs.filter(
                models.Q(user_id=getattr(user, 'user_id', None))
                | models.Q(site__code__in=codes)
            )
        site = request.query_params.get('site')
        if site:
            # Only OR in the UUID branch when the value actually parses —
            # 'DS-MAN2' as site_id raises a field-level ValidationError (500).
            site_q = models.Q(site__code=site)
            try:
                uuid.UUID(str(site))
            except (ValueError, TypeError):
                pass
            else:
                site_q |= models.Q(site_id=site)
            qs = qs.filter(site_q)
        qs = qs.filter(is_active=True).order_by(
            'site__code', 'role_at_site', 'employee')

        # One open shift per user (server-enforced by StaffShift.open).
        open_by_user = {}
        for shift in StaffShift.objects.filter(status='OPEN'):
            open_by_user.setdefault(shift.user_id, shift)

        rows = []
        for a in qs:
            shift = open_by_user.get(a.user_id) if a.user_id else None
            on_shift = bool(shift and shift.site_id == a.site_id)
            if a.user_id:
                name = a.user.full_name or a.user.email
                email = a.user.email
            else:
                name = ''
                email = ''
            rows.append({
                'assignment_id': a.id,
                'employee': a.employee,
                'user': str(a.user_id) if a.user_id else None,
                'name': name,
                'email': email,
                'site': str(a.site_id),
                'site_code': a.site.code,
                'mode': a.mode,
                'role_at_site': a.role_at_site,
                'is_primary': a.is_primary,
                'linked': bool(a.user_id),
                'on_shift': on_shift,
                'shift_id': str(shift.shift_id) if on_shift else None,
                'shift_started_at': shift.started_at if on_shift else None,
            })
        return Response({'count': len(rows), 'results': rows})


class CityDeliveryConfigViewSet(viewsets.ModelViewSet):
    queryset = CityDeliveryConfig.objects.all()
    serializer_class = CityDeliveryConfigSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]


class NetworkOverviewView(APIView):
    """Facility directory for the login screen.

    Must stay authenticated: it exposes every site code, name and address, so
    leaving it open published the whole estate to anonymous callers.

    This is also the only non-admin-readable source of the dark store list.
    /network/sites/ stays admin-only, so the dark store console must resolve
    its store from here or every operator gets a 403 and no store at all.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        sites = Site.objects.all()
        warehouses = list(sites.filter(site_type='MH').values('site_id', 'code', 'name', 'site_type', 'status'))
        dark_stores = list(sites.filter(site_type='DS').values('site_id', 'code', 'name', 'site_type', 'status'))
        all_facilities = list(sites.values('site_id', 'code', 'name', 'site_type', 'status', 'address'))
        return Response({
            'warehouses': warehouses,
            'dark_stores': dark_stores,
            'all_facilities': all_facilities,
            'total_warehouses': len(warehouses),
            'total_dark_stores': len(dark_stores),
            'total_sites': sites.count(),
        })
