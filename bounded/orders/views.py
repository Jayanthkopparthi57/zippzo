from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Customer, CustomerAddress, Cart, CartLine, CustomerOrder, CustomerOrderLine, OrderStatusHistory
from .serializers import CustomerSerializer, CustomerAddressSerializer, CartSerializer, CartLineSerializer, CustomerOrderSerializer, CustomerOrderLineSerializer, OrderStatusHistorySerializer

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

    def perform_update(self, serializer):
        """Refuse a write that would touch the read-only lifecycle fields.

        DRF silently ignores read-only fields, which turns a caller's
        PATCH {"status": "DELIVERED"} into a silent no-op returning 200. Better
        to say so.
        """
        blocked = {'status', 'picked_up_at', 'delivered_at', 'returned_at',
                   'cancelled_at', 'cancel_actor', 'cancel_reason'}
        attempted = blocked.intersection(self.request.data or {})
        if attempted:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({
                field: 'Order lifecycle fields are written by the transition '
                       'endpoints (ds-ops/order-action, ds-ops/pack-order, '
                       'delivery handoff), not by editing the order.'
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
            is_available=True).select_related('sku')

        items = [
            {
                'sku_id': str(l.sku_id),
                'sku_code': l.sku.sku_code,
                'name': l.sku.name,
                'brand': l.sku.brand,
                'pack_size': l.sku.pack_size,
                'weight_g': l.sku.weight_g,
                'image': getattr(l.sku, 'image_url', '') or '',
                'price': str(l.price),
                'mrp': str(l.sku.mrp),
                'on_offer': l.mrp > l.price,
                'available': available.get(l.sku_id, 0),
            }
            for l in listings
            if available.get(l.sku_id, 0) > 0
            and l.sku.status == 'ACTIVE'
        ]
        items.sort(key=lambda i: i['name'])

        return Response({
            'site': site.code,
            'name': site.name,
            'delivery_fee': '20.00',
            'items': items,
        })


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
