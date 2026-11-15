# Inventory URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import LpnMasterViewSet, LpnContentViewSet, StockMovementViewSet, StockBalanceViewSet, StockMovementsChainViewSet, ReplenishmentTaskViewSet
from .api import (StockPositionsView, StockMovementFeedView, RelocateStockView,
                  BinSortView, PackLpnView, StockAdjustmentView)
router = DefaultRouter()
router.register(r'lpns', LpnMasterViewSet)
router.register(r'lpn-contents', LpnContentViewSet)
router.register(r'movements', StockMovementViewSet)
router.register(r'balances', StockBalanceViewSet)
router.register(r'chain', StockMovementsChainViewSet)
router.register(r'replenishment-tasks', ReplenishmentTaskViewSet)
urlpatterns = [
    path('positions', StockPositionsView),
    path('feed', StockMovementFeedView),
    path('relocate', RelocateStockView.as_view()),
    path('bin-sort', BinSortView.as_view()),
    path('pack-lpn', PackLpnView.as_view()),
    path('adjustments', StockAdjustmentView.as_view()),
    path('adjustments/', StockAdjustmentView.as_view()),
    path('', include(router.urls)),
]
