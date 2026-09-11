from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import (DispatchPlan, Batch, Order, OrderLine, OrderAllocation,
                     Picklist, PicklistLine, Sortlist, SortlistLine,
                     Manifest, ManifestLine, CancellationPutaway)
from .serializers import (DispatchPlanSerializer, BatchSerializer, OrderSerializer,
                          OrderLineSerializer, OrderAllocationSerializer,
                          PicklistSerializer, PicklistLineSerializer,
                          SortlistSerializer, SortlistLineSerializer,
                          ManifestSerializer, ManifestLineSerializer,
                          CancellationPutawaySerializer)


class DispatchPlanViewSet(viewsets.ModelViewSet):
    queryset = DispatchPlan.objects.select_related('site').all()
    serializer_class = DispatchPlanSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status', 'site']
    search_fields = ['code']


class BatchViewSet(viewsets.ModelViewSet):
    queryset = Batch.objects.select_related('site', 'cluster_zone', 'dispatch_plan').all()
    serializer_class = BatchSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'site', 'type', 'sorting_eligible']
    search_fields = ['batch_no', 'destinations']
    ordering_fields = ['created_at', 'cutoff', 'ordered_qty']


class OrderViewSet(viewsets.ModelViewSet):
    queryset = Order.objects.select_related('source_site', 'final_dest').prefetch_related('lines').all()
    serializer_class = OrderSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['type', 'status', 'inventory_type', 'shipment_type', 'source_site']
    search_fields = ['order_no', 'reference_order']
    ordering_fields = ['created_at', 'shipped_at', 'ordered_qty']


class OrderLineViewSet(viewsets.ModelViewSet):
    queryset = OrderLine.objects.select_related('sku', 'order').all()
    serializer_class = OrderLineSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['order', 'sku', 'line_status']


class OrderAllocationViewSet(viewsets.ModelViewSet):
    queryset = OrderAllocation.objects.select_related('lot', 'bin', 'batch').all()
    serializer_class = OrderAllocationSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'batch', 'order_line']


class PicklistViewSet(viewsets.ModelViewSet):
    queryset = Picklist.objects.select_related('batch', 'zone', 'assigned_to').prefetch_related('lines').all()
    serializer_class = PicklistSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status', 'type', 'batch', 'assigned_to']
    search_fields = ['code']


class PicklistLineViewSet(viewsets.ModelViewSet):
    queryset = PicklistLine.objects.select_related('sku', 'bin', 'picklist').all()
    serializer_class = PicklistLineSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['picklist', 'status', 'sku']


class SortlistViewSet(viewsets.ModelViewSet):
    queryset = Sortlist.objects.select_related('batch', 'cluster_zone').prefetch_related('lines').all()
    serializer_class = SortlistSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status', 'type', 'batch']
    search_fields = ['code']


class SortlistLineViewSet(viewsets.ModelViewSet):
    queryset = SortlistLine.objects.select_related('sku', 'order', 'sortlist').all()
    serializer_class = SortlistLineSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['sortlist', 'status', 'sku']


class ManifestViewSet(viewsets.ModelViewSet):
    queryset = Manifest.objects.select_related('site', 'dest_store').prefetch_related('lines').all()
    serializer_class = ManifestSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status', 'type', 'site']
    search_fields = ['manifest_no', 'vehicle_no']


class ManifestLineViewSet(viewsets.ModelViewSet):
    queryset = ManifestLine.objects.select_related('manifest', 'order').all()
    serializer_class = ManifestLineSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['manifest', 'order']


class CancellationPutawayViewSet(viewsets.ModelViewSet):
    queryset = CancellationPutaway.objects.select_related('order').all()
    serializer_class = CancellationPutawaySerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'order']
