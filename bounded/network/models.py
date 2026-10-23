# Network  Sites, Zones, Bins, Locations
import uuid
from django.db import models


class Site(models.Model):
    SITE_TYPE_CHOICES = [('MH','Mother Hub'),('DS','Dark Store'),('SS','Super Store'),('XDOCK','Cross Dock')]
    STATUS_CHOICES = [('ONBOARDING','Onboarding'),('ACTIVE','Active'),('SUSPENDED','Suspended'),('RETIRED','Retired')]
    site_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    site_type = models.CharField(max_length=10, choices=SITE_TYPE_CHOICES)
    parent_site = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='child_sites')
    name = models.CharField(max_length=200, blank=True)
    address = models.TextField(blank=True)
    geo_lat = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    geo_lng = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    operating_hours = models.JSONField(null=True, blank=True)
    is_accepting_orders = models.BooleanField(default=False)
    dh_precedence = models.CharField(max_length=50, default='DEFAULT')
    ss_precedence = models.CharField(max_length=50, default='SS_DEFAULT')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ONBOARDING')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sites'
        ordering = ['code']

    def __str__(self):
        return self.code


class CityDeliveryConfig(models.Model):
    city_id = models.CharField(max_length=50, primary_key=True)
    hard_cap_km = models.DecimalField(max_digits=5, decimal_places=2, default=5.0)
    active_bands = models.CharField(max_length=200, default='Core,Standard,Extended')
    extended_plus_enabled = models.BooleanField(default=False)
    extended_plus_span_km = models.DecimalField(max_digits=4, decimal_places=2, default=2.5)
    extended_plus_max_stops = models.PositiveSmallIntegerField(default=3)
    extended_plus_solo_fee = models.DecimalField(max_digits=10, decimal_places=2, default=40.00)
    ceiling_amount = models.DecimalField(max_digits=10, decimal_places=2, default=10000.00)
    batch_allowance = models.DecimalField(max_digits=10, decimal_places=2, default=2000.00)
    last_changed_by = models.CharField(max_length=200, blank=True)
    last_changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'city_delivery_config'


class Location(models.Model):
    LOC_TYPE_CHOICES = [('BIN','Bin'),('ZONE','Zone'),('DOCK','Dock'),('STAGING','Staging')]
    location_id = models.CharField(max_length=50, primary_key=True)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='locations')
    location_type = models.CharField(max_length=10, choices=LOC_TYPE_CHOICES)
    zone = models.ForeignKey('network.Zone', null=True, blank=True, on_delete=models.SET_NULL, related_name='locations')
    container = models.CharField(max_length=30, default='PICK_FACE')
    aisle = models.CharField(max_length=20, blank=True)
    rack = models.CharField(max_length=20, blank=True)
    level = models.CharField(max_length=20, blank=True)
    position = models.CharField(max_length=50, blank=True)
    barcode = models.CharField(max_length=100, unique=True)
    qr_payload = models.CharField(max_length=500, blank=True)
    capacity_qty = models.PositiveIntegerField(null=True, blank=True)
    capacity_weight_g = models.BigIntegerField(null=True, blank=True)
    capacity_volume_ml = models.BigIntegerField(null=True, blank=True)
    is_sellable_bin = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'locations'
        unique_together = [('site', 'barcode')]
        ordering = ['barcode']

    def __str__(self):
        return self.barcode


class Zone(models.Model):
    ZONE_TYPE_CHOICES = [('GENERAL','General'),('MRP','MRP'),('FLEXI_FORWARD','Flexi Forward')]
    zone_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='zones')
    code = models.CharField(max_length=50)
    category = models.CharField(max_length=100, blank=True)
    zone_type = models.CharField(max_length=20, choices=ZONE_TYPE_CHOICES, default='GENERAL')
    value_type = models.CharField(max_length=50, default='General')
    fragility = models.CharField(max_length=50, default='General')
    food_type = models.CharField(max_length=50, default='Food')
    product_type = models.CharField(max_length=50, default='Food')
    is_advance_zone = models.BooleanField(default=False)
    commingled_allowed = models.BooleanField(default=True)
    max_commingled = models.PositiveIntegerField(default=5)
    is_hazardous_allowed = models.BooleanField(default=False)
    status = models.CharField(max_length=20, default='ACTIVE')

    class Meta:
        db_table = 'zones'
        unique_together = [('site', 'code')]
        ordering = ['code']

    def __str__(self):
        return self.code


class EmployeeSiteAssignment(models.Model):
    MODE_CHOICES = [('WAREHOUSE','Warehouse'),('DARKHOUSE','Darkhouse')]
    employee = models.CharField(max_length=20)
    # `employee` above is a bare code ("DSP470CFE") with no link to the user
    # table: none of the 103 seeded rows matched any iam.User email, so an
    # assignment could not be resolved back to an authenticated operator and no
    # API could fence a request to the sites somebody actually works at. This FK
    # is that link. Nullable so the existing rows survive untouched; they are
    # still inert until someone backfills them.
    user = models.ForeignKey(
        'iam.User', null=True, blank=True, on_delete=models.CASCADE,
        related_name='site_assignments',
    )
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='employee_assignments')
    mode = models.CharField(max_length=20, choices=MODE_CHOICES)
    role_at_site = models.CharField(max_length=30)
    is_primary = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'employee_site_assignments'
        unique_together = [('employee', 'site', 'mode')]
        indexes = [models.Index(fields=['user', 'is_active'], name='ix_empsite_user_active')]


class DockDoor(models.Model):
    CAPABILITY_CHOICES = [('LOAD','Load'),('UNLOAD','Unload'),('BOTH','Both')]
    door_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='dock_doors')
    code = models.CharField(max_length=50)
    capability = models.CharField(max_length=10, choices=CAPABILITY_CHOICES, default='BOTH')
    status = models.CharField(max_length=20, default='OPEN')

    class Meta:
        db_table = 'dock_doors'
        ordering = ['code']

    def __str__(self):
        return f"{self.site.code} - {self.code}"


class VehicleType(models.Model):
    vt_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    capacity_lpns = models.PositiveIntegerField(default=0)
    temp_controlled = models.BooleanField(default=False)

    class Meta:
        db_table = 'vehicle_type'
        ordering = ['code']

    def __str__(self):
        return self.code


class StaffShift(models.Model):
    """Clock-in/clock-out for warehouse and dark-store staff.

    Rider shifts live in delivery.RiderShift because they carry rider-only
    fields (distance, orders delivered). Warehouse staff need the same
    open/close lifecycle to bucket pick/pack/putaway work and compute
    per-shift productivity — without it the "Shift Roster" tab was just a
    user list with no attendance behind it.

    One open shift per (user, site): opening a second is refused, matching
    the rider rule.
    """
    STATUS_CHOICES = [('OPEN', 'Open'), ('CLOSED', 'Closed')]
    END_REASON_CHOICES = [
        ('MANUAL', 'Manual'), ('AUTO_IDLE', 'Auto Idle'),
        ('TIMEOUT', 'Timeout'), ('FORCED', 'Forced'),
    ]
    shift_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'iam.User', on_delete=models.CASCADE, related_name='staff_shifts',
    )
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='staff_shifts')
    role_at_site = models.CharField(max_length=30, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    end_reason = models.CharField(max_length=20, choices=END_REASON_CHOICES, null=True, blank=True)
    notes = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='OPEN')

    class Meta:
        db_table = 'staff_shifts'
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['user', 'status'], name='ix_staffshift_user_status'),
            models.Index(fields=['site', 'status'], name='ix_staffshift_site_status'),
        ]

    def __str__(self):
        return f'{self.user.email} @ {self.site.code} ({self.status})'


class EmployeeCompensation(models.Model):
    """Agreed pay rate for a staff member at a site.

    Admin-managed reference data behind the Admin Settings -> Compensation
    tab. The platform already records who worked where and for how long
    (EmployeeSiteAssignment + StaffShift); this table supplies the rate that
    turns those hours into cost. Nothing in the order path reads it — it is
    payroll reference data, kept beside the roster it belongs to.
    """
    BASIS_CHOICES = [
        ('HOURLY', 'Hourly'), ('DAILY', 'Daily'), ('WEEKLY', 'Weekly'),
        ('MONTHLY', 'Monthly'), ('PER_TASK', 'Per task'),
    ]
    comp_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'iam.User', on_delete=models.CASCADE, related_name='compensations')
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='compensations')
    employee = models.CharField(max_length=20, blank=True)
    basis = models.CharField(max_length=10, choices=BASIS_CHOICES, default='MONTHLY')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=8, default='INR')
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.CharField(max_length=200, blank=True)
    created_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'employee_compensation'
        ordering = ['-effective_from', 'site__code']
        indexes = [
            models.Index(fields=['site', 'is_active'], name='ix_comp_site_active'),
            models.Index(fields=['user', 'is_active'], name='ix_comp_user_active'),
        ]

    def __str__(self):
        return f'{self.user.email} {self.basis} {self.amount} @ {self.site.code}'
