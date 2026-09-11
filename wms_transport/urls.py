from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TripViewSet, VehicleCheckinViewSet, TripReturnLegViewSet

router = DefaultRouter()
router.register(r'trips', TripViewSet)
router.register(r'vehicle-checkins', VehicleCheckinViewSet)
router.register(r'trip-return-legs', TripReturnLegViewSet)

urlpatterns = [path('', include(router.urls))]
