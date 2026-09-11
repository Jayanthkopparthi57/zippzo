from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AsnViewSet, AsnLineViewSet, GrnViewSet, GrnLineViewSet, PutawayTaskViewSet, InboundDiscrepancyViewSet

router = DefaultRouter()
router.register(r'asns', AsnViewSet)
router.register(r'asn-lines', AsnLineViewSet)
router.register(r'grns', GrnViewSet)
router.register(r'grn-lines', GrnLineViewSet)
router.register(r'putaway-tasks', PutawayTaskViewSet)
router.register(r'discrepancies', InboundDiscrepancyViewSet)

urlpatterns = [path('', include(router.urls))]
