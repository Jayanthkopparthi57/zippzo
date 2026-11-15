# Transport URLs (dispatch plans, shipments, linehaul trips, scans, cross-dock).
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    DispatchPlanViewSet, ShipmentViewSet, ManifestDocumentViewSet, LinehaulTripViewSet,
    TripStopViewSet, ShippingScanViewSet, CrossDockMoveViewSet,
)

router = DefaultRouter()
router.register(r'dispatch-plans', DispatchPlanViewSet)
router.register(r'shipments', ShipmentViewSet)
router.register(r'manifests', ManifestDocumentViewSet)
router.register(r'trips', LinehaulTripViewSet)
router.register(r'trip-stops', TripStopViewSet)
router.register(r'shipping-scans', ShippingScanViewSet)
router.register(r'cross-dock', CrossDockMoveViewSet)

urlpatterns = [path('', include(router.urls))]
