import uuid
from django.db import models
from wms_master.models import Site, VehicleType, Transporter, DockDoor
from wms_platform.models import User
from wms_inbound.models import Asn


class Trip(models.Model):
    DIRECTION_CHOICES = [('FORWARD', 'Forward'), ('RETURN', 'Return'), ('INBOUND_MH', 'Inbound MH')]
    DELAY_STATUS_CHOICES = [('ON_TRACK', 'On Track'), ('DELAYED', 'Delayed')]
    GPS_STATUS_CHOICES = [('LIVE', 'Live'), ('STALE', 'Stale'), ('OFF', 'Off')]
    BILLING_STATUS_CHOICES = [('PLANNED', 'Planned'), ('BILLED', 'Billed'), ('PAID', 'Paid')]
    STATUS_CHOICES = [
        ('PLANNED', 'Planned'), ('VEHICLE_ASSIGNED', 'Vehicle Assigned'),
        ('CHECKED_IN', 'Checked In'), ('DOCKED_IN', 'Docked In'), ('LOADING', 'Loading'),
        ('LOADED', 'Loaded'), ('IN_TRANSIT', 'In Transit'), ('ARRIVED', 'Arrived'),
        ('COMPLETED', 'Completed'), ('CANCELLED', 'Cancelled'),
    ]

    trip_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trip_no = models.CharField(max_length=50, unique=True)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='trips')
    direction = models.CharField(max_length=15, choices=DIRECTION_CHOICES, default='FORWARD')
    dest_site = models.CharField(max_length=200, blank=True)
    trip_date = models.DateField(null=True, blank=True)
    batch_slot = models.CharField(max_length=50, blank=True)
    batch_id = models.UUIDField(null=True, blank=True)
    dispatch_plan_id = models.UUIDField(null=True, blank=True)
    vehicle_type = models.ForeignKey(VehicleType, null=True, blank=True, on_delete=models.SET_NULL, related_name='trips')
    transporter = models.ForeignKey(Transporter, null=True, blank=True, on_delete=models.SET_NULL, related_name='trips')
    vehicle_no = models.CharField(max_length=30, blank=True)
    driver_name = models.CharField(max_length=100, blank=True)
    driver_phone = models.CharField(max_length=20, blank=True)
    otr_cutoff = models.DateTimeField(null=True, blank=True)
    otd_cutoff = models.DateTimeField(null=True, blank=True)
    reporting_cutoff = models.DateTimeField(null=True, blank=True)
    dock_in_at = models.DateTimeField(null=True, blank=True)
    dock_out_cutoff = models.DateTimeField(null=True, blank=True)
    gate_out_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    lpns_loaded = models.IntegerField(default=0)
    load_weight = models.CharField(max_length=20, blank=True)
    forward_lpns_total = models.IntegerField(default=0)
    delay_status = models.CharField(max_length=10, choices=DELAY_STATUS_CHOICES, default='ON_TRACK')
    gps_status = models.CharField(max_length=10, choices=GPS_STATUS_CHOICES, default='OFF')
    pod_template = models.CharField(max_length=50, default='LPN_SCANNING')
    paired_master_trip = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='paired_trips')
    billing_status = models.CharField(max_length=10, choices=BILLING_STATUS_CHOICES, default='PLANNED')
    billing_basis = models.CharField(max_length=50, blank=True)
    source_system = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PLANNED')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'trip'
        ordering = ['-trip_date', '-created_at']

    def __str__(self):
        return self.trip_no


class VehicleCheckin(models.Model):
    DIRECTION_CHOICES = [('OUTBOUND', 'Outbound'), ('INBOUND', 'Inbound')]
    DELAY_STATUS_CHOICES = [('ON_TRACK', 'On Track'), ('DELAYED', 'Delayed')]

    checkin_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES, default='OUTBOUND')
    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name='checkins')
    asn = models.ForeignKey(Asn, null=True, blank=True, on_delete=models.SET_NULL, related_name='checkins')
    vehicle_no = models.CharField(max_length=30)
    driver_name = models.CharField(max_length=100, blank=True)
    driver_phone = models.CharField(max_length=20, blank=True)
    checkin_at = models.DateTimeField(null=True, blank=True)
    checkin_cutoff = models.DateTimeField(null=True, blank=True)
    dl_valid = models.BooleanField(default=True)
    rc_valid = models.BooleanField(default=True)
    six_sided = models.BooleanField(default=True)
    seal_no = models.CharField(max_length=50, blank=True)
    temp_reading = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    security_person = models.CharField(max_length=100, blank=True)
    loading_manifest_id = models.UUIDField(null=True, blank=True)
    unloading_manifest_id = models.UUIDField(null=True, blank=True)
    delay_status = models.CharField(max_length=10, choices=DELAY_STATUS_CHOICES, default='ON_TRACK')
    breach_type = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'vehicle_checkin'
        ordering = ['-checkin_at']

    def __str__(self):
        return f"{self.vehicle_no} - {self.trip.trip_no}"


class TripReturnLeg(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'), ('RETURN_IN_TRANSIT', 'Return In Transit'),
        ('RETURNED', 'Returned'), ('CLOSED', 'Closed'),
    ]

    leg_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name='return_legs')
    return_lpns = models.IntegerField(default=0)
    lpns_unloaded = models.IntegerField(default=0)
    unload_checkin_at = models.DateTimeField(null=True, blank=True)
    dock_in_cutoff = models.DateTimeField(null=True, blank=True)
    dock_out_cutoff = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'trip_return_leg'
        ordering = ['-created_at']

    def __str__(self):
        return f"ReturnLeg-{self.trip.trip_no}"
