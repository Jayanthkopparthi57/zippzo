from django.db import models
from django.contrib.auth.models import User

class AuditLog(models.Model):
    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')
    action = models.CharField(max_length=100) # e.g. 'USER_APPROVED', 'ORDER_ALLOCATED', 'STOCK_TRANSFER'
    entity_type = models.CharField(max_length=50) # e.g. 'User', 'Inventory', 'SalesOrder'
    entity_id = models.CharField(max_length=100)
    ip_address = models.CharField(max_length=45, blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    old_values = models.JSONField(null=True, blank=True)
    new_values = models.JSONField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['entity_type', 'entity_id', '-timestamp'], name='idx_audit_entity'),
            models.Index(fields=['action', '-timestamp'], name='idx_audit_action'),
        ]

    def __str__(self):
        return f"[{self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}] {self.user.username if self.user else 'SYSTEM'}: {self.action} on {self.entity_type} #{self.entity_id}"

    @classmethod
    def log(cls, user, action, entity_type, entity_id, old_values=None, new_values=None, ip_address=None, user_agent=None):
        """Append-only logging helper."""
        return cls.objects.create(
            user=user if user and user.is_authenticated else None,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            ip_address=ip_address,
            user_agent=user_agent,
            old_values=old_values,
            new_values=new_values
        )
