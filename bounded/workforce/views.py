from bounded.masterdata.scoping import SiteScopedViewSet
from .models import (
    PickerZoneMapping, WorkAssignment, WorkTimeLog, EmployeeActivityEvent,
    ProductivityRollup,
)
from .serializers import (
    PickerZoneMappingSerializer, WorkAssignmentSerializer,
    WorkTimeLogSerializer, EmployeeActivityEventSerializer,
    ProductivityRollupSerializer,
)


class PickerZoneMappingViewSet(SiteScopedViewSet):
    queryset = PickerZoneMapping.objects.select_related(
        'user', 'site', 'zone').all()
    serializer_class = PickerZoneMappingSerializer
    filterset_fields = ['site', 'zone', 'user', 'is_active']
    search_fields = ['user__email', 'user__full_name', 'zone__code', 'site__code']
    ordering_fields = ['priority', 'created_at']


class WorkAssignmentViewSet(SiteScopedViewSet):
    queryset = WorkAssignment.objects.select_related(
        'user', 'site', 'assigned_by').all()
    serializer_class = WorkAssignmentSerializer
    filterset_fields = ['site', 'user', 'task_type', 'status', 'priority', 'ref_type']
    search_fields = ['user__email', 'ref_id', 'notes', 'site__code']
    ordering_fields = ['assigned_at', 'priority', 'status']

    def perform_create(self, serializer):
        # The assigner is whoever created the row; a body-supplied value is
        # only trusted for an estate administrator reassigning work.
        request_user = self.request.user
        supplied = serializer.validated_data.get('assigned_by')
        serializer.save(assigned_by=(supplied or request_user))


class WorkTimeLogViewSet(SiteScopedViewSet):
    queryset = WorkTimeLog.objects.select_related(
        'user', 'site', 'assignment', 'shift').all()
    serializer_class = WorkTimeLogSerializer
    filterset_fields = ['site', 'user', 'activity', 'source', 'assignment', 'shift']
    search_fields = ['user__email', 'notes', 'site__code']
    ordering_fields = ['started_at', 'minutes', 'activity']


class EmployeeActivityEventViewSet(SiteScopedViewSet):
    """Append-only. Events may be posted and read, never rewritten."""

    queryset = EmployeeActivityEvent.objects.select_related('user', 'site').all()
    serializer_class = EmployeeActivityEventSerializer
    http_method_names = ['get', 'post', 'head', 'options']
    filterset_fields = ['site', 'user', 'event_type', 'ref_type']
    search_fields = ['user__email', 'ref_id', 'event_type']
    ordering_fields = ['occurred_at', 'event_type']


class ProductivityRollupViewSet(SiteScopedViewSet):
    queryset = ProductivityRollup.objects.select_related('user', 'site').all()
    serializer_class = ProductivityRollupSerializer
    filterset_fields = ['site', 'user', 'work_date', 'source']
    search_fields = ['user__email', 'site__code']
    ordering_fields = ['work_date', 'units_per_hour', 'units_processed']
