from rest_framework import serializers
from .models import InventoryLot, InventoryTx, Lpn, Droplist


class LpnSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lpn
        fields = '__all__'


class InventoryLotSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    bin_code = serializers.CharField(source='bin.code', read_only=True)

    class Meta:
        model = InventoryLot
        fields = '__all__'


class InventoryTxSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)

    class Meta:
        model = InventoryTx
        fields = '__all__'


class DroplistSerializer(serializers.ModelSerializer):
    class Meta:
        model = Droplist
        fields = '__all__'
