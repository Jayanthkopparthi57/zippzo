# Catalog Views
from rest_framework import viewsets
from .models import SkuCategory, Sku, SkuBarcode, Listing, InventoryLot
from .serializers import SkuCategorySerializer, SkuSerializer, SkuBarcodeSerializer, ListingSerializer, InventoryLotSerializer

class SkuCategoryViewSet(viewsets.ModelViewSet):
    queryset = SkuCategory.objects.all()
    serializer_class = SkuCategorySerializer

class SkuViewSet(viewsets.ModelViewSet):
    queryset = Sku.objects.select_related('category').all()
    serializer_class = SkuSerializer
    filterset_fields = ['storage_zone', 'status', 'is_food']
    search_fields = ['sku_code', 'name', 'ean']

class SkuBarcodeViewSet(viewsets.ModelViewSet):
    queryset = SkuBarcode.objects.all()
    serializer_class = SkuBarcodeSerializer

class ListingViewSet(viewsets.ModelViewSet):
    queryset = Listing.objects.select_related('sku', 'site').all()
    serializer_class = ListingSerializer
    filterset_fields = ['is_listed', 'is_available', 'site']

class InventoryLotViewSet(viewsets.ModelViewSet):
    queryset = InventoryLot.objects.select_related('sku', 'site').all()
    serializer_class = InventoryLotSerializer
    # Receiving resolves an existing lot by (sku, site, batch) before creating
    # one, and `?search=<batch>` was silently ignored, so every receipt of a
    # re-used batch number minted a duplicate lot.
    filterset_fields = ['sku', 'site', 'bucket', 'status', 'batch_number']
    search_fields = ['batch_number', 'sku__sku_code', 'sku__ean']
