# Catalog  SKU Master, Barcodes, Listings, Inventory Lots
import uuid
from django.db import models


class SkuCategory(models.Model):
    category_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children')
    description = models.TextField(blank=True, default='')

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
    image_url = models.CharField(max_length=300, blank=True)
    description = models.TextField(blank=True)
    ingredients = models.TextField(blank=True)
    allergens = models.TextField(blank=True)
    storage_notes = models.TextField(blank=True)
    nutrition_facts = models.JSONField(default=dict, blank=True)
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

    def save(self, *args, **kwargs):
        from decimal import Decimal
        if self.mrp:
            self.discount_pct = (
                (Decimal('1') - self.price / self.mrp) * Decimal('100')
            ).quantize(Decimal('0.01'))
        else:
            self.discount_pct = Decimal('0.00')
        super().save(*args, **kwargs)


class StoreProductProfile(models.Model):
    """Site-specific shopper presentation for a catalog SKU.

    Inventory and product facts stay on ``Sku`` and ``Listing``. This table is
    only what shoppers should see at one dark store: up to three image URLs,
    display name/brand overrides, and the store's own category labels.
    """

    profile_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='store_product_profiles')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='store_profiles')
    images = models.JSONField(default=list, blank=True)
    category = models.ForeignKey(SkuCategory, null=True, blank=True, on_delete=models.SET_NULL, related_name='store_profiles')
    sub_category = models.CharField(max_length=100, blank=True)
    display_name = models.CharField(max_length=200, blank=True)
    display_brand = models.CharField(max_length=60, blank=True)
    is_featured = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'store_product_profiles'
        unique_together = [('site', 'sku')]
        ordering = ['site__code', 'sort_order', 'sku__name']

    def clean(self):
        if not isinstance(self.images, list):
            raise ValueError('Images must be a list.')
        values = [str(image or '').strip() for image in self.images if str(image or '').strip()]
        if len(values) > 3:
            raise ValueError('A product can have at most 3 images.')
        self.images = values[:3]

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.site.code}:{self.sku.sku_code}'


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


class Coupon(models.Model):
    TYPE_CHOICES = [('FLAT', 'Flat'), ('PERCENT', 'Percent')]
    coupon_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=30, unique=True)
    title = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True)
    discount_type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    discount_value = models.DecimalField(max_digits=10, decimal_places=2)
    min_order = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    max_discount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    valid_from = models.DateTimeField()
    valid_until = models.DateTimeField()
    site = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.CASCADE,
        related_name='coupons',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'coupons'
        ordering = ['-created_at']

    def __str__(self):
        return self.code

    def is_valid_now(self):
        from django.utils import timezone
        now = timezone.now()
        return self.is_active and self.valid_from <= now <= self.valid_until

    def compute_discount(self, subtotal):
        from decimal import Decimal
        if not self.is_valid_now() or subtotal < self.min_order:
            return Decimal('0.00')
        if self.discount_type == 'FLAT':
            d = self.discount_value
        else:
            d = (subtotal * self.discount_value / Decimal('100')).quantize(Decimal('0.01'))
        if self.max_discount is not None and d > self.max_discount:
            d = self.max_discount
        if d > subtotal:
            d = subtotal
        return d.quantize(Decimal('0.01'))


class ComboOffer(models.Model):
    offer_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='combo_offers')
    title = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True)
    fixed_price = models.DecimalField(max_digits=10, decimal_places=2)
    valid_from = models.DateTimeField()
    valid_until = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'combo_offers'
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    def is_valid_now(self):
        from django.utils import timezone
        now = timezone.now()
        return self.is_active and self.valid_from <= now <= self.valid_until


class ComboOfferItem(models.Model):
    item_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    offer = models.ForeignKey(ComboOffer, on_delete=models.CASCADE, related_name='items')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='combo_offer_items')
    quantity = models.PositiveIntegerField()

    class Meta:
        db_table = 'combo_offer_items'
        unique_together = [('offer', 'sku')]


class ProductReview(models.Model):
    review_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='reviews')
    customer = models.ForeignKey('orders.Customer', on_delete=models.CASCADE, related_name='reviews')
    rating = models.PositiveSmallIntegerField()
    comment = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'product_reviews'
        unique_together = [('sku', 'customer')]
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.sku.sku_code} {self.rating}★"


class WishlistItem(models.Model):
    wishlist_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey('orders.Customer', on_delete=models.CASCADE, related_name='wishlist')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='wishlisted_by')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'wishlist_items'
        unique_together = [('customer', 'sku')]
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.customer.name} wants {self.sku.sku_code}"
