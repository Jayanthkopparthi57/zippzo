from rest_framework import serializers
from .models import Customer, CustomerAddress, Cart, CartLine, CustomerOrder, CustomerOrderLine, OrderStatusHistory

class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ['customer_id','user','name','trust_tier','default_address_id','created_at']
        # `user` would repoint the profile at somebody else's login, and
        # `trust_tier` is a platform judgement about this customer - letting a
        # shopper PATCH either is a privilege escalation, not a profile edit.
        read_only_fields = ['customer_id','created_at','user','trust_tier']

class CustomerAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerAddress
        fields = ['address_id','customer','label','line1','line2','landmark','pincode','city','geo_lat','geo_lng','geocode_confidence','is_default','created_at']
        read_only_fields = ['address_id','created_at']
        # Optional at the door because the owner is derived from the login in
        # `perform_create`, not read off the body - requiring it would reject
        # the one payload a shopper can legitimately send. It stays writable so
        # an admin, who owns no Customer row, can still file one for a shopper;
        # for a shopper it is overwritten whatever was sent.
        extra_kwargs = {'customer': {'required': False}}

class CartSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cart
        fields = ['cart_id','customer','site','status','subtotal','updated_at']
        # Both are results, not requests: checkout writes `CONVERTED` and the
        # priced `subtotal` straight onto the model when it converts the
        # basket, so a client has no business setting either one.
        read_only_fields = ['cart_id','updated_at','status','subtotal']
        # Same reason as the address: the owner comes from the login, so the
        # field must not be required of a shopper, only available to an admin.
        extra_kwargs = {'customer': {'required': False}}

class CartLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = CartLine
        # `id` is the model's auto PK. It was not listed, which left the list
        # response carrying no way to address the row it had just returned -
        # the detail and update routes could not be called by anyone.
        fields = ['id','cart','line_no','sku','qty','unit_price']
        # The price a shopper pays comes from this store's Listing at checkout,
        # never from the basket, so a client-set `unit_price` is decorative at
        # best and a discount lever at worst.
        read_only_fields = ['line_no','unit_price']

class CustomerOrderSerializer(serializers.ModelSerializer):
    # The operator queue shows who ordered and how many lines are on the order.
    # Both are derived facts, not columns: exposing them here keeps every screen
    # from inventing "Customer" / "—" when the fields are simply absent.
    customer_name = serializers.SerializerMethodField()
    total_items = serializers.SerializerMethodField()

    class Meta:
        model = CustomerOrder
        fields = ['order_id','order_no','customer','customer_name','total_items','site','address','status','payment_method','payment_status','subtotal','delivery_fee','discount','coupon_discount','combo_discount','combo_offer_details','tax_amount','grand_total','short_amount','cancel_reason','cancel_actor','cancelled_at','picked_up_at','returned_at','delivered_at','delivery_slot','coupon_code','placed_at','promise_at']
        # `status` is read-only here. It used to be writable, which meant
        # PATCH /api/orders/orders/<id>/ with {"status": "DELIVERED"} was a
        # complete state transition: no guard on where it came from, no
        # OrderStatusHistory row, and no check that the caller had any business
        # touching the order. Ops and seed scripts that need to move an order now
        # go through DSOrderActionView, the pack endpoint, or the delivery
        # handoff endpoints - all of which record who did it.
        #
        # The lifecycle timestamps are read-only for the same reason: they are
        # set as a side effect of the transition that actually happened, so
        # letting a client write `delivered_at` directly would date-stamp a
        # delivery that never occurred.
        read_only_fields = ['order_id','order_no','status','placed_at',
                            'picked_up_at','delivered_at','returned_at',
                            'cancelled_at','cancel_actor','cancel_reason',
                            # Money, ownership and provenance are not editable
                            # either. `status` was locked first and left the
                            # rest open: a shopper could PATCH their own order
                            # to payment_status=PAID, zero the grand_total, or
                            # point it at somebody else's customer row. A wrong
                            # order number also collided inside `create` as a
                            # 500 out of IntegrityError rather than a 409.
                            # Checkout is the only thing that writes these.
                            'customer','site','address','payment_method',
                            'payment_status','subtotal','delivery_fee',
                            'discount','coupon_discount','combo_discount',
                            'combo_offer_details','tax_amount','grand_total',
                            'short_amount']

    def get_customer_name(self, obj):
        # `customer` is a bare FK to a profile whose display name may be blank;
        # fall back to the linked account so the queue never shows an empty
        # cell where a person should be.
        customer = getattr(obj, 'customer', None)
        if customer is None:
            return ''
        return customer.name or getattr(customer.user, 'full_name', '') or ''

    def get_total_items(self, obj):
        # Count distinct SKU lines, not units: the queue column says "SKUs".
        return getattr(obj, 'lines').count() if hasattr(obj, 'lines') else 0

class CustomerOrderLineSerializer(serializers.ModelSerializer):
    # A past order can name a SKU this store no longer shelves, and the shopper
    # app prices its detail screen from the current storefront. Without the
    # snapshot-ish name/code here the line degrades to "Item" and the order
    # becomes unreadable. Both are read-only views of the related SKU.
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)

    class Meta:
        model = CustomerOrderLine
        fields = ['line_id','order','line_no','sku','sku_name','sku_code','lot','qty','picked_qty','packed_qty','shipped_qty','unit_price','line_total','status']
        # The three quantity counters are ledger state, not user intent.
        # picked_qty is written by the scan endpoints, packed_qty by packing and
        # shipped_qty at rider pickup. Accepting them over the API would let a
        # client report a full pick without moving a single unit off a shelf,
        # which is exactly the bug the scan-first rework removed.
        read_only_fields = ['line_id','line_no','picked_qty','packed_qty',
                            'shipped_qty','status']

class OrderStatusHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderStatusHistory
        fields = ['history_id','order','from_status','to_status','actor_type','actor_id','remark','created_at']
        read_only_fields = ['history_id','created_at']
