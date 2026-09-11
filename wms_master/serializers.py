from rest_framework import serializers
from .models import Site, SkuCategory, Sku, Vendor, Zone, Bin, ClusterZone, DockDoor, VehicleType, Transporter


class SiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = '__all__'


class SkuCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SkuCategory
        fields = '__all__'


class SkuSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = Sku
        fields = '__all__'


class VendorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendor
        fields = '__all__'


class ZoneSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = Zone
        fields = '__all__'


class BinSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    zone_code = serializers.CharField(source='zone.code', read_only=True)

    class Meta:
        model = Bin
        fields = '__all__'


class ClusterZoneSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = ClusterZone
        fields = '__all__'


class DockDoorSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = DockDoor
        fields = '__all__'


class VehicleTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleType
        fields = '__all__'


class TransporterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transporter
        fields = '__all__'
