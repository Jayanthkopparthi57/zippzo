import uuid
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from apps.master_data.models import Warehouse, Location
from apps.catalog.models import Customer, Product, Batch
from apps.hr_tracking.models import Employee

class OrderPriorityChoices(models.TextChoices):
    STANDARD = 'standard', 'Standard'
    EXPRESS = 'express', 'Express'
    SAME_DAY = 'same_day', 'Same Day'

class OrderStatusChoices(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    CONFIRMED = 'confirmed', 'Confirmed'
    ALLOCATED = 'allocated', 'Allocated'
    PARTIALLY_ALLOCATED = 'partially_allocated', 'Partially Allocated'
    PICKING = 'picking', 'Picking in Progress'
    PACKED = 'packed', 'Packed'
    SHIPPED = 'shipped', 'Shipped'
    CANCELLED = 'cancelled', 'Cancelled'
    RETURNED = 'returned', 'Returned'

class SalesOrder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_number = models.CharField(max_length=50, unique=True)
    customer = models.ForeignKey(Customer, on_delete=models.RESTRICT, related_name='sales_orders')
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='sales_orders')
    shipping_address = models.TextField()
    city = models.CharField(max_length=100)
    pincode = models.CharField(max_length=20)
    order_date = models.DateTimeField(default=timezone.now)
    delivery_deadline = models.DateTimeField()
    priority = models.CharField(max_length=20, choices=OrderPriorityChoices.choices, default=OrderPriorityChoices.STANDARD)
    status = models.CharField(max_length=30, choices=OrderStatusChoices.choices, default=OrderStatusChoices.CONFIRMED)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.order_number:
            from django.db.models import Max
            date_str = timezone.now().strftime('%Y%m')
            prefix = f"SO-{date_str}-"
            last = SalesOrder.objects.filter(
                order_number__startswith=prefix
            ).aggregate(max_num=Max('order_number'))['max_num']
            if last:
                try:
                    seq = int(last.split('-')[-1]) + 1
                except (ValueError, IndexError):
                    seq = SalesOrder.objects.filter(order_number__startswith=prefix).count() + 1
            else:
                seq = 1
            self.order_number = f"{prefix}{seq:04d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.order_number} - {self.customer.name} [{self.status}]"

class OrderItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(SalesOrder, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.RESTRICT, related_name='order_items')
    requested_qty = models.IntegerField()
    allocated_qty = models.IntegerField(default=0)
    picked_qty = models.IntegerField(default=0)
    shipped_qty = models.IntegerField(default=0)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)

    @property
    def remaining_qty(self):
        """Remaining backorder quantity = requested_qty - (picked_qty + shipped_qty)"""
        return max(0, self.requested_qty - (self.picked_qty + self.shipped_qty))

    def __str__(self):
        return f"{self.order.order_number} -> {self.product.sku}: Req={self.requested_qty}, Picked={self.picked_qty}, Rem={self.remaining_qty}"

class WaveStrategyChoices(models.TextChoices):
    ZONE_PICK = 'zone_pick', 'Zone Pick'
    BATCH_PICK = 'batch_pick', 'Batch Pick'
    SINGLE_ORDER_PICK = 'single_order_pick', 'Single Order Pick'

class WaveStatusChoices(models.TextChoices):
    OPEN = 'open', 'Open'
    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'
    CANCELLED = 'cancelled', 'Cancelled'

class PickWave(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    wave_number = models.CharField(max_length=50, unique=True)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='pick_waves')
    strategy = models.CharField(max_length=30, choices=WaveStrategyChoices.choices, default=WaveStrategyChoices.BATCH_PICK)
    status = models.CharField(max_length=30, choices=WaveStatusChoices.choices, default=WaveStatusChoices.OPEN)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_waves')
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.wave_number:
            from django.db.models import Max
            date_str = timezone.now().strftime('%Y%m%d')
            prefix = f"WAVE-{date_str}-"
            last = PickWave.objects.filter(
                wave_number__startswith=prefix
            ).aggregate(max_num=Max('wave_number'))['max_num']
            if last:
                try:
                    seq = int(last.split('-')[-1]) + 1
                except (ValueError, IndexError):
                    seq = PickWave.objects.filter(wave_number__startswith=prefix).count() + 1
            else:
                seq = 1
            self.wave_number = f"{prefix}{seq:03d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.wave_number} [{self.status}]"

class PickTaskStatusChoices(models.TextChoices):
    OPEN = 'open', 'Open'
    ASSIGNED = 'assigned', 'Assigned'
    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'
    EXCEPTION = 'exception', 'Exception / Damaged'

class ExceptionReasonChoices(models.TextChoices):
    DAMAGED_STOCK = 'damaged_stock', 'Damaged Stock in Bin'
    BIN_EMPTY = 'bin_empty', 'Bin is Empty / Stock Discrepancy'
    WRONG_BARCODE = 'wrong_barcode', 'Item Barcode Mismatch'
    EXPIRED_STOCK = 'expired_stock', 'Stock Expired'

class PickTask(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    wave = models.ForeignKey(PickWave, on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    order_item = models.ForeignKey(OrderItem, on_delete=models.CASCADE, related_name='pick_tasks')
    batch = models.ForeignKey(Batch, on_delete=models.RESTRICT, related_name='pick_tasks')
    source_location = models.ForeignKey(Location, on_delete=models.RESTRICT, related_name='pick_tasks')
    target_staging_location = models.ForeignKey(Location, on_delete=models.SET_NULL, null=True, blank=True, related_name='staging_tasks')
    assigned_employee = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_pick_tasks')
    quantity_to_pick = models.IntegerField()
    quantity_picked = models.IntegerField(default=0)
    sequence_route_order = models.IntegerField(default=1)
    status = models.CharField(max_length=30, choices=PickTaskStatusChoices.choices, default=PickTaskStatusChoices.OPEN)
    exception_reason = models.CharField(max_length=50, choices=ExceptionReasonChoices.choices, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"PickTask {self.order_item.product.sku} ({self.quantity_picked}/{self.quantity_to_pick}) at {self.source_location.bin_code} [{self.status}]"

# ==============================================================================
# WAREHOUSEOS 13-TABLE CORE ARCHITECTURE: PICKING MODELS
# ==============================================================================

class PickingTask(models.Model):
    """Table 7: PICKING TASK TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pick_task_id = models.CharField(max_length=50, unique=True) # PICK-009821
    order_id = models.CharField(max_length=50, db_index=True) # ORD-00124
    wave_id = models.CharField(max_length=50, db_index=True) # WAVE-00452
    order_type = models.CharField(max_length=50, default='Customer Order')
    priority = models.CharField(max_length=20, default='High') # High, Normal, Urgent
    warehouse = models.CharField(max_length=50, default='RJY-DS-001')
    picker = models.CharField(max_length=100, default='Rahul')
    zone = models.CharField(max_length=50, default='Mixed') # Mixed, Chilled-A, Grocery-A
    pick_route = models.CharField(max_length=150, default='A01 → A04 → A07')
    sequence = models.IntegerField(default=1)
    total_items = models.IntegerField(default=1)
    total_units = models.IntegerField(default=1)
    picked_items = models.IntegerField(default=0)
    picked_units = models.IntegerField(default=0)
    exceptions = models.IntegerField(default=0)
    started_at = models.CharField(max_length=30, default='12:30')
    completed_at = models.CharField(max_length=30, blank=True, default='')
    status = models.CharField(max_length=50, default='In Progress') # Completed, In Progress, Picking, Exception

    class Meta:
        ordering = ['-pick_task_id']

    def __str__(self):
        return f"{self.pick_task_id} for {self.order_id} ({self.status})"


class PickingItemDetail(models.Model):
    """Table 8: PICKING ITEM DETAIL TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pick_task = models.CharField(max_length=50, db_index=True) # PICK-009821
    order_id = models.CharField(max_length=50, db_index=True) # ORD-00124
    sequence = models.IntegerField(default=1)
    item_name = models.CharField(max_length=200) # Fresh Milk 1L
    sku = models.CharField(max_length=64, db_index=True) # MILK-1L
    barcode = models.CharField(max_length=64, db_index=True) # 8909876543210
    batch_no = models.CharField(max_length=100) # MILK-0905
    expiry_date = models.DateField(null=True, blank=True)
    required_qty = models.IntegerField(default=1)
    available_qty = models.IntegerField(default=0)
    reserved_qty = models.IntegerField(default=0)
    picked_qty = models.IntegerField(default=0)
    short_qty = models.IntegerField(default=0)
    damaged_qty = models.IntegerField(default=0)
    source_location = models.CharField(max_length=50, default='A01-R02-S01-B08')
    location_barcode = models.CharField(max_length=64, default='LOC-A01-R02-S01-B08')
    scanner_id = models.CharField(max_length=50, default='SCN-021')
    picker = models.CharField(max_length=100, default='Rahul')
    scan_time = models.CharField(max_length=30, default='12:35')
    fefo_applied = models.CharField(max_length=10, default='Yes') # Yes, No
    pick_method = models.CharField(max_length=50, default='Wave') # Wave, Single Order, Zone
    status = models.CharField(max_length=50, default='Picked') # Picked, Pending, Damaged

    class Meta:
        ordering = ['pick_task', 'sequence']

    def __str__(self):
        return f"{self.pick_task} Seq #{self.sequence}: {self.sku} ({self.picked_qty}/{self.required_qty})"


class PickingScanHistory(models.Model):
    """Table 9: PICKING SCAN HISTORY TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scan_id = models.CharField(max_length=50, unique=True) # PS-10021
    pick_task = models.CharField(max_length=50, db_index=True)
    order = models.CharField(max_length=50, db_index=True)
    scanner = models.CharField(max_length=50, default='SCN-021')
    picker = models.CharField(max_length=100, default='Rahul')
    scan_type = models.CharField(max_length=50, default='Product Scan') # Location Scan, Product Scan
    sku = models.CharField(max_length=64, blank=True, default='')
    barcode = models.CharField(max_length=64)
    batch = models.CharField(max_length=100, blank=True, default='')
    location = models.CharField(max_length=50, default='A01-R02-S01-B08')
    quantity = models.IntegerField(default=1)
    result = models.CharField(max_length=30, default='Valid') # Valid, Invalid
    scan_time = models.CharField(max_length=30, default='12:35:12')

    class Meta:
        ordering = ['-scan_id']

    def __str__(self):
        return f"{self.scan_id}: {self.scan_type} by {self.picker} ({self.result})"

