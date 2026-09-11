import uuid
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from apps.master_data.models import Warehouse, Location
from apps.catalog.models import Vendor, Product, Batch
from apps.hr_tracking.models import Employee

class POStatusChoices(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    SUBMITTED = 'submitted', 'Submitted'
    PARTIALLY_RECEIVED = 'partially_received', 'Partially Received'
    RECEIVED = 'received', 'Fully Received'
    CANCELLED = 'cancelled', 'Cancelled'

class GRNStatusChoices(models.TextChoices):
    PENDING_QC = 'pending_qc', 'Pending Quality Check'
    QC_IN_PROGRESS = 'qc_in_progress', 'QC in Progress'
    COMPLETED = 'completed', 'Completed & Putaway Done'
    REJECTED = 'rejected', 'Rejected'

class PurchaseOrder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    po_number = models.CharField(max_length=50, unique=True)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='purchase_orders')
    vendor = models.ForeignKey(Vendor, on_delete=models.RESTRICT, related_name='purchase_orders')
    status = models.CharField(max_length=30, choices=POStatusChoices.choices, default=POStatusChoices.DRAFT)
    order_date = models.DateField(default=timezone.now)
    expected_delivery_date = models.DateField(null=True, blank=True)
    currency = models.CharField(max_length=3, default='USD')
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0.00)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_purchase_orders')
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.po_number:
            from django.db.models import Max
            date_str = timezone.now().strftime('%Y%m')
            prefix = f"PO-{date_str}-"
            last = PurchaseOrder.objects.filter(
                po_number__startswith=prefix
            ).aggregate(max_num=Max('po_number'))['max_num']
            if last:
                try:
                    seq = int(last.split('-')[-1]) + 1
                except (ValueError, IndexError):
                    seq = PurchaseOrder.objects.filter(po_number__startswith=prefix).count() + 1
            else:
                seq = 1
            self.po_number = f"{prefix}{seq:04d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.po_number} - {self.vendor.name} ({self.status})"

class PurchaseOrderItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    po = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.RESTRICT, related_name='po_items')
    ordered_qty = models.IntegerField()
    received_qty = models.IntegerField(default=0)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)

    def __str__(self):
        return f"{self.po.po_number} -> {self.product.sku}: {self.received_qty}/{self.ordered_qty}"

class GoodsReceiptNote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn_number = models.CharField(max_length=50, unique=True)
    po = models.ForeignKey(PurchaseOrder, on_delete=models.RESTRICT, related_name='goods_receipt_notes')
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='grn_records')
    received_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='received_grns')
    receipt_date = models.DateTimeField(default=timezone.now)
    vehicle_number = models.CharField(max_length=50, blank=True, null=True)
    driver_phone = models.CharField(max_length=30, blank=True, null=True)
    status = models.CharField(max_length=30, choices=GRNStatusChoices.choices, default=GRNStatusChoices.PENDING_QC)

    def save(self, *args, **kwargs):
        if not self.grn_number:
            from django.db.models import Max
            date_str = timezone.now().strftime('%Y%m')
            prefix = f"GRN-{date_str}-"
            last = GoodsReceiptNote.objects.filter(
                grn_number__startswith=prefix
            ).aggregate(max_num=Max('grn_number'))['max_num']
            if last:
                try:
                    seq = int(last.split('-')[-1]) + 1
                except (ValueError, IndexError):
                    seq = GoodsReceiptNote.objects.filter(grn_number__startswith=prefix).count() + 1
            else:
                seq = 1
            self.grn_number = f"{prefix}{seq:04d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.grn_number} for {self.po.po_number} [{self.status}]"

class GRNItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn = models.ForeignKey(GoodsReceiptNote, on_delete=models.CASCADE, related_name='items')
    po_item = models.ForeignKey(PurchaseOrderItem, on_delete=models.RESTRICT, related_name='grn_items')
    product = models.ForeignKey(Product, on_delete=models.RESTRICT, related_name='grn_received_items')
    batch = models.ForeignKey(Batch, on_delete=models.RESTRICT, related_name='grn_items')
    received_qty = models.IntegerField()
    passed_qty = models.IntegerField(default=0)
    rejected_qty = models.IntegerField(default=0)
    quarantine_location = models.ForeignKey(Location, on_delete=models.RESTRICT, related_name='quarantined_items')
    putaway_location = models.ForeignKey(Location, on_delete=models.SET_NULL, null=True, blank=True, related_name='putaway_items')
    damaged_photos_url = models.JSONField(default=list, blank=True)
    qc_notes = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"{self.grn.grn_number} Item: {self.product.sku} (Recv: {self.received_qty}, Passed: {self.passed_qty})"

# ==============================================================================
# WAREHOUSEOS 13-TABLE CORE ARCHITECTURE: INBOUND MODELS
# ==============================================================================

class InboundShipment(models.Model):
    """Table 1: INBOUND MAIN SHIPMENT LIST"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    inbound_no = models.CharField(max_length=50, unique=True) # e.g. INB-00124
    shipment_type = models.CharField(max_length=50, default='Supplier Delivery') # Supplier Delivery, Warehouse Transfer, RMA
    source = models.CharField(max_length=150) # e.g. ABC Foods, Fresh Dairy
    warehouse = models.CharField(max_length=50, default='RJY-DS-001')
    items_count = models.IntegerField(default=1)
    expected_qty = models.IntegerField(default=0)
    received_qty = models.IntegerField(default=0)
    accepted_qty = models.IntegerField(default=0)
    rejected_qty = models.IntegerField(default=0)
    damaged_qty = models.IntegerField(default=0)
    status = models.CharField(max_length=50, default='Receiving') # Receiving, Scheduled, Putaway Pending, Completed, Cancelled
    expected_arrival = models.DateTimeField(null=True, blank=True)
    actual_arrival = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.inbound_no} ({self.source}) - {self.status}"


class InboundProductItem(models.Model):
    """Table 2: INBOUND PRODUCT / RECEIVING DETAIL TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    inbound_no = models.CharField(max_length=50, db_index=True) # INB-00124
    item_name = models.CharField(max_length=200) # Basmati Rice 5kg
    product_id = models.CharField(max_length=50, blank=True, default='') # PROD-00182
    sku = models.CharField(max_length=64, db_index=True) # RICE-BAS-5KG
    barcode = models.CharField(max_length=64, db_index=True) # 8901234567890
    batch_no = models.CharField(max_length=100) # BTH-R2408
    serial_no = models.CharField(max_length=100, blank=True, null=True)
    uom = models.CharField(max_length=30, default='Bag') # Bag, Pack, Bottle
    pack_size = models.CharField(max_length=50, default='1 unit') # 5kg, 1L, 750ml
    expected_qty = models.IntegerField(default=0)
    scanned_qty = models.IntegerField(default=0)
    received_qty = models.IntegerField(default=0)
    accepted_qty = models.IntegerField(default=0)
    rejected_qty = models.IntegerField(default=0)
    damaged_qty = models.IntegerField(default=0)
    shortage_qty = models.IntegerField(default=0)
    excess_qty = models.IntegerField(default=0)
    mfg_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    best_before = models.CharField(max_length=50, default='') # 12 Months, 3 Days
    remaining_shelf_life = models.CharField(max_length=50, default='') # 343 Days, 2 Days
    temperature = models.CharField(max_length=30, default='25°C')
    storage_condition = models.CharField(max_length=50, default='Ambient') # Ambient, Chilled, Frozen
    qc_status = models.CharField(max_length=50, default='Passed') # Passed, Passed with Exceptions, Rejected, Pending
    scanner_id = models.CharField(max_length=50, default='SCN-014')
    receiver = models.CharField(max_length=100, default='Arjun')
    scan_time = models.CharField(max_length=30, default='10:53')
    status = models.CharField(max_length=50, default='Received') # Received, QC Completed, Ready for Putaway

    class Meta:
        ordering = ['-id']

    def __str__(self):
        return f"{self.inbound_no} - {self.sku} ({self.batch_no})"


class InboundQCRecord(models.Model):
    """Table 3: INBOUND QC TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    qc_id = models.CharField(max_length=50, unique=True) # QC-00121
    inbound_no = models.CharField(max_length=50, db_index=True)
    item_name = models.CharField(max_length=200)
    sku = models.CharField(max_length=64, db_index=True)
    batch_no = models.CharField(max_length=100)
    inspected_qty = models.IntegerField(default=0)
    accepted_qty = models.IntegerField(default=0)
    rejected_qty = models.IntegerField(default=0)
    damaged_qty = models.IntegerField(default=0)
    qc_status = models.CharField(max_length=50, default='Passed') # Passed, Passed with Exceptions, Rejected
    damage_type = models.CharField(max_length=100, blank=True, default='') # Torn Packaging, Leakage
    rejection_reason = models.CharField(max_length=200, blank=True, default='')
    inspector = models.CharField(max_length=100, default='Priya')
    inspection_time = models.CharField(max_length=30, default='11:20')
    evidence_photos = models.CharField(max_length=100, blank=True, default='') # IMG-1021
    notes = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-qc_id']

    def __str__(self):
        return f"{self.qc_id} - {self.inbound_no} [{self.qc_status}]"


class InboundScanHistory(models.Model):
    """Table 4: INBOUND SCAN HISTORY TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scan_id = models.CharField(max_length=50, unique=True) # SC-98211
    inbound_no = models.CharField(max_length=50, db_index=True)
    scanner_id = models.CharField(max_length=50, default='SCN-014')
    user = models.CharField(max_length=100, default='Arjun')
    scan_type = models.CharField(max_length=50, default='Product Receive')
    barcode = models.CharField(max_length=64)
    item_name = models.CharField(max_length=200)
    sku = models.CharField(max_length=64)
    batch_no = models.CharField(max_length=100)
    quantity = models.IntegerField(default=1)
    location = models.CharField(max_length=50, default='Dock-03')
    scan_time = models.CharField(max_length=30, default='10:53:12')
    result = models.CharField(max_length=30, default='Valid') # Valid, Invalid

    class Meta:
        ordering = ['-scan_id']

    def __str__(self):
        return f"{self.scan_id}: {self.sku} by {self.user} ({self.result})"

