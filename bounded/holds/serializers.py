# Holds Serializers
from rest_framework import serializers
from .models import Hold

class HoldSerializer(serializers.ModelSerializer):
    class Meta:
        model = Hold
        fields = ['hold_id','site','sku','lot','container_from','container_ref','qty','trigger_reason',
                  'ref_type','ref_id','status','created_by','created_at','assigned_to','resolved_by',
                  'resolved_at','resolution_note','escalated_at']
        read_only_fields = ['hold_id','created_at']
