from rest_framework import serializers
from .models import ReturnOrder, ReturnItem

class ReturnItemSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source='product.sku', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    target_bin = serializers.CharField(source='target_location.bin_code', read_only=True)

    class Meta:
        model = ReturnItem
        fields = [
            'id', 'product', 'sku', 'product_name', 'batch', 'returned_qty',
            'inspection_result', 'target_location', 'target_bin', 'refund_amount'
        ]

class ReturnOrderSerializer(serializers.ModelSerializer):
    items = ReturnItemSerializer(many=True, required=False)
    order_number = serializers.CharField(source='order.order_number', read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)

    class Meta:
        model = ReturnOrder
        fields = [
            'id', 'rma_number', 'order', 'order_number', 'customer',
            'customer_name', 'reason', 'status', 'tracking_number',
            'created_at', 'items'
        ]
        read_only_fields = ['rma_number', 'created_at']

    def create(self, validated_data):
        items_data = self.context.get('request').data.get('items', [])
        rma = ReturnOrder.objects.create(**validated_data)
        for itm in items_data:
            ReturnItem.objects.create(
                rma=rma,
                product_id=itm['product_id'],
                batch_id=itm['batch_id'],
                returned_qty=itm['returned_qty'],
                refund_amount=itm.get('refund_amount', 0.00)
            )
        return rma

class RMAInspectItemSerializer(serializers.Serializer):
    return_item_id = serializers.UUIDField()
    inspection_result = serializers.ChoiceField(choices=[
        ('restockable', 'Restockable'),
        ('damaged_scrap', 'Damaged Scrap'),
        ('refurbish', 'Refurbish')
    ])
    target_location_id = serializers.UUIDField()

class RMAInspectionSerializer(serializers.Serializer):
    items = RMAInspectItemSerializer(many=True)
