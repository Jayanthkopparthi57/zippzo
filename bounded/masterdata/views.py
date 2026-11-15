from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from bounded.iam.permissions import IsAdminUserOrReadOnly

from .models import (
    Organization, Store, Carrier, Vehicle, Equipment, VehicleCheckIn, ReasonCode, ClusterZone,
)
from .scoping import SiteScopedViewSet, StampActorMixin
from .serializers import (
    OrganizationSerializer, StoreSerializer, CarrierSerializer,
    VehicleSerializer, EquipmentSerializer, VehicleCheckInSerializer,
    ReasonCodeSerializer, ClusterZoneSerializer,
)


class OrganizationViewSet(viewsets.ModelViewSet):
    queryset = Organization.objects.all()
    serializer_class = OrganizationSerializer
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]
    filterset_fields = ['kind', 'status']
    search_fields = ['code', 'name', 'legal_name', 'gstin']
    ordering_fields = ['code', 'name', 'created_at']


class StoreViewSet(SiteScopedViewSet):
    queryset = Store.objects.select_related('site', 'organization').all()
    serializer_class = StoreSerializer
    filterset_fields = ['store_type', 'status', 'city', 'organization', 'site']
    search_fields = ['code', 'name', 'city', 'pincode']
    ordering_fields = ['code', 'name', 'created_at']


class CarrierViewSet(viewsets.ModelViewSet):
    queryset = Carrier.objects.select_related('organization').all()
    serializer_class = CarrierSerializer
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]
    filterset_fields = ['mode', 'status', 'organization']
    search_fields = ['code', 'name', 'contact_phone', 'gstin']
    ordering_fields = ['code', 'name', 'created_at']


class VehicleViewSet(viewsets.ModelViewSet):
    queryset = Vehicle.objects.select_related(
        'vehicle_type', 'carrier', 'home_site').all()
    serializer_class = VehicleSerializer
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]
    filterset_fields = ['status', 'ownership', 'carrier', 'vehicle_type', 'home_site']
    search_fields = ['registration_no', 'make', 'model_name']
    ordering_fields = ['registration_no', 'created_at']


class EquipmentViewSet(SiteScopedViewSet):
    queryset = Equipment.objects.select_related('site', 'assigned_to').all()
    serializer_class = EquipmentSerializer
    filterset_fields = ['equipment_type', 'status', 'site', 'assigned_to']
    search_fields = ['code', 'name', 'serial_no']
    ordering_fields = ['code', 'created_at']


class VehicleCheckInViewSet(StampActorMixin, SiteScopedViewSet):
    queryset = VehicleCheckIn.objects.select_related('vehicle', 'site').all()
    serializer_class = VehicleCheckInSerializer
    actor_fields = {'created_by': 'char'}
    filterset_fields = ['direction', 'purpose', 'status', 'site', 'vehicle']
    search_fields = ['vehicle__registration_no', 'driver_name', 'driver_phone', 'seal_no']
    ordering_fields = ['checked_in_at', 'status']


class ReasonCodeViewSet(viewsets.ModelViewSet):
    queryset = ReasonCode.objects.all()
    serializer_class = ReasonCodeSerializer
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]
    filterset_fields = ['category', 'status']
    search_fields = ['code', 'description']
    ordering_fields = ['category', 'code', 'created_at']


class ClusterZoneViewSet(SiteScopedViewSet):
    queryset = ClusterZone.objects.select_related('site', 'zone').all()
    serializer_class = ClusterZoneSerializer
    filterset_fields = ['site', 'zone', 'status']
    search_fields = ['code', 'name', 'site__code', 'zone__code']
    ordering_fields = ['site__code', 'code', 'created_at']

