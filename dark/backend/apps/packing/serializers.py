from rest_framework import serializers
from .models import PackingTask

class PackingTaskSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source='order.order_number', read_only=True)
    customer_name = serializers.CharField(source='order.customer.name', read_only=True)
    sku = serializers.CharField(source='pick_task.order_item.product.sku', read_only=True)
    product_name = serializers.CharField(source='pick_task.order_item.product.name', read_only=True)
    expected_barcode = serializers.CharField(source='pick_task.order_item.product.barcode', read_only=True)
    internal_batch_id = serializers.CharField(source='pick_task.batch.internal_batch_id', read_only=True)
    quantity_to_pack = serializers.IntegerField(source='pick_task.quantity_picked', read_only=True)
    packer_code = serializers.CharField(source='packed_by.employee_code', read_only=True)

    class Meta:
        model = PackingTask
        fields = [
            'id', 'pick_task', 'order', 'order_number', 'customer_name',
            'sku', 'product_name', 'expected_barcode', 'internal_batch_id',
            'quantity_to_pack', 'scan_verified_qty', 'packaging_type',
            'actual_weight_kg', 'status', 'error_notes', 'packer_code',
            'created_at', 'completed_at'
        ]

class PackScanItemSerializer(serializers.Serializer):
    scanned_barcode = serializers.CharField()
    box_type = serializers.CharField(required=False, default='Standard Box')
    actual_weight_kg = serializers.DecimalField(max_digits=8, decimal_places=3, required=False)
