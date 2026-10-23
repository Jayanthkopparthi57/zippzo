from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (CoverageView, DeliveryAreaViewSet, RoutingDecisionViewSet,
                    ServiceabilityViewSet)
router = DefaultRouter()
router.register(r'serviceability', ServiceabilityViewSet)
router.register(r'delivery-areas', DeliveryAreaViewSet)
router.register(r'routing-decisions', RoutingDecisionViewSet)
urlpatterns = [
    path('', include(router.urls)),
    path('coverage', CoverageView.as_view(), name='coverage'),
]
