# Catalog  SKU Master, Barcodes, Listings, Inventory Lots
import uuid
from django.db import models


class SkuCategory(models.Model):
    category_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children')

    class Meta:
        db_table = 'sku_category'
        ordering = ['name']

    def __str__(self):
        return self.name


class Sku(models.Model):
    ZONE_CHOICES = [('DRY','Dry'),('COLD','Cold'),('FROZEN','Frozen')]
    STATUS_CHOICES = [('DRAFT','Draft'),('SAMPLE_QC','Sample QC'),('APPROVED','Approved'),
                       ('ACTIVE','Active'),('DELISTED','Delisted'),('DISCONTINUED','Discontinued')]
    sku_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sku_code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    ean = models.CharField(max_length=50, unique=True, null=True, blank=True)
    category = models.ForeignKey(SkuCategory, null=True, blank=True, on_delete=models.SET_NULL, related_name='skus')
    sub_category = models.CharField(max_length=100, blank=True)
    brand = models.CharField(max_length=60, blank=True)
    pack_size = models.CharField(max_length=30, blank=True)
    base_uom = models.CharField(max_length=10, default='EACH')
    storage_zone = models.CharField(max_length=10, choices=ZONE_CHOICES, default='DRY')
    shelf_life_days = models.PositiveIntegerField(null=True, blank=True)
    is_food = models.BooleanField(default=False)
    is_hazardous = models.BooleanField(default=False)
    is_catch_weight = models.BooleanField(default=False)
    is_serialized = models.BooleanField(default=False)
    is_age_restricted = models.BooleanField(default=False)
    min_age_years = models.PositiveSmallIntegerField(null=True, blank=True)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    hsn_code = models.CharField(max_length=10, blank=True)
    weight_g = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'skus'
        ordering = ['name']

    def __str__(self):
        return f"{self.sku_code} - {self.name}"


class SkuBarcode(models.Model):
    SYMBOLOGY_CHOICES = [('EAN','EAN'),('UPC','UPC'),('CODE128','Code128'),('GS1_128','GS1-128'),('INTERNAL','Internal'),('QR','QR')]
    PACK_LEVEL_CHOICES = [('EACH','Each'),('INNER','Inner'),('CASE','Case'),('PALLET','Pallet')]
    barcode = models.CharField(max_length=30, primary_key=True)
    symbology = models.CharField(max_length=20, choices=SYMBOLOGY_CHOICES)
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='barcodes')
    pack_level = models.CharField(max_length=10, choices=PACK_LEVEL_CHOICES, default='EACH')
    qty_in_base = models.PositiveIntegerField(default=1)
    is_primary = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'sku_barcodes'


class Listing(models.Model):
    listing_id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='listings')
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='listings')
    price = models.DecimalField(max_digits=10, decimal_places=2)
    mrp = models.DecimalField(max_digits=10, decimal_places=2)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    is_listed = models.BooleanField(default=False)
    is_available = models.BooleanField(default=False)
    low_stock_threshold = models.PositiveIntegerField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'listings'
        unique_together = [('sku', 'site')]


class InventoryLot(models.Model):
    BUCKET_CHOICES = [('Good','Good'),('BAD','Bad'),('QC_HOLD','QC Hold'),('InProgress','In Progress')]
    lot_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='lots')
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='lots')
    batch_number = models.CharField(max_length=30)
    mfg_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    box_size = models.PositiveIntegerField(default=1)
    inbound_type = models.CharField(max_length=10, blank=True)
    inbound_ref = models.CharField(max_length=100, blank=True)
    source_site = models.ForeignKey('network.Site', null=True, on_delete=models.SET_NULL, related_name='sourced_lots')
    source_vendor_id = models.UUIDField(null=True, blank=True)
    bucket = models.CharField(max_length=15, choices=BUCKET_CHOICES, default='Good')
    status = models.CharField(max_length=20, default='AVAILABLE')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inventory_lots'
        ordering = ['expiry_date', 'created_at']

    def __str__(self):
        return f"{self.batch_number} ({self.sku.sku_code})"
