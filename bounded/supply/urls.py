# Supply URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (VendorViewSet, VendorPaymentViewSet, SellerViewSet, AsnViewSet, AsnLineViewSet, GrnViewSet,
                    GrnLineViewSet, DockDiscrepancyViewSet, QcInspectionViewSet, PutawayTaskViewSet,
                    PutawayStrategyViewSet, PutawayBinListView)
router = DefaultRouter()
router.register(r'vendors', VendorViewSet)
router.register(r'vendor-payments', VendorPaymentViewSet)
router.register(r'sellers', SellerViewSet)
router.register(r'asns', AsnViewSet)
router.register(r'asn-lines', AsnLineViewSet)
router.register(r'grns', GrnViewSet)
router.register(r'grn-lines', GrnLineViewSet)
router.register(r'dock-discrepancies', DockDiscrepancyViewSet)
router.register(r'qc-inspections', QcInspectionViewSet)
router.register(r'putaway-tasks', PutawayTaskViewSet)
router.register(r'putaway-strategies', PutawayStrategyViewSet)
urlpatterns = [
    path('putaway-bins/', PutawayBinListView.as_view()),
    path('', include(router.urls)),
]
