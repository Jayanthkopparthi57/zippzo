# Audit Serializers
from rest_framework import serializers
from .models import AuditLog

class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = ['audit_id','actor_type','actor_id','action','entity_type','entity_id','before_json',
                  'after_json','ip','request_id','result','denial_reason','created_at']
        read_only_fields = ['audit_id','created_at']
