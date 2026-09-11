from rest_framework import serializers, viewsets, permissions
from .models import AuditLog
from apps.authentication.permissions import IsAdminRole

class AuditLogSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            'id', 'user', 'username', 'action', 'entity_type',
            'entity_id', 'ip_address', 'user_agent', 'old_values',
            'new_values', 'timestamp'
        ]
        read_only_fields = fields

class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.all().select_related('user')
    serializer_class = AuditLogSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]
    filterset_fields = ['action', 'entity_type', 'entity_id', 'user']
    search_fields = ['action', 'entity_id', 'ip_address']
