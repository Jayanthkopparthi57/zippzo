from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (DispatchPlanViewSet, BatchViewSet, OrderViewSet, OrderLineViewSet,
                    OrderAllocationViewSet, PicklistViewSet, PicklistLineViewSet,
                    SortlistViewSet, SortlistLineViewSet, ManifestViewSet,
                    ManifestLineViewSet, CancellationPutawayViewSet)

router = DefaultRouter()
router.register(r'dispatch-plans', DispatchPlanViewSet)
router.register(r'batches', BatchViewSet)
router.register(r'orders', OrderViewSet)
router.register(r'order-lines', OrderLineViewSet)
router.register(r'allocations', OrderAllocationViewSet)
router.register(r'picklists', PicklistViewSet)
router.register(r'picklist-lines', PicklistLineViewSet)
router.register(r'sortlists', SortlistViewSet)
router.register(r'sortlist-lines', SortlistLineViewSet)
router.register(r'manifests', ManifestViewSet)
router.register(r'manifest-lines', ManifestLineViewSet)
router.register(r'cancellation-putaways', CancellationPutawayViewSet)

urlpatterns = [path('', include(router.urls))]
