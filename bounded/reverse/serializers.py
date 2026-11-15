from rest_framework import serializers
from .models import ReturnOrder, RTVOrder, RTSOrder, CancellationPutaway

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


class CancellationPutawaySerializer(serializers.ModelSerializer):
    order_no = serializers.CharField(source='order.order_no', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    lot_number = serializers.CharField(source='lot.batch_number', read_only=True)
    created_by_email = serializers.CharField(source='created_by.email', read_only=True)
    completed_by_email = serializers.CharField(source='completed_by.email', read_only=True)

    class Meta:
        model = CancellationPutaway
        fields = [
            'putaway_id','code','order','order_no','site','site_code','sku','sku_code',
            'sku_name','lot','lot_number','qty','destination_bin','status','reason_code',
            'remarks','created_by','created_by_email','completed_by','completed_by_email',
            'completed_at','created_at','updated_at',
        ]
        read_only_fields = [
            'putaway_id','order_no','site_code','sku_code','sku_name','lot_number',
            'created_by','created_by_email','completed_by','completed_by_email',
            'completed_at','created_at','updated_at',
        ]

