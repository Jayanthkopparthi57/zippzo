# Audit Views
from rest_framework import viewsets
from .models import AuditLog
from .serializers import AuditLogSerializer

class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """The platform-wide record of who changed what.

    AuditLog has no site column - it spans every entity in every store, with
    the before and after JSON of each change - so there is nothing to narrow it
    with. Rather than hand a dark-store operator the whole history, this is
    readable by administrators only.
    """
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    filterset_fields = ['actor_type', 'action', 'result', 'entity_type']

    def get_queryset(self):
        from bounded.ds_ops.access import is_superuser

        user = self.request.user
        if user is None or not getattr(user, 'is_authenticated', False):
            return self.queryset.none()
        if not is_superuser(user):
            return self.queryset.none()
        return self.queryset
