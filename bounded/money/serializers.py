from rest_framework import serializers
from .models import (Payment, CancelIntent, Refund, RefundDecision, CashMovement,
                     RiderCustodyState, RiderEarnings, RiderPayout,
                     DeliveryPricingRule)

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
    order_no = serializers.CharField(source='order.order_no', read_only=True)
    payout_id = serializers.UUIDField(source='payout.payout_id', read_only=True, allow_null=True)

    class Meta:
        model = RiderEarnings
        fields = ['earning_id','rider','order','order_no','amount','delivery_fee','tips',
                  'status','payout_id','paid_at','created_at']
        read_only_fields = ['earning_id','created_at']


class RiderPayoutEarningSerializer(serializers.ModelSerializer):
    order_no = serializers.CharField(source='order.order_no', read_only=True)
    delivered_at = serializers.DateTimeField(source='order.delivered_at', read_only=True)

    class Meta:
        model = RiderEarnings
        fields = ['earning_id','order','order_no','amount','delivery_fee','tips',
                  'status','paid_at','delivered_at']


class RiderPayoutSerializer(serializers.ModelSerializer):
    rider_name = serializers.CharField(source='rider.name', read_only=True)
    rider_phone = serializers.CharField(source='rider.phone', read_only=True)
    earnings = RiderPayoutEarningSerializer(many=True, read_only=True)

    class Meta:
        model = RiderPayout
        fields = ['payout_id','rider','rider_name','rider_phone','site','amount',
                  'earnings_count','period_start','period_end','status','reference',
                  'created_by','created_at','earnings']
        read_only_fields = ['payout_id','amount','earnings_count','period_start',
                            'period_end','status','created_by','created_at']

class DeliveryPricingRuleSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = DeliveryPricingRule
        fields = ['rule_id','site','site_code','base_fee','promise_minutes','free_above','is_active','updated_by','created_at','updated_at']
        read_only_fields = ['rule_id','updated_by','created_at','updated_at']

    def validate_base_fee(self, value):
        if value < 0:
            raise serializers.ValidationError('A delivery fee cannot be negative.')
        if value > 1000:
            raise serializers.ValidationError('A delivery fee above ₹1000 needs a conversation, not a form.')
        return value

    def validate_free_above(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError(
                'A free-delivery threshold cannot be negative.')
        if value is not None and 0 < value < 50:
            raise serializers.ValidationError(
                'A free-delivery threshold below ₹50 is not an incentive.')
        return value
