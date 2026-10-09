# DS Ops Serializers
from rest_framework import serializers
from .models import PickTask, PackTask, SortingWave, StagedAging, TransferOrder, BinTransfer

class PickTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = PickTask
        fields = ['id','picklist_id','batch','order','zone','sku','lot','bin','qty','picked_qty','short_qty','pick_seq','status','assigned_to','started_at','completed_at','created_at']
        read_only_fields = ['id','created_at']

class PackTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = PackTask
        fields = ['id','packlist_id','lpn','order','sku','qty','packed_qty','staging_bin','status','assigned_to','created_at']
        read_only_fields = ['id','created_at']

class SortingWaveSerializer(serializers.ModelSerializer):
    class Meta:
        model = SortingWave
        fields = ['wave_id','batch','cluster_zone','type','assigned_qty','sorted_qty','status','created_at']
        read_only_fields = ['wave_id','created_at']

class StagedAgingSerializer(serializers.ModelSerializer):
    class Meta:
        model = StagedAging
        fields = ['aging_id','order_id','site','staged_at','current_stage','created_at']
        read_only_fields = ['aging_id','created_at']

class TransferOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransferOrder
        fields = ['transfer_id','source_site','dest_site','status','total_qty','created_at']
        read_only_fields = ['transfer_id','created_at']

class BinTransferSerializer(serializers.ModelSerializer):
    class Meta:
        model = BinTransfer
        fields = ['transfer_id','source_bin','dest_bin','status','created_at']
        read_only_fields = ['transfer_id','created_at']
