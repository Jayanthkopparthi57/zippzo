from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import OutgoingWebhookViewSet

router = DefaultRouter()
router.register(r'endpoints', OutgoingWebhookViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
