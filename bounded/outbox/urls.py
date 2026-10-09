# Outbox URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import OutboxEventViewSet
router = DefaultRouter()
router.register(r'events', OutboxEventViewSet)
urlpatterns = [path('', include(router.urls))]
