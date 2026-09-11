import uuid
from django.db import models
from django.utils import timezone
from apps.fulfillment.models import SalesOrder, PickTask
from apps.hr_tracking.models import Employee

class PackingStatusChoices(models.TextChoices):
    PENDING = 'pending', 'Pending Verification'
    IN_PROGRESS = 'in_progress', 'Scanning in Progress'
    VERIFIED = 'verified', 'Scan Verified & Matched'
    PACKED = 'packed', 'Sealed & Ready for Shipping'
    MISMATCH_HOLD = 'mismatch_hold', 'Barcode Mismatch / On Hold'

class PackingTask(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pick_task = models.OneToOneField(PickTask, on_delete=models.RESTRICT, related_name='packing_task')
    order = models.ForeignKey(SalesOrder, on_delete=models.CASCADE, related_name='packing_tasks')
    packed_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='packed_tasks')
    scan_verified_qty = models.IntegerField(default=0)
    packaging_type = models.CharField(max_length=50, default='Standard Box')
    actual_weight_kg = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    status = models.CharField(max_length=30, choices=PackingStatusChoices.choices, default=PackingStatusChoices.PENDING)
    error_notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Packing for {self.order.order_number} [{self.status}]"

# ==============================================================================
# WAREHOUSEOS 13-TABLE CORE ARCHITECTURE: PACKING MODELS
# ==============================================================================

class PackingRecord(models.Model):
    """Table 10: PACKING TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    packing_id = models.CharField(max_length=50, unique=True) # PACK-00981
    order_id = models.CharField(max_length=50, db_index=True) # ORD-00124
    pick_task_id = models.CharField(max_length=50, db_index=True) # PICK-009821
    package_id = models.CharField(max_length=50, db_index=True) # PKG-009821
    packing_station = models.CharField(max_length=50, default='PACK-04') # PACK-04, PACK-02
    packer = models.CharField(max_length=100, default='Priya')
    items_expected = models.IntegerField(default=1)
    items_verified = models.IntegerField(default=1)
    units = models.IntegerField(default=1)
    package_count = models.IntegerField(default=1)
    weight = models.CharField(max_length=30, default='7.8 kg')
    dimensions = models.CharField(max_length=50, default='40×30×25 cm')
    package_type = models.CharField(max_length=50, default='Standard Box') # Standard Box, Cold Bag
    package_barcode = models.CharField(max_length=64, default='PKG890123')
    seal_no = models.CharField(max_length=50, default='SEAL-48219')
    qc_status = models.CharField(max_length=30, default='Passed') # Passed, Pending, Mismatch
    packed_at = models.CharField(max_length=30, default='13:05')
    status = models.CharField(max_length=50, default='Packed') # Packed, Packing, On Hold

    class Meta:
        ordering = ['-packing_id']

    def __str__(self):
        return f"{self.packing_id} - {self.package_barcode} ({self.status})"

