# Workforce serializers.
from decimal import Decimal, ROUND_HALF_UP

from rest_framework import serializers

from .models import (
    PickerZoneMapping, WorkAssignment, WorkTimeLog, EmployeeActivityEvent,
    ProductivityRollup,
)


class PickerZoneMappingSerializer(serializers.ModelSerializer):
    user_email = serializers.CharField(source='user.email', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)
    zone_code = serializers.CharField(source='zone.code', read_only=True)

    class Meta:
        model = PickerZoneMapping
        fields = '__all__'
        read_only_fields = ['mapping_id', 'created_at', 'updated_at']

    def validate(self, attrs):
        inst = self.instance
        site = attrs.get('site', inst.site if inst else None)
        zone = attrs.get('zone', inst.zone if inst else None)
        if site and zone and zone.site_id != site.site_id:
            raise serializers.ValidationError(
                {'zone': 'That zone belongs to a different site.'})
        return attrs


class WorkAssignmentSerializer(serializers.ModelSerializer):
    user_email = serializers.CharField(source='user.email', read_only=True)
    user_name = serializers.CharField(source='user.full_name', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)
    assigned_by_email = serializers.CharField(
        source='assigned_by.email', read_only=True)

    class Meta:
        model = WorkAssignment
        fields = '__all__'
        read_only_fields = ['assignment_id', 'assigned_at']

    def validate(self, attrs):
        inst = self.instance
        accepted = attrs.get('accepted_at', inst.accepted_at if inst else None)
        started = attrs.get('started_at', inst.started_at if inst else None)
        completed = attrs.get('completed_at', inst.completed_at if inst else None)
        if accepted and started and started < accepted:
            raise serializers.ValidationError(
                {'started_at': 'Start cannot precede acceptance.'})
        if started and completed and completed < started:
            raise serializers.ValidationError(
                {'completed_at': 'Completion cannot precede start.'})
        return attrs


class WorkTimeLogSerializer(serializers.ModelSerializer):
    user_email = serializers.CharField(source='user.email', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)
    activity_label = serializers.CharField(source='get_activity_display', read_only=True)

    class Meta:
        model = WorkTimeLog
        fields = '__all__'
        read_only_fields = ['log_id', 'created_at']

    def validate(self, attrs):
        inst = self.instance
        start = attrs.get('started_at', inst.started_at if inst else None)
        end = attrs.get('ended_at', inst.ended_at if inst else None)
        if start and end and end < start:
            raise serializers.ValidationError(
                {'ended_at': 'End cannot precede start.'})
        if start and end:
            # Stored minutes are authoritative. Recompute unless the caller
            # supplied an explicit non-zero value (a corrected manual entry).
            supplied = attrs.get('minutes')
            if supplied in (None, 0):
                attrs['minutes'] = int((end - start).total_seconds() // 60)
        return attrs


class EmployeeActivityEventSerializer(serializers.ModelSerializer):
    user_email = serializers.CharField(source='user.email', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)
    event_label = serializers.CharField(source='get_event_type_display', read_only=True)

    class Meta:
        model = EmployeeActivityEvent
        fields = '__all__'
        read_only_fields = ['event_id', 'occurred_at']


class ProductivityRollupSerializer(serializers.ModelSerializer):
    user_email = serializers.CharField(source='user.email', read_only=True)
    user_name = serializers.CharField(source='user.full_name', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = ProductivityRollup
        fields = '__all__'
        read_only_fields = ['rollup_id', 'created_at', 'updated_at']

    def validate(self, attrs):
        inst = self.instance
        units = attrs.get('units_processed', inst.units_processed if inst else 0)
        minutes = attrs.get('minutes_worked', inst.minutes_worked if inst else 0)
        supplied = attrs.get('units_per_hour')
        if supplied in (None, 0) and minutes:
            rate = (Decimal(units) * Decimal(60) / Decimal(minutes))
            attrs['units_per_hour'] = rate.quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP)
        if minutes == 0:
            attrs['units_per_hour'] = Decimal('0.00')
        return attrs
