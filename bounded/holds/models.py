# Holds  Stock Holds and Invariant Monitoring
import uuid
from django.db import models


class HoldStatus:
    OPEN = 'OPEN'
    UNDER_REVIEW = 'UNDER_REVIEW'
    RESOLVED = 'RESOLVED'
    ESCALATED = 'ESCALATED'

class Hold(models.Model):
    STATUS_CHOICES = [('OPEN','Open'),('UNDER_REVIEW','Under Review'),('RESOLVED','Resolved'),('ESCALATED','Escalated')]
    hold_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.CharField(max_length=50)
    sku = models.UUIDField()
    lot = models.UUIDField()
    container_from = models.CharField(max_length=30)
    container_ref = models.CharField(max_length=50, null=True, blank=True)
    qty = models.PositiveIntegerField()
    trigger_reason = models.CharField(max_length=200)
    ref_type = models.CharField(max_length=30, null=True, blank=True)
    ref_id = models.CharField(max_length=50, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='OPEN')
    created_by = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    assigned_to = models.CharField(max_length=64, null=True, blank=True)
    resolved_by = models.CharField(max_length=64, null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.TextField(blank=True)
    escalated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'holds'
        ordering = ['-created_at']

    def __str__(self):
        return f"Hold {self.hold_id} ({self.status})"
