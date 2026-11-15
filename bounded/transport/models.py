"""Transport execution records: dispatch plans, shipments, linehaul, scans.

The reference screens had Dispatch Plan, Vehicle Assignment, Active Trips,
Manifests and Cross Dock tabs, but no backend at all: `/api/transport/trips/`
did not exist. These tables are the missing records behind those screens.
"""
import uuid

from django.db import models


class DispatchPlan(models.Model):
    """A dated wave of outbound work for one site.

    Pick lists and totes belong to a wave; vehicles and carriers are assigned
    to the plan before a shipment is created from it.
    """

    STATUS_CHOICES = [
        ('DRAFT', 'Draft'), ('OPEN', 'Open'), ('LOCKED', 'Locked'),
        ('DISPATCHED', 'Dispatched'), ('CANCELLED', 'Cancelled'),
    ]

    plan_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    site = models.ForeignKey(
        'network.Site', on_delete=models.PROTECT, related_name='dispatch_plans')
    plan_date = models.DateField()
    wave_code = models.CharField(max_length=40, blank=True)
    cutoff_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='DRAFT')
    carrier = models.ForeignKey(
        'masterdata.Carrier', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='dispatch_plans',
    )
    vehicle = models.ForeignKey(
        'masterdata.Vehicle', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='dispatch_plans',
    )
    planned_orders = models.PositiveIntegerField(default=0)
    target_lpns = models.PositiveIntegerField(default=0)
    notes = models.CharField(max_length=250, blank=True)
    created_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'dispatch_plans'
        ordering = ['-plan_date', 'code']
        indexes = [
            models.Index(fields=['site', 'plan_date'], name='ix_dplan_site_date'),
            models.Index(fields=['status'], name='ix_dplan_status'),
        ]

    def __str__(self):
        return self.code


class Shipment(models.Model):
    """A consignment moving between two sites, or from a site to a customer hub."""

    STATUS_CHOICES = [
        ('PLANNED', 'Planned'), ('READY', 'Ready'), ('DISPATCHED', 'Dispatched'),
        ('IN_TRANSIT', 'In Transit'), ('DELIVERED', 'Delivered'),
        ('EXCEPTION', 'Exception'), ('CANCELLED', 'Cancelled'),
    ]
    MODE_CHOICES = [
        ('ROAD', 'Road'), ('AIR', 'Air'), ('RAIL', 'Rail'), ('COURIER', 'Courier'),
    ]

    shipment_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    dispatch_plan = models.ForeignKey(
        DispatchPlan, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='shipments',
    )
    carrier = models.ForeignKey(
        'masterdata.Carrier', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='shipments',
    )
    vehicle = models.ForeignKey(
        'masterdata.Vehicle', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='shipments',
    )
    origin_site = models.ForeignKey(
        'network.Site', on_delete=models.PROTECT, related_name='shipments_out')
    destination_site = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.PROTECT,
        related_name='shipments_in',
    )
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default='ROAD')
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='PLANNED')
    seal_no = models.CharField(max_length=60, blank=True)
    total_lpns = models.PositiveIntegerField(default=0)
    total_units = models.PositiveIntegerField(default=0)
    planned_dispatch_at = models.DateTimeField(null=True, blank=True)
    planned_arrival_at = models.DateTimeField(null=True, blank=True)
    actual_dispatch_at = models.DateTimeField(null=True, blank=True)
    actual_arrival_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=250, blank=True)
    created_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'shipments'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status'], name='ix_shipment_status'),
            models.Index(fields=['origin_site', 'status'], name='ix_shipment_origin'),
            models.Index(fields=['destination_site', 'status'], name='ix_shipment_dest'),
        ]

    def __str__(self):
        return self.code


class ManifestDocument(models.Model):
    """A generated shipping manifest for one consignment.

    The LPN label already carries a frozen JSON snapshot; this table is the
    durable, addressable document the console can list, regenerate, mark
    generated, and dispatch without deriving a fake row from every tote.
    """

    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('GENERATED', 'Generated'),
        ('DISPATCHED', 'Dispatched'),
        ('CANCELLED', 'Cancelled'),
    ]

    manifest_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    shipment = models.ForeignKey(
        Shipment, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='manifests',
    )
    dispatch_plan = models.ForeignKey(
        DispatchPlan, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='manifests',
    )
    site = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.PROTECT,
        related_name='manifests',
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='DRAFT')
    total_lpns = models.PositiveIntegerField(default=0)
    total_units = models.PositiveIntegerField(default=0)
    payload = models.JSONField(default=dict, blank=True)
    generated_at = models.DateTimeField(null=True, blank=True)
    created_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'manifest_documents'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status'], name='ix_manifest_status'),
            models.Index(fields=['site', 'created_at'], name='ix_manifest_site_created'),
            models.Index(fields=['shipment'], name='ix_manifest_shipment'),
        ]

    def __str__(self):
        return self.code


class LinehaulTrip(models.Model):
    """One vehicle movement for a shipment, with its stop sequence."""

    STATUS_CHOICES = [
        ('PLANNED', 'Planned'), ('IN_TRANSIT', 'In Transit'),
        ('COMPLETED', 'Completed'), ('DELAYED', 'Delayed'), ('CANCELLED', 'Cancelled'),
    ]

    trip_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    shipment = models.ForeignKey(
        Shipment, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='trips',
    )
    vehicle = models.ForeignKey(
        'masterdata.Vehicle', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='trips',
    )
    carrier = models.ForeignKey(
        'masterdata.Carrier', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='trips',
    )
    origin_site = models.ForeignKey(
        'network.Site', on_delete=models.PROTECT, related_name='trips_out')
    destination_site = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.PROTECT,
        related_name='trips_in',
    )
    driver_name = models.CharField(max_length=120, blank=True)
    driver_phone = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='PLANNED')
    distance_km = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    planned_departure_at = models.DateTimeField(null=True, blank=True)
    planned_arrival_at = models.DateTimeField(null=True, blank=True)
    actual_departure_at = models.DateTimeField(null=True, blank=True)
    actual_arrival_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=250, blank=True)
    created_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'linehaul_trips'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status'], name='ix_trip_status'),
            models.Index(fields=['origin_site', 'status'], name='ix_trip_origin'),
        ]

    def __str__(self):
        return self.code


class TripStop(models.Model):
    STOP_TYPE_CHOICES = [
        ('PICKUP', 'Pickup'), ('DELIVERY', 'Delivery'),
        ('CROSS_DOCK', 'Cross Dock'), ('CHECKPOINT', 'Checkpoint'),
    ]
    STATUS_CHOICES = [
        ('PENDING', 'Pending'), ('ARRIVED', 'Arrived'),
        ('COMPLETED', 'Completed'), ('SKIPPED', 'Skipped'),
    ]

    stop_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trip = models.ForeignKey(
        LinehaulTrip, on_delete=models.CASCADE, related_name='stops')
    sequence = models.PositiveIntegerField(default=1)
    site = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='trip_stops',
    )
    stop_type = models.CharField(max_length=15, choices=STOP_TYPE_CHOICES, default='CHECKPOINT')
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='PENDING')
    planned_at = models.DateTimeField(null=True, blank=True)
    actual_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=250, blank=True)

    class Meta:
        db_table = 'trip_stops'
        ordering = ['trip', 'sequence']
        unique_together = [('trip', 'sequence')]

    def __str__(self):
        return f'{self.trip.code} #{self.sequence}'


class ShippingScan(models.Model):
    """Append-only scan at a load/unload/dispatch/receive checkpoint."""

    SCAN_TYPE_CHOICES = [
        ('LOAD', 'Load'), ('UNLOAD', 'Unload'), ('DISPATCH', 'Dispatch'),
        ('RECEIVE', 'Receive'), ('CHECK', 'Check'), ('REJECT', 'Reject'),
    ]
    RESULT_CHOICES = [
        ('OK', 'OK'), ('DUPLICATE', 'Duplicate'),
        ('UNKNOWN', 'Unknown'), ('REJECTED', 'Rejected'),
    ]

    scan_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shipment = models.ForeignKey(
        Shipment, null=True, blank=True, on_delete=models.CASCADE,
        related_name='scans',
    )
    trip = models.ForeignKey(
        LinehaulTrip, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='scans',
    )
    lpn = models.ForeignKey(
        'inventory.LpnMaster', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='shipping_scans',
    )
    site = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='shipping_scans',
    )
    scan_type = models.CharField(max_length=10, choices=SCAN_TYPE_CHOICES, default='CHECK')
    code = models.CharField(max_length=120)
    result = models.CharField(max_length=10, choices=RESULT_CHOICES, default='OK')
    scanned_by = models.ForeignKey(
        'iam.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='shipping_scans',
    )
    scanned_at = models.DateTimeField(auto_now_add=True)
    meta = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'shipping_scans'
        ordering = ['-scanned_at']
        indexes = [
            models.Index(fields=['shipment', 'scan_type'], name='ix_shipscan_shipment'),
            models.Index(fields=['code'], name='ix_shipscan_code'),
        ]

    def __str__(self):
        return f'{self.scan_type} {self.code} ({self.result})'


class CrossDockMove(models.Model):
    """Stock that lands at one site and leaves for another without putaway."""

    STATUS_CHOICES = [
        ('PENDING', 'Pending'), ('IN_TRANSIT', 'In Transit'),
        ('COMPLETED', 'Completed'), ('CANCELLED', 'Cancelled'),
    ]

    move_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    source_site = models.ForeignKey(
        'network.Site', on_delete=models.PROTECT, related_name='crossdock_out')
    destination_site = models.ForeignKey(
        'network.Site', on_delete=models.PROTECT, related_name='crossdock_in')
    shipment = models.ForeignKey(
        Shipment, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='crossdock_moves',
    )
    lpn = models.ForeignKey(
        'inventory.LpnMaster', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='crossdock_moves',
    )
    sku = models.ForeignKey(
        'catalog.Sku', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='crossdock_moves',
    )
    qty = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='PENDING')
    expected_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=250, blank=True)
    created_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cross_dock_moves'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status'], name='ix_xdock_status'),
            models.Index(fields=['source_site', 'destination_site'], name='ix_xdock_sites'),
        ]

    def __str__(self):
        return self.code
