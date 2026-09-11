from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import VendorViewSet, CustomerViewSet, ProductViewSet, BatchViewSet

router = DefaultRouter()
router.register(r'vendors', VendorViewSet)
router.register(r'customers', CustomerViewSet)
router.register(r'products', ProductViewSet)
router.register(r'batches', BatchViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
