import uuid
from django.db import models
from django.utils import timezone
from apps.master_data.models import Warehouse
from apps.catalog.models import Product, Batch
from apps.receiving.models import PurchaseOrder

class SAPDocumentTypeChoices(models.TextChoices):
    ASN = 'ASN', 'Advanced Shipping Notice (Inbound Delivery)'
    STO = 'STO', 'Stock Transfer Order'
    PO = 'PO', 'Purchase Order'
    GR_POSTING = 'GR_POSTING', 'Goods Receipt Posting (101)'

class SAPSyncStatusChoices(models.TextChoices):
    PENDING = 'PENDING', 'Pending Inward'
    IN_PROGRESS = 'IN_PROGRESS', 'Receiving & QC in Progress'
    COMPLETED = 'COMPLETED', 'Completed & Posted to SAP'
    FAILED = 'FAILED', 'Sync Failed'

class SAPInboundDelivery(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sap_delivery_number = models.CharField(max_length=50, unique=True, help_text="SAP Inbound Delivery # (e.g. 800192831)")
    po_reference = models.CharField(max_length=50, blank=True, null=True, help_text="SAP PO or STO Number")
    source_plant = models.CharField(max_length=50, default='PLANT-1000 (Central Mother Hub)')
    destination_warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='sap_inbound_deliveries')
    vehicle_number = models.CharField(max_length=50, blank=True, null=True)
    driver_name = models.CharField(max_length=100, blank=True, null=True)
    driver_contact = models.CharField(max_length=30, blank=True, null=True)
    expected_arrival = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=30, choices=SAPSyncStatusChoices.choices, default=SAPSyncStatusChoices.PENDING)
    total_line_items = models.IntegerField(default=0)
    total_expected_units = models.IntegerField(default=0)
    total_received_units = models.IntegerField(default=0)
    sap_gr_document_number = models.CharField(max_length=50, blank=True, null=True, help_text="SAP Material Document # upon 101 posting")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-expected_arrival']
        verbose_name = 'SAP Inbound Delivery'
        verbose_name_plural = 'SAP Inbound Deliveries'

    def __str__(self):
        return f"SAP Inbound {self.sap_delivery_number} [{self.source_plant} -> {self.destination_warehouse.code}] - {self.status}"

class SAPInboundLineItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    delivery = models.ForeignKey(SAPInboundDelivery, on_delete=models.CASCADE, related_name='items')
    sap_item_number = models.CharField(max_length=10, default='000010')
    product = models.ForeignKey(Product, on_delete=models.RESTRICT, related_name='sap_inbound_items')
    expected_qty = models.IntegerField()
    received_qty = models.IntegerField(default=0)
    passed_qty = models.IntegerField(default=0)
    damaged_qty = models.IntegerField(default=0)
    vendor_batch_code = models.CharField(max_length=100, blank=True, null=True)
    mfg_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    suggested_putaway_bin = models.CharField(max_length=50, blank=True, null=True)
    is_received = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.delivery.sap_delivery_number} | {self.product.sku} ({self.received_qty}/{self.expected_qty})"

class SAPSyncLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document_type = models.CharField(max_length=30, choices=SAPDocumentTypeChoices.choices)
    reference_id = models.CharField(max_length=100)
    payload_sent = models.JSONField(default=dict, blank=True)
    response_received = models.JSONField(default=dict, blank=True)
    http_status_code = models.IntegerField(default=200)
    is_successful = models.BooleanField(default=True)
    timestamp = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"SAP {self.document_type} [{self.reference_id}] - {'SUCCESS' if self.is_successful else 'FAILED'}"
