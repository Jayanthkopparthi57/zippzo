from rest_framework import serializers
from .models import Batch, OrderAllocation

class BatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Batch
        fields = ['batch_id','batch_no','site','type','status','order_type','processing_type','picking_type','cluster_zone','sorting_eligible','dispatch_plan','destinations','totes','ordered_qty','ordered_skus','picked_qty','sorted_qty','short_qty','cutoff','created_by','created_at']
        read_only_fields = ['batch_id','created_at']

class OrderAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderAllocation
        fields = ['alloc_id','order_line','lot','bin','lpn','qty','batch','status','created_at']
        read_only_fields = ['alloc_id','created_at']
