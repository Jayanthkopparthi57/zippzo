# Notifications  Push, SMS, Email, WebSocket
import uuid
from django.db import models


class Notification(models.Model):
    # IN_APP is the channel this deployment actually delivers on: the row *is*
    # the delivery. The provider channels stay declared so an SMS/push adapter
    # can be added later without a schema change, but nothing writes to them
    # today - a row that is only SMS would be a message nobody can read, so
    # publish_event always creates an IN_APP row alongside them.
    CHANNEL_CHOICES = [('IN_APP','In-App'),('PUSH','Push'),('SMS','SMS'),('WS','WebSocket'),('EMAIL','Email'),('WHATSAPP','WhatsApp')]
    notification_id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user = models.UUIDField(null=True, blank=True)
    type = models.CharField(max_length=40)
    channel = models.CharField(max_length=15, choices=CHANNEL_CHOICES)
    idempotency_key = models.CharField(max_length=120, unique=True)
    payload_json = models.JSONField()
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    # Read state for the in-app inbox. NULL means unread.
    read_at = models.DateTimeField(null=True, blank=True)
    retry_count = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'notifications'
        ordering = ['-created_at']
        indexes = [models.Index(fields=['user', 'created_at'])]

    def __str__(self):
        return f"Notification {self.notification_id}"
