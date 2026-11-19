"""
Last-mile handoff: pickup and proof of delivery.

These are the two transitions where goods and money physically change hands, and
both used to be missing. `DeliveryTaskViewSet` accepted an unvalidated PATCH, so
a caller could set `status: DELIVERED` on any task without collecting anything
and without settling COD, and no order status or shipped_qty moved with it.

`HandoffService` puts both steps behind one guarded operation each:

  * pickup  requires the order to be staged and handed to a rider, moves the
    order to PICKED_UP, sets shipped_qty on every line and clears the store's
    custody of the units - the last point at which the store still owns them.
    Outbound orders ride in loose bags; no LPN/tote barcode is read here.
  * pod     requires the pickup OTP, and for cash orders requires the amount
    actually collected, before the order is allowed to reach DELIVERED.

The OTP is stored hashed. It is a confirmation that the rider and the customer
were both looking at the same order, so a rider who guesses four digits must not
be able to close ten thousand orders; and it is cleared once used, so a captured
code cannot be replayed against the same order.
"""
import hashlib
import secrets
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import F
from django.utils import timezone


class HandoffError(Exception):
    def __init__(self, message, *, status=409, **detail):
        super().__init__(message)
        self.message = message
        self.status = status
        self.detail = detail


def _hash_otp(otp):
    return hashlib.sha256(f'zippzo-pod:{otp}'.encode()).hexdigest()


def issue_pickup_otp(order):
    """Mint a 6-digit pickup code, return it once and keep only the hash."""
    otp = f'{secrets.randbelow(1000000):06d}'
    order.pod_otp_hash = _hash_otp(otp)
    order.pod_issued_at = timezone.now()
    order.save(update_fields=['pod_otp_hash', 'pod_issued_at'])
    return otp


def _start_pod(order, actor):
    """Move the order into POD_PENDING and hand back the OTP the customer must read."""
    otp = issue_pickup_otp(order)
    from bounded.outbox.services import enqueue_event
    enqueue_event(
        aggregate_type='CustomerOrder', aggregate_id=order.order_id,
        event_type='delivery.pod_requested', correlation_id=order.order_id,
        payload_json={
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'otp': otp,
            'customer_user_id': str(order.customer.user_id) if order.customer_id else None,
            'requested_by': str(actor.user_id),
        },
    )
    return otp


# A rider stops being handed cash once this ceiling is passed; it is the number
# the custody screen refuses against, so it has to exist before the first
# collection rather than being invented per delivery.
DEFAULT_CASH_CEILING = Decimal('5000.00')


def _settle_delivery(*, order, task, actor, cod, delivered_at,
                     signature=None, method=None):
    """Write the money, the custody and the proof that close a delivery.

    Until this existed the order read CAPTURED and nothing else happened: no
    cash movement, no rider custody balance, no earning, no evidence that
    somebody at the door accepted the bag. Four separate tables were declared
    for exactly this moment and none of them was ever written.

    Every write here is idempotent, because complete_pod is a retried call on a
    flaky connection and a double-counted cash custody is unrecoverable.
    """
    from bounded.lastmile.models import PODEvidence
    from bounded.money.models import (CashMovement, Payment,
                                      RiderCustodyState, RiderEarnings)

    rider_id = task.rider_id
    if rider_id is None and getattr(actor, 'role', '') == 'RIDER':
        from bounded.delivery.models import RiderProfile
        profile = RiderProfile.objects.filter(user_id=actor.user_id).first()
        rider_id = profile.rider_id if profile else None

    if rider_id is not None:
        state, created = RiderCustodyState.objects.get_or_create(
            rider_id=rider_id,
            defaults={
                'site': order.site.code if order.site_id else '',
                'current_cash': Decimal('0.00'),
                'current_float': Decimal('0.00'),
                'bags_in_custody': 0,
                'ceiling_amount': DEFAULT_CASH_CEILING,
            })
        if not created:
            # The bag has just been handed over; it is no longer with the rider.
            # Floored at zero because a replayed settlement must not drive the
            # counter negative - the DB check constraint rejects that.
            state.bags_in_custody = max(0, (state.bags_in_custody or 0) - 1)
            state.save(update_fields=['bags_in_custody', 'updated_at'])

        PODEvidence.objects.get_or_create(
            task=task,
            defaults={
                'rider_id': rider_id,
                'signature': (signature or '')[:500],
                'method': method or ('SIGNATURE' if signature else 'PIN'),
                'otp_verified': True,
                'delivered_at': delivered_at,
            })

        fee = order.delivery_fee or Decimal('0.00')
        RiderEarnings.objects.get_or_create(
            order=order, rider_id=rider_id,
            defaults={
                'amount': fee, 'delivery_fee': fee, 'tips': Decimal('0.00'),
                'status': 'PENDING',
            })

    if cod is None or rider_id is None:
        return None

    # The Payment row that CAPTURED on this order is talking about. COD has no
    # gateway, so the capture is a person handing cash to a rider at the door;
    # without this row the order read "captured" and the money app had nothing
    # to show for it. One row per order - a replayed POD must not book the
    # same cash twice.
    Payment.objects.get_or_create(
        order=order, method='COD_CASH',
        defaults={
            'customer_id': order.customer_id,
            'gateway': 'CASH',
            'amount': cod,
            'status': 'CAPTURED',
            'captured_at': timezone.now(),
        })

    _, was_created = CashMovement.objects.get_or_create(
        idempotency_key=f'COD_COLLECT:{order.order_id}',
        defaults={
            'movement_type': 'COD_COLLECT',
            'amount': cod,
            'site': order.site.code if order.site_id else '',
            'from_container': 'CUSTOMER',
            'from_ref_id': str(order.customer_id or ''),
            'to_container': 'RIDER',
            'to_ref_id': str(rider_id),
            'ref_type': 'ORDER',
            'ref_id': str(order.order_id),
            'actor_id': str(actor.user_id),
            'actor_type': actor.role,
        })
    if not was_created:
        return None

    state, created = RiderCustodyState.objects.get_or_create(
        rider_id=rider_id,
        defaults={
            'site': order.site.code if order.site_id else '',
            'current_cash': cod,
            'current_float': Decimal('0.00'),
            'bags_in_custody': 0,
            'ceiling_amount': DEFAULT_CASH_CEILING,
        })
    if not created:
        state.current_cash = (state.current_cash or Decimal('0.00')) + cod
        state.save(update_fields=['current_cash', 'updated_at'])

    if state.current_cash > state.ceiling_amount:
        # Over the ceiling is reported, not refused: the delivery already
        # happened, and refusing here would strand a delivered order.
        return {'cash_over_ceiling': str(
            state.current_cash - state.ceiling_amount)}
    return None


@transaction.atomic
def rider_pickup(*, task, actor):
    from bounded.inventory.models import StockBalance
    from bounded.inventory.stock import already_applied, apply_stock
    from bounded.orders.models import CustomerOrderLine, OrderStatusHistory
    from bounded.outbox.services import enqueue_event

    order = task.order
    order = type(order).objects.select_for_update().select_related('site').get(pk=order.pk)

    if task.status not in {'PACKED', 'STAGED', 'UNASSIGNED', 'OFFERED',
                           'ACCEPTED', 'AT_DS'}:
        raise HandoffError(
            f'Delivery task {task.task_id} is {task.status}; it cannot be picked '
            f'up from there.')

    previous = order.status
    now = timezone.now()

    # shipped_qty is the count of units that actually left the store with the
    # rider. Until it is written the order has no notion of what the rider carried,
    # so a short or wrong pickup would be invisible.
    lines = list(CustomerOrderLine.objects.select_for_update(of=('self',))
                 .filter(order=order).select_related('sku', 'lot'))

    # Two shapes of task exist on outbound orders:
    #   * loose bag (current code): goods live in a per-line CUSTODY balance
    #     created at pack;
    #   * legacy tote task: goods live in the LPN balance the order was sealed
    #     into before outbound totes were removed. Ship from that balance so the
    #     ledger stays balanced for orders packed under the old flow.
    if task.bin:
        ship_container, ship_ref = 'LPN', task.bin
    else:
        ship_container, ship_ref = 'CUSTODY', None

    for line in lines:
        if line.lot_id is None or not line.packed_qty:
            continue
        container = ship_container
        container_ref = ship_ref if ship_ref is not None else str(line.line_id)
        if not already_applied(
            site=order.site, sku=line.sku, lot=line.lot,
            movement_type='SHIP', ref_type='ORDERLINE', ref_id=line.line_id,
            direction='OUT', container=container, container_ref=container_ref):
            apply_stock(
                site=order.site, sku=line.sku, lot=line.lot, qty=line.packed_qty,
                direction='OUT', movement_type='SHIP',
                ref_type='ORDERLINE', ref_id=line.line_id,
                actor_id=str(actor.user_id), actor_type=actor.role,
                container=container, container_ref=container_ref,
                sellable=False,
            )
        line.shipped_qty = line.packed_qty
        line.save(update_fields=['shipped_qty'])

    if task.bin:
        # Legacy tote task: the tote leaves the store with the rider. New
        # loose-bag tasks carry no bin and skip this entirely.
        from bounded.inventory.models import LpnMaster
        lpn = LpnMaster.objects.select_for_update().filter(pk=task.bin).first()
        if lpn is not None:
            lpn.status = 'IN_TRANSIT'
            lpn.current_site = None
            lpn.save(update_fields=['status', 'current_site'])

    task.status = 'PICKED_UP'
    task.pickup_at = now
    task.save(update_fields=['status', 'pickup_at'])

    if task.rider_id:
        # One more bag is now with the rider, so the custody screen shows what
        # they are physically carrying and has to hand back.
        from bounded.money.models import RiderCustodyState
        state, created = RiderCustodyState.objects.get_or_create(
            rider_id=task.rider_id,
            defaults={
                'site': order.site.code if order.site_id else '',
                'current_cash': Decimal('0.00'),
                'current_float': Decimal('0.00'),
                'bags_in_custody': 1,
                'ceiling_amount': DEFAULT_CASH_CEILING,
            })
        if not created:
            state.bags_in_custody = (state.bags_in_custody or 0) + 1
            state.save(update_fields=['bags_in_custody', 'updated_at'])

    order.status = 'PICKED_UP'
    order.picked_up_at = order.picked_up_at or now
    order.save(update_fields=['status', 'picked_up_at'])

    OrderStatusHistory.objects.create(
        order=order, from_status=previous, to_status='PICKED_UP',
        actor_type=actor.role, actor_id=str(actor.user_id))

    enqueue_event(
        aggregate_type='CustomerOrder', aggregate_id=order.order_id,
        event_type='order.picked_up', correlation_id=order.order_id,
        payload_json={
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'task_id': str(task.task_id),
            'rider_user_id': str(actor.user_id),
            'shipped_units': sum(l.shipped_qty for l in lines),
        },
    )

    return {
        'order_id': str(order.order_id),
        'order_no': order.order_no,
        'status': order.status,
        'task_status': task.status,
        'previous_status': previous,
        'pickup_at': task.pickup_at,
        'shipped_qty': sum(l.shipped_qty for l in lines),
        'can_request_pod': True,
    }


@transaction.atomic
def complete_pod(*, task, actor, otp=None, cod_amount=None,
                 signature=None, method=None):
    from bounded.orders.models import OrderStatusHistory
    from bounded.outbox.services import enqueue_event

    order = type(task.order).objects.select_for_update().select_related(
        'site').get(pk=task.order_id)
    task = type(task).objects.select_for_update().get(pk=task.pk)

    if task.status not in {'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'POD_PENDING'}:
        raise HandoffError(
            f'Delivery task {task.task_id} is {task.status}; the order has not '
            f'been picked up yet.')

    # `advance` will walk AT_DS straight to EN_ROUTE, and `complete_pod` used
    # to read the status alone, so a task could be delivered without ever
    # leaving the store: shipped_qty stayed 0, no SHIP movement was written and
    # the units were still counted as sellable on the shelf while the customer
    # had them. Pickup is the step that books them out, so it is required here
    # regardless of what the task now says about itself.
    if task.pickup_at is None:
        raise HandoffError(
            f'{order.order_no} has not been collected from the store yet; '
            f'record the pickup before handing it over.',
            pickup_required=True)

    if not order.pod_otp_hash:
        _start_pod(order, actor)
        # Park the task so the rider's screen shows "waiting for the customer's
        # code" instead of a task that looks abandoned. Committed here rather
        # than in _start_pod because both rows belong to the same transaction
        # as the OTP - see the note below.
        task.status = 'POD_PENDING'
        task.save(update_fields=['status'])
        # Returned, not raised. complete_pod runs inside a transaction, so
        # raising here would roll back the very OTP it just minted: the customer
        # would never be sent a code, the order would never carry a hash, and
        # every subsequent attempt would mint a fresh code instead of checking
        # the one the customer is holding.
        return {
            'otp_required': True,
            # The code itself is deliberately absent. It reaches the customer
            # through the outbox notification; handing it back to the caller would
            # make the code a secret the rider already holds, which is the whole
            # thing the code exists to prove.
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'status': order.status,
            'task_status': task.status,
        }
    if not otp:
        raise HandoffError('otp is required to close a delivery.', status=400,
                           otp_required=True)
    if not secrets.compare_digest(order.pod_otp_hash, _hash_otp(str(otp).strip())):
        raise HandoffError('That pickup code does not match this order.',
                           status=400, otp_required=True)

    cod = None
    cod_due = None
    cod_variance = None
    # A COD order can be settled online at the door (card / UPI / UPI QR via
    # Cashfree). The webhook may confirm that capture while the rider's phone
    # is offline, so `order.payment_method` can still say COD even though the
    # customer has already paid. If this delivery also records cash, the same
    # order is collected twice; the provider attempt is the authority, not what
    # the rider's screen happened to show.
    from bounded.orders.models import PaymentAttempt

    paid_online_attempt = None
    if order.payment_method == 'COD':
        paid_online_attempt = PaymentAttempt.objects.filter(
            order=order, status='PAID').order_by('-updated_at').first()

    if order.payment_method == 'COD' and paid_online_attempt is None:
        if cod_amount is None or str(cod_amount).strip() == '':
            raise HandoffError(
                f'{order.order_no} is cash on delivery; record what was '
                f'collected.', status=400, cod_required=True,
                cod_due=str(order.grand_total))
        # `str(x)` never raises, so the previous `try: str(...) except ValueError`
        # could not have caught a non-number - any junk string was recorded as
        # cash collected and then set payment_status to CAPTURED. The amount has
        # to actually parse as money.
        try:
            cod = Decimal(str(cod_amount).strip()).quantize(Decimal('0.01'))
        except (InvalidOperation, ValueError, ArithmeticError):
            raise HandoffError(
                f'cod_amount {str(cod_amount)!r} is not an amount.',
                status=400, cod_due=str(order.grand_total))
        # Decimal parses NaN and Infinity happily, and then refuses to be
        # compared - so the check below would raise instead of reporting bad
        # input. Reject them while they are still values.
        if not cod.is_finite():
            raise HandoffError(
                f'cod_amount {str(cod_amount)!r} is not a finite amount.',
                status=400, cod_due=str(order.grand_total))
        if cod < 0:
            raise HandoffError('cod_amount cannot be negative.', status=400,
                               cod_due=str(order.grand_total))
        cod_due = Decimal(order.grand_total).quantize(Decimal('0.01'))
        cod_variance = cod - cod_due

    now = timezone.now()
    previous = order.status

    if paid_online_attempt is not None:
        # The customer paid Cashfree, not the rider. Record the capture so the
        # door handover, the payment row and the order agree, and deliberately
        # write no cash movement: no note ever entered the rider's custody.
        from bounded.money.models import Payment

        order.payment_method = 'CASHFREE'
        order.payment_status = 'CAPTURED'
        Payment.objects.get_or_create(
            order=order,
            gateway_order_id=paid_online_attempt.provider_order_id,
            defaults={
                'customer_id': order.customer_id,
                'method': 'COD_UPI',
                'gateway': 'CASHFREE',
                'gateway_payment_id': paid_online_attempt.provider_payment_id,
                'amount': paid_online_attempt.amount,
                'status': 'CAPTURED',
                'captured_at': now,
            })

    task.status = 'DELIVERED'
    task.delivered_at = now
    task.save(update_fields=['status', 'delivered_at'])
    # Capacity freed: the next waiting task at this store goes to whoever is
    # online with room for it.
    from bounded.delivery.dispatch import assign_pending_at
    assign_pending_at(task.site, actor)

    order.status = 'DELIVERED'
    order.delivered_at = now
    fields = ['status', 'delivered_at', 'payment_method', 'payment_status']
    if order.payment_method == 'COD':
        order.payment_status = 'CAPTURED'
    # The code is single use. Keeping it would let a captured screenshot close
    # the same order again later.
    order.pod_otp_hash = None
    fields.append('pod_otp_hash')
    order.save(update_fields=fields)

    OrderStatusHistory.objects.create(
        order=order, from_status=previous, to_status='PICKED_UP',
        actor_type=actor.role, actor_id=str(actor.user_id))

    enqueue_event(
        aggregate_type='CustomerOrder', aggregate_id=order.order_id,
        event_type='order.picked_up', correlation_id=order.order_id,
        payload_json={
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'task_id': str(task.task_id),
            'rider_user_id': str(actor.user_id),
            'shipped_units': sum(l.shipped_qty for l in lines),
        },
    )

    return {
        'order_id': str(order.order_id),
        'order_no': order.order_no,
        'status': order.status,
        'task_status': task.status,
        'previous_status': previous,
        'pickup_at': task.pickup_at,
        'shipped_qty': sum(l.shipped_qty for l in lines),
        'can_request_pod': True,
    }


@transaction.atomic
def complete_pod(*, task, actor, otp=None, cod_amount=None,
                 signature=None, method=None):
    from bounded.orders.models import OrderStatusHistory
    from bounded.outbox.services import enqueue_event

    order = type(task.order).objects.select_for_update().select_related(
        'site').get(pk=task.order_id)
    task = type(task).objects.select_for_update().get(pk=task.pk)

    if task.status not in {'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'POD_PENDING'}:
        raise HandoffError(
            f'Delivery task {task.task_id} is {task.status}; the order has not '
            f'been picked up yet.')

    # `advance` will walk AT_DS straight to EN_ROUTE, and `complete_pod` used
    # to read the status alone, so a task could be delivered without ever
    # leaving the store: shipped_qty stayed 0, no SHIP movement was written and
    # the units were still counted as sellable on the shelf while the customer
    # had them. Pickup is the step that books them out, so it is required here
    # regardless of what the task now says about itself.
    if task.pickup_at is None:
        raise HandoffError(
            f'{order.order_no} has not been collected from the store yet; '
            f'record the pickup before handing it over.',
            pickup_required=True)

    if not order.pod_otp_hash:
        _start_pod(order, actor)
        # Park the task so the rider's screen shows "waiting for the customer's
        # code" instead of a task that looks abandoned. Committed here rather
        # than in _start_pod because both rows belong to the same transaction
        # as the OTP - see the note below.
        task.status = 'POD_PENDING'
        task.save(update_fields=['status'])
        # Returned, not raised. complete_pod runs inside a transaction, so
        # raising here would roll back the very OTP it just minted: the customer
        # would never be sent a code, the order would never carry a hash, and
        # every subsequent attempt would mint a fresh code instead of checking
        # the one the customer is holding.
        return {
            'otp_required': True,
            # The code itself is deliberately absent. It reaches the customer
            # through the outbox notification; handing it back to the caller would
            # make the code a secret the rider already holds, which is the whole
            # thing the code exists to prove.
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'status': order.status,
            'task_status': task.status,
        }
    if not otp:
        raise HandoffError('otp is required to close a delivery.', status=400,
                           otp_required=True)
    if not secrets.compare_digest(order.pod_otp_hash, _hash_otp(str(otp).strip())):
        raise HandoffError('That pickup code does not match this order.',
                           status=400, otp_required=True)

    cod = None
    cod_due = None
    cod_variance = None
    # A COD order can be settled online at the door (card / UPI / UPI QR via
    # Cashfree). The webhook may confirm that capture while the rider's phone
    # is offline, so `order.payment_method` can still say COD even though the
    # customer has already paid. If this delivery also records cash, the same
    # order is collected twice; the provider attempt is the authority, not what
    # the rider's screen happened to show.
    from bounded.orders.models import PaymentAttempt

    paid_online_attempt = None
    if order.payment_method == 'COD':
        paid_online_attempt = PaymentAttempt.objects.filter(
            order=order, status='PAID').order_by('-updated_at').first()

    if order.payment_method == 'COD' and paid_online_attempt is None:
        if cod_amount is None or str(cod_amount).strip() == '':
            raise HandoffError(
                f'{order.order_no} is cash on delivery; record what was '
                f'collected.', status=400, cod_required=True,
                cod_due=str(order.grand_total))
        # `str(x)` never raises, so the previous `try: str(...) except ValueError`
        # could not have caught a non-number - any junk string was recorded as
        # cash collected and then set payment_status to CAPTURED. The amount has
        # to actually parse as money.
        try:
            cod = Decimal(str(cod_amount).strip()).quantize(Decimal('0.01'))
        except (InvalidOperation, ValueError, ArithmeticError):
            raise HandoffError(
                f'cod_amount {str(cod_amount)!r} is not an amount.',
                status=400, cod_due=str(order.grand_total))
        # Decimal parses NaN and Infinity happily, and then refuses to be
        # compared - so the check below would raise instead of reporting bad
        # input. Reject them while they are still values.
        if not cod.is_finite():
            raise HandoffError(
                f'cod_amount {str(cod_amount)!r} is not a finite amount.',
                status=400, cod_due=str(order.grand_total))
        if cod < 0:
            raise HandoffError('cod_amount cannot be negative.', status=400,
                               cod_due=str(order.grand_total))
        cod_due = Decimal(order.grand_total).quantize(Decimal('0.01'))
        cod_variance = cod - cod_due

    now = timezone.now()
    previous = order.status

    if paid_online_attempt is not None:
        # The customer paid Cashfree, not the rider. Record the capture so the
        # door handover, the payment row and the order agree, and deliberately
        # write no cash movement: no note ever entered the rider's custody.
        from bounded.money.models import Payment

        order.payment_method = 'CASHFREE'
        order.payment_status = 'CAPTURED'
        Payment.objects.get_or_create(
            order=order,
            gateway_order_id=paid_online_attempt.provider_order_id,
            defaults={
                'customer_id': order.customer_id,
                'method': 'COD_UPI',
                'gateway': 'CASHFREE',
                'gateway_payment_id': paid_online_attempt.provider_payment_id,
                'amount': paid_online_attempt.amount,
                'status': 'CAPTURED',
                'captured_at': now,
            })

    task.status = 'DELIVERED'
    task.delivered_at = now
    task.save(update_fields=['status', 'delivered_at'])
    # Capacity freed: the next waiting task at this store goes to whoever is
    # online with room for it.
    from bounded.delivery.dispatch import assign_pending_at
    assign_pending_at(task.site, actor)

    order.status = 'DELIVERED'
    order.delivered_at = now
    fields = ['status', 'delivered_at', 'payment_method', 'payment_status']
    if order.payment_method == 'COD':
        order.payment_status = 'CAPTURED'
    # The code is single use. Keeping it would let a captured screenshot close
    # the same order again later.
    order.pod_otp_hash = None
    fields.append('pod_otp_hash')
    order.save(update_fields=fields)

    OrderStatusHistory.objects.create(
        order=order, from_status=previous, to_status='DELIVERED',
        actor_type=actor.role, actor_id=str(actor.user_id))

    enqueue_event(
        aggregate_type='CustomerOrder', aggregate_id=order.order_id,
        event_type='order.delivered', correlation_id=order.order_id,
        payload_json={
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'task_id': str(task.task_id),
            'payment_method': order.payment_method,
            'cod_amount': str(cod) if cod is not None else None,
            'cod_due': str(cod_due) if cod_due is not None else None,
            # A shortfall or an over-collection is a real operational event, so it
            # is recorded rather than rejected - but it has to be visible instead
            # of being absorbed into a CAPTURED payment_status.
            'cod_variance': str(cod_variance) if cod_variance is not None else None,
            'delivered_at': order.delivered_at.isoformat(),
        },
    )

    settlement = _settle_delivery(
        order=order, task=task, actor=actor, cod=cod,
        delivered_at=now, signature=signature, method=method)

    result = {
        'order_id': str(order.order_id),
        'order_no': order.order_no,
        'status': order.status,
        'task_status': task.status,
        'previous_status': previous,
        'delivered_at': order.delivered_at,
        'payment_status': order.payment_status,
        'payment_method': order.payment_method,
        # True when a door-step Cashfree capture settled this COD order, so the
        # client can say "paid online" instead of asking for cash again.
        'paid_online': paid_online_attempt is not None,
        'cod_amount': str(cod) if cod is not None else None,
        'cod_due': str(cod_due) if cod_due is not None else None,
        'cod_variance': str(cod_variance) if cod_variance is not None else None,
    }
    if settlement:
        result.update(settlement)
    return result

