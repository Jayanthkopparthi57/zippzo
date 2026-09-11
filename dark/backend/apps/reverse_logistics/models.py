import uuid
from django.db import models
from django.utils import timezone
from apps.fulfillment.models import SalesOrder
from apps.catalog.models import Customer, Product, Batch
from apps.master_data.models import Location

class RMAReasonChoices(models.TextChoices):
    DAMAGED = 'damaged', 'Damaged in Transit'
    DEFECTIVE = 'defective', 'Defective / Faulty Product'
    WRONG_ITEM = 'wrong_item', 'Wrong Item Shipped'
    CUSTOMER_REMORSE = 'customer_remorse', 'Customer Remorse / No Longer Needed'

class RMAStatusChoices(models.TextChoices):
    INITIATED = 'initiated', 'RMA Initiated'
    ITEM_RECEIVED = 'item_received', 'Item Received at Dock'
    INSPECTED = 'inspected', 'Inspected & Routed'
    REFUND_APPROVED = 'refund_approved', 'Refund Approved'
    REJECTED = 'rejected', 'Return Rejected'

class InspectionResultChoices(models.TextChoices):
    RESTOCKABLE = 'restockable', 'Restockable (Return to Pick Zone)'
    DAMAGED_SCRAP = 'damaged_scrap', 'Damaged / Scrap Zone'
    REFURBISH = 'refurbish', 'Quarantine for Refurbishment'

class ReturnOrder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rma_number = models.CharField(max_length=50, unique=True)
    order = models.ForeignKey(SalesOrder, on_delete=models.RESTRICT, related_name='return_orders')
    customer = models.ForeignKey(Customer, on_delete=models.RESTRICT, related_name='returns')
    reason = models.CharField(max_length=50, choices=RMAReasonChoices.choices)
    status = models.CharField(max_length=30, choices=RMAStatusChoices.choices, default=RMAStatusChoices.INITIATED)
    tracking_number = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.rma_number:
            from django.db.models import Max
            date_str = timezone.now().strftime('%Y%m')
            prefix = f"RMA-{date_str}-"
            last = ReturnOrder.objects.filter(
                rma_number__startswith=prefix
            ).aggregate(max_num=Max('rma_number'))['max_num']
            if last:
                try:
                    seq = int(last.split('-')[-1]) + 1
                except (ValueError, IndexError):
                    seq = ReturnOrder.objects.filter(rma_number__startswith=prefix).count() + 1
            else:
                seq = 1
            self.rma_number = f"{prefix}{seq:04d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.rma_number} for {self.order.order_number} [{self.status}]"

class ReturnItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rma = models.ForeignKey(ReturnOrder, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.RESTRICT, related_name='return_items')
    batch = models.ForeignKey(Batch, on_delete=models.RESTRICT, related_name='return_items')
    returned_qty = models.IntegerField()
    inspection_result = models.CharField(max_length=50, choices=InspectionResultChoices.choices, null=True, blank=True)
    target_location = models.ForeignKey(Location, on_delete=models.SET_NULL, null=True, blank=True, related_name='restocked_returns')
    refund_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)

    def __str__(self):
        return f"{self.rma.rma_number} Item: {self.product.sku} ({self.returned_qty} units - {self.inspection_result})"
