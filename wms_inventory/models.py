import uuid
from django.db import models
from wms_master.models import Site, Sku, Bin, Zone
from wms_platform.models import User


class Lpn(models.Model):
    TYPE_CHOICES = [('TOTE', 'Tote'), ('CARTON', 'Carton'), ('PALLET', 'Pallet')]
    STATUS_CHOICES = [
        ('EMPTY', 'Empty'), ('PICKING', 'Picking'), ('SORT_DONE', 'Sort Done'),
        ('QC_DONE', 'QC Done'), ('IRT_DONE', 'IRT Done'), ('PACKED', 'Packed'),
        ('IN_TRANSIT', 'In Transit'), ('RECEIVED', 'Received'), ('CLOSED', 'Closed'),
    ]

    lpn_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    barcode = models.CharField(max_length=100, unique=True)
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default='TOTE')
    current_site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='lpns')
    current_bin = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='EMPTY')
    is_superstore = models.BooleanField(default=False)
    order_id = models.UUIDField(null=True, blank=True)
    picklist_id = models.UUIDField(null=True, blank=True)
    source_site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='source_lpns')
    dest_site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='dest_lpns')
    parent_pallet = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children')
    qc_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='qc_lpns')
    qc_at = models.DateTimeField(null=True, blank=True)
    irt_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='irt_lpns')
    irt_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'lpn'
        ordering = ['-created_at']

    def __str__(self):
        return self.barcode


class InventoryLot(models.Model):
    BUCKET_CHOICES = [('Good', 'Good'), ('BAD', 'Bad'), ('QC_HOLD', 'QC Hold'), ('InProgress', 'In Progress')]
    STATUS_CHOICES = [('AVAILABLE', 'Available'), ('HELD', 'Held'), ('PICKING', 'Picking'), ('DEPLETED', 'Depleted')]
    INBOUND_TYPE_CHOICES = [('EXTERNAL', 'External'), ('INTERNAL', 'Internal')]

    lot_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='lots')
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='lots')
    bin = models.ForeignKey(Bin, null=True, blank=True, on_delete=models.SET_NULL, related_name='lots')
    lpn = models.ForeignKey(Lpn, null=True, blank=True, on_delete=models.SET_NULL, related_name='lots')
    parent_pallet = models.ForeignKey(Lpn, null=True, blank=True, on_delete=models.SET_NULL, related_name='pallet_lots')
    lot_code = models.CharField(max_length=50, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    box_size = models.IntegerField(default=1)
    inbound_type = models.CharField(max_length=10, choices=INBOUND_TYPE_CHOICES, default='EXTERNAL')
    inbound_ref = models.CharField(max_length=100, blank=True)
    source_site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='sourced_lots')
    source_vendor_id = models.UUIDField(null=True, blank=True)
    bucket = models.CharField(max_length=15, choices=BUCKET_CHOICES, default='Good')
    qty = models.IntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='AVAILABLE')
    on_hold = models.BooleanField(default=False)
    hold_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='held_lots')
    hold_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inventory_lot'
        ordering = ['expiry_date', 'created_at']

    def __str__(self):
        return f"{self.lot_code or str(self.lot_id)[:8]} ({self.sku.sku_code})"


class InventoryTx(models.Model):
    FLOW_CHOICES = [
        ('GRN', 'GRN'), ('PUTAWAY', 'Putaway'), ('PICK', 'Pick'), ('SORT', 'Sort'),
        ('PACK', 'Pack'), ('SHIP', 'Ship'), ('RECEIVE', 'Receive'), ('MOVEMENT', 'Movement'),
        ('ADJUST', 'Adjust'), ('SCRAP', 'Scrap'), ('REINVENTORIZE', 'Re-inventorize'),
        ('COUNT', 'Count'),
    ]

    tx_id = models.BigAutoField(primary_key=True)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='transactions')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='transactions')
    from_lot = models.ForeignKey(InventoryLot, null=True, blank=True, on_delete=models.SET_NULL, related_name='from_txs')
    to_lot = models.ForeignKey(InventoryLot, null=True, blank=True, on_delete=models.SET_NULL, related_name='to_txs')
    from_bin = models.CharField(max_length=100, blank=True)
    to_bin = models.CharField(max_length=100, blank=True)
    qty = models.IntegerField(default=0)
    flow = models.CharField(max_length=20, choices=FLOW_CHOICES)
    ref_type = models.CharField(max_length=50, blank=True)
    ref_id = models.UUIDField(null=True, blank=True)
    remark = models.TextField(blank=True)
    category = models.CharField(max_length=100, blank=True)
    subcategory = models.CharField(max_length=100, blank=True)
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='transactions')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inventory_tx'
        ordering = ['-created_at']

    def __str__(self):
        return f"TX#{self.tx_id} {self.flow} qty={self.qty}"


class Droplist(models.Model):
    STATUS_CHOICES = [('OPEN', 'Open'), ('IN_PROGRESS', 'In Progress'), ('COMPLETED', 'Completed')]

    droplist_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    lpn = models.ForeignKey(Lpn, null=True, blank=True, on_delete=models.SET_NULL, related_name='droplists')
    totes = models.IntegerField(default=0)
    dropped_count = models.IntegerField(default=0)
    in_spider_count = models.IntegerField(default=0)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='OPEN')
    started_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='droplists')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'droplist'
        ordering = ['-created_at']

    def __str__(self):
        return self.code
