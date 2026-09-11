import uuid
from django.db import models
from django.utils import timezone
from apps.master_data.models import Category, SoftDeleteModel

class Vendor(SoftDeleteModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vendor_code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=150)
    contact_person = models.CharField(max_length=100, blank=True, null=True)
    email = models.EmailField(max_length=255)
    phone = models.CharField(max_length=30, blank=True, null=True)
    tax_id = models.CharField(max_length=50, blank=True, null=True)
    currency = models.CharField(max_length=3, default='USD')
    payment_terms = models.CharField(max_length=100, default='Net 30')
    address = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.vendor_code})"

class Customer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer_code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=150)
    email = models.EmailField(max_length=255)
    phone = models.CharField(max_length=30, blank=True, null=True)
    shipping_address = models.TextField()
    billing_address = models.TextField(blank=True, null=True)
    city = models.CharField(max_length=100)
    pincode = models.CharField(max_length=20)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.customer_code})"

class Product(SoftDeleteModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True, related_name='products')
    sku = models.CharField(max_length=64, unique=True)
    barcode = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    hsn_code = models.CharField(max_length=30, blank=True, null=True)
    uom = models.CharField(max_length=20, default='PCS')
    length_cm = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    width_cm = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    height_cm = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    gross_weight_kg = models.DecimalField(max_digits=8, decimal_places=3, default=0.100)
    reorder_point = models.IntegerField(default=10)
    reorder_quantity = models.IntegerField(default=50)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} [{self.sku}]"

class Batch(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='batches')
    internal_batch_id = models.CharField(max_length=50, unique=True)
    vendor_batch_code = models.CharField(max_length=100, blank=True, null=True)
    mfg_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    currency = models.CharField(max_length=3, default='USD')
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    pack_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    pack_quantity = models.IntegerField(default=1)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'Batches'
        indexes = [
            models.Index(
                fields=['expiry_date'],
                name='idx_batches_expiry'
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.internal_batch_id:
            from django.db.models import Max
            date_str = timezone.now().strftime('%Y%m')
            prefix = f"BAT-{date_str}-"
            last = Batch.objects.filter(
                internal_batch_id__startswith=prefix
            ).aggregate(max_num=Max('internal_batch_id'))['max_num']
            if last:
                try:
                    seq = int(last.split('-')[-1]) + 1
                except (ValueError, IndexError):
                    seq = Batch.objects.filter(internal_batch_id__startswith=prefix).count() + 1
            else:
                seq = 1
            self.internal_batch_id = f"{prefix}{seq:04d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.product.sku} - {self.internal_batch_id} (Exp: {self.expiry_date or 'N/A'})"
