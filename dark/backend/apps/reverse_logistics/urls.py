from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ReturnOrderViewSet

router = DefaultRouter()
router.register(r'rma', ReturnOrderViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
