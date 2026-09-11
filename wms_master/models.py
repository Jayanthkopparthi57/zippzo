import uuid
from django.db import models


class Site(models.Model):
    TYPE_CHOICES = [('MH', 'Mother Hub'), ('DS', 'Dark Store'), ('SS', 'Super Store'), ('XDOCK', 'Cross Dock')]
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')]

    site_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    parent_site = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='child_sites')
    dh_precedence = models.CharField(max_length=50, default='DEFAULT')
    ss_precedence = models.CharField(max_length=50, default='SS_DEFAULT')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    name = models.CharField(max_length=200, blank=True)
    address = models.TextField(blank=True)

    class Meta:
        db_table = 'site'
        ordering = ['code']

    def __str__(self):
        return self.code


class SkuCategory(models.Model):
    category_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children')

    class Meta:
        db_table = 'sku_category'
        verbose_name_plural = 'SKU Categories'
        ordering = ['name']

    def __str__(self):
        return self.name


class Sku(models.Model):
    ZONE_CHOICES = [('DRY', 'Dry'), ('COLD', 'Cold'), ('FROZEN', 'Frozen')]
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')]

    sku_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sku_code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    ean = models.CharField(max_length=50, unique=True)
    category = models.ForeignKey(SkuCategory, null=True, blank=True, on_delete=models.SET_NULL, related_name='skus')
    sub_category = models.CharField(max_length=100, blank=True)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    pack_size = models.CharField(max_length=50, blank=True)
    storage_zone = models.CharField(max_length=10, choices=ZONE_CHOICES, default='DRY')
    shelf_life_days = models.IntegerField(default=365)
    is_food = models.BooleanField(default=True)
    wac = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')

    class Meta:
        db_table = 'sku'
        ordering = ['name']

    def __str__(self):
        return f"{self.sku_code} - {self.name}"


class Vendor(models.Model):
    STATUS_CHOICES = [('Active', 'Active'), ('Inactive', 'Inactive')]

    vendor_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    org_entity = models.CharField(max_length=50, blank=True)
    gstin = models.CharField(max_length=20, blank=True)
    is_customer = models.BooleanField(default=False)
    is_sku_vendor = models.BooleanField(default=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='Active')

    class Meta:
        db_table = 'vendor'
        ordering = ['name']

    def __str__(self):
        return f"{self.code} - {self.name}"


class Zone(models.Model):
    ZONE_TYPE_CHOICES = [('GENERAL', 'General'), ('MRP', 'MRP'), ('FLEXI_FORWARD', 'Flexi Forward')]
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive'), ('BLOCKED', 'Blocked')]

    zone_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='zones')
    code = models.CharField(max_length=50, unique=True)
    category = models.CharField(max_length=100, blank=True)
    zone_type = models.CharField(max_length=20, choices=ZONE_TYPE_CHOICES, default='GENERAL')
    value_type = models.CharField(max_length=50, default='General')
    fragility = models.CharField(max_length=50, default='General')
    food_type = models.CharField(max_length=50, default='General')
    product_type = models.CharField(max_length=50, default='Food')
    is_advance_zone = models.BooleanField(default=False)
    commingled_allowed = models.BooleanField(default=True)
    max_commingled = models.IntegerField(default=5)
    is_hazardous_allowed = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')

    class Meta:
        db_table = 'zone'
        ordering = ['code']

    def __str__(self):
        return self.code


class Bin(models.Model):
    CONDITION_CHOICES = [('GOOD', 'Good'), ('DAMAGE', 'Damage')]
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')]

    bin_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='bins')
    zone = models.ForeignKey(Zone, null=True, blank=True, on_delete=models.SET_NULL, related_name='bins')
    code = models.CharField(max_length=100, unique=True)
    aisle = models.CharField(max_length=20, blank=True)
    rack = models.CharField(max_length=20, blank=True)
    level = models.IntegerField(default=1)
    level_class = models.CharField(max_length=50, blank=True)
    rack_class = models.CharField(max_length=50, blank=True)
    roll_no = models.IntegerField(default=0)
    bin_type = models.CharField(max_length=50, blank=True)
    lbh = models.CharField(max_length=50, blank=True)
    putaway_max = models.IntegerField(default=100)
    condition = models.CharField(max_length=10, choices=CONDITION_CHOICES, default='GOOD')
    is_pickzone = models.BooleanField(default=False)
    zone_sub_type = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')

    class Meta:
        db_table = 'bin'
        ordering = ['code']

    def __str__(self):
        return self.code


class ClusterZone(models.Model):
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')]

    cz_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='cluster_zones')
    code = models.CharField(max_length=50, unique=True)
    slot_count = models.IntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')

    class Meta:
        db_table = 'cluster_zone'
        ordering = ['code']

    def __str__(self):
        return self.code


class DockDoor(models.Model):
    CAPABILITY_CHOICES = [('LOAD', 'Load'), ('UNLOAD', 'Unload'), ('BOTH', 'Both')]
    STATUS_CHOICES = [('OPEN', 'Open'), ('BUSY', 'Busy'), ('CLOSED', 'Closed')]

    door_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='dock_doors')
    code = models.CharField(max_length=50)
    capability = models.CharField(max_length=10, choices=CAPABILITY_CHOICES, default='BOTH')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='OPEN')

    class Meta:
        db_table = 'dock_door'
        ordering = ['code']

    def __str__(self):
        return f"{self.site.code} - {self.code}"


class VehicleType(models.Model):
    vt_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    capacity_lpns = models.IntegerField(default=0)
    temp_controlled = models.BooleanField(default=False)

    class Meta:
        db_table = 'vehicle_type'
        ordering = ['code']

    def __str__(self):
        return self.code


class Transporter(models.Model):
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')]

    transporter_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    billing_basis = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')

    class Meta:
        db_table = 'transporter'
        ordering = ['name']

    def __str__(self):
        return self.name
