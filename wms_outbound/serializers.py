from rest_framework import serializers
from .models import (DispatchPlan, Batch, Order, OrderLine, OrderAllocation,
                     Picklist, PicklistLine, Sortlist, SortlistLine,
                     Manifest, ManifestLine, CancellationPutaway)


class DispatchPlanSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = DispatchPlan
        fields = '__all__'


class BatchSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = Batch
        fields = '__all__'


class OrderLineSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)

    class Meta:
        model = OrderLine
        fields = '__all__'


class OrderSerializer(serializers.ModelSerializer):
    lines = OrderLineSerializer(many=True, read_only=True)
    source_site_code = serializers.CharField(source='source_site.code', read_only=True)
    source_site_name = serializers.CharField(source='source_site.name', read_only=True)
    final_dest_code = serializers.CharField(source='final_dest.code', read_only=True)
    final_dest_name = serializers.CharField(source='final_dest.name', read_only=True)

    class Meta:
        model = Order
        fields = '__all__'


class OrderAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderAllocation
        fields = '__all__'


class PicklistLineSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    bin_code = serializers.CharField(source='bin.code', read_only=True)

    class Meta:
        model = PicklistLine
        fields = '__all__'


class PicklistSerializer(serializers.ModelSerializer):
    lines = PicklistLineSerializer(many=True, read_only=True)
    batch_no = serializers.CharField(source='batch.batch_no', read_only=True)
    zone_name = serializers.CharField(source='zone.name', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.name', read_only=True, default=None)
    assigned_to_code = serializers.CharField(source='assigned_to.emp_code', read_only=True, default=None)

    class Meta:
        model = Picklist
        fields = '__all__'


class SortlistLineSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)

    class Meta:
        model = SortlistLine
        fields = '__all__'


class SortlistSerializer(serializers.ModelSerializer):
    lines = SortlistLineSerializer(many=True, read_only=True)
    batch_no = serializers.CharField(source='batch.batch_no', read_only=True)

    class Meta:
        model = Sortlist
        fields = '__all__'


class ManifestLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = ManifestLine
        fields = '__all__'


class ManifestSerializer(serializers.ModelSerializer):
    lines = ManifestLineSerializer(many=True, read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = Manifest
        fields = '__all__'


class CancellationPutawaySerializer(serializers.ModelSerializer):
    order_no = serializers.CharField(source='order.order_no', read_only=True)

    class Meta:
        model = CancellationPutaway
        fields = '__all__'
