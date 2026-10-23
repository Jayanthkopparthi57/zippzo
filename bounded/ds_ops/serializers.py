# DS Ops Serializers
from rest_framework import serializers
from bounded.iam.names import display_name
from .models import PickTask, PackTask, SortingWave, StagedAging, TransferOrder, BinTransfer

# Every bare-UUID actor column this module renders gets a sibling `_name`
# field resolved from the per-response user_map in serializer context (see
# bounded.iam.names). The UUID itself stays in the payload for filtering.

class PickTaskSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    started_by_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PickTask
        fields = ['id','picklist_id','batch','order','zone','sku','lot','bin','qty','picked_qty','short_qty','pick_seq','status',
                  'assigned_to','assigned_to_name','started_by','started_by_name','completed_by','completed_by_name',
                  'started_at','completed_at','created_at']
        read_only_fields = ['id','started_by','completed_by','assigned_to_name','started_by_name',
                            'completed_by_name','created_at']

    def get_assigned_to_name(self, obj):
        return display_name(self.context.get('user_map'), obj.assigned_to)

    def get_started_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.started_by)

    def get_completed_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.completed_by)

class PackTaskSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PackTask
        fields = ['id','packlist_id','lpn','order','sku','qty','packed_qty','staging_bin','status',
                  'assigned_to','assigned_to_name','completed_by','completed_by_name',
                  'started_at','completed_at','created_at']
        read_only_fields = ['id','completed_by','assigned_to_name','completed_by_name','created_at']

    def get_assigned_to_name(self, obj):
        return display_name(self.context.get('user_map'), obj.assigned_to)

    def get_completed_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.completed_by)

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
    created_by_name = serializers.SerializerMethodField()
    dispatched_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TransferOrder
        fields = ['transfer_id','source_site','dest_site','status','total_qty',
                  'created_by','created_by_name','dispatched_by','dispatched_by_name','created_at']
        read_only_fields = ['transfer_id','created_by','dispatched_by','created_by_name',
                            'dispatched_by_name','created_at']

    def get_created_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.created_by)

    def get_dispatched_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.dispatched_by)

class BinTransferSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BinTransfer
        fields = ['transfer_id','source_bin','dest_bin','status',
                  'created_by','created_by_name','completed_by','completed_by_name','created_at']
        read_only_fields = ['transfer_id','created_by','completed_by','created_by_name',
                            'completed_by_name','created_at']

    def get_created_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.created_by)

    def get_completed_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.completed_by)
