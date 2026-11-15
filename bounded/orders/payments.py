import base64
import hashlib
import hmac
import json
import logging
import urllib.error
import urllib.request
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from bounded.orders.models import CustomerOrder, OrderStatusHistory, PaymentAttempt

logger = logging.getLogger(__name__)


class CashfreeError(Exception):
    """Safe, shopper-readable Cashfree integration error."""


def _configured():
    return bool(getattr(settings, 'CASHFREE_APP_ID', '')
                and getattr(settings, 'CASHFREE_SECRET_KEY', ''))


def _api_root():
    mode = getattr(settings, 'CASHFREE_ENV', 'sandbox').lower()
    return ('https://api.cashfree.com/pg' if mode == 'production'
            else 'https://sandbox.cashfree.com/pg')


def _request(method, path, payload=None, *, idempotency_key=None):
    if not _configured():
        raise CashfreeError('Online payment is not configured. Choose Cash on Delivery.')
    headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-api-version': getattr(settings, 'CASHFREE_API_VERSION', '2025-01-01'),
        'x-client-id': settings.CASHFREE_APP_ID,
        'x-client-secret': settings.CASHFREE_SECRET_KEY,
    }
    if idempotency_key:
        headers['x-idempotency-key'] = idempotency_key
    data = json.dumps(payload, separators=(',', ':')).encode() if payload is not None else None
    request = urllib.request.Request(
        f'{_api_root()}{path}', data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        # Do not log provider response bodies or request headers: keep credentials
        # and customer data out of application logs.
        logger.warning('Cashfree API returned HTTP %s for %s', exc.code, path)
        raise CashfreeError('Cashfree could not start or verify this payment. Please retry or use COD.') from None
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.warning('Cashfree API request failed for %s: %s', path, type(exc).__name__)
        raise CashfreeError('Cashfree is temporarily unavailable. Please retry or use COD.') from None


def create_attempt(order, *, phone=None, provider_order_id=None):
    """Open a Cashfree checkout session for an order.

    ``phone``/``provider_order_id`` are optional so the rider's door-step
    capture can use the customer's number as typed by the rider and a fresh
    provider order id (a COD order may already have been attempted once).
    """
    if not _configured():
        raise CashfreeError('Online payment is not configured. Choose Cash on Delivery.')
    user = order.customer.user
    raw_phone = phone if phone is not None else (user.phone or '')
    digits = ''.join(ch for ch in str(raw_phone) if ch.isdigit())
    if len(digits) < 10:
        raise CashfreeError('Add a valid mobile number to your account before paying online.')
    provider_order_id = provider_order_id or f'zp_{order.order_id.hex[:32]}'
    attempt_id = PaymentAttempt.objects.create(
        order=order,
        provider_order_id=provider_order_id,
        payment_session_id='pending',
        amount=order.grand_total,
        expires_at=timezone.now() + timedelta(minutes=30),
    )
    try:
        response = _request('POST', '/orders', {
        'order_id': attempt_id.provider_order_id,
        'order_amount': float(order.grand_total),
        'order_currency': 'INR',
        'customer_details': {
            'customer_id': str(order.customer_id),
            'customer_name': (user.full_name or order.customer.name or 'Customer')[:100],
            'customer_email': user.email,
            'customer_phone': digits[-10:],
        },
        'order_note': f'Zippzo {order.order_no}',
        'order_expiry_time': attempt_id.expires_at.isoformat(),
        }, idempotency_key=str(attempt_id.attempt_id))
    except CashfreeError:
        attempt_id.status = 'FAILED'
        attempt_id.save(update_fields=['status', 'updated_at'])
        raise
    session = response.get('payment_session_id')
    provider_order_id = response.get('order_id')
    if not session or provider_order_id != attempt_id.provider_order_id:
        attempt_id.status = 'FAILED'
        attempt_id.save(update_fields=['status', 'updated_at'])
        raise CashfreeError('Cashfree returned an invalid checkout session. Please retry or use COD.')
    attempt_id.payment_session_id = session
    attempt_id.status = 'PENDING'
    attempt_id.save(update_fields=['payment_session_id', 'status', 'updated_at'])
    return attempt_id


@transaction.atomic
def abort_unstarted_payment(order, remark='Cashfree checkout could not be started.'):
    from bounded.ds_ops.allocation import release_order_allocations
    order = CustomerOrder.objects.select_for_update().get(pk=order.pk)
    if order.status == 'PAYMENT_PENDING' and order.payment_status == 'PENDING':
        release_order_allocations(order)
        order.status = 'PAYMENT_FAILED'
        order.payment_status = 'FAILED'
        order.save(update_fields=['status', 'payment_status'])
        OrderStatusHistory.objects.create(
            order=order, from_status='PAYMENT_PENDING', to_status='PAYMENT_FAILED',
            actor_type='SYSTEM', remark=remark,
        )


def _verified_provider_order(attempt):
    return _request('GET', f'/orders/{attempt.provider_order_id}')


@transaction.atomic
def sync_attempt(attempt, *, payment_id=''):
    attempt = PaymentAttempt.objects.select_for_update().select_related(
        'order', 'order__site', 'order__customer', 'order__customer__user').get(pk=attempt.pk)
    order = CustomerOrder.objects.select_for_update().get(pk=attempt.order_id)
    if attempt.status == 'PAID' and order.payment_status == 'CAPTURED':
        return order
    details = _verified_provider_order(attempt)
    try:
        paid_amount = Decimal(str(details.get('order_amount'))).quantize(Decimal('0.01'))
    except (InvalidOperation, TypeError):
        paid_amount = Decimal('-1')
    if paid_amount != attempt.amount or details.get('order_currency') != attempt.currency:
        logger.error('Cashfree amount/currency mismatch for local attempt %s', attempt.attempt_id)
        raise CashfreeError('Payment details could not be verified. Contact support before retrying.')
    provider_status = details.get('order_status')
    if provider_status != 'PAID':
        if provider_status in ('EXPIRED', 'TERMINATED'):
            attempt.status = 'EXPIRED'
            attempt.save(update_fields=['status', 'updated_at'])
            _fail_pending_order(order, 'Cashfree payment expired.')
        elif attempt.expires_at and attempt.expires_at <= timezone.now():
            attempt.status = 'EXPIRED'
            attempt.save(update_fields=['status', 'updated_at'])
            _fail_pending_order(order, 'Cashfree payment window expired.')
        return order

    attempt.status = 'PAID'
    attempt.provider_payment_id = str(payment_id or '')[:80]
    attempt.save(update_fields=['status', 'provider_payment_id', 'updated_at'])
    if order.status == 'PAYMENT_PENDING' and order.payment_status == 'PENDING':
        previous = order.status
        order.status = 'CONFIRMED'
        order.payment_status = 'CAPTURED'
        order.save(update_fields=['status', 'payment_status'])
        OrderStatusHistory.objects.create(
            order=order, from_status=previous, to_status='CONFIRMED',
            actor_type='SYSTEM', remark='Cashfree payment verified server-side.',
        )
        from bounded.delivery.models import DeliveryTask
        DeliveryTask.objects.get_or_create(
            order=order, defaults={'site': order.site, 'status': 'UNASSIGNED'})
        from bounded.outbox.services import enqueue_event
        enqueue_event(
            aggregate_type='CustomerOrder', aggregate_id=order.order_id,
            event_type='payment.captured',
            payload_json={
                'order_id': str(order.order_id), 'order_no': order.order_no,
                'site_code': order.site.code, 'payment_method': 'CASHFREE',
                'grand_total': str(order.grand_total),
            },
        )
        # The event above is for observers. The order itself still needs an
        # owner: COD checkout assigns a picker and offers the delivery, and a
        # prepaid order must not land in a different world where it has a
        # delivery task but no picker. `assign_order` is idempotent, so a
        # webhook retry cannot steal an order that is already being picked.
        try:
            from bounded.orders.fulfilment import auto_assign_after_confirmation

            auto_assign_after_confirmation(order, actor=None)
        except Exception:  # noqa: BLE001 - a paid order must not roll back
            logger.exception(
                'Could not auto-assign confirmed order %s', order.order_no)
    return order


def _fail_pending_order(order, remark):
    if order.status != 'PAYMENT_PENDING' or order.payment_status != 'PENDING':
        return
    from bounded.ds_ops.allocation import release_order_allocations
    release_order_allocations(order)
    previous = order.status
    order.status = 'PAYMENT_FAILED'
    order.payment_status = 'FAILED'
    order.save(update_fields=['status', 'payment_status'])
    OrderStatusHistory.objects.create(
        order=order, from_status=previous, to_status='PAYMENT_FAILED',
        actor_type='SYSTEM', remark=remark,
    )


@transaction.atomic
def verify_doorstep_attempt(attempt, *, payment_id=''):
    """Verify a COD order paid online at the door (card / UPI / UPI QR).

    Unlike `sync_attempt` this never promotes a PAYMENT_PENDING order: this
    order is already confirmed and out for delivery. A captured payment
    replaces the cash obligation (`payment_method` moves to CASHFREE) so proof
    of delivery stops asking the rider for cash. No cash movement is written:
    the money never entered the rider's custody.
    """
    from bounded.money.models import Payment

    attempt = PaymentAttempt.objects.select_for_update().get(pk=attempt.pk)
    order = CustomerOrder.objects.select_for_update().select_related(
        'customer').get(pk=attempt.order_id)
    if attempt.status == 'PAID' and order.payment_status == 'CAPTURED':
        return order
    details = _verified_provider_order(attempt)
    try:
        paid_amount = Decimal(str(details.get('order_amount'))).quantize(
            Decimal('0.01'))
    except (InvalidOperation, TypeError):
        paid_amount = Decimal('-1')
    if paid_amount != attempt.amount or details.get('order_currency') != attempt.currency:
        logger.error('Cashfree amount/currency mismatch for door attempt %s',
                     attempt.attempt_id)
        raise CashfreeError(
            'Payment details could not be verified. Contact support before retrying.')
    provider_status = details.get('order_status')
    if provider_status != 'PAID':
        if provider_status in ('EXPIRED', 'TERMINATED') or (
                attempt.expires_at and attempt.expires_at <= timezone.now()):
            attempt.status = 'EXPIRED'
            attempt.save(update_fields=['status', 'updated_at'])
        return order

    attempt.status = 'PAID'
    attempt.provider_payment_id = str(payment_id or '')[:80]
    attempt.save(update_fields=['status', 'provider_payment_id', 'updated_at'])

    # Written before the delivered-early-return below: if the POD already
    # closed on cash and the customer's online payment lands afterwards, the
    # customer has paid twice and finance needs this second row to refund it.
    Payment.objects.get_or_create(
        order=order, gateway_order_id=attempt.provider_order_id,
        defaults={
            'customer_id': order.customer_id,
            'method': 'COD_UPI',
            'gateway': 'CASHFREE',
            'gateway_payment_id': attempt.provider_payment_id,
            'amount': attempt.amount,
            'status': 'CAPTURED',
            'captured_at': timezone.now(),
        })

    # The bike already left with the goods; a late capture after the cash POD
    # must not rewrite a settled order.
    if order.status == 'DELIVERED':
        logger.warning(
            'Door-step payment %s captured after order %s was delivered; '
            'the cash collection needs a refund.',
            attempt.provider_order_id, order.order_no)
        return order

    order.payment_method = 'CASHFREE'
    order.payment_status = 'CAPTURED'
    order.save(update_fields=['payment_method', 'payment_status'])

    from bounded.outbox.services import enqueue_event

    enqueue_event(
        aggregate_type='CustomerOrder', aggregate_id=order.order_id,
        event_type='payment.captured', correlation_id=order.order_id,
        payload_json={
            'order_id': str(order.order_id), 'order_no': order.order_no,
            'site_code': order.site.code if order.site_id else '',
            'payment_method': 'CASHFREE', 'doorstep': True,
            'grand_total': str(order.grand_total),
        },
    )
    return order


def verify_webhook(raw_body, timestamp, signature):
    secret = getattr(settings, 'CASHFREE_SECRET_KEY', '')
    if not secret or not timestamp or not signature:
        return False
    message = timestamp.encode() + raw_body
    expected = base64.b64encode(
        hmac.new(secret.encode(), message, hashlib.sha256).digest()).decode()
    return hmac.compare_digest(expected, signature)


def refund_payment(payment, amount, *, refund_id, note=''):
    """Refund a captured Cashfree payment back to the source instrument.

    ``refund_id`` is the local Refund row's primary key, sent as both the
    provider ``refund_id`` and the ``x-idempotency-key``. Cashfree refuses a
    second refund with the same id, so a retried click cannot pay a customer
    twice even if the first response never reached us.

    The provider returns ``refund_status`` of ``PENDING``/``SUCCESS``/``FAILED``;
    callers persist it rather than assuming success.
    """
    if not _configured():
        raise CashfreeError('Online payments are not configured.')
    if payment.gateway != 'CASHFREE' or not payment.gateway_order_id:
        raise CashfreeError('This payment was not taken through Cashfree.')
    amount = Decimal(str(amount)).quantize(Decimal('0.01'))
    if amount <= 0:
        raise CashfreeError('A refund must be for more than zero.')
    if amount > (payment.amount or Decimal('0.00')):
        raise CashfreeError('The refund is more than the captured payment.')
    return _request(
        'POST', f'/orders/{payment.gateway_order_id}/refunds',
        {
            'refund_id': str(refund_id)[:40],
            'refund_amount': float(amount),
            'refund_note': (note or 'Zippzo refund')[:200],
        },
        idempotency_key=str(refund_id)[:40],
    )
