from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.response import Response

from bounded.masterdata.scoping import SiteScopedViewSet, StampActorMixin
from .models import (
    DispatchPlan, Shipment, ManifestDocument, LinehaulTrip, TripStop, ShippingScan, CrossDockMove,
)
from .serializers import (
    DispatchPlanSerializer, ShipmentSerializer, ManifestDocumentSerializer, LinehaulTripSerializer,
    TripStopSerializer, ShippingScanSerializer, CrossDockMoveSerializer,
)


class DispatchPlanViewSet(StampActorMixin, SiteScopedViewSet):
    queryset = DispatchPlan.objects.select_related(
        'site', 'carrier', 'vehicle').all()
    serializer_class = DispatchPlanSerializer
    actor_fields = {'created_by': 'char'}
    filterset_fields = ['status', 'site', 'plan_date', 'carrier', 'vehicle']
    search_fields = ['code', 'wave_code', 'site__code']
    ordering_fields = ['plan_date', 'code', 'created_at']


class ShipmentViewSet(StampActorMixin, SiteScopedViewSet):
    queryset = Shipment.objects.select_related(
        'dispatch_plan', 'carrier', 'vehicle', 'origin_site', 'destination_site').all()
    serializer_class = ShipmentSerializer
    site_field = 'origin_site'
    alt_site_field = 'destination_site'
    actor_fields = {'created_by': 'char'}
    filterset_fields = [
        'status', 'mode', 'origin_site', 'destination_site',
        'carrier', 'vehicle', 'dispatch_plan',
    ]
    search_fields = ['code', 'seal_no', 'origin_site__code', 'destination_site__code']
    ordering_fields = ['created_at', 'planned_dispatch_at', 'code']


class ManifestDocumentViewSet(StampActorMixin, SiteScopedViewSet):
    queryset = ManifestDocument.objects.select_related(
        'shipment', 'dispatch_plan', 'site').all()
    serializer_class = ManifestDocumentSerializer
    actor_fields = {'created_by': 'char'}
    filterset_fields = ['status', 'site', 'shipment', 'dispatch_plan']
    search_fields = ['code', 'shipment__code', 'dispatch_plan__code', 'site__code']
    ordering_fields = ['created_at', 'code', 'total_units']

    @action(detail=True, methods=['post'])
    def generate(self, request, pk=None):
        manifest = self.get_object()
        if manifest.status == 'CANCELLED':
            return Response({'error': 'Cancelled manifests cannot be generated.'}, status=400)
        manifest.status = 'GENERATED'
        manifest.generated_at = timezone.now()
        manifest.save(update_fields=['status', 'generated_at', 'updated_at'])
        return Response({'success': True, 'manifest_id': str(manifest.manifest_id), 'status': manifest.status})

    @action(detail=True, methods=['post'], url_path='mark-dispatched')
    def mark_dispatched(self, request, pk=None):
        manifest = self.get_object()
        if manifest.status != 'GENERATED':
            return Response({'error': 'Only generated manifests can be dispatched.'}, status=400)
        manifest.status = 'DISPATCHED'
        manifest.save(update_fields=['status', 'updated_at'])
        return Response({'success': True, 'manifest_id': str(manifest.manifest_id), 'status': manifest.status})


class LinehaulTripViewSet(StampActorMixin, SiteScopedViewSet):
    queryset = LinehaulTrip.objects.select_related(
        'shipment', 'vehicle', 'carrier', 'origin_site', 'destination_site').all()
    serializer_class = LinehaulTripSerializer
    site_field = 'origin_site'
    alt_site_field = 'destination_site'
    actor_fields = {'created_by': 'char'}
    filterset_fields = [
        'status', 'origin_site', 'destination_site', 'vehicle', 'carrier', 'shipment',
    ]
    search_fields = ['code', 'driver_name', 'driver_phone', 'vehicle__registration_no']
    ordering_fields = ['created_at', 'planned_departure_at', 'code']


class TripStopViewSet(SiteScopedViewSet):
    queryset = TripStop.objects.select_related('trip', 'site').all()
    serializer_class = TripStopSerializer
    site_field = 'trip__origin_site'
    alt_site_field = 'site'
    filterset_fields = ['status', 'stop_type', 'trip', 'site']
    search_fields = ['trip__code', 'site__code']
    ordering_fields = ['sequence', 'planned_at']


class ShippingScanViewSet(StampActorMixin, SiteScopedViewSet):
    queryset = ShippingScan.objects.select_related(
        'shipment', 'trip', 'lpn', 'site', 'scanned_by').all()
    serializer_class = ShippingScanSerializer
    # A scan is created by the person holding the scanner; the actor is stamped
    # from the token, and reads are scoped to the site the scan happened at.
    actor_fields = {'scanned_by': 'relation'}
    filterset_fields = ['scan_type', 'result', 'site', 'shipment', 'trip', 'lpn']
    search_fields = ['code', 'shipment__code', 'lpn__lpn_id']
    ordering_fields = ['scanned_at', 'scan_type']


class CrossDockMoveViewSet(StampActorMixin, SiteScopedViewSet):
    queryset = CrossDockMove.objects.select_related(
        'source_site', 'destination_site', 'shipment', 'lpn', 'sku').all()
    serializer_class = CrossDockMoveSerializer
    site_field = 'source_site'
    alt_site_field = 'destination_site'
    actor_fields = {'created_by': 'char'}
    filterset_fields = ['status', 'source_site', 'destination_site', 'shipment']
    search_fields = ['code', 'sku__sku_code', 'lpn__lpn_id']
    ordering_fields = ['created_at', 'expected_at']
