import uuid
from django.db import models

class ReturnOrder(models.Model):
    STATUS_CHOICES = [('RETURN_CREATED','Return Created'),('APPROVED','Approved'),('PICKUP_SCHEDULED','Pickup Scheduled'),('PICKED_UP','Picked Up'),('RECEIVED_AT_DS','Received at DS'),('QC_IN_PROGRESS','QC In Progress'),('REFUND_DECISION','Refund Decision'),('REFUND_INITIATED','Refund Initiated'),('REFUNDED','Refunded'),('RETURN_DENIED','Return Denied'),('CLOSED','Closed')]
    FAULT_CHOICES = [('CUSTOMER','Customer'),('TRANSIT','Transit'),('UNKNOWN','Unknown'),('NONE','None')]
    return_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('orders.CustomerOrder', on_delete=models.CASCADE, related_name='returns')
    reason = models.TextField()
    fault = models.CharField(max_length=20, choices=FAULT_CHOICES, default='NONE')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='RETURN_CREATED')
    pickup_scheduled_at = models.DateTimeField(null=True, blank=True)
    picked_up_at = models.DateTimeField(null=True, blank=True)
    received_at_ds = models.DateTimeField(null=True, blank=True)
    qc_disposition = models.CharField(max_length=20, null=True, blank=True)
    refund_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'return_orders'
        ordering = ['-created_at']

class RTVOrder(models.Model):
    STATUS_CHOICES = [('PENDING','Pending'),('IN_TRANSIT','In Transit'),('RECEIVED','Received'),('CLOSED','Closed')]
    rtv_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('orders.CustomerOrder', on_delete=models.CASCADE, related_name='rtvs')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    destination_site = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'rtv_orders'

class RTSOrder(models.Model):
    STATUS_CHOICES = [('PENDING','Pending'),('IN_TRANSIT','In Transit'),('RECEIVED','Received'),('CLOSED','Closed')]
    rts_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('orders.CustomerOrder', on_delete=models.CASCADE, related_name='rts')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    destination_site = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'rts_orders'


class CancellationPutaway(models.Model):
    """Cancelled-order stock that has come back and still needs shelf putaway.

    Cancellation is not a customer return: the order never completed for the
    customer, so the putaway record only needs the order, site, physical SKU
    and qty, the destination bin, and the reason it came back.
    """

    STATUS_CHOICES = [
        ('PENDING_QC', 'Pending QC'),
        ('PUTAWAY_PENDING', 'Putaway Pending'),
        ('COMPLETED', 'Completed'),
        ('REJECTED', 'Rejected'),
        ('CANCELLED', 'Cancelled'),
    ]

    putaway_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    order = models.ForeignKey(
        'orders.CustomerOrder', on_delete=models.PROTECT,
        related_name='cancellation_putaways',
    )
    site = models.ForeignKey(
        'network.Site', on_delete=models.PROTECT,
        related_name='cancellation_putaways',
    )
    sku = models.ForeignKey(
        'catalog.Sku', on_delete=models.PROTECT,
        related_name='cancellation_putaways',
    )
    lot = models.ForeignKey(
        'catalog.InventoryLot', null=True, blank=True, on_delete=models.PROTECT,
        related_name='cancellation_putaways',
    )
    qty = models.PositiveIntegerField()
    destination_bin = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING_QC')
    reason_code = models.CharField(max_length=60, blank=True)
    remarks = models.TextField(blank=True)
    created_by = models.ForeignKey(
        'iam.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cancellation_putaways_created',
    )
    completed_by = models.ForeignKey(
        'iam.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cancellation_putaways_completed',
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cancellation_putaways'
        ordering = ['-created_at', 'putaway_id']
        indexes = [
            models.Index(fields=['site', 'status']),
            models.Index(fields=['order', 'status']),
            models.Index(fields=['sku', 'status']),
        ]

    def __str__(self):
        return self.code
