from rest_framework import serializers
from .models import Asn, AsnLine, Grn, GrnLine, PutawayTask, InboundDiscrepancy


class AsnLineSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)

    class Meta:
        model = AsnLine
        fields = '__all__'


class AsnSerializer(serializers.ModelSerializer):
    lines = AsnLineSerializer(many=True, read_only=True)
    dest_site_code = serializers.CharField(source='dest_site.code', read_only=True)
    source_site_code = serializers.CharField(source='source_site.code', read_only=True)
    source_vendor_name = serializers.CharField(source='source_vendor.name', read_only=True)
    door_code = serializers.CharField(source='door.code', read_only=True)

    class Meta:
        model = Asn
        fields = '__all__'


class GrnLineSerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)

    class Meta:
        model = GrnLine
        fields = '__all__'


class GrnSerializer(serializers.ModelSerializer):
    lines = GrnLineSerializer(many=True, read_only=True)
    asn_no = serializers.CharField(source='asn.asn_no', read_only=True)
    received_by_name = serializers.CharField(source='received_by.name', read_only=True, default=None)

    class Meta:
        model = Grn
        fields = '__all__'


class PutawayTaskSerializer(serializers.ModelSerializer):
    grn_no = serializers.CharField(source='grn_line.grn.grn_no', read_only=True, default=None)
    asn_no = serializers.CharField(source='grn_line.grn.asn.asn_no', read_only=True, default=None)
    sku_name = serializers.CharField(source='grn_line.sku.name', read_only=True, default=None)
    sku_code = serializers.CharField(source='grn_line.sku.sku_code', read_only=True, default=None)
    to_bin_code = serializers.CharField(source='to_bin.code', read_only=True, default=None)

    class Meta:
        model = PutawayTask
        fields = '__all__'


class InboundDiscrepancySerializer(serializers.ModelSerializer):
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    asn_no = serializers.CharField(source='asn.asn_no', read_only=True)

    class Meta:
        model = InboundDiscrepancy
        fields = '__all__'
