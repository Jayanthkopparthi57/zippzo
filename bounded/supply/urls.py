# Supply URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import VendorViewSet, SellerViewSet, AsnViewSet, AsnLineViewSet, GrnViewSet, GrnLineViewSet, QcInspectionViewSet, PutawayTaskViewSet
router = DefaultRouter()
router.register(r'vendors', VendorViewSet)
router.register(r'sellers', SellerViewSet)
router.register(r'asns', AsnViewSet)
router.register(r'asn-lines', AsnLineViewSet)
router.register(r'grns', GrnViewSet)
router.register(r'grn-lines', GrnLineViewSet)
router.register(r'qc-inspections', QcInspectionViewSet)
router.register(r'putaway-tasks', PutawayTaskViewSet)
urlpatterns = [path('', include(router.urls))]
