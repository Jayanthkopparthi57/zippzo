from rest_framework import serializers
from .models import PurchaseOrder, PurchaseOrderItem, GoodsReceiptNote, GRNItem

class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source='product.sku', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = PurchaseOrderItem
        fields = ['id', 'product', 'sku', 'product_name', 'ordered_qty', 'received_qty', 'unit_price']

class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True, required=False)
    vendor_name = serializers.CharField(source='vendor.name', read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            'id', 'po_number', 'warehouse', 'warehouse_name', 'vendor',
            'vendor_name', 'status', 'order_date', 'expected_delivery_date',
            'currency', 'total_amount', 'created_by', 'created_at', 'items'
        ]
        read_only_fields = ['po_number', 'created_at']

    def create(self, validated_data):
        items_data = self.context.get('request').data.get('items', [])
        po = PurchaseOrder.objects.create(**validated_data)
        total = 0
        for item_data in items_data:
            item = PurchaseOrderItem.objects.create(
                po=po,
                product_id=item_data['product_id'],
                ordered_qty=item_data['ordered_qty'],
                unit_price=item_data.get('unit_price', 0.00)
            )
            total += (item.ordered_qty * float(item.unit_price))
        po.total_amount = total
        po.save()
        return po

class GRNItemSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source='product.sku', read_only=True)
    internal_batch_id = serializers.CharField(source='batch.internal_batch_id', read_only=True)
    quarantine_bin = serializers.CharField(source='quarantine_location.bin_code', read_only=True)
    putaway_bin = serializers.CharField(source='putaway_location.bin_code', read_only=True)

    class Meta:
        model = GRNItem
        fields = [
            'id', 'po_item', 'product', 'sku', 'batch', 'internal_batch_id',
            'received_qty', 'passed_qty', 'rejected_qty', 'quarantine_location',
            'quarantine_bin', 'putaway_location', 'putaway_bin', 'damaged_photos_url', 'qc_notes'
        ]

class GoodsReceiptNoteSerializer(serializers.ModelSerializer):
    items = GRNItemSerializer(many=True, read_only=True)
    po_number = serializers.CharField(source='po.po_number', read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    receiver_code = serializers.CharField(source='received_by.employee_code', read_only=True)

    class Meta:
        model = GoodsReceiptNote
        fields = [
            'id', 'grn_number', 'po', 'po_number', 'warehouse',
            'warehouse_name', 'received_by', 'receiver_code',
            'receipt_date', 'vehicle_number', 'driver_phone',
            'status', 'items'
        ]
        read_only_fields = ['grn_number', 'receipt_date']

class QCInspectionItemSerializer(serializers.Serializer):
    grn_item_id = serializers.UUIDField()
    passed_qty = serializers.IntegerField(min_value=0)
    rejected_qty = serializers.IntegerField(min_value=0, default=0)
    putaway_location_id = serializers.UUIDField(required=False, allow_null=True)
    damaged_photos_url = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    qc_notes = serializers.CharField(required=False, allow_blank=True)

class QCInspectionSerializer(serializers.Serializer):
    items = QCInspectionItemSerializer(many=True)
