from rest_framework import serializers
from .models import Vendor, Customer, Product, Batch

class VendorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendor
        fields = '__all__'

class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = '__all__'

class BatchSerializer(serializers.ModelSerializer):
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = Batch
        fields = [
            'id', 'product', 'product_sku', 'product_name',
            'internal_batch_id', 'vendor_batch_code', 'mfg_date',
            'expiry_date', 'currency', 'unit_cost', 'pack_cost',
            'pack_quantity', 'created_at'
        ]
        read_only_fields = ['internal_batch_id', 'created_at']

class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    active_batches = BatchSerializer(source='batches', many=True, read_only=True)

    class Meta:
        model = Product
        fields = [
            'id', 'category', 'category_name', 'sku', 'barcode',
            'name', 'description', 'hsn_code', 'uom', 'length_cm',
            'width_cm', 'height_cm', 'gross_weight_kg', 'reorder_point',
            'reorder_quantity', 'is_active', 'active_batches', 'created_at'
        ]
