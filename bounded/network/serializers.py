# Network Serializers
from rest_framework import serializers
from .models import Site, Location, Zone, DockDoor, VehicleType, EmployeeSiteAssignment, CityDeliveryConfig

class SiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = ['site_id','code','site_type','parent_site','name','address','geo_lat','geo_lng',
                  'operating_hours','is_accepting_orders','dh_precedence','ss_precedence','status','created_at']
        read_only_fields = ['site_id','created_at']

class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = ['location_id','site','location_type','zone','container','aisle','rack','level','position',
                  'barcode','qr_payload','capacity_qty','capacity_weight_g','capacity_volume_ml',
                  'is_sellable_bin','is_active','created_at']
        read_only_fields = ['created_at']

class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = ['zone_id','site','code','category','zone_type','value_type','fragility','food_type',
                  'product_type','is_advance_zone','commingled_allowed','max_commingled','is_hazardous_allowed','status']
        read_only_fields = ['zone_id']

class DockDoorSerializer(serializers.ModelSerializer):
    class Meta:
        model = DockDoor
        fields = ['door_id','site','code','capability','status']
        read_only_fields = ['door_id']

class VehicleTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleType
        fields = ['vt_id','code','capacity_lpns','temp_controlled']
        read_only_fields = ['vt_id']

class EmployeeSiteAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeSiteAssignment
        fields = ['employee','site','mode','role_at_site','is_primary','is_active','created_at']
        read_only_fields = ['created_at']

class CityDeliveryConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = CityDeliveryConfig
        fields = ['city_id','hard_cap_km','active_bands','extended_plus_enabled','extended_plus_span_km',
                  'extended_plus_max_stops','extended_plus_solo_fee','ceiling_amount','batch_allowance','last_changed_by','last_changed_at']
        read_only_fields = ['city_id','last_changed_at']
