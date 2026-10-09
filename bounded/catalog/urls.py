# Catalog URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SkuCategoryViewSet, SkuViewSet, SkuBarcodeViewSet, ListingViewSet, InventoryLotViewSet
router = DefaultRouter()
router.register(r'categories', SkuCategoryViewSet)
router.register(r'skus', SkuViewSet)
router.register(r'barcodes', SkuBarcodeViewSet)
router.register(r'listings', ListingViewSet)
router.register(r'lots', InventoryLotViewSet)
urlpatterns = [path('', include(router.urls))]
