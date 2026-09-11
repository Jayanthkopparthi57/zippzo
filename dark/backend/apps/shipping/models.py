import uuid
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from apps.fulfillment.models import SalesOrder

class LogisticsPartnerChoices(models.TextChoices):
    FEDEX = 'FedEx', 'FedEx'
    DHL = 'DHL', 'DHL Express'
    BLUEDART = 'BlueDart', 'BlueDart'
    DELHIVERY = 'Delhivery', 'Delhivery'
    SELF_FLEET = 'Self_Fleet', 'Company Fleet / In-House'

class ShipmentStatusChoices(models.TextChoices):
    LABELED = 'labeled', 'Label Created'
    PICKED_UP = 'picked_up', 'Picked Up by Carrier'
    IN_TRANSIT = 'in_transit', 'In Transit'
    OUT_FOR_DELIVERY = 'out_for_delivery', 'Out for Delivery'
    DELIVERED = 'delivered', 'Delivered'
    FAILED_ATTEMPT = 'failed_attempt', 'Delivery Attempt Failed'
    RTO = 'rto', 'Returned to Origin'

class Shipment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(SalesOrder, on_delete=models.CASCADE, related_name='shipments')
    shipment_number = models.CharField(max_length=50, unique=True)
    package_weight_kg = models.DecimalField(max_digits=8, decimal_places=3)
    package_dimensions = models.JSONField(default=dict) # e.g. {"length": 30, "width": 20, "height": 15}
    logistics_partner = models.CharField(max_length=50, choices=LogisticsPartnerChoices.choices, default=LogisticsPartnerChoices.FEDEX)
    tracking_number = models.CharField(max_length=100, unique=True)
    shipping_label_url = models.TextField(blank=True, null=True)
    delivery_eta = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=30, choices=ShipmentStatusChoices.choices, default=ShipmentStatusChoices.LABELED)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.shipment_number:
            from django.db.models import Max
            date_str = timezone.now().strftime('%Y%m%d')
            prefix = f"SHP-{date_str}-"
            last = Shipment.objects.filter(
                shipment_number__startswith=prefix
            ).aggregate(max_num=Max('shipment_number'))['max_num']
            if last:
                try:
                    seq = int(last.split('-')[-1]) + 1
                except (ValueError, IndexError):
                    seq = Shipment.objects.filter(shipment_number__startswith=prefix).count() + 1
            else:
                seq = 1
            self.shipment_number = f"{prefix}{seq:04d}"
        if not self.tracking_number:
            self.tracking_number = f"TRK-{uuid.uuid4().hex[:12].upper()}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.shipment_number} ({self.logistics_partner}: {self.tracking_number})"

class ShipmentManifest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    manifest_number = models.CharField(max_length=50, unique=True)
    logistics_partner = models.CharField(max_length=50, choices=LogisticsPartnerChoices.choices)
    driver_name = models.CharField(max_length=100)
    vehicle_number = models.CharField(max_length=50)
    driver_phone = models.CharField(max_length=30, blank=True, null=True)
    total_packages = models.IntegerField(default=0)
    departure_time = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_manifests')
    shipments = models.ManyToManyField(Shipment, related_name='manifests')

    def save(self, *args, **kwargs):
        if not self.manifest_number:
            from django.db.models import Max
            date_str = timezone.now().strftime('%Y%m%d')
            prefix = f"MNF-{date_str}-"
            last = ShipmentManifest.objects.filter(
                manifest_number__startswith=prefix
            ).aggregate(max_num=Max('manifest_number'))['max_num']
            if last:
                try:
                    seq = int(last.split('-')[-1]) + 1
                except (ValueError, IndexError):
                    seq = ShipmentManifest.objects.filter(manifest_number__startswith=prefix).count() + 1
            else:
                seq = 1
            self.manifest_number = f"{prefix}{seq:03d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.manifest_number} - Driver: {self.driver_name} ({self.total_packages} pkgs)"

# ==============================================================================
# WAREHOUSEOS 13-TABLE CORE ARCHITECTURE: SHIPPING & DISPATCH MODELS
# ==============================================================================

class ShipmentMaster(models.Model):
    """Table 11: SHIPPING / DISPATCH TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shipment_id = models.CharField(max_length=50, unique=True) # SHP-000821
    order_id = models.CharField(max_length=50, db_index=True) # ORD-00124
    package_id = models.CharField(max_length=50, db_index=True) # PKG-009821
    warehouse = models.CharField(max_length=50, default='RJY-DS-001')
    customer = models.CharField(max_length=150, default='Jay')
    delivery_zone = models.CharField(max_length=50, default='RJY-Z03')
    items = models.IntegerField(default=1)
    units = models.IntegerField(default=1)
    packages = models.IntegerField(default=1)
    weight = models.CharField(max_length=30, default='7.8 kg')
    transporter = models.CharField(max_length=100, default='Internal Fleet') # Internal Fleet, Shadowfax, Blinkit
    rider = models.CharField(max_length=100, default='Suresh')
    vehicle = models.CharField(max_length=50, default='AP05CD4521')
    route = models.CharField(max_length=50, default='RT-00421')
    tracking_id = models.CharField(max_length=100, default='TRK-982145')
    dispatch_dock = models.CharField(max_length=50, default='DOCK-02')
    eta = models.CharField(max_length=30, default='14:35')
    dispatch_time = models.CharField(max_length=30, blank=True, default='13:18')
    delivery_time = models.CharField(max_length=30, blank=True, default='')
    status = models.CharField(max_length=50, default='Ready for Dispatch') # Delivered, Ready for Dispatch, In Transit

    class Meta:
        ordering = ['-shipment_id']

    def __str__(self):
        return f"{self.shipment_id} ({self.customer}) - {self.status}"


class ShipmentDeliveryDetail(models.Model):
    """Table 12: SHIPPING / DELIVERY DETAIL TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shipment_id = models.CharField(max_length=50, db_index=True) # SHP-000821
    customer = models.CharField(max_length=150, default='Jay')
    delivery_address = models.TextField(default='Rajahmundry')
    delivery_slot = models.CharField(max_length=50, default='14:00–15:00')
    order_value = models.CharField(max_length=30, default='₹1,245')
    payment_method = models.CharField(max_length=50, default='UPI') # UPI, COD
    payment_status = models.CharField(max_length=30, default='Paid') # Paid, Pending
    cod_amount = models.CharField(max_length=30, default='0')
    package_barcode = models.CharField(max_length=64, default='PKG890123')
    shipping_label = models.CharField(max_length=64, default='LAB-009821')
    dispatcher = models.CharField(max_length=100, default='Kiran')
    scanner_id = models.CharField(max_length=50, default='SCN-031')
    transporter = models.CharField(max_length=100, default='Internal Fleet')
    rider_id = models.CharField(max_length=50, default='DP-00152')
    rider_name = models.CharField(max_length=100, default='Suresh')
    vehicle_type = models.CharField(max_length=50, default='Bike')
    vehicle_number = models.CharField(max_length=50, default='AP05CD4521')
    route_sequence = models.IntegerField(default=1)
    dispatch_scan_time = models.CharField(max_length=30, blank=True, default='13:15')
    delivery_otp = models.CharField(max_length=30, default='Verified') # Verified, Pending
    pod = models.CharField(max_length=50, blank=True, default='POD-8921')
    failed_reason = models.CharField(max_length=150, blank=True, default='')
    return_required = models.CharField(max_length=10, default='No') # Yes, No
    status = models.CharField(max_length=50, default='Delivered') # Delivered, Ready, Returned

    class Meta:
        ordering = ['-shipment_id']

    def __str__(self):
        return f"{self.shipment_id} - Rider: {self.rider_name} [{self.status}]"


class ShippingScanHistory(models.Model):
    """Table 13: SHIPPING SCAN HISTORY TABLE"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scan_id = models.CharField(max_length=50, unique=True) # SS-00121
    shipment_id = models.CharField(max_length=50, db_index=True)
    package_id = models.CharField(max_length=50, db_index=True)
    scanner_id = models.CharField(max_length=50, default='SCN-031')
    user = models.CharField(max_length=100, default='Kiran')
    scan_type = models.CharField(max_length=50, default='Package Verification') # Package Verification, Dispatch Scan, Vehicle Assignment
    location = models.CharField(max_length=50, default='PACK-04')
    result = models.CharField(max_length=30, default='Valid')
    scan_time = models.CharField(max_length=30, default='13:10')

    class Meta:
        ordering = ['-scan_id']

    def __str__(self):
        return f"{self.scan_id}: {self.scan_type} at {self.location} ({self.result})"

