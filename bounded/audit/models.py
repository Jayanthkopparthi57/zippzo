# Audit  Immutable Action Log
import uuid
from django.db import models


class AuditLog(models.Model):
    actor_type_choices = [('USER','User'),('SYSTEM','System'),('API','API'),('INTEGRATION','Integration')]
    result_choices = [('SUCCESS','Success'),('DENIED','Denied'),('ERROR','Error')]
    audit_id = models.BigAutoField(primary_key=True)
    actor_type = models.CharField(max_length=20, choices=actor_type_choices)
    actor_id = models.CharField(max_length=50, null=True, blank=True)
    action = models.CharField(max_length=60)
    entity_type = models.CharField(max_length=40, null=True, blank=True)
    entity_id = models.UUIDField(null=True, blank=True)
    before_json = models.JSONField(null=True, blank=True)
    after_json = models.JSONField(null=True, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    request_id = models.UUIDField(null=True, blank=True)
    result = models.CharField(max_length=20, choices=result_choices)
    denial_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'audit_log'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['actor_id', 'created_at']),
            models.Index(fields=['entity_type', 'entity_id']),
        ]

    def __str__(self):
        return f"Audit {self.audit_id}: {self.action}"
