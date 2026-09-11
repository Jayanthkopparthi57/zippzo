import uuid
from django.db import models
from wms_master.models import Site, Sku, Bin, ClusterZone, Vendor
from wms_platform.models import User
from wms_inventory.models import InventoryLot, Lpn


class DispatchPlan(models.Model):
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('COMPLETED', 'Completed'), ('EXPIRED', 'Expired')]

    plan_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='dispatch_plans')
    mh_locations = models.TextField(blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='ACTIVE')
    creation_time = models.DateTimeField(null=True, blank=True)
    expiry_time = models.DateTimeField(null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    total_trips = models.IntegerField(default=0)
    trips_with_vehicles = models.IntegerField(default=0)
    updated_by = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'dispatch_plan'
        ordering = ['-created_at']

    def __str__(self):
        return self.code


class Batch(models.Model):
    TYPE_CHOICES = [('MANUAL', 'Manual'), ('AUTO', 'Auto')]
    STATUS_CHOICES = [
        ('UPLOADED', 'Uploaded'), ('ALLOCATING', 'Allocating'), ('ALLOCATED', 'Allocated'),
        ('IN_PROGRESS', 'In Progress'), ('CLOSED', 'Closed'), ('CANCELLED', 'Cancelled'),
    ]

    batch_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_no = models.CharField(max_length=50, unique=True)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='batches')
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default='MANUAL')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='UPLOADED')
    order_type = models.CharField(max_length=30, blank=True)
    processing_type = models.CharField(max_length=20, default='LPN_BASED')
    picking_type = models.CharField(max_length=30, blank=True)
    cluster_zone = models.ForeignKey(ClusterZone, null=True, blank=True, on_delete=models.SET_NULL, related_name='batches')
    sorting_eligible = models.BooleanField(default=True)
    dispatch_plan = models.ForeignKey(DispatchPlan, null=True, blank=True, on_delete=models.SET_NULL, related_name='batches')
    destinations = models.TextField(blank=True)
    totes = models.IntegerField(default=0)
    ordered_qty = models.IntegerField(default=0)
    ordered_skus = models.IntegerField(default=0)
    picked_qty = models.IntegerField(default=0)
    sorted_qty = models.IntegerField(default=0)
    short_qty = models.IntegerField(default=0)
    cutoff = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='batches')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'batch'
        ordering = ['-created_at']

    def __str__(self):
        return self.batch_no


class Order(models.Model):
    TYPE_CHOICES = [
        ('REGULAR', 'Regular'), ('STO', 'STO'), ('RETURN', 'Return'),
        ('EXTERNAL_RTV', 'External RTV'), ('SECONDARY_SALES', 'Secondary Sales'),
        ('SCRAP', 'Scrap'), ('CROSSDOCK', 'Cross Dock'),
    ]
    STATUS_CHOICES = [
        ('CREATED', 'Created'), ('UPLOADED', 'Uploaded'), ('ALLOCATED', 'Allocated'),
        ('PICKING', 'Picking'), ('SORTED', 'Sorted'), ('PACKED', 'Packed'),
        ('SHIPPED', 'Shipped'), ('IN_TRANSIT', 'In Transit'), ('RECEIVED', 'Received'),
        ('CLOSED', 'Closed'), ('CANCELLED', 'Cancelled'),
    ]

    order_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_no = models.CharField(max_length=50, unique=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='REGULAR')
    processing_type = models.CharField(max_length=15, default='LPN_BASED')
    inventory_type = models.CharField(max_length=10, default='GOOD')
    shipment_type = models.CharField(max_length=20, default='SELF_DISPATCH')
    picking_type = models.CharField(max_length=30, blank=True)
    section = models.CharField(max_length=50, blank=True)
    reference_order = models.CharField(max_length=50, blank=True)
    source_site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='source_orders')
    next_dest = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='next_dest_orders')
    final_dest = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='final_dest_orders')
    to_vendor = models.ForeignKey(Vendor, null=True, blank=True, on_delete=models.SET_NULL, related_name='orders')
    multi_run = models.BooleanField(default=False)
    run_no = models.IntegerField(default=1)
    ordered_qty = models.IntegerField(default=0)
    ordered_skus = models.IntegerField(default=0)
    allocated_qty = models.IntegerField(default=0)
    picked_qty = models.IntegerField(default=0)
    shipped_qty = models.IntegerField(default=0)
    short_qty = models.IntegerField(default=0)
    received_qty = models.IntegerField(default=0)
    discrepancy_qty = models.IntegerField(default=0)
    upload_ref = models.CharField(max_length=500, blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='CREATED')
    shipped_at = models.DateTimeField(null=True, blank=True)
    canceled_at = models.DateTimeField(null=True, blank=True)
    canceled_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='canceled_orders')
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='created_orders')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'orders'
        ordering = ['-created_at']

    def __str__(self):
        return self.order_no


class OrderLine(models.Model):
    LINE_STATUS_CHOICES = [
        ('CREATED', 'Created'), ('ALLOCATED', 'Allocated'), ('PICKING', 'Picking'),
        ('PACKED', 'Packed'), ('SHIPPED', 'Shipped'), ('CANCELLED', 'Cancelled'),
    ]

    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='lines')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='order_lines')
    ordered_qty = models.IntegerField(default=0)
    allocated_qty = models.IntegerField(default=0)
    actual_allocated_qty = models.IntegerField(default=0)
    allocated_bin = models.CharField(max_length=100, blank=True)
    picked_qty = models.IntegerField(default=0)
    short_qty = models.IntegerField(default=0)
    shipped_qty = models.IntegerField(default=0)
    received_qty = models.IntegerField(default=0)
    discrepancy_qty = models.IntegerField(default=0)
    line_status = models.CharField(max_length=15, choices=LINE_STATUS_CHOICES, default='CREATED')

    class Meta:
        db_table = 'order_line'

    def __str__(self):
        return f"{self.order.order_no} - {self.sku.sku_code}"


class OrderAllocation(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'), ('ALLOCATED', 'Allocated'), ('PICKED', 'Picked'),
        ('SHORT', 'Short'), ('CANCELLED', 'Cancelled'),
    ]

    alloc_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_line = models.ForeignKey(OrderLine, on_delete=models.CASCADE, related_name='allocations')
    lot = models.ForeignKey(InventoryLot, null=True, blank=True, on_delete=models.SET_NULL, related_name='allocations')
    bin = models.ForeignKey(Bin, null=True, blank=True, on_delete=models.SET_NULL, related_name='allocations')
    lpn = models.ForeignKey(Lpn, null=True, blank=True, on_delete=models.SET_NULL, related_name='allocations')
    qty = models.IntegerField(default=0)
    batch = models.ForeignKey(Batch, null=True, blank=True, on_delete=models.SET_NULL, related_name='allocations')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='PENDING')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'order_allocation'

    def __str__(self):
        return f"Alloc-{str(self.alloc_id)[:8]}"


class Picklist(models.Model):
    TYPE_CHOICES = [('LPN', 'LPN'), ('PIECE', 'Piece'), ('CLUSTER', 'Cluster')]
    STATUS_CHOICES = [('NOT_STARTED', 'Not Started'), ('IN_PROGRESS', 'In Progress'), ('COMPLETED', 'Completed')]

    picklist_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, related_name='picklists')
    zone = models.ForeignKey('wms_master.Zone', null=True, blank=True, on_delete=models.SET_NULL, related_name='picklists')
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default='LPN')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='NOT_STARTED')
    assigned_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='picklists')
    assigned_qty = models.IntegerField(default=0)
    assigned_skus = models.IntegerField(default=0)
    picked_qty = models.IntegerField(default=0)
    pending_qty = models.IntegerField(default=0)
    short_qty = models.IntegerField(default=0)
    cancelled_qty = models.IntegerField(default=0)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'picklist'
        ordering = ['-batch__created_at']

    def __str__(self):
        return self.code


class PicklistLine(models.Model):
    STATUS_CHOICES = [('PENDING', 'Pending'), ('PICKED', 'Picked'), ('SHORT', 'Short'), ('CANCELLED', 'Cancelled')]

    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    picklist = models.ForeignKey(Picklist, on_delete=models.CASCADE, related_name='lines')
    alloc = models.ForeignKey(OrderAllocation, null=True, blank=True, on_delete=models.SET_NULL, related_name='picklist_lines')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='picklist_lines')
    bin = models.ForeignKey(Bin, null=True, blank=True, on_delete=models.SET_NULL, related_name='picklist_lines')
    lot = models.ForeignKey(InventoryLot, null=True, blank=True, on_delete=models.SET_NULL, related_name='picklist_lines')
    qty = models.IntegerField(default=0)
    picked_qty = models.IntegerField(default=0)
    short_qty = models.IntegerField(default=0)
    pick_seq = models.IntegerField(default=0)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='PENDING')

    class Meta:
        db_table = 'picklist_line'
        ordering = ['pick_seq']


class Sortlist(models.Model):
    TYPE_CHOICES = [('CLUSTER', 'Cluster'), ('PTL', 'PTL'), ('FLOW', 'Flow')]
    STATUS_CHOICES = [('CREATED', 'Created'), ('IN_PROGRESS', 'In Progress'), ('COMPLETED', 'Completed'), ('CANCELLED', 'Cancelled')]

    sortlist_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, related_name='sortlists')
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default='CLUSTER')
    cluster_zone = models.ForeignKey(ClusterZone, null=True, blank=True, on_delete=models.SET_NULL, related_name='sortlists')
    assigned_qty = models.IntegerField(default=0)
    assigned_skus = models.IntegerField(default=0)
    sorted_qty = models.IntegerField(default=0)
    pending_qty = models.IntegerField(default=0)
    short_qty = models.IntegerField(default=0)
    sorter = models.CharField(max_length=100, blank=True)
    close_type = models.CharField(max_length=50, blank=True)
    closed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='sortlists')
    close_suggested_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='CREATED')
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'sortlist'
        ordering = ['-started_at']

    def __str__(self):
        return self.code


class SortlistLine(models.Model):
    STATUS_CHOICES = [('PENDING', 'Pending'), ('SORTED', 'Sorted'), ('SHORT', 'Short')]

    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sortlist = models.ForeignKey(Sortlist, on_delete=models.CASCADE, related_name='lines')
    order = models.ForeignKey(Order, null=True, blank=True, on_delete=models.SET_NULL, related_name='sort_lines')
    dest_tote = models.CharField(max_length=100, blank=True)
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='sort_lines')
    qty = models.IntegerField(default=0)
    sorted_qty = models.IntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')

    class Meta:
        db_table = 'sortlist_line'


class Manifest(models.Model):
    TYPE_CHOICES = [('LPN_BASED', 'LPN Based'), ('PIECE', 'Piece')]
    STATUS_CHOICES = [('CREATED', 'Created'), ('SEALED', 'Sealed'), ('DISPATCHED', 'Dispatched'), ('CLOSED', 'Closed')]

    manifest_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    manifest_no = models.CharField(max_length=50, unique=True)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='manifests')
    type = models.CharField(max_length=15, choices=TYPE_CHOICES, default='LPN_BASED')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='CREATED')
    trip_id = models.UUIDField(null=True, blank=True)
    vehicle_no = models.CharField(max_length=30, blank=True)
    dest_store = models.ForeignKey(Site, null=True, blank=True, on_delete=models.SET_NULL, related_name='dest_manifests')
    shipments_count = models.IntegerField(default=0)
    packed_qty = models.IntegerField(default=0)
    packed_totes = models.IntegerField(default=0)
    pod_template = models.CharField(max_length=50, default='LPN_SCANNING')
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='manifests')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'manifest'
        ordering = ['-created_at']

    def __str__(self):
        return self.manifest_no


class ManifestLine(models.Model):
    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    manifest = models.ForeignKey(Manifest, on_delete=models.CASCADE, related_name='lines')
    tote_lpn = models.CharField(max_length=100, blank=True)
    order = models.ForeignKey(Order, null=True, blank=True, on_delete=models.SET_NULL, related_name='manifest_lines')
    qty = models.IntegerField(default=0)

    class Meta:
        db_table = 'manifest_line'


class CancellationPutaway(models.Model):
    STATUS_CHOICES = [('CREATED', 'Created'), ('PENDING_QC', 'Pending QC'), ('IN_PROGRESS', 'In Progress'), ('COMPLETED', 'Completed')]

    cp_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='cancellation_putaways')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='CREATED')
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    pending_skus = models.IntegerField(default=0)
    remaining_qty = models.IntegerField(default=0)
    pending_lpns = models.IntegerField(default=0)

    class Meta:
        db_table = 'cancellation_putaway'
        ordering = ['-created_at']

    def __str__(self):
        return f"CancelPutaway-{self.order.order_no}"
