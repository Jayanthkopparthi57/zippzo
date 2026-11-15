# Network Serializers
from rest_framework import serializers
from .models import (
    Site, Location, Zone, DockDoor, VehicleType, EmployeeSiteAssignment,
    CityDeliveryConfig, StaffShift, EmployeeCompensation,
)

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
        extra_kwargs = {
            'barcode': {'allow_blank': True, 'required': False},
            'qr_payload': {'allow_blank': True, 'required': False},
        }

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
    user_email = serializers.EmailField(source='user.email', read_only=True)
    user_name = serializers.CharField(source='user.full_name', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = EmployeeSiteAssignment
        # `id` is Django's implicit primary key; without it the console cannot
        # address a row to deactivate it (the natural key is employee+site+mode).
        fields = ['id','employee','user','user_email','user_name','site','site_code','mode',
                  'role_at_site','is_primary','is_active','created_at']
        read_only_fields = ['id','created_at']

class StaffShiftSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source='user.email', read_only=True)
    user_name = serializers.CharField(source='user.full_name', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = StaffShift
        fields = ['shift_id','user','user_email','user_name','site','site_code',
                  'role_at_site','started_at','ended_at','end_reason','notes','status']
        read_only_fields = ['shift_id','started_at','ended_at','status']

class CityDeliveryConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = CityDeliveryConfig
        fields = ['city_id','hard_cap_km','active_bands','extended_plus_enabled','extended_plus_span_km',
                  'extended_plus_max_stops','extended_plus_solo_fee','ceiling_amount','batch_allowance','last_changed_by','last_changed_at']
        read_only_fields = ['city_id','last_changed_at']


class EmployeeCompensationSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source='user.email', read_only=True)
    user_name = serializers.CharField(source='user.full_name', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = EmployeeCompensation
        fields = ['comp_id','user','user_email','user_name','site','site_code','employee',
                  'basis','amount','currency','effective_from','effective_to','is_active',
                  'notes','created_by','created_at','updated_at']
        read_only_fields = ['comp_id','created_by','created_at','updated_at']

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('amount must be greater than zero')
        return value

    def validate(self, attrs):
        # Merge: a partial PATCH supplies only the changed fields, so the
        # window and duplicate checks must fall back to the stored row.
        inst = self.instance
        start = attrs.get('effective_from',
                          inst.effective_from if inst else None)
        end = attrs.get('effective_to', inst.effective_to if inst else None)
        if start and end and end < start:
            raise serializers.ValidationError(
                'effective_to cannot be before effective_from')
        user = attrs.get('user', inst.user if inst else None)
        site = attrs.get('site', inst.site if inst else None)
        basis = attrs.get('basis', inst.basis if inst else None)
        if user and site and basis and start:
            dup = EmployeeCompensation.objects.filter(
                user=user, site=site, basis=basis, effective_from=start)
            if inst:
                dup = dup.exclude(pk=inst.pk)
            if dup.exists():
                raise serializers.ValidationError(
                    'A compensation for this person, site, basis and start '
                    'date already exists.')
        return attrs
