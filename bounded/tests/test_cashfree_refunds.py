"""Refunds go back through the rail that took the money.

A refund used to be a row an operator could only *record*. These cases pin the
two paths that now exist:

  * a captured Cashfree payment is refunded at Cashfree, keyed by the local
    refund id so a retried click cannot pay the customer twice;
  * anything else (cash at the door, a payment with no provider id) is stamped
    MANUAL_OPS, because pretending a card rail moved cash is worse than saying
    a human must.
"""
import base64
import hashlib
import hmac
import json
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.hashers import make_password
from django.test import override_settings
from django.utils import timezone

from bounded.iam.models import User
from bounded.money.models import Payment, Refund
from bounded.orders.models import CustomerOrder
from bounded.orders.payments import CashfreeError, refund_payment
from bounded.tests.test_checkout import CheckoutBase

PROCESS = '/api/money/refunds/{}/process/'
WEBHOOK = '/api/orders/payments/cashfree/webhook'


@override_settings(
    CASHFREE_APP_ID='test-app', CASHFREE_SECRET_KEY='test-secret',
    CASHFREE_ENV='sandbox', CASHFREE_API_VERSION='2025-01-01',
)
class CashfreeRefundTests(CheckoutBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.ops = User.objects.create(
            email='ops-refund@zippzo.in', password_hash=make_password('Ref123!'),
            role='OPS_MANAGER', status='ACTIVE')

    def setUp(self):
        super().setUp()
        self.order = CustomerOrder.objects.create(
            order_no='RF-1001', customer=self.customer, site=self.site,
            address=self.address, status='DELIVERED',
            payment_method='CASHFREE', payment_status='CAPTURED',
            subtotal=Decimal('90.00'), delivery_fee=Decimal('20.00'),
            grand_total=Decimal('110.00'))
        self.payment = Payment.objects.create(
            order=self.order, customer=self.customer, method='UPI',
            gateway='CASHFREE', gateway_order_id='zp_refund_order',
            gateway_payment_id='cf-pay-1', amount=Decimal('110.00'),
            status='CAPTURED', captured_at=timezone.now())
        self.refund = Refund.objects.create(
            order=self.order, payment=self.payment, amount=Decimal('110.00'),
            refund_method='UPI', status='APPROVED')

    def ops_api(self):
        from rest_framework.test import APIClient
        api = APIClient()
        api.force_authenticate(self.ops)
        return api

    @patch('bounded.orders.payments._request')
    def test_an_online_refund_is_sent_to_cashfree_and_settles_the_payment(self, provider):
        provider.return_value = {'cf_refund_id': 'rf-1', 'refund_status': 'SUCCESS'}

        response = self.ops_api().post(
            PROCESS.format(self.refund.refund_id), {'amount': '110.00'}, format='json')

        self.assertEqual(200, response.status_code, response.data)
        self.assertFalse(response.data['manual'])
        refund = response.data['refund']
        self.assertEqual('SUCCESS', refund['status'])
        self.assertEqual('rf-1', refund['gateway_refund_id'])
        method, path, payload = provider.call_args.args
        self.assertEqual('POST', method)
        self.assertEqual('/orders/zp_refund_order/refunds', path)
        self.assertEqual(float(Decimal('110.00')), payload['refund_amount'])
        self.assertEqual(str(self.refund.refund_id)[:40], payload['refund_id'])
        self.assertEqual(str(self.refund.refund_id)[:40],
                         provider.call_args.kwargs['idempotency_key'])
        self.payment.refresh_from_db()
        self.assertEqual('REFUNDED', self.payment.status)

    @patch('bounded.orders.payments._request')
    def test_a_provider_acceptance_that_is_still_pending_is_not_called_success(self, provider):
        provider.return_value = {'cf_refund_id': 'rf-2', 'refund_status': 'PENDING'}

        response = self.ops_api().post(
            PROCESS.format(self.refund.refund_id), {'amount': '50.00'}, format='json')

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('PROCESSED', response.data['refund']['status'])
        self.payment.refresh_from_db()
        self.assertEqual('CAPTURED', self.payment.status,
                         'a partial/pending refund must not settle the payment')

    def test_a_refund_that_was_already_processed_is_refused(self):
        self.refund.status = 'SUCCESS'
        self.refund.save(update_fields=['status'])

        response = self.ops_api().post(
            PROCESS.format(self.refund.refund_id), {'amount': '10.00'}, format='json')

        self.assertEqual(400, response.status_code, response.data)
        self.assertIn('already been processed', response.data['error'])

    def test_more_than_the_payment_is_refused(self):
        response = self.ops_api().post(
            PROCESS.format(self.refund.refund_id), {'amount': '500.00'}, format='json')
        self.assertEqual(400, response.status_code, response.data)

    def test_a_cash_payment_becomes_a_manual_ops_hand_off(self):
        cash = Payment.objects.create(
            order=self.order, customer=self.customer, method='COD_CASH',
            gateway='', amount=Decimal('110.00'), status='CAPTURED',
            captured_at=timezone.now())
        refund = Refund.objects.create(
            order=self.order, payment=cash, amount=Decimal('110.00'),
            refund_method='CASH', status='APPROVED')

        response = self.ops_api().post(
            PROCESS.format(refund.refund_id), {'utr': 'CASH-1'}, format='json')

        self.assertEqual(200, response.status_code, response.data)
        self.assertTrue(response.data['manual'])
        refund.refresh_from_db()
        self.assertEqual('MANUAL_OPS', refund.status)
        self.assertEqual('CASH-1', refund.utr)
        self.assertIsNotNone(refund.completed_at)

    def test_a_customer_cannot_push_their_own_refund(self):
        response = self.api.post(
            PROCESS.format(self.refund.refund_id), {'amount': '110.00'}, format='json')
        self.assertEqual(403, response.status_code, response.data)

    def test_a_provider_refusal_marks_the_refund_failed_and_counts_a_retry(self):
        with patch('bounded.orders.payments._request',
                   side_effect=CashfreeError('provider down')):
            response = self.ops_api().post(
                PROCESS.format(self.refund.refund_id), {'amount': '110.00'},
                format='json')

        self.assertEqual(400, response.status_code, response.data)
        self.refund.refresh_from_db()
        self.assertEqual('FAILED', self.refund.status)
        self.assertEqual(1, self.refund.retry_count)

    def test_the_refund_webhook_settles_a_refund_without_the_order_object(self):
        body = json.dumps({
            'type': 'REFUND_STATUS_CHANGED',
            'data': {'refund': {
                'refund_id': str(self.refund.refund_id),
                'cf_refund_id': 'cf-rf-9',
                'refund_status': 'SUCCESS',
            }},
        }).encode()
        timestamp = '1794150000000'
        signature = base64.b64encode(hmac.new(
            b'test-secret', timestamp.encode() + body, hashlib.sha256).digest()
        ).decode()

        response = self.client.post(
            WEBHOOK, body, content_type='application/json',
            HTTP_X_WEBHOOK_TIMESTAMP=timestamp,
            HTTP_X_WEBHOOK_SIGNATURE=signature,
        )

        self.assertEqual(200, response.status_code, response.data)
        self.refund.refresh_from_db()
        self.payment.refresh_from_db()
        self.assertEqual('SUCCESS', self.refund.status)
        self.assertEqual('cf-rf-9', self.refund.gateway_refund_id)
        self.assertIsNotNone(self.refund.completed_at)
        self.assertEqual('REFUNDED', self.payment.status)

    def test_refund_payment_refuses_more_than_the_payment(self):
        with self.assertRaises(CashfreeError):
            refund_payment(self.payment, Decimal('999.00'),
                           refund_id='rf-x', note='too much')
