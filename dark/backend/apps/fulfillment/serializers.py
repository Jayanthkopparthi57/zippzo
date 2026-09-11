from rest_framework import serializers
from .models import SalesOrder, OrderItem, PickWave, PickTask

class OrderItemSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source='product.sku', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    barcode = serializers.CharField(source='product.barcode', read_only=True)
    remaining_qty = serializers.ReadOnlyField()

    class Meta:
        model = OrderItem
        fields = [
            'id', 'product', 'sku', 'product_name', 'barcode',
            'requested_qty', 'allocated_qty', 'picked_qty', 'shipped_qty',
            'remaining_qty', 'unit_price'
        ]

class SalesOrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)

    class Meta:
        model = SalesOrder
        fields = [
            'id', 'order_number', 'customer', 'customer_name',
            'warehouse', 'warehouse_name', 'shipping_address',
            'city', 'pincode', 'order_date', 'delivery_deadline',
            'priority', 'status', 'items', 'created_at'
        ]
        read_only_fields = ['order_number', 'created_at']

    def create(self, validated_data):
        items_data = self.context.get('request').data.get('items', []) if self.context.get('request') else []
        order = SalesOrder.objects.create(**validated_data)
        for item_data in items_data:
            prod_id = item_data.get('product') or item_data.get('product_id')
            OrderItem.objects.create(
                order=order,
                product_id=prod_id,
                requested_qty=item_data['requested_qty'],
                unit_price=item_data.get('unit_price', 0.00)
            )
        return order

class PickTaskSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source='order_item.product.sku', read_only=True)
    product_name = serializers.CharField(source='order_item.product.name', read_only=True)
    product_barcode = serializers.CharField(source='order_item.product.barcode', read_only=True)
    internal_batch_id = serializers.CharField(source='batch.internal_batch_id', read_only=True)
    expiry_date = serializers.DateField(source='batch.expiry_date', read_only=True)
    bin_code = serializers.CharField(source='source_location.bin_code', read_only=True)
    location_barcode = serializers.CharField(source='source_location.barcode_label', read_only=True)
    aisle = serializers.CharField(source='source_location.aisle', read_only=True)
    rack = serializers.CharField(source='source_location.rack_number', read_only=True)
    shelf = serializers.CharField(source='source_location.shelf_level', read_only=True)
    order_number = serializers.CharField(source='order_item.order.order_number', read_only=True)
    assigned_employee_code = serializers.CharField(source='assigned_employee.employee_code', read_only=True)

    class Meta:
        model = PickTask
        fields = [
            'id', 'wave', 'order_item', 'order_number', 'sku', 'product_name',
            'product_barcode', 'internal_batch_id', 'expiry_date', 'source_location',
            'bin_code', 'location_barcode', 'aisle', 'rack', 'shelf',
            'assigned_employee', 'assigned_employee_code', 'quantity_to_pick',
            'quantity_picked', 'sequence_route_order', 'status', 'exception_reason',
            'created_at', 'completed_at'
        ]

class PickWaveSerializer(serializers.ModelSerializer):
    tasks = PickTaskSerializer(many=True, read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)

    class Meta:
        model = PickWave
        fields = ['id', 'wave_number', 'warehouse', 'warehouse_name', 'strategy', 'status', 'tasks', 'created_at']

class ScanVerifySerializer(serializers.Serializer):
    location_barcode = serializers.CharField()
    product_barcode = serializers.CharField()
    picked_qty = serializers.IntegerField(min_value=1)

class PickExceptionSerializer(serializers.Serializer):
    exception_reason = serializers.ChoiceField(choices=[
        ('damaged_stock', 'Damaged Stock in Bin'),
        ('bin_empty', 'Bin is Empty / Stock Discrepancy'),
        ('wrong_barcode', 'Item Barcode Mismatch'),
        ('expired_stock', 'Stock Expired'),
    ])
    notes = serializers.CharField(required=False, allow_blank=True)
