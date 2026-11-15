# DS Ops URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PickTaskViewSet, PackTaskViewSet, SortingWaveViewSet, StagedAgingViewSet, TransferOrderViewSet, TransferOrderLineViewSet, BinTransferViewSet, DroplistViewSet, DSOverviewView, DSIncomingLpnsView, DSInventoryView, DSReceiveLpnView, DSOrderActionView, DSShelfPutawayView
from .pick_scan import (DSPickLinesView, DSPickLineView, DSPickAbandonView,
                       DSResolveBinView, DSAllocateOrderView)
from .pack_scan import DSPackOrderView
from .rack_drop import (DSRackDropView, DSAssignOrderView, DSPendingPicksView,
                        DSDeliveryQueueView, DSDepartmentStatusView,
                        DSOrderTrackView, DSMyPicksView)
router = DefaultRouter()
router.register(r'pick-tasks', PickTaskViewSet)
router.register(r'pack-tasks', PackTaskViewSet)
router.register(r'sorting-waves', SortingWaveViewSet)
router.register(r'staged-aging', StagedAgingViewSet)
router.register(r'transfer-orders', TransferOrderViewSet)
router.register(r'transfer-order-lines', TransferOrderLineViewSet)
router.register(r'bin-transfers', BinTransferViewSet)
router.register(r'droplists', DroplistViewSet)
urlpatterns = [
    path('', include(router.urls)),
    path('overview', DSOverviewView.as_view(), name='ds-overview'),
    path('incoming-lpns', DSIncomingLpnsView.as_view(), name='ds-incoming-lpns'),
    path('inventory', DSInventoryView.as_view(), name='ds-inventory'),
    path('receive-lpn', DSReceiveLpnView.as_view(), name='ds-receive-lpn'),
    path('shelf-putaway', DSShelfPutawayView.as_view(), name='ds-shelf-putaway'),
    path('order-action', DSOrderActionView.as_view(), name='ds-order-action'),
    path('allocate-order', DSAllocateOrderView.as_view(), name='ds-allocate-order'),
    path('pick-lines', DSPickLinesView.as_view(), name='ds-pick-lines'),
    path('pick-line', DSPickLineView.as_view(), name='ds-pick-line'),
    path('pick-abandon', DSPickAbandonView.as_view(), name='ds-pick-abandon'),
    path('resolve-bin', DSResolveBinView.as_view(), name='ds-resolve-bin'),
    path('pack-order', DSPackOrderView.as_view(), name='ds-pack-order'),
    path('rack-drop', DSRackDropView.as_view(), name='ds-rack-drop'),
    path('assign-order', DSAssignOrderView.as_view(), name='ds-assign-order'),
    path('pending-picks', DSPendingPicksView.as_view(), name='ds-pending-picks'),
    path('my-picks', DSMyPicksView.as_view(), name='ds-my-picks'),
    path('delivery-queue', DSDeliveryQueueView.as_view(), name='ds-delivery-queue'),
    path('department-status', DSDepartmentStatusView.as_view(),
         name='ds-department-status'),
    path('order-tracking', DSOrderTrackView.as_view(), name='ds-order-tracking'),
]
