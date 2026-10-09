# Outbox  Transactional Event Publisher
import uuid
from django.db import models


class OutboxEvent(models.Model):
    event_id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    aggregate_type = models.CharField(max_length=40)
    aggregate_id = models.UUIDField()
    event_type = models.CharField(max_length=60)
    payload_json = models.JSONField()
    status = models.CharField(max_length=10, default='PENDING')
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    published_at = models.DateTimeField(null=True, blank=True)
    correlation_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = 'outbox_events'
        indexes = [
            models.Index(fields=['created_at'], name='ix_outbox_pending', condition=models.Q(status='PENDING')),
            models.Index(fields=['aggregate_type', 'aggregate_id']),
        ]

    def __str__(self):
        return f"Event {self.event_id} ({self.status})"
