from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ServiceabilityViewSet, RoutingDecisionViewSet
router = DefaultRouter()
router.register(r'serviceability', ServiceabilityViewSet)
router.register(r'routing-decisions', RoutingDecisionViewSet)
urlpatterns = [path('', include(router.urls))]
