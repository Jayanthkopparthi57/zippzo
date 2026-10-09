from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (RiderProfileViewSet, RiderShiftViewSet, DeliveryTaskViewSet,
                    RoutePlanViewSet, RouteStopViewSet, DeliveryPickupView,
                    DeliveryPodView)
router = DefaultRouter()
router.register(r'rider-profiles', RiderProfileViewSet)
router.register(r'rider-shifts', RiderShiftViewSet)
router.register(r'delivery-tasks', DeliveryTaskViewSet)
router.register(r'route-plans', RoutePlanViewSet)
router.register(r'route-stops', RouteStopViewSet)
urlpatterns = [
    path('', include(router.urls)),
    path('handoff/pickup', DeliveryPickupView.as_view(), name='delivery-pickup'),
    path('handoff/pod', DeliveryPodView.as_view(), name='delivery-pod'),
]
