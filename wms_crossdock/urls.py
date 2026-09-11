from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CrossDockBatchViewSet, CrossDockLineViewSet

router = DefaultRouter()
router.register(r'batches', CrossDockBatchViewSet)
router.register(r'lines', CrossDockLineViewSet)

urlpatterns = [path('', include(router.urls))]
