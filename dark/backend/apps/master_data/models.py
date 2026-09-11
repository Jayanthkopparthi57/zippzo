import uuid
from django.db import models
from django.utils import timezone

class SoftDeleteModel(models.Model):
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True

    def soft_delete(self):
        self.is_active = False
        self.deleted_at = timezone.now()
        self.save()

class Warehouse(SoftDeleteModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100)
    address_line1 = models.CharField(max_length=255)
    address_line2 = models.CharField(max_length=255, blank=True, null=True)
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=100)
    pincode = models.CharField(max_length=20)
    country = models.CharField(max_length=100, default='USA')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.code})"

class Category(SoftDeleteModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='categories')
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=100)
    parent_category = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='subcategories')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('warehouse', 'code')
        verbose_name_plural = 'Categories'

    def __str__(self):
        return f"{self.name} ({self.code})"

class ZoneTypeChoices(models.TextChoices):
    BULK = 'bulk', 'Bulk Storage'
    PICK = 'pick', 'Picking Zone'
    QUARANTINE = 'quarantine', 'Quarantine Zone'
    DAMAGED = 'damaged', 'Damaged Zone'
    STAGING = 'staging', 'Staging Zone'
    PACKING = 'packing', 'Packing Zone'
    SHIPPING = 'shipping', 'Shipping Zone'

class Zone(SoftDeleteModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='zones')
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=100)
    zone_type = models.CharField(max_length=30, choices=ZoneTypeChoices.choices, default=ZoneTypeChoices.PICK)

    class Meta:
        unique_together = ('warehouse', 'code')

    def __str__(self):
        return f"{self.warehouse.code} - {self.name} ({self.zone_type})"

class Location(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    zone = models.ForeignKey(Zone, on_delete=models.CASCADE, related_name='locations')
    aisle = models.CharField(max_length=20)
    rack_number = models.CharField(max_length=20)
    shelf_level = models.CharField(max_length=20)
    bin_code = models.CharField(max_length=50, unique=True)
    barcode_label = models.CharField(max_length=100, unique=True)
    max_weight_kg = models.DecimalField(max_digits=10, decimal_places=2, default=1000.00)
    max_volume_cbm = models.DecimalField(max_digits=10, decimal_places=4, default=2.5000)
    is_occupied = models.BooleanField(default=False)
    is_blocked = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(
                fields=['zone', 'aisle', 'rack_number', 'shelf_level'],
                name='idx_loc_zone_aisle'
            ),
        ]

    def __str__(self):
        return f"{self.bin_code} [{self.zone.name}]"

class LocationActivityTypeChoices(models.TextChoices):
    PUTAWAY = 'putaway', 'Putaway'
    PICK = 'pick', 'Pick'
    TRANSFER = 'transfer', 'Transfer'
    CYCLE_COUNT = 'cycle_count', 'Cycle Count'

class LocationActivityLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name='activity_logs')
    activity_type = models.CharField(max_length=30, choices=LocationActivityTypeChoices.choices)
    quantity = models.IntegerField(default=1)
    timestamp = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [
            models.Index(
                fields=['location', 'activity_type', '-timestamp'],
                name='idx_loc_act_time'
            ),
        ]

    def __str__(self):
        return f"{self.location.bin_code} - {self.activity_type} ({self.quantity}) at {self.timestamp}"
