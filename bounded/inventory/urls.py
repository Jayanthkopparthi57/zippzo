# Inventory URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import LpnMasterViewSet, LpnContentViewSet, StockMovementViewSet, StockBalanceViewSet, StockMovementsChainViewSet
from .api import StockPositionsView, StockMovementFeedView, RelocateStockView
router = DefaultRouter()
router.register(r'lpns', LpnMasterViewSet)
router.register(r'lpn-contents', LpnContentViewSet)
router.register(r'movements', StockMovementViewSet)
router.register(r'balances', StockBalanceViewSet)
router.register(r'chain', StockMovementsChainViewSet)
urlpatterns = [
    path('positions', StockPositionsView),
    path('feed', StockMovementFeedView),
    path('relocate', RelocateStockView.as_view()),
    path('', include(router.urls)),
]
