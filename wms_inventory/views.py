from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import InventoryLot, InventoryTx, Lpn, Droplist
from .serializers import InventoryLotSerializer, InventoryTxSerializer, LpnSerializer, DroplistSerializer


class LpnViewSet(viewsets.ModelViewSet):
    queryset = Lpn.objects.select_related('current_site').all()
    serializer_class = LpnSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['type', 'status', 'current_site', 'is_superstore']
    search_fields = ['barcode']


class InventoryLotViewSet(viewsets.ModelViewSet):
    queryset = InventoryLot.objects.select_related('sku', 'site', 'bin').all()
    serializer_class = InventoryLotSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['site', 'sku', 'bucket', 'status', 'on_hold', 'inbound_type']
    search_fields = ['lot_code', 'sku__sku_code', 'sku__name']
    ordering_fields = ['expiry_date', 'qty', 'created_at']


class InventoryTxViewSet(viewsets.ModelViewSet):
    queryset = InventoryTx.objects.select_related('sku', 'site').all()
    serializer_class = InventoryTxSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['site', 'sku', 'flow', 'ref_type']
    search_fields = ['sku__sku_code', 'remark']
    ordering_fields = ['created_at', 'qty']


class DroplistViewSet(viewsets.ModelViewSet):
    queryset = Droplist.objects.all()
    serializer_class = DroplistSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status']
    search_fields = ['code']
