from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Customer, CustomerAddress, Cart, CartLine, CustomerOrder, CustomerOrderLine, OrderStatusHistory
from .serializers import CustomerSerializer, CustomerAddressSerializer, CartSerializer, CartLineSerializer, CustomerOrderSerializer, CustomerOrderLineSerializer, OrderStatusHistorySerializer

# ── live delivery tracking ────────────────────────────────────────────────
#
# The shopper is told where the rider is, but only while the parcel is on its
# way - a position is not history worth keeping once the door has closed.
# Coordinates come from the rider app's own `me/location` beacon, which it
# sends while online; a rider who has never shared simply has no pin, and the
# endpoint says so instead of inventing one.

# Order states in which somebody is actually carrying the parcel.
TRACKING_ORDER_STATUSES = frozenset({
    'RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED',
})

# A pin older than this is shown, but labelled as the last known position.
TRACKING_STALE_AFTER = 120  # seconds

# City speed assumed when only a distance is known: a scooter in traffic.
CITY_SPEED_KMH = 20.0

def _km_between(lat1, lng1, lat2, lng2):
    """Great-circle distance in kilometres. Flat-earth is fine at city scale."""
    from math import asin, cos, radians, sin, sqrt
    d_lat = radians(float(lat2) - float(lat1))
    d_lng = radians(float(lng2) - float(lng1))
    a = (sin(d_lat / 2) ** 2
         + cos(radians(float(lat1))) * cos(radians(float(lat2)))
         * sin(d_lng / 2) ** 2)
    return 2 * 6371.0 * asin(sqrt(a))


def _mask_phone(phone):
    """Enough to recognise a callback number, not enough to harvest it."""
    digits = ''.join(ch for ch in (phone or '') if ch.isdigit())
    return f'•••••{digits[-4:]}' if len(digits) >= 4 else ''


def _first_name(name):
    cleaned = (name or '').strip()
    return cleaned.split()[0] if cleaned else 'Your rider'

def _is_admin(user):
    """Whether this login keeps the full list instead of its own rows."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return False
    from bounded.ds_ops.access import is_superuser
    return (getattr(user, 'role', '') in ('ADMIN', 'SUPER_ADMIN')
            or is_superuser(user))


def _shopper_for(user):
    """The Customer row this login owns, or None when it owns none.

    A staff login has no Customer row on purpose, so it lands on None here and
    gets an empty list rather than the whole network: operators reach their own
    work through the site-fenced dark-store endpoints, not through a shopper's
    drawer.
    """
    if user is None or not getattr(user, 'is_authenticated', False):
        return None
    return Customer.objects.filter(user_id=user.user_id).first()


def _owned(request, queryset, owner='customer'):
    """Restrict a customer-owned queryset to the caller.

    These endpoints are a shopper's own drawer - their profile, saved
    addresses, baskets and order lines. Unfiltered, any logged-in account
    could read or delete another person's rows simply by paging to them, the
    same hole `CustomerOrderViewSet` already closed for orders. `owner` names
    the field that reaches the owning Customer, and may be a path such as
    `cart__customer`.
    """
    user = getattr(request, 'user', None)
    if _is_admin(user):
        return queryset
    customer = _shopper_for(user)
    if customer is None:
        return queryset.none()
    return queryset.filter(**{owner: customer})


def _pin_customer(serializer, request):
    """Write the caller's own Customer onto the row being saved.

    Scoping the queryset only decides what can be seen. `customer` is a
    writable serializer field, so a shopper could otherwise POST a row into
    somebody else's drawer, or PATCH one of their own rows onto somebody
    else's account and lose it. An admin has no Customer row of their own and
    keeps whatever the payload named, so support can still file a row for a
    customer.
    """
    customer = _shopper_for(getattr(request, 'user', None))
    if customer is not None:
        return serializer.save(customer=customer)

    # An admin or a staff login owns no Customer row, so they keep whatever
    # `customer` the payload named - that is what lets support file an address
    # for a shopper. A body naming nobody would otherwise fail the NOT NULL at
    # insert time and come back as a 500, so it is reported instead.
    if not serializer.validated_data.get('customer'):
        from rest_framework.exceptions import ValidationError
        raise ValidationError({'customer': 'Name the customer this belongs to.'})
    return serializer.save()


def _own_login(request):
    """The authenticated login, or None when there is no real one."""
    user = getattr(request, 'user', None)
    if user is None or not getattr(user, 'is_authenticated', False):
        return None
    return user


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.select_related('user').all()
    serializer_class = CustomerSerializer
    filterset_fields = ['trust_tier']

    def get_queryset(self):
        """A login sees only its own customer row; admins see the directory."""
        user = self.request.user
        if _is_admin(user):
            return self.queryset
        customer = _shopper_for(user)
        if customer is None:
            return self.queryset.none()
        return self.queryset.filter(pk=customer.pk)

    def perform_create(self, serializer):
        """A shopper creates their own customer profile, and only their own.

        `user` is read-only on the serializer, so nothing else would ever set
        it and the NOT NULL on `customers.user_id` surfaced as a 500. The
        owner is the login, exactly as `_pin_customer` does for addresses: the
        shopper is not asked to name themselves, and cannot name somebody else.
        This is the one missing step between a fresh CUSTOMER login and a
        first order - `CheckoutView` refuses an account with no customer row,
        so without this there is no way to reach checkout at all.
        """
        from rest_framework.exceptions import ValidationError

        if _is_admin(self.request.user):
            raise ValidationError({
                'customer': 'Staff accounts do not have a shopper profile. '
                            'Create the order from the customer app instead.'})

        user = _own_login(self.request)
        if user is None:
            raise ValidationError({'customer': 'Sign in before setting up your account.'})

        if Customer.objects.filter(user_id=user.user_id).exists():
            raise ValidationError({
                'customer': 'This login already has a shopper profile.'})

        serializer.save(user=user)


class CustomerAddressViewSet(viewsets.ModelViewSet):
    queryset = CustomerAddress.objects.all()
    serializer_class = CustomerAddressSerializer

    def get_queryset(self):
        return _owned(self.request, self.queryset)

    def perform_create(self, serializer):
        self._save_one_default(serializer)

    def perform_update(self, serializer):
        self._save_one_default(serializer)

    def _save_one_default(self, serializer):
        """Keep at most one default address per shopper.

        Two rows flagged default would leave checkout to take whichever one
        the database returned first, so a shopper who saved a second "Home"
        would find their orders silently going to the other. Saving a default
        therefore clears the flag everywhere else on that account.
        """
        address = _pin_customer(serializer, self.request)
        if address is not None and address.is_default:
            CustomerAddress.objects.filter(
                customer=address.customer, is_default=True,
            ).exclude(pk=address.pk).update(is_default=False)
        return address

    def perform_destroy(self, instance):
        """Refuse to delete an address an order was placed with.

        `CustomerOrder.address` cascades, so a DELETE here would quietly take
        the shopper's order history with it - the order numbers, the totals,
        the proof of delivery, all gone because they tidied up an address
        book. The row stays and the order keeps pointing at it.
        """
        if instance.orders.exists():
            from rest_framework.exceptions import ValidationError
            raise ValidationError({
                'address': 'This address has orders against it, so it cannot '
                           'be deleted. Orders keep the address they were '
                           'placed with.'})
        return super().perform_destroy(instance)

class CartViewSet(viewsets.ModelViewSet):
    queryset = Cart.objects.select_related('customer','site').all()
    serializer_class = CartSerializer
    filterset_fields = ['status','site']

    def get_queryset(self):
        return _owned(self.request, self.queryset)

    def perform_create(self, serializer):
        _pin_customer(serializer, self.request)

    def perform_update(self, serializer):
        _pin_customer(serializer, self.request)

class CartLineViewSet(viewsets.ModelViewSet):
    queryset = CartLine.objects.select_related('cart','sku').all()
    serializer_class = CartLineSerializer

    def get_queryset(self):
        return _owned(self.request, self.queryset, owner='cart__customer')

    def perform_create(self, serializer):
        self._check_basket(serializer, creating=True)
        cart = serializer.validated_data['cart']
        serializer.save(
            line_no=self._next_line_no(cart),
            unit_price=self._price_for(cart, serializer.validated_data['sku']),
        )

    def perform_update(self, serializer):
        self._check_basket(serializer, creating=False)
        serializer.save()

    @staticmethod
    def _next_line_no(cart):
        """Number the line after what the basket already holds.

        `line_no` is read-only in the serializer because the sequence belongs to
        the basket, not to the caller - and it has no default, so leaving it
        unset would fail the insert.
        """
        from django.db.models import Max
        taken = CartLine.objects.filter(cart=cart).aggregate(m=Max('line_no'))['m']
        return (taken or 0) + 1

    @staticmethod
    def _price_for(cart, sku):
        """Price the line from this store's listing, exactly as checkout does.

        `unit_price` is read-only for the same reason it is at checkout: a
        shopper-set price is a discount lever. Priced here rather than left null
        because the column has no default either.
        """
        from rest_framework.exceptions import ValidationError
        from bounded.catalog.models import Listing
        if cart.site_id is None:
            raise ValidationError(
                {'cart': 'That basket has no store to be priced against.'})
        listing = Listing.objects.filter(sku=sku, site_id=cart.site_id).first()
        if listing is None or not listing.is_listed or not listing.is_available:
            raise ValidationError(
                {'sku': 'That item is not sold at this store.'})
        return listing.price

    def _check_basket(self, serializer, *, creating):
        """A line may only be filed against a basket the caller owns.

        Scoping reads does not cover this: `cart` is writable, so a shopper
        could POST a line pointing at somebody else's basket and edit it
        indirectly through an id they were never shown.
        """
        customer = _shopper_for(self.request.user)
        if customer is None:
            return
        cart = serializer.validated_data.get('cart')
        if cart is None:
            if creating:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({'cart': 'A basket line needs a basket.'})
            return
        if cart.customer_id != customer.customer_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'cart': 'That basket is not on your account.'})

class CustomerOrderViewSet(viewsets.ModelViewSet):
    queryset = CustomerOrder.objects.select_related('customer','site','address').all()
    serializer_class = CustomerOrderSerializer
    filterset_fields = ['status','payment_method','payment_status','site']
    search_fields = ['order_no']

    # Status transitions used to live here as an `order_action` detail route.
    # That copy had no transition guard, no OrderStatusHistory write and no site
    # or ownership check, so any authenticated user could mark any order in any
    # state DELIVERED. It also read `order.assigned_picker`, which is not a
    # CustomerOrder column, so the COMPLETE_PICK branch raised AttributeError.
    #
    # `DSOrderActionView` (POST /ds-ops/order-action) is the single guarded
    # state machine: it 409s illegal transitions, stamps the relevant
    # timestamps and writes the audit row. Do not re-add a second path here --
    # if a new transition is needed, extend ORDER_ACTIONS in
    # bounded/ds_ops/views.py so the guard and the history write apply too.
    #
    # `status` is now read-only in CustomerOrderSerializer, closing the other
    # door: PATCHing the order directly used to be a second, unguarded path to
    # the same transitions with no audit row at all.

    def get_queryset(self):
        """Restrict the list to what the caller may see.

        An unfiltered queryset here hands every customer every other customer's
        order numbers, addresses and totals, and every rider every task in the
        network. Staff keep the full view; everyone else sees only orders
        belonging to them.
        """
        user = self.request.user
        if not user or not getattr(user, 'is_authenticated', False):
            return self.queryset.none()

        from bounded.iam.models import User
        from bounded.ds_ops.access import is_superuser

        if getattr(user, 'role', '') in ('ADMIN', 'SUPER_ADMIN') or is_superuser(user):
            return self.queryset

        qs = self.queryset
        customer = Customer.objects.filter(user_id=user.user_id).first()

        # A rider has no Customer row of their own - they are delivering, not
        # buying - so this has to be asked *before* the "no customer, no
        # orders" fallback below. It used to come after, which made it dead
        # code: every rider fell through to `qs.none()`, and the rider
        # dashboard got a 404 for the order behind each of its tasks and
        # silently rendered the row from the task alone. They see the orders
        # they are carrying, and nothing else in the network.
        if User.objects.filter(user_id=user.user_id, role='RIDER').exists():
            carrying = qs.filter(
                delivery_tasks__rider__user_id=user.user_id)
            if customer is None:
                return carrying.distinct()
            # An account that both buys and delivers must not lose its own
            # orders to the other half of this branch.
            return (carrying | qs.filter(customer=customer)).distinct()

        if customer is None:
            # Not a shopper. Staff reach their orders through the dark-store
            # endpoints, which are fenced by site assignment, so an operator
            # with no customer record gets an empty list rather than the
            # network.
            return qs.none()
        return qs.filter(customer=customer)

    def create(self, request, *args, **kwargs):
        """Orders are opened by checkout, not by posting to the collection.

        Leaving `create` routable meant a duplicate order_no - or a customer
        row someone else owns - surfaced as IntegrityError out of the model,
        i.e. a 500 with a stack trace, rather than a considered answer.
        """
        from rest_framework.exceptions import MethodNotAllowed
        raise MethodNotAllowed('POST')

    def perform_update(self, serializer):
        """Refuse a write that would touch the read-only lifecycle fields.

        DRF silently ignores read-only fields, which turns a caller's
        PATCH {"status": "DELIVERED"} into a silent no-op returning 200. Better
        to say so. The same holds for the money and ownership columns: they are
        read-only in the serializer for the same reason `status` is, and a
        shopper who PATCHes payment_status or grand_total deserves to be told
        what actually writes those, not to be handed a 200 for a no-op.
        """
        blocked = {'status', 'picked_up_at', 'delivered_at', 'returned_at',
                   'cancelled_at', 'cancel_actor', 'cancel_reason',
                   'customer', 'site', 'address', 'payment_method',
                   'payment_status', 'subtotal', 'delivery_fee', 'discount',
                   'tax_amount', 'grand_total', 'short_amount'}
        attempted = blocked.intersection(self.request.data or {})
        if attempted:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({
                field: 'Order lifecycle fields are written by the transition '
                       'endpoints (ds-ops/order-action, ds-ops/pack-order, '
                       'delivery handoff) and totals by checkout, not by '
                       'editing the order.'
                for field in sorted(attempted)
            })
        return super().perform_update(serializer)

    @action(detail=True, methods=['get'], url_path='delivery-code')
    def delivery_code(self, request, pk=None):
        """The pickup code, for the person who has to read it out.

        The rider's handoff deliberately withholds the code - `complete_pod`
        mints it and returns only `otp_required` - because the code's whole
        job is to show that the rider and the customer are standing in front
        of the same order. This is the other half of that exchange: the
        shopper looking at their own order.

        `get_queryset` already lets a rider read their assigned orders and an
        admin read every order, which is what tracking needs and exactly wrong
        for a secret, so ownership is checked against the customer rather than
        trusted from the queryset. Everyone else gets 404 rather than 403: a
        rider who could tell "your order has no code yet" apart from "no such
        order" would be learning something about an order that is not theirs.

        The plaintext exists only in the outbox payload that the notification
        would have been sent from - the order keeps just the hash - so it is
        read back from there, and only while that hash is still live.
        """
        order = self.get_object()
        user = request.user
        if order.customer_id is None or order.customer.user_id != user.user_id:
            from rest_framework.exceptions import NotFound
            raise NotFound('No such order.')

        if not order.pod_otp_hash:
            # The hash is cleared the moment the delivery closes, so "issued
            # but no longer live" is a code that has already been spent.
            state = 'used' if order.pod_issued_at else 'not_requested'
            return Response({
                'order_id': str(order.order_id),
                'order_no': order.order_no,
                'status': order.status,
                'code': None,
                'state': state,
                'issued_at': order.pod_issued_at,
            })

        from bounded.outbox.models import OutboxEvent
        event = (OutboxEvent.objects
                 .filter(aggregate_type='CustomerOrder',
                         aggregate_id=order.order_id,
                         event_type='delivery.pod_requested')
                 .order_by('-created_at')
                 .first())
        payload = (event.payload_json or {}) if event else {}
        code = payload.get('otp')

        return Response({
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'status': order.status,
            'code': code,
            # `issued` means the hash is set but the payload did not yield a
            # code - a state the UI should report rather than blank out.
            'state': 'ready' if code else 'issued',
            'issued_at': order.pod_issued_at,
        })

    @action(detail=True, methods=['get'], url_path='tracking')
    def tracking(self, request, pk=None):
        """GET /api/orders/orders/{id}/tracking - where the parcel is right now.

        Ownership is checked against the customer, not trusted from
        `get_queryset`: a rider may read the orders they carry (their console
        needs them) and an admin reads everything, but neither is the shopper
        this screen belongs to. Everyone else gets 404 for the same reason the
        delivery code does - "no such order" must not differ from "not yours".

        The rider is named only while the order is moving. Once it is
        delivered the answer quietly drops back to `live: false`, so a saved
        link cannot replay somebody's last position out of context.
        """
        from django.utils import timezone
        from rest_framework.exceptions import NotFound

        order = self.get_object()
        user = request.user
        # Staff may look at any order (support does this on the phone); the
        # rider carrying it may not, and another shopper learns nothing.
        if not _is_admin(user) and (
                order.customer_id is None
                or order.customer.user_id != user.user_id):
            raise NotFound('No such order.')

        task = (order.delivery_tasks
                .select_related('rider', 'rider__user', 'site')
                .exclude(status__in=('WITHDRAWN', 'RECALLED'))
                .order_by('-created_at')
                .first())
        live = order.status in TRACKING_ORDER_STATUSES and task is not None and task.rider_id

        payload = {
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'status': order.status,
            'live': bool(live),
            'rider': None,
            'location': None,
            'destination': None,
            'distance_km': None,
            'eta_minutes': None,
            'stale': False,
            'updated_at': None,
        }
        if not live:
            return Response(payload)

        profile = task.rider
        payload['rider'] = {
            'name': _first_name(profile.name),
            'phone_masked': _mask_phone(profile.phone),
            'vehicle_type': profile.vehicle_type,
            'rating': float(profile.rating) if profile.rating is not None else None,
        }

        now = timezone.now()
        seen = profile.last_seen_at
        payload['stale'] = bool(
            seen is None or (now - seen).total_seconds() > TRACKING_STALE_AFTER)
        if profile.last_lat is not None and profile.last_lng is not None:
            payload['location'] = {
                'lat': float(profile.last_lat),
                'lng': float(profile.last_lng),
            }
            payload['updated_at'] = seen.isoformat() if seen else None

        # Where the parcel is headed: the address the shopper chose. Without
        # coordinates on the address there is nothing to measure against, so
        # the ETA stays null rather than being guessed.
        dest = order.address
        if dest is not None and dest.geo_lat is not None and dest.geo_lng is not None:
            payload['destination'] = {
                'lat': float(dest.geo_lat), 'lng': float(dest.geo_lng),
            }
            origin = None
            if payload['location']:
                origin = (payload['location']['lat'], payload['location']['lng'])
            elif task.site is not None and task.site.geo_lat is not None:
                origin = (float(task.site.geo_lat), float(task.site.geo_lng))
            if origin is not None:
                km = _km_between(origin[0], origin[1],
                                 payload['destination']['lat'],
                                 payload['destination']['lng'])
                payload['distance_km'] = round(km, 1)
                # Round up: telling somebody "0 min" while the rider is still
                # two streets away reads as broken, not early.
                from math import ceil
                payload['eta_minutes'] = max(
                    1, min(60, ceil(km / CITY_SPEED_KMH * 60)))
        return Response(payload)

class CheckoutView(APIView):
    """POST /api/orders/checkout - the shopper's leg.

    Everything identifying the buyer comes from the authenticated user, never
    from the request body. A checkout that accepted `customer_id` would let any
    logged-in account place orders into someone else's name and against their
    saved addresses.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from bounded.network.models import Site
        from .checkout import CheckoutError, place_order

        data = request.data or {}
        user = request.user

        if (getattr(user, 'role', '') in ('ADMIN', 'SUPER_ADMIN')
                or getattr(user, 'is_superuser', False)):
            # Staff accounts have no Customer row of their own, and inventing
            # one would silently order on somebody's behalf.
            return Response(
                {'error': 'This endpoint places orders for a customer account. '
                          'Log in as the shopper.'},
                status=400)

        customer = Customer.objects.filter(user_id=user.user_id).first()
        if customer is None:
            return Response(
                {'error': 'No customer account is linked to your login, so there '
                          'is nothing to order as.'},
                status=403)

        site_code = data.get('site')
        if not site_code:
            return Response({'error': 'Choose a store to order from.'}, status=400)
        try:
            site = Site.objects.get(code=site_code)
        except Site.DoesNotExist:
            return Response({'error': f'No store with code {site_code!r}.'},
                            status=404)

        address_id = data.get('address_id')
        address = None
        if address_id:
            # A malformed id reaches the UUID field as a raw string and Django
            # raises on it, which surfaces as a 500. It is a bad request, and
            # it is also not proof that the address exists on this account.
            from django.core.exceptions import ValidationError
            try:
                address = CustomerAddress.objects.filter(
                    customer=customer, address_id=address_id).first()
            except (ValidationError, ValueError, TypeError):
                return Response(
                    {'error': 'That address id is not one this server issued.'},
                    status=404)
            if address is None:
                return Response(
                    {'error': 'That address is not on your account.'}, status=403)
        else:
            address = (CustomerAddress.objects.filter(customer=customer, is_default=True).first()
                       or CustomerAddress.objects.filter(customer=customer).first())
            if address is None:
                return Response(
                    {'error': 'Add a delivery address to your account first.'},
                    status=400)

        cart = None
        if data.get('cart_id'):
            from .models import Cart
            cart = Cart.objects.filter(cart_id=data['cart_id']).first()
            if cart is None:
                return Response({'error': 'No such basket.'}, status=404)
            if cart.customer_id != customer.customer_id:
                # The basket id is a guessable identifier, so accepting any one
                # of them would let a shopper convert - and so close - another
                # shopper's basket while the order itself was placed in their
                # own name. Same rule as the address above.
                return Response(
                    {'error': 'That basket is not on your account.'}, status=403)
            if cart.site_id and cart.site_id != site.site_id:
                return Response(
                    {'error': f'That basket is for {cart.site.code}, not {site.code}.'},
                    status=400)

        try:
            result = place_order(
                customer=customer, site=site, address=address,
                items=data.get('items'), cart=cart,
                payment_method=data.get('payment_method') or 'COD',
                actor=user,
                coupon_code=data.get('coupon_code') or '',
                delivery_slot=data.get('delivery_slot') or '',
            )
        except CheckoutError as exc:
            return Response({'error': exc.message, **exc.detail}, status=exc.status)

        return Response({'success': True, **result['summary']}, status=201)


class StorefrontView(APIView):
    """GET /api/orders/storefront - what this store actually has on its shelves.

    A shopper cannot be shown a catalogue derived from the product master: an
    item with no stock is an item they will pay for and nobody will find. The
    listing gives the price, the shelf balances give the availability, and only
    the intersection of the two is offered.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.catalog.models import Listing, Sku
        from bounded.ds_ops.models import OrderLineAllocation
        from bounded.inventory.models import StockBalance
        from bounded.network.models import Site
        from django.db.models import Case, F, IntegerField, Sum, Value, When

        site_code = request.query_params.get('site')
        if not site_code:
            return Response({'error': 'site is required.'}, status=400)
        site = Site.objects.filter(code=site_code).first()
        if site is None:
            return Response({'error': f'No store with code {site_code!r}.'}, status=404)

        stock = {
            row['sku_id']: row
            for row in StockBalance.objects
            .filter(site=site, container='BIN', qty__gt=0)
            .values('sku_id').annotate(on_hand=Sum('qty'))
        }
        # `on_hand` is what is physically shelved, which includes units a
        # confirmed order has already bought. A pick takes its units off the
        # balance, so the unpicked remainder (`qty - picked_qty`) is exactly the
        # part that must not be offered again - the same rule checkout and
        # `allocate_order` apply. Without this the catalogue promises stock that
        # three other baskets are already paying for, and the shopper only
        # learns that when checkout refuses them.
        held = {
            row['line__sku_id']: row['held']
            for row in OrderLineAllocation.objects
            .filter(site=site)
            .exclude(status='RELEASED')
            .values('line__sku_id')
            .annotate(held=Sum(Case(
                When(qty__gt=F('picked_qty'), then=F('qty') - F('picked_qty')),
                default=Value(0), output_field=IntegerField())))
        }
        available = {
            sku_id: max(0, int(row.get('on_hand', 0)) - int(held.get(sku_id, 0)))
            for sku_id, row in stock.items()
        }
        listings = Listing.objects.filter(
            site=site, price__gt=0, is_listed=True,
            is_available=True).select_related('sku', 'sku__category')

        query = (request.query_params.get('q') or '').strip().lower()

        def matches(l):
            if not query:
                return True
            sku = l.sku
            hay = ' '.join(filter(None, [
                sku.name, sku.brand, sku.pack_size, sku.sku_code,
                sku.sub_category,
                sku.category.name if sku.category else '',
            ])).lower()
            return query in hay

        items = [
            {
                'sku_id': str(l.sku_id),
                'sku_code': l.sku.sku_code,
                'name': l.sku.name,
                'brand': l.sku.brand,
                'pack_size': l.sku.pack_size,
                'weight_g': l.sku.weight_g,
                'image': l.sku.image_url or '',
                # The shelf groups itself by this. `sub_category` is what the
                # cataloguer typed against the SKU; the category row is the
                # fallback when they left it blank.
                'category': l.sku.sub_category
                or (l.sku.category.name if l.sku.category else ''),
                'price': str(l.price),
                'mrp': str(l.sku.mrp),
                'on_offer': l.mrp > l.price,
                'available': available.get(l.sku_id, 0),
            }
            for l in listings
            if available.get(l.sku_id, 0) > 0
            and l.sku.status == 'ACTIVE'
            and matches(l)
        ]
        items.sort(key=lambda i: i['name'])

        # Delivery is priced by the store's own rule, and the same rule can
        # waive the fee above a basket threshold. The shelf also answers the
        # address question when a pincode is supplied, so a shopper is told
        # "not here" before they fill a basket.
        from bounded.money.models import DeliveryPricingRule, resolve_delivery_fee
        from bounded.routing.models import DeliveryArea

        rule = DeliveryPricingRule.objects.filter(site=site, is_active=True).first()
        pincode = (request.query_params.get('pincode') or '').strip()
        serviceable = True
        if pincode:
            serviceable = DeliveryArea.covers(site, pincode)

        return Response({
            'site': site.code,
            'name': site.name,
            'delivery_fee': str(resolve_delivery_fee(site)),
            'free_above': str(rule.free_above) if rule else '0.00',
            'delivery_configured': DeliveryArea.configured(site),
            'pincode': pincode,
            'serviceable': serviceable,
            'items': items,
        })


class OrderCancelView(APIView):
    """POST /api/orders/orders/{id}/cancel/ - the shopper cancels their own order.

    Only allowed while the order is still before picking (PLACED/CONFIRMED):
    once a picker has touched it, cancellation has to go through the return
    flow instead, because goods are already being pulled off the shelf.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, order_id):
        from django.utils import timezone
        order = CustomerOrder.objects.filter(
            order_id=order_id,
            customer__user_id=request.user.user_id).first()
        if order is None:
            return Response({'error': 'No such order on your account.'}, status=404)
        if order.status not in ('PLACED', 'CONFIRMED', 'PAYMENT_PENDING'):
            return Response(
                {'error': 'This order is already being prepared and can no '
                          'longer be cancelled here. Report a problem after '
                          'delivery instead.'},
                status=409)
        order.status = 'CANCELLED'
        order.cancel_actor = 'CUSTOMER'
        order.cancel_reason = (request.data.get('reason') or 'Cancelled by customer.')[:500]
        order.cancelled_at = timezone.now()
        order.save(update_fields=['status', 'cancel_actor', 'cancel_reason',
                                  'cancelled_at'])
        OrderStatusHistory.objects.create(
            order=order, from_status='CONFIRMED', to_status='CANCELLED',
            actor_type='CUSTOMER', actor_id=request.user.user_id,
            remark=order.cancel_reason,
        )
        return Response({'success': True, 'order_no': order.order_no,
                         'status': order.status})


class CustomerOrderLineViewSet(viewsets.ReadOnlyModelViewSet):
    """Order lines are read here and written by the lifecycle endpoints only.

    It was a ModelViewSet, which made `qty`, `unit_price`, `line_total`, `sku`
    and `lot` client-writable: a shopper could re-price or re-quantity a line
    after checkout had already approved it. The quantity counters are already
    read-only in the serializer for the same reason, and every legitimate write
    - a scan, packing, a handoff - arrives through its own guarded endpoint, so
    this view has nothing left to create.
    """
    queryset = CustomerOrderLine.objects.select_related('order','sku','lot').all()
    serializer_class = CustomerOrderLineSerializer
    # Without this a shopper could not ask for the lines of *one* order, so the
    # order detail screen would have to pull every line they own and filter
    # client-side.
    filterset_fields = ['order', 'status']

    def get_queryset(self):
        return _owned(self.request, self.queryset, owner='order__customer')

class OrderStatusHistoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = OrderStatusHistory.objects.select_related('order').all()
    serializer_class = OrderStatusHistorySerializer
    filterset_fields = ['order']

    def get_queryset(self):
        # An audit trail of every order in the network, order numbers
        # included, is not something one shopper should be able to page
        # through. It stays read-only; here it is also narrowed to theirs.
        return _owned(self.request, self.queryset, owner='order__customer')
