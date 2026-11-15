# Supply Serializers
from rest_framework import serializers
from bounded.iam.names import display_name
from .models import Vendor, Seller, Asn, AsnLine, Grn, GrnLine, DockDiscrepancy, QcInspection, PutawayTask, PutawayStrategy, VendorLicense, SellerCategoryApproval

class VendorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendor
        fields = ['vendor_id','code','name','org_entity','gstin','pan','contact_name','contact_phone','email','address',
                  'over_delivery_pct','under_delivery_pct','status','created_at']
        read_only_fields = ['vendor_id','created_at']

class SellerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Seller
        fields = ['seller_id','code','legal_name','brand_name','seller_type','gstin','fulfilment_mode','status',
                  'commission_default_pct','created_at']
        read_only_fields = ['seller_id','created_at']

class AsnSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    # Joined labels. The dashboard lists the vendor and the sending site next to
    # the ASN number; exposing only the UUIDs forced the UI to render blanks.
    # Method fields rather than `source=` because both FKs are nullable and a
    # nested `getattr` on None would raise.
    source_vendor_name = serializers.SerializerMethodField()
    source_vendor_code = serializers.SerializerMethodField()
    source_site_code = serializers.SerializerMethodField()
    dest_site_code = serializers.SerializerMethodField()
    # The bundle builder renders the declared SKUs/packs straight from the
    # consignment. Nested read-only lines keep the detail drawer and the
    # receive wizard to one request instead of a second ?asn= lookup.
    lines = serializers.SerializerMethodField()

    class Meta:
        model = Asn
        fields = ['asn_id','asn_no','type','source_vendor','source_site','dest_site','po_ref','package_type','door','slot_start',
                  'slot_end','expected_vehicle','total_lpns','total_skus','total_qty','status','created_by',
                  'created_by_name','source_vendor_name','source_vendor_code','source_site_code','dest_site_code',
                  'lines','created_at','updated_at']
        # asn_no is assigned server-side in AsnViewSet.perform_create so
        # clients POST type+dest_site only. created_by is stamped from the
        # request user the same way.
        read_only_fields = ['asn_id','asn_no','created_by','created_by_name','created_at','updated_at']

    def get_created_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.created_by)

    def get_source_vendor_name(self, obj):
        return obj.source_vendor.name if obj.source_vendor_id else None

    def get_source_vendor_code(self, obj):
        return obj.source_vendor.code if obj.source_vendor_id else None

    def get_source_site_code(self, obj):
        return obj.source_site.code if obj.source_site_id else None

    def get_dest_site_code(self, obj):
        return obj.dest_site.code if obj.dest_site_id else None

    def get_lines(self, obj):
        return [
            {
                'line_id': str(line.line_id),
                'line_no': line.line_no,
                'sku': str(line.sku_id),
                'sku_code': line.sku.sku_code if line.sku_id else '',
                'sku_name': line.sku.name if line.sku_id else '',
                'ean': line.ean,
                'ordered_qty': line.ordered_qty,
                'line_status': line.line_status,
            }
            for line in obj.lines.all()
        ]

class AsnLineSerializer(serializers.ModelSerializer):
    # The ASN detail drawer lists product name/code, not the SKU UUID.
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)

    class Meta:
        model = AsnLine
        fields = ['line_id','asn','line_no','sku','sku_code','sku_name','ean','ordered_qty',
                  'expected_expiry','line_status']
        read_only_fields = ['line_id','line_no']

    def validate(self, attrs):
        """line_no is server-assigned: next integer within the ASN.

        Clients POST asn+sku+ean+ordered_qty. Handing them a required
        line_no meant every create request 400'd, so the line-add step of
        the receive wizard was dead UI too.
        """
        if attrs.get('line_no') is None and attrs.get('asn'):
            from django.db.models import Max
            last = (AsnLine.objects.filter(asn=attrs['asn'])
                    .aggregate(m=Max('line_no'))['m'])
            attrs['line_no'] = (last or 0) + 1
        return attrs

class GrnSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    received_by_name = serializers.SerializerMethodField()
    # The receiving table is read by an operator: the ASN number and the
    # destination site are the two identifiers they search on, and both were
    # previously rendered blank because only the UUIDs were exposed.
    asn_no = serializers.CharField(source='asn.asn_no', read_only=True)
    dest_site_code = serializers.CharField(source='asn.dest_site.code', read_only=True)

    class Meta:
        model = Grn
        fields = ['grn_id','grn_no','asn','asn_no','dest_site_code','mode','batch_code','status',
                  'has_discrepancy','created_by','created_by_name',
                  'received_by','received_by_name','manual_entry_by','manual_entry_reason','manual_entry_at',
                  'completed_at','created_at']
        # grn_no is assigned server-side in GrnViewSet.perform_create;
        # created_by/received_by are stamped from the request token. The manual
        # entry columns are written by the labelled-exception action only.
        read_only_fields = ['grn_id','grn_no','created_by','created_by_name','received_by','received_by_name',
                            'manual_entry_by','manual_entry_at',
                            'completed_at','created_at']

    def get_created_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.created_by)

    def get_received_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.received_by)

class GrnLineSerializer(serializers.ModelSerializer):
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    grn_no = serializers.CharField(source='grn.grn_no', read_only=True)

    class Meta:
        model = GrnLine
        fields = ['line_id','grn','grn_no','asn_line','sku','sku_code','sku_name','ordered_qty','received_qty','accepted_qty','damaged_qty',
                  'expired_qty','excess_qty','expiry_date','mrp','lot']
        read_only_fields = ['line_id']


class DockDiscrepancySerializer(serializers.ModelSerializer):
    grn_no = serializers.CharField(source='grn.grn_no', read_only=True)
    asn_no = serializers.CharField(source='grn.asn.asn_no', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    lot_number = serializers.CharField(source='lot.batch_number', read_only=True)
    created_by_email = serializers.CharField(source='created_by.email', read_only=True)
    resolved_by_email = serializers.CharField(source='resolved_by.email', read_only=True)

    class Meta:
        model = DockDiscrepancy
        fields = [
            'discrepancy_id','code','grn','grn_no','asn_no','grn_line','site','site_code',
            'sku','sku_code','sku_name','lot','lot_number','discrepancy_type','status',
            'expected_qty','received_qty','accepted_qty','damaged_qty','expired_qty',
            'excess_qty','shortage_qty','reason_code','remarks','created_by','created_by_email',
            'resolved_by','resolved_by_email','resolved_at','created_at','updated_at',
        ]
        read_only_fields = [
            'discrepancy_id','grn_no','asn_no','site_code','sku_code','sku_name',
            'lot_number','created_by','created_by_email','resolved_by','resolved_by_email',
            'resolved_at','created_at','updated_at',
        ]

    def validate(self, attrs):
        expected = attrs.get('expected_qty', getattr(self.instance, 'expected_qty', 0) or 0)
        received = attrs.get('received_qty', getattr(self.instance, 'received_qty', 0) or 0)
        shortage = max(0, int(expected) - int(received))
        if attrs.get('shortage_qty') is None and 'shortage_qty' not in attrs:
            attrs['shortage_qty'] = shortage
        return attrs

class QcInspectionSerializer(serializers.ModelSerializer):
    tested_by_name = serializers.SerializerMethodField()
    # Receiving-exception rows need the consignment and the product they
    # describe; an inspection row keyed only by grn_line UUID is unusable.
    grn_no = serializers.CharField(source='grn_line.grn.grn_no', read_only=True)
    asn_no = serializers.CharField(source='grn_line.grn.asn.asn_no', read_only=True)
    sku_code = serializers.CharField(source='grn_line.sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='grn_line.sku.name', read_only=True)
    sku_ean = serializers.CharField(source='grn_line.sku.ean', read_only=True)
    received_qty = serializers.IntegerField(source='grn_line.received_qty', read_only=True)

    class Meta:
        model = QcInspection
        fields = ['qc_id','grn_line','grn_no','asn_no','sku_code','sku_name','sku_ean','received_qty','sample_size',
                  'pass_count','fail_count','status','remarks',
                  'tested_by','tested_by_name','tested_at']
        read_only_fields = ['qc_id','tested_by','tested_by_name']

    def get_tested_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.tested_by)

class PutawayTaskSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    confirmed_by_name = serializers.SerializerMethodField()
    remaining_qty = serializers.IntegerField(read_only=True)
    site_id = serializers.SerializerMethodField()
    site_code = serializers.SerializerMethodField()
    # Read-model labels for the putaway queue. The task carries FKs to the
    # SKU, lot, GRN and bin; a planner needs those names, not UUIDs.
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    category_name = serializers.CharField(source='sku.category.name', read_only=True, default=None)
    storage_zone = serializers.CharField(source='sku.storage_zone', read_only=True, default=None)
    lot_number = serializers.CharField(source='lot.batch_number', read_only=True)
    grn_no = serializers.CharField(source='grn_line.grn.grn_no', read_only=True)
    asn_no = serializers.CharField(source='grn_line.grn.asn.asn_no', read_only=True)
    to_bin_code = serializers.SerializerMethodField()

    class Meta:
        model = PutawayTask
        fields = ['task_id','grn_line','grn_no','asn_no','lpn','from_container','to_container',
                  'sku','sku_code','sku_name','category_name','storage_zone','lot','lot_number','qty','placed_qty',
                  'remaining_qty','suggested_bin','confirmed_bin','to_bin_code','status','site_id','site_code',
                  'assigned_to','assigned_to_name','confirmed_by','confirmed_by_name',
                  'created_at','started_at','completed_at']
        read_only_fields = ['task_id','placed_qty','remaining_qty','confirmed_by','confirmed_by_name',
                            'assigned_to_name','created_at']

    def _site(self, obj):
        line = getattr(obj, 'grn_line', None)
        grn = getattr(line, 'grn', None) if line else None
        asn = getattr(grn, 'asn', None) if grn else None
        return getattr(asn, 'dest_site', None) if asn else None

    def get_site_id(self, obj):
        site = self._site(obj)
        return str(site.site_id) if site else None

    def get_site_code(self, obj):
        site = self._site(obj)
        return site.code if site else ''

    def get_to_bin_code(self, obj):
        bin_obj = obj.confirmed_bin or obj.suggested_bin
        return bin_obj.barcode if bin_obj else obj.to_container or ''

    def get_assigned_to_name(self, obj):
        return display_name(self.context.get('user_map'), obj.assigned_to)

    def get_confirmed_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.confirmed_by)

class VendorLicenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = VendorLicense
        fields = ['license_id','vendor','license_type','license_number','issued_at','expires_at','verified_at','verified_by','created_at']
        read_only_fields = ['license_id','created_at']


class PutawayStrategySerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    zone_code = serializers.CharField(source='zone.code', read_only=True)

    class Meta:
        model = PutawayStrategy
        fields = '__all__'
        read_only_fields = ['strategy_id', 'site_code', 'sku_code', 'zone_code', 'created_at', 'updated_at']

    def validate(self, attrs):
        site = attrs.get('site', getattr(self.instance, 'site', None))
        zone = attrs.get('zone', getattr(self.instance, 'zone', None))
        if site and zone and zone.site_id != site.site_id:
            raise serializers.ValidationError({'zone': 'Strategy zone must belong to the selected site.'})
        return attrs


class SellerCategoryApprovalSerializer(serializers.ModelSerializer):
    class Meta:
        model = SellerCategoryApproval
        fields = ['approval_id','seller','category','status','commission_pct','valid_from','valid_until','approved_by','approved_at','rejection_reason']
        read_only_fields = ['approval_id']
