from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PaymentViewSet, CancelIntentViewSet, RefundViewSet, RefundDecisionViewSet, CashMovementViewSet, RiderCustodyStateViewSet, RiderEarningsViewSet, DeliveryPricingRuleViewSet
router = DefaultRouter()
router.register(r'payments', PaymentViewSet)
router.register(r'cancel-intents', CancelIntentViewSet)
router.register(r'refunds', RefundViewSet)
router.register(r'refund-decisions', RefundDecisionViewSet)
router.register(r'cash-movements', CashMovementViewSet)
router.register(r'rider-custody', RiderCustodyStateViewSet)
router.register(r'rider-earnings', RiderEarningsViewSet)
router.register(r'pricing-rules', DeliveryPricingRuleViewSet)
urlpatterns = [path('', include(router.urls))]
