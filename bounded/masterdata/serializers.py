# Master data serializers.
import re

from rest_framework import serializers

from .models import (
    Organization, Store, Carrier, Vehicle, Equipment, VehicleCheckIn, ReasonCode, ClusterZone,
)


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = '__all__'
        read_only_fields = ['org_id', 'created_at', 'updated_at']


class StoreSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    organization_name = serializers.CharField(source='organization.name', read_only=True)

    class Meta:
        model = Store
        fields = '__all__'
        read_only_fields = ['store_id', 'created_at', 'updated_at']

    def validate_daily_cutoff_time(self, value):
        if value and not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', value):
            raise serializers.ValidationError('Use HH:MM in 24-hour time.')
        return value

    def validate_service_radius_km(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError('Service radius must be greater than zero.')
        return value


class CarrierSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source='organization.name', read_only=True)

    class Meta:
        model = Carrier
        fields = '__all__'
        read_only_fields = ['carrier_id', 'created_at', 'updated_at']


class VehicleSerializer(serializers.ModelSerializer):
    vehicle_type_code = serializers.CharField(source='vehicle_type.code', read_only=True)
    carrier_name = serializers.CharField(source='carrier.name', read_only=True)
    home_site_code = serializers.CharField(source='home_site.code', read_only=True)

    class Meta:
        model = Vehicle
        fields = '__all__'
        read_only_fields = ['vehicle_id', 'created_at', 'updated_at']

    def validate_registration_no(self, value):
        return (value or '').strip().upper()


class EquipmentSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    assigned_to_email = serializers.CharField(source='assigned_to.email', read_only=True)

    class Meta:
        model = Equipment
        fields = '__all__'
        read_only_fields = ['equipment_id', 'created_at', 'updated_at']


class VehicleCheckInSerializer(serializers.ModelSerializer):
    vehicle_registration = serializers.CharField(
        source='vehicle.registration_no', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = VehicleCheckIn
        fields = '__all__'
        read_only_fields = ['checkin_id', 'checked_in_at', 'created_by']

    def validate(self, attrs):
        inst = self.instance
        status = attrs.get('status', inst.status if inst else 'OPEN')
        checked_out = attrs.get('checked_out_at', inst.checked_out_at if inst else None)
        if status == 'CLOSED' and checked_out is None:
            raise serializers.ValidationError(
                {'checked_out_at': 'A closed check-in needs a check-out time.'})
        return attrs


class ReasonCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReasonCode
        fields = '__all__'
        read_only_fields = ['rc_id', 'created_at', 'updated_at']


class ClusterZoneSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    zone_code = serializers.CharField(source='zone.code', read_only=True)

    class Meta:
        model = ClusterZone
        fields = '__all__'
        read_only_fields = ['cz_id', 'site_code', 'zone_code', 'created_at', 'updated_at']

    def validate(self, attrs):
        site = attrs.get('site', getattr(self.instance, 'site', None))
        zone = attrs.get('zone', getattr(self.instance, 'zone', None))
        if site and zone and zone.site_id != site.site_id:
            raise serializers.ValidationError({'zone': 'Cluster zone must belong to the selected site.'})
        return attrs

