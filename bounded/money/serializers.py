from rest_framework import serializers
from .models import Payment, CancelIntent, Refund, RefundDecision, CashMovement, RiderCustodyState, RiderEarnings

class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['payment_id','order','customer','method','gateway','gateway_order_id','gateway_payment_id','amount','status','captured_at','created_at']
        read_only_fields = ['payment_id','created_at']

class CancelIntentSerializer(serializers.ModelSerializer):
    class Meta:
        model = CancelIntent
        fields = ['intent_id','order','idempotency_key','reason_code','actor_type','actor_id','status','created_at','expires_at','resolved_at']
        read_only_fields = ['intent_id','created_at']

class RefundSerializer(serializers.ModelSerializer):
    class Meta:
        model = Refund
        fields = ['refund_id','order','payment','amount','refund_method','status','gateway_refund_id','utr','initiated_at','completed_at','retry_count','created_at']
        read_only_fields = ['refund_id','created_at']

class RefundDecisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RefundDecision
        fields = ['decision_id','refund','return_order','decision','amount','reason_code','decided_by','decided_at']
        read_only_fields = ['decision_id','decided_at']

class CashMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = CashMovement
        fields = ['entry_id','movement_type','amount','site','from_container','from_ref_id','to_container','to_ref_id','ref_type','ref_id','actor_id','actor_type','idempotency_key','created_at']
        read_only_fields = ['entry_id','created_at']

class RiderCustodyStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = RiderCustodyState
        fields = ['rider_id','site','current_cash','current_float','bags_in_custody','ceiling_amount','updated_at']
        read_only_fields = ['updated_at']

class RiderEarningsSerializer(serializers.ModelSerializer):
    class Meta:
        model = RiderEarnings
        fields = ['earning_id','rider','order','amount','delivery_fee','tips','status','created_at']
        read_only_fields = ['earning_id','created_at']
