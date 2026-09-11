from rest_framework import serializers
from .models import Shipment, ShipmentManifest

class ShipmentSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source='order.order_number', read_only=True)
    customer_name = serializers.CharField(source='order.customer.name', read_only=True)
    shipping_address = serializers.CharField(source='order.shipping_address', read_only=True)
    city = serializers.CharField(source='order.city', read_only=True)
    pincode = serializers.CharField(source='order.pincode', read_only=True)

    class Meta:
        model = Shipment
        fields = [
            'id', 'order', 'order_number', 'customer_name', 'shipping_address',
            'city', 'pincode', 'shipment_number', 'package_weight_kg',
            'package_dimensions', 'logistics_partner', 'tracking_number',
            'shipping_label_url', 'delivery_eta', 'status', 'created_at'
        ]
        read_only_fields = ['shipment_number', 'tracking_number', 'created_at']

class CreateShipmentLabelSerializer(serializers.Serializer):
    order_id = serializers.UUIDField()
    package_weight_kg = serializers.DecimalField(max_digits=8, decimal_places=3)
    package_dimensions = serializers.JSONField(required=False, default=dict)
    logistics_partner = serializers.ChoiceField(choices=[
        ('FedEx', 'FedEx'),
        ('DHL', 'DHL Express'),
        ('BlueDart', 'BlueDart'),
        ('Delhivery', 'Delhivery'),
        ('Self_Fleet', 'Company Fleet')
    ], default='FedEx')

class ShipmentManifestSerializer(serializers.ModelSerializer):
    shipment_details = ShipmentSerializer(source='shipments', many=True, read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = ShipmentManifest
        fields = [
            'id', 'manifest_number', 'logistics_partner', 'driver_name',
            'vehicle_number', 'driver_phone', 'total_packages', 'departure_time',
            'created_by', 'created_by_name', 'shipments', 'shipment_details'
        ]
        read_only_fields = ['manifest_number', 'total_packages', 'departure_time']

class CreateManifestSerializer(serializers.Serializer):
    shipment_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    logistics_partner = serializers.CharField()
    driver_name = serializers.CharField()
    vehicle_number = serializers.CharField()
    driver_phone = serializers.CharField(required=False, allow_blank=True)
