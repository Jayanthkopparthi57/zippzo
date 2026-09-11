from rest_framework import serializers
from .models import SAPInboundDelivery, SAPInboundLineItem, SAPSyncLog
from apps.catalog.serializers import ProductSerializer

class SAPInboundLineItemSerializer(serializers.ModelSerializer):
    product_details = ProductSerializer(source='product', read_only=True)
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_barcode = serializers.CharField(source='product.barcode', read_only=True)

    class Meta:
        model = SAPInboundLineItem
        fields = [
            'id', 'sap_item_number', 'product', 'product_details', 'product_sku',
            'product_name', 'product_barcode', 'expected_qty', 'received_qty',
            'passed_qty', 'damaged_qty', 'vendor_batch_code', 'mfg_date',
            'expiry_date', 'unit_price', 'suggested_putaway_bin', 'is_received'
        ]

class SAPInboundDeliverySerializer(serializers.ModelSerializer):
    items = SAPInboundLineItemSerializer(many=True, read_only=True)
    destination_warehouse_code = serializers.CharField(source='destination_warehouse.code', read_only=True)
    destination_warehouse_name = serializers.CharField(source='destination_warehouse.name', read_only=True)

    class Meta:
        model = SAPInboundDelivery
        fields = [
            'id', 'sap_delivery_number', 'po_reference', 'source_plant',
            'destination_warehouse', 'destination_warehouse_code', 'destination_warehouse_name',
            'vehicle_number', 'driver_name', 'driver_contact', 'expected_arrival',
            'status', 'total_line_items', 'total_expected_units', 'total_received_units',
            'sap_gr_document_number', 'created_at', 'updated_at', 'items'
        ]

class SAPSyncLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SAPSyncLog
        fields = '__all__'
