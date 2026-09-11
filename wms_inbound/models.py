import uuid
from django.db import models
from wms_master.models import Site, Sku, Bin, DockDoor, Vendor
from wms_platform.models import User, ReasonCode
from wms_inventory.models import InventoryLot, Lpn


class Asn(models.Model):
    TYPE_CHOICES = [
        ('VENDOR_PO', 'Vendor PO'), ('MH_TRANSFER', 'MH Transfer'),
        ('STORE_RETURN', 'Store Return'), ('RTV_IN', 'RTV In'),
    ]
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'), ('CONFIRMED', 'Confirmed'), ('IN_TRANSIT', 'In Transit'),
        ('ARRIVED', 'Arrived'), ('CHECKED_IN', 'Checked In'), ('UNLOADED', 'Unloaded'),
        ('QC_PENDING', 'QC Pending'), ('PUTAWAY_PENDING', 'Putaway Pending'), ('CLOSED', 'Closed'),
    ]

    asn_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asn_no = models.CharField(max_length=50, unique=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    source_site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='outbound_asns')
    source_vendor = models.ForeignKey(Vendor, null=True, blank=True, on_delete=models.SET_NULL, related_name='asns')
    dest_site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='inbound_asns')
    po_ref = models.CharField(max_length=100, blank=True)
    door = models.ForeignKey(DockDoor, null=True, blank=True, on_delete=models.SET_NULL, related_name='asns')
    slot_start = models.DateTimeField(null=True, blank=True)
    slot_end = models.DateTimeField(null=True, blank=True)
    expected_vehicle = models.CharField(max_length=50, blank=True)
    total_lpns = models.IntegerField(default=0)
    total_skus = models.IntegerField(default=0)
    total_qty = models.IntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'asn'
        ordering = ['-created_at']

    def __str__(self):
        return self.asn_no


class AsnLine(models.Model):
    LINE_STATUS_CHOICES = [
        ('OPEN', 'Open'), ('PARTIAL', 'Partial'), ('RECEIVED', 'Received'), ('SHORT', 'Short'),
    ]

    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asn = models.ForeignKey(Asn, on_delete=models.CASCADE, related_name='lines')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='asn_lines')
    ean = models.CharField(max_length=50, blank=True)
    ordered_qty = models.IntegerField(default=0)
    expected_expiry = models.DateField(null=True, blank=True)
    line_status = models.CharField(max_length=10, choices=LINE_STATUS_CHOICES, default='OPEN')

    class Meta:
        db_table = 'asn_line'

    def __str__(self):
        return f"{self.asn.asn_no} - {self.sku.sku_code}"


class Grn(models.Model):
    MODE_CHOICES = [('LPN_SCAN', 'LPN Scan'), ('CASE_SCAN', 'Case Scan'), ('PIECE', 'Piece'), ('FILE', 'File')]
    STATUS_CHOICES = [('DRAFT', 'Draft'), ('IN_PROGRESS', 'In Progress'), ('PARTIAL', 'Partial'), ('COMPLETED', 'Completed')]

    grn_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn_no = models.CharField(max_length=50, unique=True)
    asn = models.ForeignKey(Asn, on_delete=models.CASCADE, related_name='grns')
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default='LPN_SCAN')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='DRAFT')
    has_discrepancy = models.BooleanField(default=False)
    received_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='grns')
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'grn'
        ordering = ['-created_at']

    def __str__(self):
        return self.grn_no


class GrnLine(models.Model):
    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn = models.ForeignKey(Grn, on_delete=models.CASCADE, related_name='lines')
    asn_line = models.ForeignKey(AsnLine, null=True, blank=True, on_delete=models.SET_NULL, related_name='grn_lines')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='grn_lines')
    ordered_qty = models.IntegerField(default=0)
    received_qty = models.IntegerField(default=0)
    damaged_qty = models.IntegerField(default=0)
    expired_qty = models.IntegerField(default=0)
    excess_qty = models.IntegerField(default=0)
    expiry_date = models.DateField(null=True, blank=True)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    lot = models.ForeignKey(InventoryLot, null=True, blank=True, on_delete=models.SET_NULL, related_name='grn_lines')
    reason_code = models.ForeignKey(ReasonCode, null=True, blank=True, on_delete=models.SET_NULL, related_name='grn_lines')

    class Meta:
        db_table = 'grn_line'

    def __str__(self):
        return f"{self.grn.grn_no} - {self.sku.sku_code}"


class PutawayTask(models.Model):
    STATUS_CHOICES = [('CREATED', 'Created'), ('ASSIGNED', 'Assigned'), ('COMPLETED', 'Completed'), ('EXCEPTION', 'Exception')]

    putaway_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn_line = models.ForeignKey(GrnLine, null=True, blank=True, on_delete=models.SET_NULL, related_name='putaway_tasks')
    lpn = models.ForeignKey(Lpn, null=True, blank=True, on_delete=models.SET_NULL, related_name='putaway_tasks')
    from_location = models.CharField(max_length=100, default='RECV-STAGE')
    to_bin = models.ForeignKey(Bin, null=True, blank=True, on_delete=models.SET_NULL, related_name='putaway_tasks')
    priority = models.IntegerField(default=5)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='CREATED')
    assigned_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='putaway_tasks')
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    exception_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'putaway_task'
        ordering = ['priority', '-created_at']

    def __str__(self):
        return f"Putaway-{str(self.putaway_id)[:8]}"


class InboundDiscrepancy(models.Model):
    TYPE_CHOICES = [('SHORT', 'Short'), ('EXCESS', 'Excess'), ('DAMAGE', 'Damage'), ('WRONG_MRP', 'Wrong MRP')]
    STATUS_CHOICES = [('OPEN', 'Open'), ('RESOLVED', 'Resolved')]

    disc_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asn = models.ForeignKey(Asn, on_delete=models.CASCADE, related_name='discrepancies')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='discrepancies')
    type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    claimed_qty = models.IntegerField(default=0)
    found_qty = models.IntegerField(default=0)
    value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='OPEN')
    maker = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='made_discrepancies')
    checker = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='checked_discrepancies')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inbound_discrepancy'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.asn.asn_no} - {self.type} - {self.sku.sku_code}"
