from rest_framework import serializers
from .models import Inventory, InventoryTransaction

class InventorySerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source='batch.product.sku', read_only=True)
    product_name = serializers.CharField(source='batch.product.name', read_only=True)
    internal_batch_id = serializers.CharField(source='batch.internal_batch_id', read_only=True)
    vendor_batch_code = serializers.CharField(source='batch.vendor_batch_code', read_only=True)
    expiry_date = serializers.DateField(source='batch.expiry_date', read_only=True)
    unit_cost = serializers.DecimalField(source='batch.unit_cost', max_digits=12, decimal_places=2, read_only=True)
    bin_code = serializers.CharField(source='location.bin_code', read_only=True)
    zone_name = serializers.CharField(source='location.zone.name', read_only=True)
    zone_type = serializers.CharField(source='location.zone.zone_type', read_only=True)
    available_qty = serializers.ReadOnlyField()

    class Meta:
        model = Inventory
        fields = [
            'id', 'warehouse', 'batch', 'sku', 'product_name',
            'internal_batch_id', 'vendor_batch_code', 'expiry_date',
            'unit_cost', 'location', 'bin_code', 'zone_name',
            'zone_type', 'quantity_on_hand', 'quantity_reserved',
            'available_qty', 'status', 'updated_at'
        ]

class InventoryTransactionSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source='batch.product.sku', read_only=True)
    internal_batch_id = serializers.CharField(source='batch.internal_batch_id', read_only=True)
    source_bin = serializers.CharField(source='source_location.bin_code', read_only=True)
    dest_bin = serializers.CharField(source='dest_location.bin_code', read_only=True)
    user_name = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = InventoryTransaction
        fields = [
            'id', 'warehouse', 'batch', 'sku', 'internal_batch_id',
            'source_location', 'source_bin', 'dest_location', 'dest_bin',
            'transaction_type', 'quantity', 'reference_doc_type',
            'reference_doc_id', 'user', 'user_name', 'notes', 'created_at'
        ]

class StockTransferSerializer(serializers.Serializer):
    batch_id = serializers.UUIDField()
    from_location_id = serializers.UUIDField()
    to_location_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1)
    notes = serializers.CharField(required=False, allow_blank=True)
