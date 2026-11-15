"""Master data that the 36-table WMS design expects and the platform lacked.

The original schema had `Vendor`, `Seller` and a `VehicleType` stub. There was
no Organization to own a legal entity, no Store to represent the commercial
storefront a Site operates, no Carrier, no vehicle instance and no equipment
register. Those are reference tables: order, stock and pick paths never read
them, but every admin screen needs them to describe the estate.

Nothing here alters an existing table. Each model is a new table so deploying
the code before `migrate` cannot break a running warehouse.
"""
import uuid

from django.db import models


class Organization(models.Model):
    """The legal / commercial party behind a vendor, seller, carrier or store.

    Vendor and Seller already exist as separate party masters; this table is
    the parent they were missing. Links are optional so existing rows survive.
    """

    KIND_CHOICES = [
        ('PLATFORM', 'Platform'),
        ('VENDOR', 'Vendor'),
        ('SELLER', 'Seller'),
        ('CARRIER', 'Carrier'),
        ('THIRD_PARTY', 'Third Party'),
    ]
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')]

    org_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    legal_name = models.CharField(max_length=250, blank=True)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default='VENDOR')
    gstin = models.CharField(max_length=20, blank=True)
    pan = models.CharField(max_length=20, blank=True)
    contact_name = models.CharField(max_length=120, blank=True)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'organizations'
        ordering = ['code']
        indexes = [models.Index(fields=['kind', 'status'], name='ix_org_kind_status')]

    def __str__(self):
        return self.code


class ReasonCode(models.Model):
    """A controlled vocabulary for why operators record an exception.

    Dock discrepancies, cancellation putaways and similar flows store only
    the code; the display text and evidence rules live here so the same code
    cannot mean different things on different screens.
    """

    CATEGORY_CHOICES = [
        ('SHORT_PICK', 'Short Pick'),
        ('DAMAGE', 'Damage'),
        ('DISCREPANCY', 'Discrepancy'),
        ('CHECK_IN_BREACH', 'Check-in Breach'),
        ('CANCEL', 'Cancel'),
        ('OTHER', 'Other'),
    ]
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')]

    rc_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES, default='OTHER')
    description = models.TextField()
    requires_photo = models.BooleanField(default=False)
    requires_remark = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'reason_codes'
        ordering = ['category', 'code']
        indexes = [
            models.Index(fields=['category', 'status'], name='ix_reason_category_status'),
            models.Index(fields=['status'], name='ix_reason_status'),
        ]

    def __str__(self):
        return self.code


class ClusterZone(models.Model):
    """A pick/sort cluster inside a site, with a slot capacity."""

    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')]

    cz_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    site = models.ForeignKey('network.Site', on_delete=models.PROTECT, related_name='cluster_zones')
    name = models.CharField(max_length=120, blank=True)
    zone = models.ForeignKey(
        'network.Zone', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cluster_zones',
    )
    slot_count = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cluster_zones'
        ordering = ['site__code', 'code']
        indexes = [
            models.Index(fields=['site', 'status'], name='ix_cluster_site_status'),
            models.Index(fields=['zone'], name='ix_cluster_zone'),
        ]

    def clean(self):
        if self.zone_id and self.zone.site_id != self.site_id:
            from django.core.exceptions import ValidationError
            raise ValidationError({'zone': 'Cluster zone must belong to the selected site.'})

    def __str__(self):
        return self.code


class Store(models.Model):
    """A commercial storefront, optionally backed by an operational Site.

    `network.Site` describes a physical facility (a building with zones and
    bins). A Store describes the business unit customers see, its service
    radius and cut-off. Keeping them as separate rows lets one back-office
    Store be staffed by a Site, and lets a Site exist (a mother hub) with no
    storefront at all.
    """

    STORE_TYPE_CHOICES = [
        ('DARK_STORE', 'Dark Store'),
        ('SUPER_STORE', 'Super Store'),
        ('MOTHER_HUB', 'Mother Hub'),
        ('CROSS_DOCK', 'Cross Dock'),
    ]
    STATUS_CHOICES = [
        ('ONBOARDING', 'Onboarding'),
        ('ACTIVE', 'Active'),
        ('PAUSED', 'Paused'),
        ('RETIRED', 'Retired'),
    ]

    store_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    organization = models.ForeignKey(
        Organization, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='stores',
    )
    site = models.OneToOneField(
        'network.Site', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='store_profile',
        help_text='Operational facility that fulfils this storefront.',
    )
    store_type = models.CharField(
        max_length=20, choices=STORE_TYPE_CHOICES, default='DARK_STORE')
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    pincode = models.CharField(max_length=10, blank=True)
    geo_lat = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    geo_lng = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    service_radius_km = models.DecimalField(
        max_digits=5, decimal_places=2, default=5.0)
    daily_cutoff_time = models.CharField(
        max_length=5, blank=True, help_text='HH:MM, local time.')
    is_accepting_orders = models.BooleanField(default=False)
    opened_on = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='ONBOARDING')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'stores'
        ordering = ['code']
        indexes = [
            models.Index(fields=['status'], name='ix_store_status'),
            models.Index(fields=['city'], name='ix_store_city'),
        ]

    def __str__(self):
        return self.code


class Carrier(models.Model):
    """A transport partner. Distinct from `Vehicle`, which is a physical unit."""

    MODE_CHOICES = [
        ('ROAD', 'Road'), ('AIR', 'Air'), ('RAIL', 'Rail'),
        ('COURIER', 'Courier'), ('MULTIMODAL', 'Multimodal'),
    ]
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive'), ('BLOCKED', 'Blocked')]

    carrier_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    organization = models.ForeignKey(
        Organization, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='carriers',
    )
    mode = models.CharField(max_length=15, choices=MODE_CHOICES, default='ROAD')
    contact_name = models.CharField(max_length=120, blank=True)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)
    tracking_url = models.CharField(max_length=300, blank=True)
    gstin = models.CharField(max_length=20, blank=True)
    service_level = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'carriers'
        ordering = ['code']
        indexes = [models.Index(fields=['status'], name='ix_carrier_status')]

    def __str__(self):
        return self.code


class Vehicle(models.Model):
    """A physical vehicle instance, not a class of vehicle.

    `network.VehicleType` answers "a 14-ft truck"; this answers "which truck".
    """

    OWNERSHIP_CHOICES = [
        ('OWNED', 'Owned'), ('LEASED', 'Leased'), ('CONTRACTED', 'Contracted'),
    ]
    STATUS_CHOICES = [
        ('AVAILABLE', 'Available'), ('ASSIGNED', 'Assigned'),
        ('IN_TRANSIT', 'In Transit'), ('MAINTENANCE', 'Maintenance'),
        ('RETIRED', 'Retired'),
    ]

    vehicle_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    registration_no = models.CharField(max_length=30, unique=True)
    vehicle_type = models.ForeignKey(
        'network.VehicleType', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='vehicles',
    )
    carrier = models.ForeignKey(
        Carrier, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='vehicles',
    )
    home_site = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='home_vehicles',
    )
    make = models.CharField(max_length=80, blank=True)
    model_name = models.CharField(max_length=80, blank=True)
    ownership = models.CharField(
        max_length=15, choices=OWNERSHIP_CHOICES, default='OWNED')
    capacity_kg = models.PositiveIntegerField(null=True, blank=True)
    capacity_volume_l = models.PositiveIntegerField(null=True, blank=True)
    insurance_expiry = models.DateField(null=True, blank=True)
    fitness_expiry = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='AVAILABLE')
    notes = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'vehicles'
        ordering = ['registration_no']
        indexes = [
            models.Index(fields=['status'], name='ix_vehicle_status'),
            models.Index(fields=['carrier', 'status'], name='ix_vehicle_carrier_status'),
        ]

    def __str__(self):
        return self.registration_no


class Equipment(models.Model):
    """Scanners, printers, totes, pallets, chillers and other site assets."""

    TYPE_CHOICES = [
        ('SCANNER', 'Scanner'), ('PRINTER', 'Printer'), ('TOTE', 'Tote'),
        ('PALLET', 'Pallet'), ('FORKLIFT', 'Forklift'), ('CART', 'Cart'),
        ('CHILLER', 'Chiller'), ('OTHER', 'Other'),
    ]
    STATUS_CHOICES = [
        ('AVAILABLE', 'Available'), ('IN_USE', 'In Use'),
        ('MAINTENANCE', 'Maintenance'), ('RETIRED', 'Retired'),
    ]

    equipment_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    name = models.CharField(max_length=150, blank=True)
    equipment_type = models.CharField(
        max_length=15, choices=TYPE_CHOICES, default='SCANNER')
    site = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='equipment',
    )
    serial_no = models.CharField(max_length=100, blank=True)
    assigned_to = models.ForeignKey(
        'iam.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='equipment_held',
    )
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='AVAILABLE')
    last_service_on = models.DateField(null=True, blank=True)
    next_service_on = models.DateField(null=True, blank=True)
    notes = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'equipment'
        ordering = ['code']
        indexes = [
            models.Index(fields=['site', 'status'], name='ix_equip_site_status'),
            models.Index(fields=['equipment_type'], name='ix_equip_type'),
        ]

    def __str__(self):
        return self.code


class VehicleCheckIn(models.Model):
    """Gate check-in / check-out record for a vehicle visiting a site."""

    DIRECTION_CHOICES = [('IN', 'In'), ('OUT', 'Out')]
    PURPOSE_CHOICES = [
        ('PICKUP', 'Pickup'), ('DELIVERY', 'Delivery'),
        ('TRANSFER', 'Transfer'), ('MAINTENANCE', 'Maintenance'), ('OTHER', 'Other'),
    ]
    STATUS_CHOICES = [('OPEN', 'Open'), ('CLOSED', 'Closed')]

    checkin_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(
        Vehicle, on_delete=models.PROTECT, related_name='checkins')
    site = models.ForeignKey(
        'network.Site', on_delete=models.PROTECT, related_name='vehicle_checkins')
    direction = models.CharField(max_length=3, choices=DIRECTION_CHOICES, default='IN')
    purpose = models.CharField(max_length=15, choices=PURPOSE_CHOICES, default='PICKUP')
    driver_name = models.CharField(max_length=120, blank=True)
    driver_phone = models.CharField(max_length=20, blank=True)
    driver_license = models.CharField(max_length=40, blank=True)
    seal_no = models.CharField(max_length=60, blank=True)
    odometer_km = models.PositiveIntegerField(null=True, blank=True)
    gate = models.CharField(max_length=40, blank=True)
    checked_in_at = models.DateTimeField(auto_now_add=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='OPEN')
    notes = models.CharField(max_length=250, blank=True)
    created_by = models.CharField(max_length=64, blank=True)

    class Meta:
        db_table = 'vehicle_checkins'
        ordering = ['-checked_in_at']
        indexes = [
            models.Index(fields=['site', 'status'], name='ix_checkin_site_status'),
            models.Index(fields=['vehicle', 'status'], name='ix_checkin_vehicle_status'),
        ]

    def __str__(self):
        return f'{self.vehicle.registration_no} @ {self.site.code}'
