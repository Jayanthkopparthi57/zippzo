import uuid
from django.db import models

class WebhookEventTypeChoices(models.TextChoices):
    LOW_STOCK = 'inventory.low_stock', 'Inventory Low Stock'
    GRN_RECEIVED = 'grn.received', 'GRN Stock Received'
    ORDER_SHIPPED = 'order.shipped', 'Order Shipped'
    BATCH_EXPIRING = 'batch.expiring_soon', 'Batch Expiring Soon'
    BACKORDER_TRIGGERED = 'backorder.triggered', 'Backorder Triggered'

class OutgoingWebhook(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    webhook_id = models.CharField(max_length=64, unique=True, default=uuid.uuid4)
    event_type = models.CharField(max_length=50, choices=WebhookEventTypeChoices.choices)
    target_url = models.URLField(max_length=255)
    secret_token = models.CharField(max_length=255, default='zippzo-secret-token')
    retry_count = models.IntegerField(default=0)
    max_retries = models.IntegerField(default=5)
    last_triggered_at = models.DateTimeField(null=True, blank=True)
    last_response_code = models.IntegerField(null=True, blank=True)
    last_error_message = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Webhook [{self.event_type}] -> {self.target_url}"
