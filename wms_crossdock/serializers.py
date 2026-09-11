from rest_framework import serializers
from .models import CrossDockBatch, CrossDockLine


class CrossDockLineSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)

    class Meta:
        model = CrossDockLine
        fields = '__all__'


class CrossDockBatchSerializer(serializers.ModelSerializer):
    lines = CrossDockLineSerializer(many=True, read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = CrossDockBatch
        fields = '__all__'
