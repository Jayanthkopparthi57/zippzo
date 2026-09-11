from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SalesOrderViewSet, PickWaveViewSet, PickTaskViewSet

router = DefaultRouter()
router.register(r'orders', SalesOrderViewSet)
router.register(r'waves', PickWaveViewSet)
router.register(r'tasks', PickTaskViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
