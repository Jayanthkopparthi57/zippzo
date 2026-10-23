# Supply Serializers
from rest_framework import serializers
from bounded.iam.names import display_name
from .models import Vendor, Seller, Asn, AsnLine, Grn, GrnLine, QcInspection, PutawayTask, VendorLicense, SellerCategoryApproval

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

    class Meta:
        model = Asn
        fields = ['asn_id','asn_no','type','source_vendor','source_site','dest_site','po_ref','door','slot_start',
                  'slot_end','expected_vehicle','total_lpns','total_skus','total_qty','status','created_by',
                  'created_by_name','created_at','updated_at']
        # asn_no is assigned server-side in AsnViewSet.perform_create so
        # clients POST type+dest_site only. created_by is stamped from the
        # request user the same way.
        read_only_fields = ['asn_id','asn_no','created_by','created_by_name','created_at','updated_at']

    def get_created_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.created_by)

class AsnLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = AsnLine
        fields = ['line_id','asn','line_no','sku','ean','ordered_qty','expected_expiry','line_status']
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

    class Meta:
        model = Grn
        fields = ['grn_id','grn_no','asn','mode','status','has_discrepancy','created_by','created_by_name',
                  'received_by','received_by_name','completed_at','created_at']
        # grn_no is assigned server-side in GrnViewSet.perform_create;
        # created_by/received_by are stamped from the request token.
        read_only_fields = ['grn_id','grn_no','created_by','created_by_name','received_by','received_by_name',
                            'completed_at','created_at']

    def get_created_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.created_by)

    def get_received_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.received_by)

class GrnLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = GrnLine
        fields = ['line_id','grn','asn_line','sku','ordered_qty','received_qty','accepted_qty','damaged_qty',
                  'expired_qty','excess_qty','expiry_date','mrp','lot']
        read_only_fields = ['line_id']

class QcInspectionSerializer(serializers.ModelSerializer):
    tested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = QcInspection
        fields = ['qc_id','grn_line','sample_size','pass_count','fail_count','status','remarks',
                  'tested_by','tested_by_name','tested_at']
        read_only_fields = ['qc_id','tested_by','tested_by_name']

    def get_tested_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.tested_by)

class PutawayTaskSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    confirmed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PutawayTask
        fields = ['task_id','grn_line','lpn','from_container','to_container','sku','lot','qty',
                  'suggested_bin','confirmed_bin','status','assigned_to','assigned_to_name',
                  'confirmed_by','confirmed_by_name','created_at','started_at','completed_at']
        read_only_fields = ['task_id','confirmed_by','confirmed_by_name','assigned_to_name','created_at']

    def get_assigned_to_name(self, obj):
        return display_name(self.context.get('user_map'), obj.assigned_to)

    def get_confirmed_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.confirmed_by)

class VendorLicenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = VendorLicense
        fields = ['license_id','vendor','license_type','license_number','issued_at','expires_at','verified_at','verified_by','created_at']
        read_only_fields = ['license_id','created_at']

class SellerCategoryApprovalSerializer(serializers.ModelSerializer):
    class Meta:
        model = SellerCategoryApproval
        fields = ['approval_id','seller','category','status','commission_pct','valid_from','valid_until','approved_by','approved_at','rejection_reason']
        read_only_fields = ['approval_id']
