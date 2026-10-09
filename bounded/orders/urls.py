from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CustomerViewSet, CustomerAddressViewSet, CartViewSet, CartLineViewSet, CustomerOrderViewSet, CustomerOrderLineViewSet, OrderStatusHistoryViewSet, CheckoutView, StorefrontView
router = DefaultRouter()
router.register(r'customers', CustomerViewSet)
router.register(r'addresses', CustomerAddressViewSet)
router.register(r'carts', CartViewSet)
router.register(r'cart-lines', CartLineViewSet)
router.register(r'orders', CustomerOrderViewSet)
router.register(r'order-lines', CustomerOrderLineViewSet)
router.register(r'order-history', OrderStatusHistoryViewSet)

# Explicit paths, declared before the router's `orders` prefix so they are not
# swallowed by the viewset route.
urlpatterns = [
    path('checkout', CheckoutView.as_view(), name='orders-checkout'),
    path('storefront', StorefrontView.as_view(), name='orders-storefront'),
    path('', include(router.urls)),
]
