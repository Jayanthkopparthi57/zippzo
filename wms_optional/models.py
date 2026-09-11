import uuid
from django.db import models
from wms_master.models import Site, Sku, Bin
from wms_platform.models import User


class CycleCount(models.Model):
    TYPE_CHOICES = [('BIN', 'Bin'), ('SKU', 'SKU'), ('BLIND', 'Blind')]
    STATUS_CHOICES = [('PLANNED', 'Planned'), ('IN_PROGRESS', 'In Progress'), ('COMPLETED', 'Completed')]

    count_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='cycle_counts')
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default='BIN')
    scope = models.TextField(blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='PLANNED')
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='cycle_counts')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cycle_count'
        ordering = ['-created_at']

    def __str__(self):
        return f"CycleCount-{str(self.count_id)[:8]}"


class CycleCountLine(models.Model):
    LINE_STATUS_CHOICES = [
        ('PENDING', 'Pending'), ('MATCHED', 'Matched'),
        ('VARIANCE', 'Variance'), ('ADJUSTED', 'Adjusted'),
    ]

    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    count = models.ForeignKey(CycleCount, on_delete=models.CASCADE, related_name='lines')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='count_lines')
    bin = models.ForeignKey(Bin, null=True, blank=True, on_delete=models.SET_NULL, related_name='count_lines')
    system_qty = models.IntegerField(default=0)
    counted_qty = models.IntegerField(default=0)
    variance = models.IntegerField(default=0)
    status = models.CharField(max_length=15, choices=LINE_STATUS_CHOICES, default='PENDING')

    class Meta:
        db_table = 'cycle_count_line'

    def __str__(self):
        return f"{self.count} - {self.sku.sku_code}"


class ReplenishmentTask(models.Model):
    TRIGGER_CHOICES = [('ALLOCATION', 'Allocation'), ('THRESHOLD', 'Threshold')]
    STATUS_CHOICES = [('CREATED', 'Created'), ('ASSIGNED', 'Assigned'), ('DONE', 'Done'), ('CANCELLED', 'Cancelled')]

    rep_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='replenishments')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='replenishments')
    from_bin = models.ForeignKey(Bin, null=True, blank=True, on_delete=models.SET_NULL, related_name='replen_from')
    to_bin = models.ForeignKey(Bin, null=True, blank=True, on_delete=models.SET_NULL, related_name='replen_to')
    qty = models.IntegerField(default=0)
    trigger = models.CharField(max_length=15, choices=TRIGGER_CHOICES, default='THRESHOLD')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='CREATED')
    assigned_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='replenishments')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'replenishment_task'
        ordering = ['-created_at']

    def __str__(self):
        return f"Replen-{self.sku.sku_code}-{self.qty}"
