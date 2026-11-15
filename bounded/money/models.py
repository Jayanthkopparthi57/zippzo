import uuid
from decimal import Decimal

from django.db import models

class Payment(models.Model):
    METHOD_CHOICES = [('UPI','UPI'),('CARD','Card'),('NETBANKING','Net Banking'),('WALLET','Wallet'),('COD_UPI','COD UPI'),('COD_CASH','COD Cash')]
    STATUS_CHOICES = [('INITIATED','Initiated'),('PROCESSING','Processing'),('CAPTURED','Captured'),('FAILED','Failed'),('VOIDED','Voided'),('REFUNDED','Refunded')]
    payment_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('orders.CustomerOrder', on_delete=models.CASCADE, related_name='payments')
    customer = models.ForeignKey('orders.Customer', on_delete=models.CASCADE, related_name='payments')
    method = models.CharField(max_length=20, choices=METHOD_CHOICES)
    gateway = models.CharField(max_length=50, blank=True)
    gateway_order_id = models.CharField(max_length=80, blank=True)
    gateway_payment_id = models.CharField(max_length=80, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='INITIATED')
    captured_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'payments'
        ordering = ['-created_at']

class CancelIntent(models.Model):
    STATUS_CHOICES = [('WAITING_PAYMENT','Waiting Payment'),('RESUMED','Resumed'),('CANCELLED','Cancelled'),('SUPERSEDED','Superseded')]
    intent_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('orders.CustomerOrder', on_delete=models.CASCADE, related_name='cancel_intents')
    idempotency_key = models.CharField(max_length=80, unique=True)
    reason_code = models.CharField(max_length=50)
    actor_type = models.CharField(max_length=20)
    actor_id = models.CharField(max_length=64, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='WAITING_PAYMENT')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    resolved_at = models.DateTimeField(null=True, blank=True)
    class Meta:
        db_table = 'cancel_intents'
        ordering = ['-created_at']

class Refund(models.Model):
    STATUS_CHOICES = [('REQUESTED','Requested'),('APPROVED','Approved'),('PARTIAL_APPROVED','Partial Approved'),('DENIED','Denied'),('WAITING_QC','Waiting QC'),('PROCESSED','Processed'),('SUCCESS','Success'),('FAILED','Failed'),('UNKNOWN','Unknown'),('MANUAL_OPS','Manual Ops'),('CLOSED','Closed')]
    refund_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('orders.CustomerOrder', on_delete=models.CASCADE, related_name='refunds')
    payment = models.ForeignKey('Payment', on_delete=models.CASCADE, related_name='refunds')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    refund_method = models.CharField(max_length=20)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='REQUESTED')
    gateway_refund_id = models.CharField(max_length=80, blank=True)
    utr = models.CharField(max_length=40, blank=True)
    initiated_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    retry_count = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'refunds'
        ordering = ['-created_at']

class RefundDecision(models.Model):
    DECISION_CHOICES = [('APPROVE','Approve'),('PARTIAL','Partial'),('DENY','Deny'),('WAIT','Wait')]
    decision_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    refund = models.ForeignKey('Refund', on_delete=models.CASCADE, related_name='decisions')
    return_order = models.UUIDField(null=True, blank=True)
    decision = models.CharField(max_length=20, choices=DECISION_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason_code = models.CharField(max_length=50, blank=True)
    decided_by = models.CharField(max_length=64, blank=True)
    decided_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'refund_decisions'

class CashMovement(models.Model):
    MOVE_TYPE_CHOICES = [('FLOAT_ISSUE','Float Issue'),('FLOAT_RETURN','Float Return'),('COD_COLLECT','COD Collect'),('COD_UPI_SETTLE','COD UPI Settle'),('REMITTANCE_TO_VAULT','Remittance to Vault'),('VAULT_TO_BANK','Vault to Bank'),('CUSTODY_ADJUSTMENT','Custody Adjustment')]
    entry_id = models.BigAutoField(primary_key=True)
    movement_type = models.CharField(max_length=30, choices=MOVE_TYPE_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    site = models.CharField(max_length=50)
    from_container = models.CharField(max_length=30, null=True, blank=True)
    from_ref_id = models.CharField(max_length=50, null=True, blank=True)
    to_container = models.CharField(max_length=30, null=True, blank=True)
    to_ref_id = models.CharField(max_length=50, null=True, blank=True)
    ref_type = models.CharField(max_length=30, null=True, blank=True)
    ref_id = models.CharField(max_length=50, null=True, blank=True)
    actor_id = models.CharField(max_length=64, null=True, blank=True)
    actor_type = models.CharField(max_length=20, default='SYSTEM')
    idempotency_key = models.CharField(max_length=80, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'cash_movements'
        ordering = ['-created_at']

class RiderCustodyState(models.Model):
    rider_id = models.UUIDField(primary_key=True)
    site = models.CharField(max_length=50)
    current_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    current_float = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    bags_in_custody = models.PositiveSmallIntegerField(default=0)
    ceiling_amount = models.DecimalField(max_digits=12, decimal_places=2)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        db_table = 'rider_custody_state'

class RiderEarnings(models.Model):
    earning_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rider = models.ForeignKey('delivery.RiderProfile', on_delete=models.CASCADE, related_name='earnings')
    order = models.ForeignKey('orders.CustomerOrder', on_delete=models.CASCADE, related_name='earnings')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2)
    tips = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=20, default='PENDING')
    #: The payout run that settled this row. NULL while PENDING, so finance can
    #: always answer "which transfer paid this delivery" without a second table.
    payout = models.ForeignKey(
        'RiderPayout', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='earnings')
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'rider_earnings'
        ordering = ['-created_at']
        unique_together = [('order', 'rider')]


class RiderPayout(models.Model):
    """One counted transfer to one rider: the statement finance hands over.

    Earnings are only ever settled by a payout run. Keeping the run as its own
    row (rather than flipping ``status`` in place) is what makes the rider's
    statement reproducible: the amount, the number of deliveries and the
    reference all exist even after the orders themselves age out of view.
    """
    STATUS_CHOICES = [('PAID', 'Paid'), ('VOID', 'Void')]
    payout_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rider = models.ForeignKey(
        'delivery.RiderProfile', on_delete=models.CASCADE, related_name='payouts')
    site = models.CharField(max_length=50, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    earnings_count = models.PositiveIntegerField(default=0)
    period_start = models.DateTimeField(null=True, blank=True)
    period_end = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PAID')
    reference = models.CharField(max_length=80, blank=True)
    created_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'rider_payouts'
        ordering = ['-created_at']

    def __str__(self):
        return f'Payout {self.payout_id} · {self.rider_id} · {self.amount}'



# What checkout charges for delivery when the store has no rule of its own.
# Keeping the flat number here rather than in checkout means the fallback and
# the modelled path are decided in one place.
DEFAULT_DELIVERY_FEE = Decimal('20.00')
# The standing rule for a store that nobody has priced: a small-basket charge,
# waived once the basket reaches this amount. A store that publishes its own
# rule replaces this entirely.
DEFAULT_FREE_ABOVE = Decimal('150.00')


class DeliveryPricingRule(models.Model):
    """One store's delivery fee, so checkout stops charging everybody the
    same flat number.

    One row per site (OneToOne) rather than a versioned history: the admin
    screen edits the fee a store is charging right now, and a shopper's
    checkout reads exactly one number. Orders already placed keep the fee
    they were charged on their own row - this only decides the next one.
    """
    rule_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.OneToOneField('network.Site', on_delete=models.CASCADE,
                                related_name='delivery_pricing_rule')
    base_fee = models.DecimalField(max_digits=10, decimal_places=2,
                                   default=DEFAULT_DELIVERY_FEE)
    promise_minutes = models.PositiveIntegerField(default=15)
    # A quick-commerce lever every store runs: free delivery above a basket
    # value. 0 means "never free", which keeps existing rows and the flat
    # default behaving exactly as before.
    free_above = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    updated_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'delivery_pricing_rules'
        ordering = ['site__code']

    def __str__(self):
        return f'{self.site.code}: ₹{self.base_fee}'


def resolve_delivery_fee(site, subtotal=None):
    """The fee this store charges right now.

    An inactive rule, a store nobody has priced, and no site at all all land
    on the flat default - checkout must never fail to open because pricing
    was never configured.

    Passing the basket subtotal applies the store's free-delivery threshold:
    a rule with `free_above` set waives the fee once the basket reaches it.
    Callers that only need the headline fee (storefront, coverage) omit it and
    get the base fee.
    """
    if site is None:
        return DEFAULT_DELIVERY_FEE
    rule = DeliveryPricingRule.objects.filter(
        site_id=getattr(site, 'site_id', None), is_active=True).first()
    if rule is None:
        if (subtotal is not None and DEFAULT_FREE_ABOVE > 0
                and subtotal >= DEFAULT_FREE_ABOVE):
            return Decimal('0.00')
        return DEFAULT_DELIVERY_FEE
    if (subtotal is not None and rule.free_above
            and rule.free_above > 0 and subtotal >= rule.free_above):
        return Decimal('0.00')
    return rule.base_fee
