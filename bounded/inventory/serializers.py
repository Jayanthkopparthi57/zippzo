# Inventory Serializers
from rest_framework import serializers
from .models import LpnMaster, LpnContent, StockMovement, StockBalance, StockMovementsChain

class LpnMasterSerializer(serializers.ModelSerializer):
    class Meta:
        model = LpnMaster
        fields = ['lpn_id','barcode','lpn_type','current_site','source_site','dest_site','transfer','current_container','current_ref_id','status',
                  'is_insulated','temp_rating','capacity_weight_g','capacity_volume_ml','created_by','created_at',
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

class StockBalanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockBalance
        fields = ['site','container','container_ref','container_ref_type','sku','lot','owner_type','owner_id',
                  'qty','sellable','counts_toward_site_custody','updated_at']
        read_only_fields = ['updated_at']

class StockMovementsChainSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockMovementsChain
        fields = ['site','head_seq','head_hash','updated_at']
        read_only_fields = ['updated_at']
