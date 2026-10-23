# Network URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    SiteViewSet, LocationViewSet, ZoneViewSet, DockDoorViewSet,
    VehicleTypeViewSet, EmployeeSiteAssignmentViewSet,
    CityDeliveryConfigViewSet, NetworkOverviewView, StaffShiftViewSet,
    EmployeeCompensationViewSet, ManpowerView,
)
router = DefaultRouter()
router.register(r'sites', SiteViewSet)
router.register(r'locations', LocationViewSet)
router.register(r'zones', ZoneViewSet)
router.register(r'dock-doors', DockDoorViewSet)
router.register(r'vehicle-types', VehicleTypeViewSet)
router.register(r'employee-assignments', EmployeeSiteAssignmentViewSet)
router.register(r'city-config', CityDeliveryConfigViewSet)
router.register(r'staff-shifts', StaffShiftViewSet)
router.register(r'payroll', EmployeeCompensationViewSet)
urlpatterns = [
    path('', include(router.urls)),
    path('overview', NetworkOverviewView.as_view(), name='network-overview'),
    path('manpower', ManpowerView.as_view(), name='network-manpower'),
]
