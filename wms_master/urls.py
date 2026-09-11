from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (SiteViewSet, SkuCategoryViewSet, SkuViewSet, VendorViewSet,
                    ZoneViewSet, BinViewSet, ClusterZoneViewSet, DockDoorViewSet,
                    VehicleTypeViewSet, TransporterViewSet)

router = DefaultRouter()
router.register(r'sites', SiteViewSet)
router.register(r'sku-categories', SkuCategoryViewSet)
router.register(r'skus', SkuViewSet)
router.register(r'vendors', VendorViewSet)
router.register(r'zones', ZoneViewSet)
router.register(r'bins', BinViewSet)
router.register(r'cluster-zones', ClusterZoneViewSet)
router.register(r'dock-doors', DockDoorViewSet)
router.register(r'vehicle-types', VehicleTypeViewSet)
router.register(r'transporters', TransporterViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
