from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ReturnOrderViewSet, RTVOrderViewSet, RTSOrderViewSet
router = DefaultRouter()
router.register(r'returns', ReturnOrderViewSet)
router.register(r'rtvs', RTVOrderViewSet)
router.register(r'rts', RTSOrderViewSet)
urlpatterns = [path('', include(router.urls))]
