import uuid
from django.db import models

class Customer(models.Model):
    STATUS_CHOICES = [('T0','T0'),('T1','T1'),('T2','T2'),('T3','T3'),('T_FLAGGED','T_FLAGGED')]
    customer_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField('iam.User', on_delete=models.CASCADE, related_name='customer_profile')
    name = models.CharField(max_length=80, blank=True)
    trust_tier = models.CharField(max_length=20, choices=STATUS_CHOICES, default='T0')
    default_address_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'customers'
        ordering = ['-created_at']
    def __str__(self):
        return self.name or str(self.user_id)[:8]

class CustomerAddress(models.Model):
    address_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey('Customer', on_delete=models.CASCADE, related_name='addresses')
    label = models.CharField(max_length=20, blank=True)
    line1 = models.CharField(max_length=200)
    line2 = models.CharField(max_length=200, blank=True)
    landmark = models.CharField(max_length=100, blank=True)
    pincode = models.CharField(max_length=6)
    city = models.CharField(max_length=40, blank=True)
    geo_lat = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    geo_lng = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    geocode_confidence = models.CharField(max_length=10, null=True, blank=True)
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'customer_addresses'
        ordering = ['-created_at']
    def __str__(self):
        return f"{self.label} - {self.customer.name}"

class Cart(models.Model):
    STATUS_CHOICES = [('ACTIVE','Active'),('CONVERTED','Converted'),('ABANDONED','Abandoned')]
    cart_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey('Customer', on_delete=models.CASCADE, related_name='carts')
    site = models.ForeignKey('network.Site', null=True, on_delete=models.CASCADE, related_name='carts')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    updated_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'carts'
    def __str__(self):
        return f"Cart {self.cart_id} - {self.customer.name}"

class CartLine(models.Model):
    cart = models.ForeignKey('Cart', on_delete=models.CASCADE, related_name='lines')
    line_no = models.PositiveSmallIntegerField()
    sku = models.ForeignKey('catalog.Sku', on_delete=models.CASCADE, related_name='cart_lines')
    qty = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    class Meta:
        db_table = 'cart_lines'
        unique_together = [('cart', 'line_no')]

class CustomerOrder(models.Model):
    STATUS_CHOICES = [('PLACED','Placed'),('PAYMENT_PENDING','Payment Pending'),('PAYMENT_FAILED','Payment Failed'),('CONFIRMED','Confirmed'),('PICKING','Picking'),('INTERRUPTED','Interrupted'),('PICKED','Picked'),('PARTIALLY_FULFILLED','Partially Fulfilled'),('PACKED','Packed'),('PRICE_FINALIZED','Price Finalized'),('STAGED','Staged'),('RIDER_ASSIGNED','Rider Assigned'),('PICKED_UP','Picked Up'),('OUT_FOR_DELIVERY','Out for Delivery'),('ARRIVED','Arrived'),('DELIVERED','Delivered'),('CANCELLED','Cancelled'),('CANCELLED_PENDING_RETURN','Cancelled Pending Return'),('EXPIRED','Expired'),('FAILED','Failed'),('CLOSED_RTO','Closed RTO'),('REFUNDED','Refunded')]
    PAYMENT_METHODS = [('PREPAID','Prepaid'),('COD','COD')]
    PAYMENT_STATUS = [('PENDING','Pending'),('CAPTURED','Captured'),('FAILED','Failed'),('REFUNDED','Refunded')]
    order_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_no = models.CharField(max_length=20, unique=True)
    customer = models.ForeignKey('Customer', on_delete=models.CASCADE, related_name='orders')
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='orders')
    address = models.ForeignKey('CustomerAddress', on_delete=models.CASCADE, related_name='orders')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='PLACED')
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHODS)
    payment_status = models.CharField(max_length=20, choices=PAYMENT_STATUS, default='PENDING')
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    grand_total = models.DecimalField(max_digits=10, decimal_places=2)
    short_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    cancel_reason = models.TextField(blank=True)
    cancel_actor = models.CharField(max_length=64, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    picked_up_at = models.DateTimeField(null=True, blank=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    # Pickup code for proof of delivery. Only the hash is kept: the plain value is
    # handed to the customer once over the outbox event and never stored, so a
    # database leak does not hand over the ability to close somebody's delivery.
    # Cleared on use, which makes the code single-use rather than a standing
    # permission to close the order again.
    pod_otp_hash = models.CharField(max_length=64, null=True, blank=True)
    pod_issued_at = models.DateTimeField(null=True, blank=True)
    placed_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'customer_orders'
        ordering = ['-placed_at']
    def __str__(self):
        return self.order_no

class CustomerOrderLine(models.Model):
    STATUS_CHOICES = [('PENDING','Pending'),('PICKED','Picked'),('SHORT','Short'),('CANCELLED','Cancelled')]
    order = models.ForeignKey('CustomerOrder', on_delete=models.CASCADE, related_name='lines')
    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    line_no = models.PositiveSmallIntegerField()
    sku = models.ForeignKey('catalog.Sku', on_delete=models.CASCADE, related_name='order_lines')
    lot = models.ForeignKey('catalog.InventoryLot', null=True, on_delete=models.SET_NULL, related_name='order_lots')
    qty = models.PositiveIntegerField()
    picked_qty = models.PositiveIntegerField(default=0)
    packed_qty = models.PositiveIntegerField(default=0)
    shipped_qty = models.PositiveIntegerField(default=0)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    class Meta:
        db_table = 'customer_order_lines'
        unique_together = [('order', 'line_no')]

class OrderStatusHistory(models.Model):
    history_id = models.BigAutoField(primary_key=True)
    order = models.ForeignKey('CustomerOrder', on_delete=models.CASCADE, related_name='status_history')
    from_status = models.CharField(max_length=30, null=True, blank=True)
    to_status = models.CharField(max_length=30)
    actor_type = models.CharField(max_length=20)
    actor_id = models.UUIDField(null=True, blank=True)
    remark = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'order_status_history'
        ordering = ['-created_at']
