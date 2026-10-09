import uuid
from django.db import models

class Serviceability(models.Model):
    service_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='serviceability')
    band = models.CharField(max_length=20)
    day_of_week = models.PositiveSmallIntegerField()
    start_hour = models.PositiveSmallIntegerField()
    end_hour = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)
    class Meta:
        db_table = 'serviceability'

class RoutingDecision(models.Model):
    decision_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_id = models.UUIDField()
    source_site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='routing_source')
    dest_site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='routing_dest')
    eta_minutes = models.PositiveIntegerField()
    distance_m = models.PositiveIntegerField()
    vehicle_type = models.CharField(max_length=20, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'routing_decisions'
        ordering = ['-created_at']
