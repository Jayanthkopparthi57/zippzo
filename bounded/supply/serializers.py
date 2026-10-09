# Supply Serializers
from rest_framework import serializers
from .models import Vendor, Seller, Asn, AsnLine, Grn, GrnLine, QcInspection, PutawayTask, VendorLicense, SellerCategoryApproval

class VendorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendor
        fields = ['vendor_id','code','name','org_entity','gstin','contact_name','contact_phone','email','address',
                  'over_delivery_pct','under_delivery_pct','status','created_at']
        read_only_fields = ['vendor_id','created_at']

class SellerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Seller
        fields = ['seller_id','code','legal_name','brand_name','seller_type','gstin','fulfilment_mode','status',
                  'commission_default_pct','created_at']
        read_only_fields = ['seller_id','created_at']

class AsnSerializer(serializers.ModelSerializer):
    class Meta:
        model = Asn
        fields = ['asn_id','asn_no','type','source_vendor','source_site','dest_site','po_ref','door','slot_start',
                  'slot_end','expected_vehicle','total_lpns','total_skus','total_qty','status','created_at','updated_at']
        read_only_fields = ['asn_id','created_at','updated_at']

class AsnLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = AsnLine
        fields = ['line_id','asn','line_no','sku','ean','ordered_qty','expected_expiry','line_status']
        read_only_fields = ['line_id']

class GrnSerializer(serializers.ModelSerializer):
    class Meta:
        model = Grn
        fields = ['grn_id','grn_no','asn','mode','status','has_discrepancy','received_by','completed_at','created_at']
        read_only_fields = ['grn_id','created_at']

class GrnLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = GrnLine
        fields = ['line_id','grn','asn_line','sku','ordered_qty','received_qty','accepted_qty','damaged_qty',
                  'expired_qty','excess_qty','expiry_date','mrp','lot']
        read_only_fields = ['line_id']

class QcInspectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QcInspection
        fields = ['qc_id','grn_line','sample_size','pass_count','fail_count','status','remarks','tested_by','tested_at']
        read_only_fields = ['qc_id']

class PutawayTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = PutawayTask
        fields = ['task_id','grn_line','lpn','from_container','to_container','sku','lot','qty',
                  'suggested_bin','confirmed_bin','status','assigned_to','created_at','started_at','completed_at']
        read_only_fields = ['task_id','created_at']

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
