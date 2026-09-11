from rest_framework import serializers
from .models import CycleCount, CycleCountLine, ReplenishmentTask


class CycleCountLineSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    bin_code = serializers.CharField(source='bin.code', read_only=True)

    class Meta:
        model = CycleCountLine
        fields = '__all__'


class CycleCountSerializer(serializers.ModelSerializer):
    lines = CycleCountLineSerializer(many=True, read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = CycleCount
        fields = '__all__'


class ReplenishmentTaskSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    from_bin_code = serializers.CharField(source='from_bin.code', read_only=True)
    to_bin_code = serializers.CharField(source='to_bin.code', read_only=True)

    class Meta:
        model = ReplenishmentTask
        fields = '__all__'
