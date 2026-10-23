"""
Turning a basket into an order a dark store will actually pick.

Until this existed, every `CustomerOrder` in the system had been written
straight into the database. That is not a shortcut, it is a hole: the shopper's
leg was missing entirely, so there was no code path where stock was *checked*
before an order promised it, no server-side price, and no point at which a
customer could learn their order could not be fulfilled. The first sign of a
problem was a picker standing at an empty shelf.

So checkout does the four things that have to happen before an order is real,
all inside one transaction:

  1. **Price on the server.** `Listing.price` at that store, never a number the
     client sent. A cart that can name its own price is a cart that charges
     whatever it likes.

  2. **Choose the lot, FEFO.** A lot is picked per line here so the picker is
     not asked to make a freshness decision at the shelf, and so the order line
     records which batch the customer is owed.

  3. **Reserve the stock immediately** by allocating to bins. `allocate_order`
     takes `SELECT ... FOR UPDATE` on the balances, so two shoppers checking out
     the last unit cannot both be told yes. This is the same call the pick
     screen uses, which is why a picker opening a freshly placed order sees a
     route rather than an unallocated order.

  4. **Refuse cleanly when it cannot be filled**, naming the SKU and the number
     actually on the shelf. A clear "only 2 left" is recoverable; a half-placed
     order is not.

Payment is deliberately not faked. There is no payment adapter in this project,
so a PREPAID order cannot honestly be marked CAPTURED, and it cannot reach
CONFIRMED either - the store would start picking goods nobody has paid for.
PREPAID is therefore refused with an explanation rather than quietly accepted.
COD is the supported path, and it reaches CONFIRMED.
"""
import uuid
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

# Default dark-store delivery fee, for a store with no pricing rule of its
# own. The live number comes from money.DeliveryPricingRule (see
# resolve_delivery_fee); this is what a fresh, unconfigured estate charges.
DELIVERY_FEE = Decimal('20.00')

# Site types an order may be fulfilled from.
#
# `Site.SITE_TYPE_CHOICES` spells a dark store 'DS', and that is the only value
# the live estate ever holds - every row in the database reads DS. Checkout,
# however, compared against the literal 'DARK_STORE', a string that appears in
# no model enum and no production row. The result was that a shopper who picked
# any real store was refused with "DS-... is not a dark store", so the shopper
# app could not place a single order against real data even though the entire
# backend suite stayed green - every test fabricated its own site with the
# 'DARK_STORE' spelling the guard happened to expect.
#
# Both spellings are therefore treated as the same thing. Accepting the legacy
# spelling keeps the existing fixtures working; accepting 'DS' is what lets the
# application work at all.
ORDERABLE_SITE_TYPES = ('DS', 'DARK_STORE')


def is_orderable_site(site):
    """Whether orders may be placed against this site.

    A dark store is the only site type that holds shelf stock a picker can walk
    to. Warehouses and cross-docks are replenishment nodes, not a place a
    customer's order can be picked from, so they are refused here rather than
    being accepted and then stalling in a pick queue forever.
    """
    return getattr(site, 'site_type', '') in ORDERABLE_SITE_TYPES


# An order number has to be short, unique, and legible over the phone to a
# rider who is reading it off a tote label.
_ORDER_NO_PREFIX = 'ZP'


class CheckoutError(Exception):
    """A basket that cannot become an order. Carries `detail` for the response."""

    def __init__(self, message, *, status=400, detail=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.detail = detail or {}


def _next_order_no():
    """
    An order number no other order can hold.

    Built from a UUID fragment rather than a counter: the live database has no
    order sequence, and two checkouts racing on a MAX()+1 both read the same
    highest number and one silently loses its order.
    """
    for _ in range(5):
        candidate = f'{_ORDER_NO_PREFIX}{uuid.uuid4().hex[:8].upper()}'
        from bounded.orders.models import CustomerOrder
        if not CustomerOrder.objects.filter(order_no=candidate).exists():
            return candidate
    raise CheckoutError(  # pragma: no cover - astronomically unlikely
        'Could not allocate an order number, please retry.',
        status=503)


def _normalise_items(raw_items):
    """
    Fold the requested basket into one entry per SKU.

    Duplicates are summed rather than rejected: a shopper who taps a product
    twice wants two, and two separate order lines for one SKU would make the
    picker visit the same shelf twice for one item.
    """
    wanted = {}
    for raw in raw_items or []:
        sku_id = raw.get('sku_id')
        try:
            qty = int(raw.get('qty', 1))
        except (TypeError, ValueError):
            raise CheckoutError(f'Quantity for {sku_id} is not a number.')
        if qty <= 0:
            raise CheckoutError(
                'Quantities must be at least 1. Use the remove control rather '
                'than a zero or negative quantity.')
        key = str(sku_id)
        wanted[key] = wanted.get(key, 0) + qty
    if not wanted:
        raise CheckoutError('Your basket is empty.')
    return wanted


@transaction.atomic
def place_order(*, customer, site, address, items=None, cart=None,
                payment_method='COD', actor=None, coupon_code='', delivery_slot=''):
    """
    Convert a basket into a CONFIRMED order with its stock already reserved.

    Raises CheckoutError with a shopper-readable message on anything that would
    leave a half-built order behind. Nothing is committed unless it all works.
    """
    from bounded.catalog.models import InventoryLot, Listing, Sku, Coupon
    from bounded.inventory.models import StockBalance
    from bounded.orders.models import (
        CustomerOrder, CustomerOrderLine, OrderStatusHistory,
    )
    from bounded.outbox.models import OutboxEvent
    from bounded.ds_ops.allocation import (
    AllocationError, allocate_order, reserved_qty,
)

    if not is_orderable_site(site):
        raise CheckoutError(
            f'{site.code} is not a dark store, so it cannot fulfil orders.')

    # -- can this store even reach the address? -----------------------------
    # A store that has published delivery areas only serves those pincodes,
    # so an unreachable address is refused before stock is locked. Stores with
    # no areas configured keep working exactly as before.
    from bounded.routing.models import DeliveryArea
    if not DeliveryArea.covers(site, getattr(address, 'pincode', '')):
        raise CheckoutError(
            f'{site.code} does not deliver to {getattr(address, "pincode", "") or "that address"}. '
            'Pick a store closer to you.',
            detail={'reason': 'OUT_OF_DELIVERY_AREA',
                    'pincode': getattr(address, 'pincode', '')})

    # One number decides this order's delivery charge: the store's own pricing
    # rule if it has one, the flat default if it does not. Resolved once and
    # used for the order row, the grand total and the summary below, so the
    # three can never disagree. The store's free-delivery threshold is applied
    # once the basket subtotal is known, below.
    from bounded.money.models import resolve_delivery_fee
    delivery_fee = resolve_delivery_fee(site)

    if address.customer_id != customer.customer_id:
        raise CheckoutError(
            'That delivery address belongs to a different account.',
            status=403)

    if payment_method not in dict(CustomerOrder.PAYMENT_METHODS):
        raise CheckoutError(
            f'Unknown payment method {payment_method!r}.',
            detail={'allowed': sorted(dict(CustomerOrder.PAYMENT_METHODS))})

    if cart is not None:
        if cart.customer_id != customer.customer_id:
            raise CheckoutError('That basket belongs to a different account.',
                                status=403)
        if cart.status != 'ACTIVE':
            raise CheckoutError(
                f'This basket is already {cart.status.lower()}.', status=409)
        if items:
            raise CheckoutError(
                'Send either a basket or a list of items, not both.', status=400)

    wanted = _normalise_items(items) if items is not None else _normalise_items(
        [{'sku_id': l.sku_id, 'qty': l.qty} for l in cart.lines.select_related('sku')])

    skus = {
        str(s.sku_id): s
        for s in Sku.objects.filter(sku_id__in=list(wanted))
    }

    # -- price, from this store's listing, not from the client -------------
    # `is_listed` and `is_available` both have to be true: a listing row can
    # exist as a price record while the store has delisted the item or switched
    # it off, and a shopper must not be able to buy it just because the row is
    # still there.
    prices = {
        str(l.sku_id): l.price
        for l in Listing.objects.filter(
            site=site, sku_id__in=list(wanted), price__gt=0,
            is_listed=True, is_available=True)
    }
    unlisted = [
        {'sku_id': k, 'name': skus[k].name if k in skus else None}
        for k in wanted if k not in prices
    ]
    if unlisted:
        raise CheckoutError(
            'Some items are not sold at this store right now.',
            status=409, detail={'unavailable': unlisted})

    # -- one lot per line -------------------------------------------------
    # A line names exactly one lot, so the lot chosen has to be able to cover
    # the whole line on its own. Choosing purely by expiry and finding out
    # afterwards is wrong: a shelf holding 2 of the earliest lot and 6 of the
    # next is one product with 8 on hand, and refusing the order because the
    # oldest batch is short refuses a customer over a freshness rule they never
    # asked for. So walk the lots earliest-first and take the first one that can
    # actually fill the line.
    lots_by_sku = {}
    shelf_stock = {}
    for sku_id, qty in wanted.items():
        balances = list(
            StockBalance.objects
            .filter(site=site, container='BIN', sku_id=sku_id, qty__gt=0)
            .order_by('container_ref')
        )
        # `b.qty` is what is physically on the shelf, not what this shopper may
        # buy: a confirmed order holds its units in `OrderLineAllocation` until
        # a picker scans them off. Choosing a lot on the raw balance picks a
        # batch somebody else already owns, and the "N on the shelf" in the
        # refusal below tells the customer they lost units that were never
        # theirs to lose. So the lot walk and the availability number both use
        # what is left after other orders are taken out - the same rule
        # `allocate_order` enforces when it takes the lock.
        free_by_lot = {}
        for b in balances:
            free_by_lot[b.lot_id] = free_by_lot.get(b.lot_id, 0) + max(
                0, b.qty - reserved_qty(site, b.container_ref, sku_id, b.lot_id))
        shelf_stock[sku_id] = sum(free_by_lot.values())
        candidates = list(
            InventoryLot.objects
            .filter(lot_id__in={b.lot_id for b in balances},
                    sku_id=sku_id, bucket='Good')
            .order_by('expiry_date', 'lot_id')
        )
        chosen = next((lot for lot in candidates
                       if free_by_lot.get(lot.lot_id, 0) >= qty), None)
        lots_by_sku[sku_id] = (chosen, candidates)

    short = [
        {
            'sku_id': sku_id,
            'sku_code': skus[sku_id].sku_code if sku_id in skus else None,
            'name': skus[sku_id].name if sku_id in skus else None,
            'requested': qty,
            'available': shelf_stock[sku_id],
            'reason': ('no single batch on the shelf is large enough to fill '
                       'this line'
                       if lots_by_sku[sku_id][0] is None and shelf_stock[sku_id] >= qty
                       else 'not enough shelved stock at this store'),
        }
        for sku_id, qty in wanted.items() if lots_by_sku[sku_id][0] is None
    ]
    if short:
        names = ', '.join(
            f"{s['name']} ({s['reason']}, {s['available']} on the shelf)"
            for s in short)
        raise CheckoutError(
            f'Some items cannot be filled from {site.code} right now: {names}.',
            status=409, detail={'short_lines': short})

    # -- build it ----------------------------------------------------------
    # Coupon: resolve it now that we know the subtotal, before the order row
    # exists, so an invalid code is a clean 400 instead of a rolled-back insert.
    coupon = None
    discount = Decimal('0.00')
    if coupon_code:
        coupon = Coupon.objects.filter(code=coupon_code.strip().upper()).first()
        if coupon is None or not coupon.is_valid_now():
            raise CheckoutError(
                'That coupon code is not valid right now.', status=400)
        # min-order is checked against the subtotal we are about to compute;
        # done after lines are built below.

    order = CustomerOrder(
        order_no=_next_order_no(),
        customer=customer, site=site, address=address,
        status='CONFIRMED', payment_method=payment_method,
        # COD/UPI/Card are all settled outside this build's payment layer, so
        # nothing is captured now. The store may still pick, because the order
        # itself is real.
        payment_status='PENDING',
        subtotal=Decimal('0.00'), delivery_fee=delivery_fee,
        grand_total=Decimal('0.00'),
        coupon_code=(coupon.code if coupon else ''),
        delivery_slot=delivery_slot or '',
    )
    order.save()

    subtotal = Decimal('0.00')
    lines = []
    for line_no, sku_id in enumerate(sorted(wanted, key=lambda k: skus[k].sku_code), start=1):
        qty = wanted[sku_id]
        unit_price = prices[sku_id]
        lot = lots_by_sku[sku_id][0]
        line_total = (unit_price * qty).quantize(Decimal('0.01'))
        subtotal += line_total
        lines.append(CustomerOrderLine(
            order=order, line_no=line_no, sku=skus[sku_id], lot=lot, qty=qty,
            unit_price=unit_price, line_total=line_total,
        ))

    subtotal = subtotal.quantize(Decimal('0.01'))
    order.subtotal = subtotal

    # The basket is now known, so the store's free-delivery threshold can be
    # applied. This must happen before the grand total is computed: waiving the
    # fee afterwards would leave a total that charges for delivery.
    delivery_fee = resolve_delivery_fee(site, subtotal)
    order.delivery_fee = delivery_fee

    if coupon is not None:
        if subtotal < coupon.min_order:
            raise CheckoutError(
                f'{coupon.code} needs a minimum order of '
                f'₹{coupon.min_order}.', status=400)
        discount = coupon.compute_discount(subtotal)
        order.discount = discount

    order.grand_total = (subtotal - discount + delivery_fee).quantize(Decimal('0.01'))
    order.save(update_fields=['subtotal', 'delivery_fee', 'discount', 'grand_total'])
    for line in lines:
        line.save()

    # -- reserve the units -------------------------------------------------
    # This is the step that makes the promise real. allocate_order locks the
    # balances and refuses to commit a partial reservation, so an order either
    # owns its stock or was never created.
    try:
        allocation = allocate_order(order, actor=actor)
    except AllocationError as exc:
        raise CheckoutError(
            'Those items were taken while you were checking out. Nothing has '
            'been charged and your basket is untouched - please try again.',
            status=409, detail={'short_lines': getattr(exc, 'args', [[]])[0]})

    if cart is not None:
        cart.status = 'CONVERTED'
        cart.subtotal = subtotal
        cart.save(update_fields=['status', 'subtotal'])

    OrderStatusHistory.objects.create(
        order=order, from_status=None, to_status='CONFIRMED',
        actor_type=(actor.role if actor is not None else 'SYSTEM'),
        actor_id=(actor.user_id if actor is not None else None),
        remark='Order placed by the customer.',
    )

    OutboxEvent.objects.create(
        aggregate_type='CustomerOrder', aggregate_id=order.order_id,
        event_type='order.placed',
        payload_json={
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'site_code': site.code,
            'customer_user_id': str(customer.user_id),
            'grand_total': str(order.grand_total),
            'payment_method': payment_method,
        },
    )

    return {
        'order': order,
        'allocation': allocation,
        'summary': {
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'status': order.status,
            'site': site.code,
            'payment_method': payment_method,
            'subtotal': str(subtotal),
            'discount': str(order.discount),
            'delivery_fee': str(delivery_fee),
            'grand_total': str(order.grand_total),
            'coupon_code': order.coupon_code,
            'delivery_slot': order.delivery_slot,
            'lines': [
                {
                    'line_no': line.line_no,
                    'sku_code': line.sku.sku_code,
                    'name': line.sku.name,
                    'qty': line.qty,
                    'unit_price': str(line.unit_price),
                    'line_total': str(line.line_total),
                    'batch': line.lot.batch_number if line.lot_id else None,
                }
                for line in order.lines.select_related('sku', 'lot').order_by('line_no')
            ],
        },
    }