# Master data URLs (organizations, stores, carriers, vehicles, equipment).
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    OrganizationViewSet, StoreViewSet, CarrierViewSet, VehicleViewSet,
    EquipmentViewSet, VehicleCheckInViewSet, ReasonCodeViewSet, ClusterZoneViewSet,
)

router = DefaultRouter()
router.register(r'organizations', OrganizationViewSet)
router.register(r'stores', StoreViewSet)
router.register(r'carriers', CarrierViewSet)
router.register(r'vehicles', VehicleViewSet)
router.register(r'equipment', EquipmentViewSet)
router.register(r'vehicle-checkins', VehicleCheckInViewSet)
router.register(r'reason-codes', ReasonCodeViewSet)
router.register(r'cluster-zones', ClusterZoneViewSet)

urlpatterns = [path('', include(router.urls))]
