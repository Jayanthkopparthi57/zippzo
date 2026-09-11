from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    WarehouseViewSet,
    CategoryViewSet,
    ZoneViewSet,
    LocationViewSet,
    LocationActivityLogViewSet
)

router = DefaultRouter()
router.register(r'warehouses', WarehouseViewSet)
router.register(r'categories', CategoryViewSet)
router.register(r'zones', ZoneViewSet)
router.register(r'locations', LocationViewSet)
router.register(r'activity-logs', LocationActivityLogViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
