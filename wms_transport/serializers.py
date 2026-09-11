from rest_framework import serializers
from .models import Trip, VehicleCheckin, TripReturnLeg


class TripSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    vehicle_type_code = serializers.CharField(source='vehicle_type.code', read_only=True)
    transporter_name = serializers.CharField(source='transporter.name', read_only=True)

    class Meta:
        model = Trip
        fields = '__all__'


class VehicleCheckinSerializer(serializers.ModelSerializer):
    trip_no = serializers.CharField(source='trip.trip_no', read_only=True)

    class Meta:
        model = VehicleCheckin
        fields = '__all__'


class TripReturnLegSerializer(serializers.ModelSerializer):
    trip_no = serializers.CharField(source='trip.trip_no', read_only=True)

    class Meta:
        model = TripReturnLeg
        fields = '__all__'
