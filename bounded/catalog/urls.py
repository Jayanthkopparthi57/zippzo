# Catalog URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (SkuCategoryViewSet, SkuViewSet, SkuBarcodeViewSet, ListingViewSet,
                    InventoryLotViewSet, ActiveCouponViewSet, ComboOfferViewSet,
                    ProductReviewViewSet, WishlistViewSet, StoreProductProfileViewSet)
router = DefaultRouter()
router.register(r'categories', SkuCategoryViewSet)
router.register(r'skus', SkuViewSet)
router.register(r'barcodes', SkuBarcodeViewSet)
router.register(r'listings', ListingViewSet)
router.register(r'store-profiles', StoreProductProfileViewSet)
router.register(r'lots', InventoryLotViewSet)
router.register(r'coupons', ActiveCouponViewSet)
router.register(r'combo-offers', ComboOfferViewSet)
router.register(r'reviews', ProductReviewViewSet, basename='product-review')
router.register(r'wishlist', WishlistViewSet, basename='wishlist')
urlpatterns = [path('', include(router.urls))]
