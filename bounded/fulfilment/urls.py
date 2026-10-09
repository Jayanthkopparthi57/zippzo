from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import BatchViewSet, OrderAllocationViewSet
router = DefaultRouter()
router.register(r'batches', BatchViewSet)
router.register(r'allocations', OrderAllocationViewSet)
urlpatterns = [path('', include(router.urls))]
