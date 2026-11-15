# Cycle counting URLs.
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import CycleCountViewSet, CycleCountLineViewSet

router = DefaultRouter()
router.register(r'cycle-counts', CycleCountViewSet)
router.register(r'cycle-count-lines', CycleCountLineViewSet)

urlpatterns = [path('', include(router.urls))]
