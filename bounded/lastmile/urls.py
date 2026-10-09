from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PODEvidenceViewSet
router = DefaultRouter()
router.register(r'pod', PODEvidenceViewSet)
urlpatterns = [path('', include(router.urls))]
