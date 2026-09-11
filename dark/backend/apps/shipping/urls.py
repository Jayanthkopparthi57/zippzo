from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ShipmentViewSet, ShipmentManifestViewSet

router = DefaultRouter()
router.register(r'packages', ShipmentViewSet)
router.register(r'manifests', ShipmentManifestViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
