# Cycle-count serializers.
from django.utils import timezone
from rest_framework import serializers

from .models import CycleCount, CycleCountLine


class CycleCountSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    assigned_to_email = serializers.CharField(
        source='assigned_to.email', read_only=True)
    created_by_email = serializers.CharField(
        source='created_by.email', read_only=True)
    line_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = CycleCount
        fields = '__all__'
        read_only_fields = ['count_id', 'started_at', 'closed_at', 'created_at', 'updated_at']

    def validate_site(self, value):
        """A count may only be opened for a store the caller works at.

        Writes are no longer administrator-only (see the viewset), so the site
        assignment has to be enforced here as well as by the queryset.
        """
        request = self.context.get('request')
        if request is None or value is None:
            return value
        from bounded.ds_ops.access import is_estate_role, operator_site_codes
        if is_estate_role(request.user):
            return value
        if value.code not in operator_site_codes(request.user):
            raise serializers.ValidationError(
                f'You are not assigned to {value.code}.')
        return value

    def validate(self, attrs):
        inst = self.instance
        status = attrs.get('status', inst.status if inst else 'DRAFT')
        closed = attrs.get('closed_at', inst.closed_at if inst else None)
        if status == 'CLOSED' and closed is None:
            attrs['closed_at'] = timezone.now()
        if status == 'IN_PROGRESS':
            started = attrs.get('started_at', inst.started_at if inst else None)
            if started is None:
                attrs['started_at'] = timezone.now()
        return attrs


class CycleCountLineSerializer(serializers.ModelSerializer):
    count_code = serializers.CharField(source='count.code', read_only=True)
    location_barcode = serializers.CharField(
        source='location.barcode', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    sku_ean = serializers.CharField(source='sku.ean', read_only=True)
    lpn_code = serializers.CharField(source='lpn.lpn_id', read_only=True)
    counted_by_email = serializers.CharField(
        source='counted_by.email', read_only=True)

    class Meta:
        model = CycleCountLine
        fields = '__all__'
        read_only_fields = ['line_id', 'variance']

    def validate(self, attrs):
        inst = self.instance
        count = attrs.get('count', inst.count if inst else None)
        if count and count.status in ('CLOSED', 'CANCELLED'):
            raise serializers.ValidationError(
                {'count': 'Cannot change lines on a closed or cancelled count.'})

        # The line belongs to a count, and the count belongs to a store. Without
        # this a counter at store A could add a line to store B's count simply
        # by sending its id.
        request = self.context.get('request')
        if count is not None and request is not None:
            from bounded.ds_ops.access import is_estate_role, operator_site_codes
            if not is_estate_role(request.user):
                if count.site.code not in operator_site_codes(request.user):
                    raise serializers.ValidationError(
                        {'count': 'That count belongs to another store.'})

        counted = attrs.get('counted_qty', inst.counted_qty if inst else None)
        system = attrs.get('system_qty', inst.system_qty if inst else 0)

        if counted is not None:
            if counted < 0:
                raise serializers.ValidationError(
                    {'counted_qty': 'Counted quantity cannot be negative.'})
            attrs['variance'] = counted - (system or 0)
            requested = attrs.get('status')
            if requested in (None, '', 'PENDING', 'COUNTED'):
                attrs['status'] = 'VARIANCE' if attrs['variance'] else 'COUNTED'
            if attrs.get('counted_at') is None:
                attrs['counted_at'] = timezone.now()
            if attrs.get('counted_by') is None and self.context.get('request'):
                attrs['counted_by'] = self.context['request'].user
        return attrs
