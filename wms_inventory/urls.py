from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import InventoryLotViewSet, InventoryTxViewSet, LpnViewSet, DroplistViewSet

router = DefaultRouter()
router.register(r'lots', InventoryLotViewSet)
router.register(r'transactions', InventoryTxViewSet)
router.register(r'lpns', LpnViewSet)
router.register(r'droplists', DroplistViewSet)

urlpatterns = [path('', include(router.urls))]
