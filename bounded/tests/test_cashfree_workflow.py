"""Cashfree's sandbox boundary, tested without calling the provider."""
import json
from unittest.mock import patch

from django.test import override_settings

from bounded.delivery.models import DeliveryTask
from bounded.orders.models import CustomerOrder, PaymentAttempt
from bounded.tests.test_checkout import CheckoutBase


@override_settings(
    CASHFREE_APP_ID='test-app', CASHFREE_SECRET_KEY='test-secret',
    CASHFREE_ENV='sandbox', CASHFREE_API_VERSION='2025-01-01',
)
class CashfreeOrderWorkflowTests(CheckoutBase):
    def setUp(self):
        super().setUp()
        self.shopper.phone = '9876543210'
        self.shopper.save(update_fields=['phone'])

    @patch('bounded.orders.payments._request')
    def test_checkout_waits_for_server_verified_payment_before_fulfillment(self, provider):
        provider.side_effect = lambda method, path, payload=None, **kwargs: {
            'order_id': payload['order_id'],
            'payment_session_id': 'sandbox-session',
        }
        response = self.checkout(payment_method='CASHFREE')
        self.assertEqual(response.status_code, 201, response.data)
        order = CustomerOrder.objects.get(order_no=response.data['order_no'])
        self.assertEqual('PAYMENT_PENDING', order.status)
        self.assertEqual('PENDING', order.payment_status)
        self.assertFalse(DeliveryTask.objects.filter(order=order).exists())
        attempt = PaymentAttempt.objects.get(order=order)
        self.assertEqual(float(order.grand_total), provider.call_args.args[2]['order_amount'])
        self.assertEqual('sandbox-session', response.data['cashfree']['payment_session_id'])

        provider.side_effect = None
        provider.return_value = {
            'order_amount': str(attempt.amount), 'order_currency': 'INR',
            'order_status': 'PAID',
        }
        status = self.api.get(f'/api/orders/payments/{order.order_id}/status')
        self.assertEqual(status.status_code, 200, status.data)
        order.refresh_from_db()
        self.assertEqual('CONFIRMED', order.status)
        self.assertEqual('CAPTURED', order.payment_status)
        self.assertEqual(1, DeliveryTask.objects.filter(order=order).count())
        # A prepaid order must not be a second-class citizen: the same
        # lowest-workload assignment COD gets is applied when the provider
        # confirms the payment, so it reaches a picker without a manager click.
        from bounded.ds_ops.models import PickTask

        task = PickTask.objects.filter(order=order).first()
        self.assertIsNotNone(task, 'prepaid order has no pick task')
        self.assertEqual(self.staff.user_id, task.assigned_to)

        # Replaying a second status check is safe and does not duplicate work.
        self.api.get(f'/api/orders/payments/{order.order_id}/status')
        self.assertEqual(1, DeliveryTask.objects.filter(order=order).count())

    @patch('bounded.orders.payments._request')
    def test_provider_amount_mismatch_cannot_confirm_order(self, provider):
        def cashfree(method, path, payload=None, **kwargs):
            if method == 'POST':
                return {'order_id': payload['order_id'],
                        'payment_session_id': 'sandbox-session'}
            return {'order_amount': '0.01', 'order_currency': 'INR',
                    'order_status': 'PAID'}
        provider.side_effect = cashfree
        created = self.checkout(payment_method='CASHFREE')
        order = CustomerOrder.objects.get(order_no=created.data['order_no'])
        response = self.api.get(f'/api/orders/payments/{order.order_id}/status')
        self.assertEqual(response.status_code, 503)
        order.refresh_from_db()
        self.assertEqual('PAYMENT_PENDING', order.status)
        self.assertEqual('PENDING', order.payment_status)
        self.assertFalse(DeliveryTask.objects.filter(order=order).exists())

    @patch('bounded.orders.payments._request')
    def test_webhook_requires_signature_and_rechecks_provider_order(self, provider):
        def cashfree(method, path, payload=None, **kwargs):
            if method == 'POST':
                return {'order_id': payload['order_id'],
                        'payment_session_id': 'sandbox-session'}
            return {'order_amount': '110.00', 'order_currency': 'INR',
                    'order_status': 'PAID'}
        provider.side_effect = cashfree
        created = self.checkout(payment_method='CASHFREE')
        order = CustomerOrder.objects.get(order_no=created.data['order_no'])
        attempt = PaymentAttempt.objects.get(order=order)
        body = json.dumps({'data': {'order': {'order_id': attempt.provider_order_id},
                                   'payment': {'cf_payment_id': 'cf-test-1'}}}).encode()
        denied = self.client.post('/api/orders/payments/cashfree/webhook', body,
                                  content_type='application/json')
        self.assertEqual(denied.status_code, 401)

        from bounded.orders.payments import verify_webhook
        timestamp = '1794150000000'
        from django.test import override_settings as _override
        with _override(CASHFREE_SECRET_KEY='test-secret'):
            import base64, hashlib, hmac
            signature = base64.b64encode(hmac.new(
                b'test-secret', timestamp.encode() + body, hashlib.sha256).digest()
            ).decode()
            accepted = self.client.post(
                '/api/orders/payments/cashfree/webhook', body,
                content_type='application/json',
                HTTP_X_WEBHOOK_TIMESTAMP=timestamp,
                HTTP_X_WEBHOOK_SIGNATURE=signature,
            )
        self.assertEqual(accepted.status_code, 200, accepted.data)
        order.refresh_from_db()
        attempt.refresh_from_db()
        self.assertEqual('CONFIRMED', order.status)
        self.assertEqual('cf-test-1', attempt.provider_payment_id)
        self.assertEqual(1, DeliveryTask.objects.filter(order=order).count())
