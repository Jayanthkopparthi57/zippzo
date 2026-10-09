from rest_framework import serializers
from django.db.models import Sum
from django.db.models.functions import Coalesce
from .models import RiderProfile, RiderShift, DeliveryTask, RoutePlan, RouteStop

class RiderProfileSerializer(serializers.ModelSerializer):
    # `current_site` serialises to the site's uuid, which is useless for the
    # shift/open endpoint (it takes a code) and unreadable on the rider's
    # header. Carry the code alongside instead of making the client join
    # against /network/overview, which the rider cannot always reach.
    current_site_code = serializers.SerializerMethodField()

    class Meta:
        model = RiderProfile
        fields = ['rider_id','user','name','phone','vehicle_type','vehicle_number','vehicle_capacity_kg','vehicle_capacity_cbm','can_carry_cold','kyc_status','is_online','current_site','current_site_code','rating','created_at']
        read_only_fields = ['rider_id','created_at']

    def get_current_site_code(self, obj):
        return getattr(obj.current_site, 'code', None)

class RiderShiftSerializer(serializers.ModelSerializer):
    class Meta:
        model = RiderShift
        fields = ['shift_id','rider','site','qr_in','started_at','ended_at','end_reason','orders_delivered','distance_km','status']
        read_only_fields = ['shift_id','started_at']

class DeliveryTaskSerializer(serializers.ModelSerializer):
    # `order` is a bare uuid. The counter screen lists jobs for a rider to pick
    # up and the rider app lists the same jobs to close out, and neither can show
    # a human "ORD-1042" from a uuid - so the number and the shipped count are
    # carried here rather than making every client fetch the order separately.
    # Both are read_only: they are facts about the task, never set through it.
    order_no = serializers.SerializerMethodField()
    shipped_qty = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    delivery_address = serializers.SerializerMethodField()
    grand_total = serializers.SerializerMethodField()
    payment_method = serializers.SerializerMethodField()

    class Meta:
        model = DeliveryTask
        fields = ['task_id','order','order_no','shipped_qty','site','rider','bin','staging_bin','status','offer_count','offer_surge','order_weight_kg','order_volume_cbm','requires_cold_chain','offered_at','accepted_at','pickup_at','packed_at','delivered_at','distance_m','eta_at','attempt_no','route_plan_id','route_seq','customer_name','delivery_address','grand_total','payment_method','created_at']
        read_only_fields = ['task_id','created_at']

    def get_order_no(self, obj):
        return getattr(getattr(obj, 'order', None), 'order_no', None)

    def get_shipped_qty(self, obj):
        # Summed from the lines rather than read off the task, because
        # shipped_qty is the whole point of a pickup: it is what actually left
        # the store. None (not 0) before a pickup, so "not shipped yet" and
        # "shipped nothing" stay distinguishable.
        total = obj.order.lines.filter(shipped_qty__gt=0).aggregate(
            total=Coalesce(Sum('shipped_qty'), 0))['total']
        if not obj.pickup_at:
            return None
        return total

    def _viewer_sees_address(self, obj):
        """Only the rider carrying this job, or the people running its store.

        An offered job stays in every online rider's list until somebody takes
        it, so returning the street address there would hand the customer's
        address to riders who never carried the order - and who keep it after
        declining. The task payload is the one place the rider has to read it
        from, because /orders/addresses/ is scoped to the shopper.
        """
        from bounded.ds_ops.access import is_superuser, operator_site_codes

        request = self.context.get('request')
        user = getattr(request, 'user', None) if request else None
        if user is None or not getattr(user, 'is_authenticated', False):
            return False
        if is_superuser(user) or getattr(user, 'role', '') == 'ADMIN':
            return True
        if getattr(user, 'role', '') == 'RIDER':
            return obj.rider_id is not None and obj.rider.user_id == user.user_id
        return obj.site_id is not None and obj.site.code in operator_site_codes(user)

    def get_customer_name(self, obj):
        if not self._viewer_sees_address(obj):
            return None
        customer = getattr(obj.order, 'customer', None)
        return getattr(customer, 'name', None)

    def get_delivery_address(self, obj):
        if not self._viewer_sees_address(obj):
            return None
        address = getattr(obj.order, 'address', None)
        if address is None:
            return None
        parts = [address.line1, address.line2, address.landmark,
                 address.city, address.pincode]
        return ', '.join(str(p).strip() for p in parts if p)

    def get_grand_total(self, obj):
        return str(obj.order.grand_total) if obj.order_id else None

    def get_payment_method(self, obj):
        return obj.order.payment_method if obj.order_id else None

class RoutePlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoutePlan
        fields = ['route_id','rider','shift','site','status','stop_count','total_distance_m','estimated_min','started_at','completed_at','created_at']
        read_only_fields = ['route_id','created_at']

class RouteStopSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteStop
        fields = ['stop_id','route','task','seq','planned_eta','actual_arrival','status']
        read_only_fields = ['stop_id','created_at']
