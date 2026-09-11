from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CycleCountViewSet, CycleCountLineViewSet, ReplenishmentTaskViewSet

router = DefaultRouter()
router.register(r'cycle-counts', CycleCountViewSet)
router.register(r'cycle-count-lines', CycleCountLineViewSet)
router.register(r'replenishments', ReplenishmentTaskViewSet)

urlpatterns = [path('', include(router.urls))]
