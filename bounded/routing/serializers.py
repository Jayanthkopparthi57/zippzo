from rest_framework import serializers
from .models import Serviceability, RoutingDecision

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
