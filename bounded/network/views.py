from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from django.db.models import Count, Sum
from bounded.orders.models import CustomerOrder
from bounded.inventory.models import LpnMaster
from bounded.catalog.models import InventoryLot
from bounded.iam.permissions import IsAdminUser
from .models import Site, Location, Zone, DockDoor, VehicleType, EmployeeSiteAssignment, CityDeliveryConfig
from .serializers import SiteSerializer, LocationSerializer, ZoneSerializer, DockDoorSerializer, VehicleTypeSerializer, EmployeeSiteAssignmentSerializer, CityDeliveryConfigSerializer


class SiteViewSet(viewsets.ModelViewSet):
    queryset = Site.objects.all()
    serializer_class = SiteSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    filterset_fields = ['site_type', 'status']
    search_fields = ['code', 'name']


class LocationViewSet(viewsets.ModelViewSet):
    queryset = Location.objects.select_related('site', 'zone').all()
    serializer_class = LocationSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    filterset_fields = ['site', 'location_type', 'zone']
    search_fields = ['barcode', 'aisle', 'rack']


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
    queryset = EmployeeSiteAssignment.objects.all()
    serializer_class = EmployeeSiteAssignmentSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    filterset_fields = ['mode', 'is_active']


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
