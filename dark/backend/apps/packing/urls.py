from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PackingTaskViewSet

router = DefaultRouter()
router.register(r'tasks', PackingTaskViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
