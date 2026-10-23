import re

from rest_framework import serializers

from .models import DeliveryArea, Serviceability, RoutingDecision


class DeliveryAreaSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    site_name = serializers.CharField(source='site.name', read_only=True)

    class Meta:
        model = DeliveryArea
        fields = ['area_id', 'site', 'site_code', 'site_name', 'pincode',
                  'band', 'is_active', 'created_at']
        read_only_fields = ['area_id', 'created_at']

    def validate_pincode(self, value):
        pincode = (value or '').strip()
        if not re.fullmatch(r'\d{6}', pincode):
            raise serializers.ValidationError('A pincode is exactly 6 digits.')
        return pincode


class ServiceabilitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Serviceability
        fields = ['service_id','site','band','day_of_week','start_hour','end_hour','is_active']
        read_only_fields = ['service_id']

class RoutingDecisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoutingDecision
        fields = ['decision_id','order_id','source_site','dest_site','eta_minutes','distance_m','vehicle_type','created_at']
        read_only_fields = ['decision_id','created_at']
