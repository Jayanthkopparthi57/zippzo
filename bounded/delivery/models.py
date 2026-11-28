import uuid
from django.db import models
from django.conf import settings


class RiderPaymentRule(models.Model):
    """Rider pay rate card for a store. Values are admin-editable reference data.

    Bonuses need a weather/peak signal on the job before they can be applied to
    an automatic settlement; until then this is the published rate card and is
    used by the estimate endpoint and the console preview.
    """
    rule_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.OneToOneField('network.Site', on_delete=models.CASCADE,
                                related_name='rider_payment_rule', null=True, blank=True)
    base_per_km = models.DecimalField(max_digits=6, decimal_places=2, default='7.00')
    delivery_radius_km = models.DecimalField(max_digits=5, decimal_places=2, default='5.00')
    busy_bonus = models.DecimalField(max_digits=6, decimal_places=2, default='5.00')
    rain_bonus = models.DecimalField(max_digits=6, decimal_places=2, default='5.00')
    busy_rain_bonus = models.DecimalField(max_digits=6, decimal_places=2, default='10.00')
    incentive_orders = models.PositiveIntegerField(default=15)
    incentive_amount = models.DecimalField(max_digits=7, decimal_places=2, default='100.00')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'rider_payment_rules'
        ordering = ['-created_at']

    def __str__(self):
        return f'Rider pay · {self.site.code if self.site else "default"}'


class RiderProfile(models.Model):
    VEHICLE_CHOICES = [('BIKE','Bike'),('SCOOTER','Scooter'),('CYCLE','Cycle'),('MINI_VAN','Mini Van')]
    KYC_CHOICES = [('PENDING','Pending'),('VERIFIED','Verified'),('REJECTED','Rejected')]
    rider_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField('iam.User', on_delete=models.CASCADE, related_name='rider_profile')
    name = models.CharField(max_length=80)
    phone = models.CharField(max_length=15)
    vehicle_type = models.CharField(max_length=20, choices=VEHICLE_CHOICES)
    vehicle_number = models.CharField(max_length=15, blank=True)
    vehicle_capacity_kg = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    vehicle_capacity_cbm = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    can_carry_cold = models.BooleanField(default=False)
    kyc_status = models.CharField(max_length=20, choices=KYC_CHOICES, default='PENDING')
    kyc_number = models.CharField(max_length=80, blank=True)
    kyc_document_type = models.CharField(max_length=30, blank=True)
    kyc_document_url = models.CharField(max_length=500, blank=True)
    kyc_reviewed_at = models.DateTimeField(null=True, blank=True)
    kyc_reviewed_by = models.CharField(max_length=64, blank=True)
    is_online = models.BooleanField(default=False)
    current_site = models.ForeignKey('network.Site', null=True, on_delete=models.SET_NULL, related_name='rider_profiles')
    rating = models.DecimalField(max_digits=3, decimal_places=2, null=True, blank=True)
    # Where the rider was last seen, stamped by the rider app itself while it
    # is online. Null until the first accepted location - a rider who has never
    # shared, or whose browser refused the permission, simply has no pin.
    last_lat = models.FloatField(null=True, blank=True)
    last_lng = models.FloatField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'rider_profiles'
        ordering = ['-created_at']

class RiderShift(models.Model):
    STATUS_CHOICES = [('OPEN','Open'),('CLOSED','Closed')]
    END_REASON_CHOICES = [('MANUAL','Manual'),('AUTO_IDLE','Auto Idle'),('TIMEOUT','Timeout'),('FORCED','Forced')]
    shift_id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    rider = models.ForeignKey('RiderProfile', on_delete=models.CASCADE, related_name='shifts')
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='rider_shifts')
    qr_in = models.ForeignKey('iam.QRCode', null=True, on_delete=models.SET_NULL, related_name='shifts')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    end_reason = models.CharField(max_length=20, choices=END_REASON_CHOICES, null=True, blank=True)
    orders_delivered = models.PositiveIntegerField(default=0)
    distance_km = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='OPEN')
    class Meta:
        db_table = 'rider_shifts'
        ordering = ['-started_at']

class DeliveryTask(models.Model):
    STATUS_CHOICES = [('UNASSIGNED','Unassigned'),('OFFERED','Offered'),('ACCEPTED','Accepted'),('AT_DS','At DS'),('PICKED_UP','Picked Up'),('EN_ROUTE','En Route'),('ARRIVED','Arrived'),('POD_PENDING','POD Pending'),('DELIVERED','Delivered'),('FAILED','Failed'),('RETURNED','Returned'),('WITHDRAWN','Withdrawn'),('RECALLED','Recalled')]
    task_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('orders.CustomerOrder', on_delete=models.CASCADE, related_name='delivery_tasks')
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='delivery_tasks')
    rider = models.ForeignKey('RiderProfile', null=True, on_delete=models.SET_NULL, related_name='delivery_tasks')
    bin = models.CharField(max_length=50, null=True, blank=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='UNASSIGNED')
    offer_count = models.PositiveSmallIntegerField(default=0)
    offer_surge = models.DecimalField(max_digits=6, decimal_places=3, default=0)
    order_weight_kg = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    order_volume_cbm = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    requires_cold_chain = models.BooleanField(default=False)
    offered_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    pickup_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    distance_m = models.PositiveIntegerField(null=True, blank=True)
    eta_at = models.DateTimeField(null=True, blank=True)
    attempt_no = models.PositiveSmallIntegerField(default=1)
    route_plan_id = models.UUIDField(null=True, blank=True)
    route_seq = models.PositiveSmallIntegerField(null=True, blank=True)
    # Recorded when the order is actually packed, so the rider notification can
    # say where to collect. Set-Together with the pack completion that raises the
    # order.packed event; set to NULL rather than cascading if that pack row is
    # removed, since the order itself is the durable record.
    staging_bin = models.CharField(max_length=50, null=True, blank=True)
    # Packer drops the staged bag in a collection bin; the rider scans this
    # code before the handoff can complete.
    bin_code = models.CharField(max_length=50, blank=True, default='')
    bin_dropped_at = models.DateTimeField(null=True, blank=True)
    bin_dropped_by = models.CharField(max_length=100, blank=True, default='')
    packed_at = models.DateTimeField(null=True, blank=True)
    cash_collected_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'delivery_tasks'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['rider', 'status'], name='ix_deliverytask_rider_status'),
            models.Index(fields=['site', 'status'], name='ix_deliverytask_site_status'),
        ]

class RoutePlan(models.Model):
    STATUS_CHOICES = [('PLANNED','Planned'),('IN_PROGRESS','In Progress'),('COMPLETED','Completed'),('ABORTED','Aborted')]
    route_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rider = models.ForeignKey('RiderProfile', on_delete=models.CASCADE, related_name='route_plans')
    shift = models.ForeignKey('RiderShift', null=True, on_delete=models.SET_NULL, related_name='route_plans')
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='route_plans')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PLANNED')
    stop_count = models.PositiveSmallIntegerField(default=0)
    total_distance_m = models.PositiveIntegerField(null=True, blank=True)
    estimated_min = models.PositiveIntegerField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'route_plans'
        ordering = ['-created_at']

class RouteStop(models.Model):
    STATUS_CHOICES = [('PENDING','Pending'),('ARRIVED','Arrived'),('DELIVERED','Delivered'),('FAILED','Failed')]
    stop_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route = models.ForeignKey('RoutePlan', on_delete=models.CASCADE, related_name='stops')
    task = models.ForeignKey('DeliveryTask', on_delete=models.CASCADE, related_name='route_stops')
    seq = models.PositiveSmallIntegerField()
    planned_eta = models.DateTimeField(null=True, blank=True)
    actual_arrival = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    class Meta:
        db_table = 'route_stops'
        unique_together = [('route', 'seq')]
