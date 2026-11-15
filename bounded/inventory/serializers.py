# Inventory Serializers
from rest_framework import serializers
from .models import LpnMaster, LpnContent, StockMovement, StockBalance, StockMovementsChain, ReplenishmentTask

class LpnMasterSerializer(serializers.ModelSerializer):
    class Meta:
        model = LpnMaster
        fields = ['lpn_id','barcode','lpn_type','current_site','source_site','dest_site','transfer','current_container','current_ref_id','status',
                  'is_insulated','temp_rating','capacity_weight_g','capacity_volume_ml','manifest','created_by','created_at',
                  'sealed_at','consumed_at']
        read_only_fields = ['created_at','sealed_at','consumed_at']

class LpnContentSerializer(serializers.ModelSerializer):
    class Meta:
        model = LpnContent
        # `id` is the model pk. It was absent from `fields`, so a tote manifest
        # could be listed but never incremented: a repeated scan of the same
        # (lpn, sku, lot) hit the unique_together and 400'd, and the row could
        # not be addressed to PATCH it.
        fields = ['id','lpn','sku','lot','qty','added_at']
        read_only_fields = ['id','added_at']

class StockMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockMovement
        fields = ['entry_id','movement_ref','ref_id','movement_type','sku','lot','qty','site',
                  'from_container','from_ref_id','to_container','to_ref_id','owner_type','owner_id',
                  'actor_id','actor_type','device_id','idempotency_key','sellable_delta','site_custody_delta',
                  'created_at','site_seq']
        read_only_fields = ['entry_id','created_at']


class ReplenishmentTaskSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    lot_number = serializers.CharField(source='lot.batch_number', read_only=True)
    assigned_to_email = serializers.CharField(source='assigned_to.email', read_only=True)
    completed_by_email = serializers.CharField(source='completed_by.email', read_only=True)

    class Meta:
        model = ReplenishmentTask
        fields = [
            'task_id','site','site_code','sku','sku_code','sku_name','lot','lot_number',
            'from_container','from_container_ref','to_container','to_container_ref','qty',
            'status','trigger','reason','assigned_to','assigned_to_email','created_by',
            'completed_by','completed_by_email','started_at','completed_at','created_at','updated_at',
        ]
        read_only_fields = [
            'task_id','site_code','sku_code','sku_name','lot_number','assigned_to_email',
            'completed_by_email','created_by','completed_by','started_at','completed_at',
            'created_at','updated_at',
        ]

    def validate(self, attrs):
        from_container = attrs.get('from_container', getattr(self.instance, 'from_container', None))
        from_ref = attrs.get('from_container_ref', getattr(self.instance, 'from_container_ref', None))
        to_container = attrs.get('to_container', getattr(self.instance, 'to_container', None))
        to_ref = attrs.get('to_container_ref', getattr(self.instance, 'to_container_ref', None))
        if from_container == to_container and from_ref == to_ref:
            raise serializers.ValidationError({'to_container_ref': 'Source and destination must differ.'})
        return attrs

class StockBalanceSerializer(serializers.ModelSerializer):
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    sku_ean = serializers.CharField(source='sku.ean', read_only=True)

    class Meta:
        model = StockBalance
        fields = ['site','container','container_ref','container_ref_type','sku','sku_code','sku_name','sku_ean',
                  'lot','owner_type','owner_id',
                  'qty','sellable','counts_toward_site_custody','updated_at']
        read_only_fields = ['updated_at']

class StockMovementsChainSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockMovementsChain
        fields = ['site','head_seq','head_hash','updated_at']
        read_only_fields = ['updated_at']
