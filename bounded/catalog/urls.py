# Catalog URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (SkuCategoryViewSet, SkuViewSet, SkuBarcodeViewSet, ListingViewSet,
                    InventoryLotViewSet, ActiveCouponViewSet, ProductReviewViewSet, WishlistViewSet)
router = DefaultRouter()
router.register(r'categories', SkuCategoryViewSet)
router.register(r'skus', SkuViewSet)
router.register(r'barcodes', SkuBarcodeViewSet)
router.register(r'listings', ListingViewSet)
router.register(r'lots', InventoryLotViewSet)
router.register(r'coupons', ActiveCouponViewSet)
router.register(r'reviews', ProductReviewViewSet, basename='product-review')
router.register(r'wishlist', WishlistViewSet, basename='wishlist')
urlpatterns = [path('', include(router.urls))]
