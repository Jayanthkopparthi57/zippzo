from rest_framework import serializers
from .models import Warehouse, Category, Zone, Location, LocationActivityLog

class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = '__all__'

class CategorySerializer(serializers.ModelSerializer):
    subcategories = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ['id', 'warehouse', 'code', 'name', 'parent_category', 'subcategories', 'is_active', 'created_at']

    def get_subcategories(self, obj):
        if hasattr(obj, 'subcategories'):
            return CategorySerializer(obj.subcategories.filter(is_active=True), many=True).data
        return []

class ZoneSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)

    class Meta:
        model = Zone
        fields = ['id', 'warehouse', 'warehouse_name', 'code', 'name', 'zone_type', 'is_active']

class LocationSerializer(serializers.ModelSerializer):
    zone_name = serializers.CharField(source='zone.name', read_only=True)
    zone_type = serializers.CharField(source='zone.zone_type', read_only=True)
    warehouse_id = serializers.UUIDField(source='zone.warehouse.id', read_only=True)

    class Meta:
        model = Location
        fields = [
            'id', 'zone', 'zone_name', 'zone_type', 'warehouse_id',
            'aisle', 'rack_number', 'shelf_level', 'bin_code',
            'barcode_label', 'max_weight_kg', 'max_volume_cbm',
            'is_occupied', 'is_blocked'
        ]

class LocationActivityLogSerializer(serializers.ModelSerializer):
    bin_code = serializers.CharField(source='location.bin_code', read_only=True)

    class Meta:
        model = LocationActivityLog
        fields = ['id', 'location', 'bin_code', 'activity_type', 'quantity', 'timestamp']
