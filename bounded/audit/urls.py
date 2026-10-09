# Audit URLs
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AuditLogViewSet
router = DefaultRouter()
router.register(r'log', AuditLogViewSet)
urlpatterns = [path('', include(router.urls))]
