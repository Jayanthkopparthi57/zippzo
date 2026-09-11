from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PurchaseOrderViewSet, GoodsReceiptNoteViewSet

router = DefaultRouter()
router.register(r'purchase-orders', PurchaseOrderViewSet)
router.register(r'grn', GoodsReceiptNoteViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
