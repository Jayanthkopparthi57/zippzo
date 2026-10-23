# Catalog Serializers
from rest_framework import serializers
from .models import SkuCategory, Sku, SkuBarcode, Listing, InventoryLot, Coupon, ProductReview, WishlistItem

class SkuCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SkuCategory
        fields = ['category_id', 'name', 'parent']
        read_only_fields = ['category_id']

class SkuSerializer(serializers.ModelSerializer):
    category_name = serializers.SerializerMethodField()

    class Meta:
        model = Sku
        fields = ['sku_id','sku_code','name','ean','category','category_name','sub_category','brand','pack_size',
                  'base_uom','storage_zone','shelf_life_days','is_food','is_hazardous','is_catch_weight',
                  'is_serialized','is_age_restricted','min_age_years','mrp','hsn_code','weight_g','image_url',
                  'status','created_at']
        read_only_fields = ['sku_id','created_at']

    def get_category_name(self, obj):
        """The list screen shows the taxonomy name, not the category UUID."""
        return obj.category.name if obj.category_id else None

class SkuBarcodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SkuBarcode
        fields = ['barcode','symbology','sku','pack_level','qty_in_base','is_primary','is_active']
        read_only_fields = []

class ListingSerializer(serializers.ModelSerializer):
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = Listing
        fields = ['listing_id','sku','sku_code','sku_name','site','site_code','price','mrp','discount_pct',
                  'is_listed','is_available','low_stock_threshold','updated_at']
        read_only_fields = ['listing_id']

class InventoryLotSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryLot
        fields = ['lot_id','sku','site','batch_number','mfg_date','expiry_date','mrp','box_size',
                  'inbound_type','inbound_ref','source_site','source_vendor_id','bucket','status','created_at']
        read_only_fields = ['lot_id','created_at']

class CouponSerializer(serializers.ModelSerializer):
    class Meta:
        model = Coupon
        fields = ['coupon_id','code','title','description','discount_type','discount_value',
                  'min_order','max_discount','valid_from','valid_until','is_active']
        read_only_fields = ['coupon_id','created_at']

class ProductReviewSerializer(serializers.ModelSerializer):
    customer_name = serializers.SerializerMethodField()
    class Meta:
        model = ProductReview
        fields = ['review_id','sku','customer','customer_name','rating','comment','created_at']
        read_only_fields = ['review_id','customer','created_at']
    def get_customer_name(self, obj):
        return obj.customer.name or 'Anonymous'

class WishlistItemSerializer(serializers.ModelSerializer):
    sku_detail = SkuSerializer(source='sku', read_only=True)
    class Meta:
        model = WishlistItem
        fields = ['wishlist_id','customer','sku','sku_detail','created_at']
        read_only_fields = ['wishlist_id','customer','created_at']
