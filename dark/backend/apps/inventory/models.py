import uuid
from django.db import models
from django.contrib.auth.models import User
from apps.master_data.models import Warehouse, Location
from apps.catalog.models import Batch

class InventoryStatusChoices(models.TextChoices):
    AVAILABLE = 'available', 'Available'
    QUARANTINE = 'quarantine', 'Quarantine'
    DAMAGED = 'damaged', 'Damaged'
    RESERVED = 'reserved', 'Reserved'

class Inventory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='inventory_records')
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, related_name='inventory_records')
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name='inventory_records')
    quantity_on_hand = models.IntegerField(default=0)
    quantity_reserved = models.IntegerField(default=0)
    status = models.CharField(
        max_length=30,
        choices=InventoryStatusChoices.choices,
        default=InventoryStatusChoices.AVAILABLE
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'Inventories'
        unique_together = ('batch', 'location', 'status')
        indexes = [
            models.Index(
                fields=['batch', 'location', 'status', 'quantity_on_hand'],
                name='idx_inv_fefo_lookup'
            ),
        ]

    @property
    def available_qty(self):
        return max(0, self.quantity_on_hand - self.quantity_reserved)

    def __str__(self):
        return f"{self.batch.product.sku} at {self.location.bin_code}: OnHand={self.quantity_on_hand}, Avail={self.available_qty} [{self.status}]"

class TransactionTypeChoices(models.TextChoices):
    GRN_RECEIPT = 'GRN_RECEIPT', 'GRN Inbound Receipt'
    QC_PASS = 'QC_PASS', 'QC Passed to Available'
    QC_REJECT = 'QC_REJECT', 'QC Rejected to Damaged'
    PICK_RESERVE = 'PICK_RESERVE', 'Pick Reservation'
    PICK_CONFIRM = 'PICK_CONFIRM', 'Pick Confirmed'
    PACK_VERIFY = 'PACK_VERIFY', 'Pack Scan Verified'
    SHIPMENT_DEDUCT = 'SHIPMENT_DEDUCT', 'Shipment Dispatched'
    REPLENISHMENT_MOVE = 'REPLENISHMENT_MOVE', 'Replenishment Transfer'
    CYCLE_COUNT_ADJUST = 'CYCLE_COUNT_ADJUST', 'Cycle Count Adjustment'
    CUSTOMER_RETURN = 'CUSTOMER_RETURN', 'Customer RMA Return'

class InventoryTransaction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='stock_transactions')
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, related_name='stock_transactions')
    source_location = models.ForeignKey(Location, on_delete=models.SET_NULL, null=True, blank=True, related_name='outgoing_transactions')
    dest_location = models.ForeignKey(Location, on_delete=models.SET_NULL, null=True, blank=True, related_name='incoming_transactions')
    transaction_type = models.CharField(max_length=50, choices=TransactionTypeChoices.choices)
    quantity = models.IntegerField()
    reference_doc_type = models.CharField(max_length=50) # e.g. 'GRN', 'PICK_TASK', 'SALES_ORDER', 'RMA'
    reference_doc_id = models.CharField(max_length=100)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='inventory_transactions')
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['warehouse', 'transaction_type', '-created_at'], name='idx_inv_txn_type'),
            models.Index(fields=['batch', '-created_at'], name='idx_inv_txn_batch'),
        ]

    def __str__(self):
        return f"{self.transaction_type}: {self.quantity} of {self.batch.product.sku} ({self.created_at})"

# ==============================================================================
# WAREHOUSEOS 13-TABLE CORE ARCHITECTURE: STORAGE & PUTAWAY MODELS
# ==============================================================================

class PutawayTask(models.Model):
    """Table 5: STORAGE / PUTAWAY TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    putaway_id = models.CharField(max_length=50, unique=True) # PUT-00982
    inbound_no = models.CharField(max_length=50, db_index=True) # INB-00124
    item_name = models.CharField(max_length=200) # Basmati Rice 5kg
    sku = models.CharField(max_length=64, db_index=True) # RICE-BAS-5KG
    barcode = models.CharField(max_length=64, db_index=True) # 8901234567890
    batch_no = models.CharField(max_length=100) # BTH-R2408
    serial_no = models.CharField(max_length=100, blank=True, null=True)
    accepted_qty = models.IntegerField(default=0)
    putaway_qty = models.IntegerField(default=0)
    pending_qty = models.IntegerField(default=0)
    warehouse = models.CharField(max_length=50, default='RJY-DS-001')
    source_location = models.CharField(max_length=50, default='Dock-03') # Dock-03, QC-Chilled
    zone = models.CharField(max_length=50, default='Grocery-A') # Grocery-A, Chilled-A, Beverage-A
    aisle = models.CharField(max_length=20, default='A04')
    rack = models.CharField(max_length=20, default='R12')
    shelf = models.CharField(max_length=20, default='S03')
    bin = models.CharField(max_length=20, default='B04')
    destination_location = models.CharField(max_length=50, default='A04-R12-S03-B04')
    location_barcode = models.CharField(max_length=64, default='LOC-A04-R12-S03-B04')
    storage_type = models.CharField(max_length=50, default='Rack') # Rack, Cold Rack
    capacity = models.IntegerField(default=500)
    occupied_qty = models.IntegerField(default=0)
    available_capacity = models.IntegerField(default=500)
    storage_condition = models.CharField(max_length=50, default='Ambient') # Ambient, Chilled
    temperature = models.CharField(max_length=30, default='26°C')
    expiry_date = models.DateField(null=True, blank=True)
    fefo_priority = models.CharField(max_length=20, default='Medium') # High, Medium, Low
    scanner_id = models.CharField(max_length=50, default='SCN-014')
    operator = models.CharField(max_length=100, default='Arjun')
    status = models.CharField(max_length=50, default='Completed') # Completed, In Progress, Pending
    started_at = models.CharField(max_length=30, default='11:50')
    completed_at = models.CharField(max_length=30, blank=True, default='')

    class Meta:
        ordering = ['-putaway_id']

    def __str__(self):
        return f"{self.putaway_id} - {self.sku} to {self.destination_location} [{self.status}]"


class LocationInventory(models.Model):
    """Table 6: STORAGE LOCATION INVENTORY TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    location = models.CharField(max_length=50, db_index=True) # A04-R12-S03-B04
    warehouse = models.CharField(max_length=50, default='RJY-DS-001')
    zone = models.CharField(max_length=50, default='Grocery-A')
    aisle = models.CharField(max_length=20, default='A04')
    rack = models.CharField(max_length=20, default='R12')
    shelf = models.CharField(max_length=20, default='S03')
    bin = models.CharField(max_length=20, default='B04')
    location_barcode = models.CharField(max_length=64, default='LOC-A04-R12-S03-B04')
    sku = models.CharField(max_length=64, db_index=True)
    item_name = models.CharField(max_length=200)
    batch_no = models.CharField(max_length=100)
    serial_no = models.CharField(max_length=100, blank=True, null=True)
    available_qty = models.IntegerField(default=0)
    reserved_qty = models.IntegerField(default=0)
    picked_qty = models.IntegerField(default=0)
    quarantine_qty = models.IntegerField(default=0)
    damaged_qty = models.IntegerField(default=0)
    capacity = models.IntegerField(default=500)
    occupancy_pct = models.CharField(max_length=20, default='0%')
    mfg_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    storage_condition = models.CharField(max_length=50, default='Ambient')
    temperature = models.CharField(max_length=30, default='26°C')
    stock_status = models.CharField(max_length=50, default='Available') # Available, Low Stock, Near Expiry

    class Meta:
        ordering = ['location', 'sku']

    def __str__(self):
        return f"{self.location}: {self.sku} (Avail: {self.available_qty})"

