# Workforce URLs (zone mapping, assignments, time logs, activity, productivity).
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    PickerZoneMappingViewSet, WorkAssignmentViewSet, WorkTimeLogViewSet,
    EmployeeActivityEventViewSet, ProductivityRollupViewSet,
)

router = DefaultRouter()
router.register(r'picker-zones', PickerZoneMappingViewSet)
router.register(r'work-assignments', WorkAssignmentViewSet)
router.register(r'time-logs', WorkTimeLogViewSet)
router.register(r'activity-events', EmployeeActivityEventViewSet)
router.register(r'productivity', ProductivityRollupViewSet)

urlpatterns = [path('', include(router.urls))]
