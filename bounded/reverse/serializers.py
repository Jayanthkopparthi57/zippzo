from rest_framework import serializers
from .models import ReturnOrder, RTVOrder, RTSOrder

class ReturnOrderSerializer(serializers.ModelSerializer):
    # Every field is state a return earns on its own: who may return it, whether
    # it was approved, what QC found and what refund was decided. Left writable,
    # a shopper could POST status=REFUNDED with refund_amount of their choosing
    # and the console would show it as settled. Creating a return goes through
    # the guarded create() on the viewset; everything else moves through the
    # qc and restock actions.
    class Meta:
        model = ReturnOrder
        fields = ['return_id','order','reason','fault','status','pickup_scheduled_at','picked_up_at','received_at_ds','qc_disposition','refund_amount','created_at']
        read_only_fields = fields

class RTVOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = RTVOrder
        fields = ['rtv_id','order','status','destination_site','created_at']
        read_only_fields = ['rtv_id','created_at']

class RTSOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = RTSOrder
        fields = ['rts_id','order','status','destination_site','created_at']
        read_only_fields = ['rts_id','created_at']
