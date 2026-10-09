# Catalog Serializers
from rest_framework import serializers
from .models import SkuCategory, Sku, SkuBarcode, Listing, InventoryLot

class SkuCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SkuCategory
        fields = ['category_id', 'name', 'parent']
        read_only_fields = ['category_id']

class SkuSerializer(serializers.ModelSerializer):
    class Meta:
        model = Sku
        fields = ['sku_id','sku_code','name','ean','category','sub_category','brand','pack_size','base_uom',
                  'storage_zone','shelf_life_days','is_food','is_hazardous','is_catch_weight','is_serialized',
                  'is_age_restricted','min_age_years','mrp','hsn_code','weight_g','status','created_at']
        read_only_fields = ['sku_id','created_at']

class SkuBarcodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SkuBarcode
        fields = ['barcode','symbology','sku','pack_level','qty_in_base','is_primary','is_active']
        read_only_fields = []

class ListingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Listing
        fields = ['listing_id','sku','site','price','mrp','discount_pct','is_listed','is_available','low_stock_threshold','updated_at']
        read_only_fields = ['listing_id']

class InventoryLotSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryLot
        fields = ['lot_id','sku','site','batch_number','mfg_date','expiry_date','mrp','box_size',
                  'inbound_type','inbound_ref','source_site','source_vendor_id','bucket','status','created_at']
        read_only_fields = ['lot_id','created_at']
