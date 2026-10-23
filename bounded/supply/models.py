# Supply Chain  Vendors, Sellers, ASN, GRN, QC, Putaway
import uuid
from django.db import models


class Vendor(models.Model):
    STATUS_CHOICES = [('ACTIVE','Active'),('BLOCKED','Blocked'),('BLACKLISTED','Blacklisted')]
    vendor_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=120)
    org_entity = models.CharField(max_length=80, blank=True)
    gstin = models.CharField(max_length=15, blank=True)
    pan = models.CharField(max_length=10, blank=True)
    contact_name = models.CharField(max_length=80, blank=True)
    contact_phone = models.CharField(max_length=15, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    over_delivery_pct = models.DecimalField(max_digits=5, decimal_places=2, default=5.00)
    under_delivery_pct = models.DecimalField(max_digits=5, decimal_places=2, default=5.00)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'vendors'
        ordering = ['name']

    def __str__(self):
        return f"{self.code} - {self.name}"


class VendorLicense(models.Model):
    LICENSE_TYPE_CHOICES = [('FSSAI','FSSAI'),('DRUG','Drug'),('GSTIN','GSTIN'),('MSME','MSME'),('OTHER','Other')]
    license_id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name='licenses')
    license_type = models.CharField(max_length=20, choices=LICENSE_TYPE_CHOICES)
    license_number = models.CharField(max_length=40)
    issued_at = models.DateField()
    expires_at = models.DateField()
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'vendor_licenses'


class Seller(models.Model):
    SELLER_TYPE_CHOICES = [('INDIVIDUAL','Individual'),('PROPRIETORSHIP','Proprietorship'),
                            ('LLP','LLP'),('PVT_LTD','Pvt Ltd')]
    FULFILMENT_MODE_CHOICES = [('CONSIGNMENT_MH','Consignment MH'),('CONSIGNMENT_DS','Consignment DS'),('OUTRIGHT','Outright')]
    STATUS_CHOICES = [('DRAFT','Draft'),('SUBMITTED','Submitted'),('KYC_PENDING','KYC Pending'),
                       ('KYC_VERIFIED','KYC Verified'),('CATALOG_REVIEW','Catalog Review'),
                       ('PARTIALLY_APPROVED','Partially Approved'),('ACTIVE','Active'),
                       ('SUSPENDED','Suspended'),('BLACKLISTED','Blacklisted'),('OFFBOARDED','Offboarded')]
    seller_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, unique=True)
    legal_name = models.CharField(max_length=120)
    brand_name = models.CharField(max_length=80, blank=True)
    seller_type = models.CharField(max_length=20, choices=SELLER_TYPE_CHOICES)
    gstin = models.CharField(max_length=15, blank=True)
    pan = models.CharField(max_length=10, blank=True)
    gst_registered = models.BooleanField(default=True)
    fulfilment_mode = models.CharField(max_length=20, choices=FULFILMENT_MODE_CHOICES, default='CONSIGNMENT_MH')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    commission_default_pct = models.DecimalField(max_digits=5, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sellers'
        ordering = ['code']


class SellerCategoryApproval(models.Model):
    approval_id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    seller = models.ForeignKey(Seller, on_delete=models.CASCADE, related_name='category_approvals')
    category = models.ForeignKey('catalog.SkuCategory', on_delete=models.CASCADE, related_name='seller_approvals')
    status = models.CharField(max_length=20)
    commission_pct = models.DecimalField(max_digits=5, decimal_places=2)
    valid_from = models.DateTimeField(auto_now_add=True)
    valid_until = models.DateTimeField(null=True, blank=True)
    approved_by = models.UUIDField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)

    class Meta:
        db_table = 'seller_category_approvals'
        unique_together = [('seller', 'category')]


class Asn(models.Model):
    TYPE_CHOICES = [('VENDOR_PO','Vendor PO'),('MH_TRANSFER','MH Transfer'),('STORE_RETURN','Store Return'),('RTV_IN','RTV In')]
    STATUS_CHOICES = [('DRAFT','Draft'),('CONFIRMED','Confirmed'),('ARRIVED','Arrived'),
                       ('GRN_IN_PROGRESS','GRN In Progress'),('CLOSED','Closed'),('CANCELLED','Cancelled')]
    asn_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asn_no = models.CharField(max_length=50, unique=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    source_vendor = models.ForeignKey(Vendor, null=True, on_delete=models.SET_NULL, related_name='asns')
    source_site = models.ForeignKey('network.Site', null=True, on_delete=models.SET_NULL, related_name='outbound_asns')
    dest_site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='inbound_asns')
    po_ref = models.CharField(max_length=100, blank=True)
    door = models.ForeignKey('network.DockDoor', null=True, on_delete=models.SET_NULL, related_name='asns')
    slot_start = models.DateTimeField(null=True, blank=True)
    slot_end = models.DateTimeField(null=True, blank=True)
    expected_vehicle = models.CharField(max_length=50, blank=True)
    total_lpns = models.PositiveIntegerField(default=0)
    total_skus = models.PositiveIntegerField(default=0)
    total_qty = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'asns'
        ordering = ['-created_at']

    def __str__(self):
        return self.asn_no


class AsnLine(models.Model):
    LINE_STATUS = [('OPEN','Open'),('PARTIAL','Partial'),('RECEIVED','Received'),('SHORT','Short')]
    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asn = models.ForeignKey(Asn, on_delete=models.CASCADE, related_name='lines')
    line_no = models.PositiveSmallIntegerField()
    sku = models.ForeignKey('catalog.Sku', on_delete=models.CASCADE, related_name='asn_lines')
    ean = models.CharField(max_length=50, blank=True)
    ordered_qty = models.PositiveIntegerField()
    expected_expiry = models.DateField(null=True, blank=True)
    line_status = models.CharField(max_length=10, choices=LINE_STATUS, default='OPEN')

    class Meta:
        db_table = 'asn_lines'
        unique_together = [('asn', 'line_no')]


class Grn(models.Model):
    MODE_CHOICES = [('LPN_SCAN','LPN Scan'),('CASE_SCAN','Case Scan'),('PIECE','Piece'),('FILE','File')]
    STATUS_CHOICES = [('DRAFT','Draft'),('IN_PROGRESS','In Progress'),('COMPLETED','Completed')]
    grn_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn_no = models.CharField(max_length=50, unique=True)
    asn = models.ForeignKey(Asn, on_delete=models.CASCADE, related_name='grns')
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default='LPN_SCAN')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='DRAFT')
    has_discrepancy = models.BooleanField(default=False)
    # Attribution: created_by is stamped when the GRN is raised, received_by
    # when receiving is completed. Both server-side from the request token.
    created_by = models.UUIDField(null=True, blank=True)
    received_by = models.UUIDField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'grns'
        ordering = ['-created_at']

    def __str__(self):
        return self.grn_no


class GrnLine(models.Model):
    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn = models.ForeignKey(Grn, on_delete=models.CASCADE, related_name='lines')
    asn_line = models.ForeignKey(AsnLine, null=True, on_delete=models.SET_NULL, related_name='grn_lines')
    sku = models.ForeignKey('catalog.Sku', on_delete=models.CASCADE, related_name='grn_lines')
    ordered_qty = models.PositiveIntegerField(default=0)
    received_qty = models.PositiveIntegerField(default=0)
    accepted_qty = models.PositiveIntegerField(default=0)
    damaged_qty = models.PositiveIntegerField(default=0)
    expired_qty = models.PositiveIntegerField(default=0)
    excess_qty = models.PositiveIntegerField(default=0)
    expiry_date = models.DateField(null=True, blank=True)
    mrp = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    lot = models.ForeignKey('catalog.InventoryLot', null=True, on_delete=models.SET_NULL, related_name='grn_lines')

    class Meta:
        db_table = 'grn_lines'


class QcInspection(models.Model):
    qc_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn_line = models.ForeignKey(GrnLine, on_delete=models.CASCADE, related_name='qc')
    sample_size = models.PositiveIntegerField(default=0)
    pass_count = models.PositiveIntegerField(default=0)
    fail_count = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20)
    remarks = models.TextField(blank=True)
    tested_by = models.UUIDField(null=True, blank=True)
    tested_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'qc_inspections'
        ordering = ['-tested_at', 'qc_id']


class PutawayTask(models.Model):
    STATUS_CHOICES = [('GENERATED','Generated'),('ACCEPTED','Accepted'),('IN_PROGRESS','In Progress'),
                       ('CONFIRMED','Confirmed'),('EXCEPTION','Exception'),('HOLD_AUDIT','Hold Audit')]
    task_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn_line = models.ForeignKey(GrnLine, on_delete=models.CASCADE, related_name='putaway_tasks')
    lpn = models.ForeignKey('inventory.LpnMaster', null=True, on_delete=models.SET_NULL, related_name='putaway_tasks')
    from_container = models.CharField(max_length=30, default='QC_PASSED_STAGING')
    to_container = models.CharField(max_length=30)
    sku = models.ForeignKey('catalog.Sku', on_delete=models.CASCADE, related_name='putaway_tasks')
    lot = models.ForeignKey('catalog.InventoryLot', on_delete=models.CASCADE, related_name='putaway_lots')
    qty = models.PositiveIntegerField()
    suggested_bin = models.ForeignKey('network.Location', null=True, on_delete=models.SET_NULL, related_name='putaway_suggested')
    confirmed_bin = models.ForeignKey('network.Location', null=True, on_delete=models.SET_NULL, related_name='putaway_confirmed')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='GENERATED')
    assigned_to = models.UUIDField(null=True, blank=True)
    # Who physically shelved the stock — stamped by the complete action.
    confirmed_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    exception_reason = models.TextField(blank=True)

    class Meta:
        db_table = 'putaway_tasks'
        ordering = ['-created_at']
