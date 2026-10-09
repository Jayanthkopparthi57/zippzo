# Holds URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import HoldViewSet
router = DefaultRouter()
router.register(r'holds', HoldViewSet)
urlpatterns = [path('', include(router.urls))]
