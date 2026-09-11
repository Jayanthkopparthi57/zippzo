from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import Site, SkuCategory, Sku, Vendor, Zone, Bin, ClusterZone, DockDoor, VehicleType, Transporter
from .serializers import (SiteSerializer, SkuCategorySerializer, SkuSerializer,
                          VendorSerializer, ZoneSerializer, BinSerializer,
                          ClusterZoneSerializer, DockDoorSerializer,
                          VehicleTypeSerializer, TransporterSerializer)


class SiteViewSet(viewsets.ModelViewSet):
    queryset = Site.objects.all()
    serializer_class = SiteSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['type', 'status']
    search_fields = ['code', 'name']


class SkuCategoryViewSet(viewsets.ModelViewSet):
    queryset = SkuCategory.objects.all()
    serializer_class = SkuCategorySerializer
    search_fields = ['name']


class SkuViewSet(viewsets.ModelViewSet):
    queryset = Sku.objects.select_related('category').all()
    serializer_class = SkuSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['storage_zone', 'status', 'is_food', 'category']
    search_fields = ['sku_code', 'name', 'ean']
    ordering_fields = ['name', 'mrp', 'wac']


class VendorViewSet(viewsets.ModelViewSet):
    queryset = Vendor.objects.all()
    serializer_class = VendorSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status', 'is_customer', 'is_sku_vendor']
    search_fields = ['code', 'name', 'gstin']


class ZoneViewSet(viewsets.ModelViewSet):
    queryset = Zone.objects.select_related('site').all()
    serializer_class = ZoneSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['site', 'zone_type', 'status']
    search_fields = ['code', 'category']


class BinViewSet(viewsets.ModelViewSet):
    queryset = Bin.objects.select_related('site', 'zone').all()
    serializer_class = BinSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['site', 'zone', 'status', 'condition', 'is_pickzone']
    search_fields = ['code', 'aisle', 'rack']


class ClusterZoneViewSet(viewsets.ModelViewSet):
    queryset = ClusterZone.objects.select_related('site').all()
    serializer_class = ClusterZoneSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['site', 'status']


class DockDoorViewSet(viewsets.ModelViewSet):
    queryset = DockDoor.objects.select_related('site').all()
    serializer_class = DockDoorSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['site', 'capability', 'status']


class VehicleTypeViewSet(viewsets.ModelViewSet):
    queryset = VehicleType.objects.all()
    serializer_class = VehicleTypeSerializer
    search_fields = ['code']


class TransporterViewSet(viewsets.ModelViewSet):
    queryset = Transporter.objects.all()
    serializer_class = TransporterSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status']
    search_fields = ['code', 'name']
