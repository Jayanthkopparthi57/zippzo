from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SAPInboundDeliveryViewSet, SAPSyncLogViewSet

router = DefaultRouter()
router.register(r'inbound-deliveries', SAPInboundDeliveryViewSet, basename='sap-inbound')
router.register(r'sync-logs', SAPSyncLogViewSet, basename='sap-logs')

urlpatterns = [
    path('', include(router.urls)),
]
