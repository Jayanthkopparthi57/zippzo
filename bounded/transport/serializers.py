# Transport serializers.
from rest_framework import serializers

from .models import (
    DispatchPlan, Shipment, ManifestDocument, LinehaulTrip, TripStop, ShippingScan, CrossDockMove,
)


class DispatchPlanSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    carrier_name = serializers.CharField(source='carrier.name', read_only=True)
    vehicle_registration = serializers.CharField(
        source='vehicle.registration_no', read_only=True)

    class Meta:
        model = DispatchPlan
        fields = '__all__'
        read_only_fields = ['plan_id', 'created_by', 'created_at', 'updated_at']


class ShipmentSerializer(serializers.ModelSerializer):
    origin_site_code = serializers.CharField(source='origin_site.code', read_only=True)
    destination_site_code = serializers.CharField(
        source='destination_site.code', read_only=True)
    carrier_name = serializers.CharField(source='carrier.name', read_only=True)
    vehicle_registration = serializers.CharField(
        source='vehicle.registration_no', read_only=True)

    class Meta:
        model = Shipment
        fields = '__all__'
        read_only_fields = ['shipment_id', 'created_by', 'created_at', 'updated_at']

    def validate(self, attrs):
        inst = self.instance
        origin = attrs.get('origin_site', inst.origin_site if inst else None)
        dest = attrs.get('destination_site', inst.destination_site if inst else None)
        if origin and dest and origin.pk == dest.pk:
            raise serializers.ValidationError(
                {'destination_site': 'Origin and destination must differ.'})
        shipped = attrs.get('actual_dispatch_at', inst.actual_dispatch_at if inst else None)
        arrived = attrs.get('actual_arrival_at', inst.actual_arrival_at if inst else None)
        if shipped and arrived and arrived < shipped:
            raise serializers.ValidationError(
                {'actual_arrival_at': 'Arrival cannot precede dispatch.'})
        return attrs


class ManifestDocumentSerializer(serializers.ModelSerializer):
    shipment_code = serializers.CharField(source='shipment.code', read_only=True)
    dispatch_plan_code = serializers.CharField(source='dispatch_plan.code', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = ManifestDocument
        fields = '__all__'
        read_only_fields = ['manifest_id', 'generated_at', 'created_by', 'created_at', 'updated_at']


class LinehaulTripSerializer(serializers.ModelSerializer):
    origin_site_code = serializers.CharField(source='origin_site.code', read_only=True)
    destination_site_code = serializers.CharField(
        source='destination_site.code', read_only=True)
    vehicle_registration = serializers.CharField(
        source='vehicle.registration_no', read_only=True)
    shipment_code = serializers.CharField(source='shipment.code', read_only=True)
    carrier_name = serializers.CharField(source='carrier.name', read_only=True)

    class Meta:
        model = LinehaulTrip
        fields = '__all__'
        read_only_fields = ['trip_id', 'created_by', 'created_at', 'updated_at']

    def validate(self, attrs):
        inst = self.instance
        departure = attrs.get('actual_departure_at',
                              inst.actual_departure_at if inst else None)
        arrival = attrs.get('actual_arrival_at',
                            inst.actual_arrival_at if inst else None)
        if departure and arrival and arrival < departure:
            raise serializers.ValidationError(
                {'actual_arrival_at': 'Arrival cannot precede departure.'})
        return attrs


class TripStopSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    trip_code = serializers.CharField(source='trip.code', read_only=True)

    class Meta:
        model = TripStop
        fields = '__all__'
        read_only_fields = ['stop_id']


class ShippingScanSerializer(serializers.ModelSerializer):
    shipment_code = serializers.CharField(source='shipment.code', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)
    lpn_code = serializers.CharField(source='lpn.lpn_id', read_only=True)
    scanned_by_email = serializers.CharField(source='scanned_by.email', read_only=True)

    class Meta:
        model = ShippingScan
        fields = '__all__'
        read_only_fields = ['scan_id', 'scanned_at']


class CrossDockMoveSerializer(serializers.ModelSerializer):
    source_site_code = serializers.CharField(source='source_site.code', read_only=True)
    destination_site_code = serializers.CharField(
        source='destination_site.code', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    lpn_code = serializers.CharField(source='lpn.lpn_id', read_only=True)

    class Meta:
        model = CrossDockMove
        fields = '__all__'
        read_only_fields = ['move_id', 'created_by', 'created_at', 'updated_at']

    def validate(self, attrs):
        inst = self.instance
        source = attrs.get('source_site', inst.source_site if inst else None)
        dest = attrs.get('destination_site', inst.destination_site if inst else None)
        if source and dest and source.pk == dest.pk:
            raise serializers.ValidationError(
                {'destination_site': 'Cross-dock cannot move stock within one site.'})
        qty = attrs.get('qty', inst.qty if inst else 1)
        if qty is not None and qty <= 0:
            raise serializers.ValidationError({'qty': 'Quantity must be positive.'})
        return attrs
