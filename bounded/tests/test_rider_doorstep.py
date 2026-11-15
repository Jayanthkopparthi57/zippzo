"""The rider app's two new load-bearing pieces.

  1. A rider is only active after the DS activation QR opens a shift. The
     summary the home screen reads must say so explicitly.
  2. A COD order can be paid at the door by card / UPI / UPI QR through the
     same Cashfree tooling the shopper app uses. Once captured, proof of
     delivery must stop asking the rider for cash.
"""
from decimal import Decimal
import json
from unittest.mock import patch

from django.test import override_settings
from django.utils import timezone

from bounded.delivery.handoff import issue_pickup_otp
from bounded.delivery.models import RiderShift
from bounded.money.models import CashMovement, Payment, RiderEarnings
from bounded.orders.models import PaymentAttempt
from bounded.tests.test_rider_app import POD, RIDERS, RiderAppBase, TASKS


@override_settings(
    CASHFREE_APP_ID='test-app', CASHFREE_SECRET_KEY='test-secret',
    CASHFREE_ENV='sandbox', CASHFREE_API_VERSION='2025-01-01',
)
class RiderActivationAndSummaryTests(RiderAppBase):

    def test_the_summary_stays_inactive_until_the_store_qr_is_scanned(self):
        self.profile.is_online = False
        self.profile.save(update_fields=['is_online'])

        response = self.api_for(self.rider).get(f'{RIDERS}me/summary/')
        self.assertEqual(200, response.status_code, response.data)
        self.assertTrue(response.data['has_profile'])
        self.assertFalse(response.data['activation']['active'],
                         'an online flag alone is not an activation')

        activated = self.api_for(self.rider).post(
            f'{RIDERS}activate-by-qr/',
            {'qr': 'zippzo:site:DS-RIDER-APP'}, format='json')
        self.assertEqual(200, activated.status_code, activated.data)
        self.assertTrue(activated.data['active'])
        self.assertTrue(RiderShift.objects.filter(
            rider=self.profile, status='OPEN').exists())

        fresh = self.api_for(self.rider).get(f'{RIDERS}me/summary/')
        self.assertTrue(fresh.data['activation']['active'])
        self.assertEqual('DS-RIDER-APP', fresh.data['activation']['site'])
        self.assertEqual('DS-RIDER-APP', fresh.data['profile']['current_site_code'])

    def test_deliveries_and_per_ride_earnings_are_counted(self):
        order = self.make_order()
        task = self.make_task(order, status='DELIVERED', rider=self.profile)
        task.delivered_at = timezone.now()
        task.save(update_fields=['delivered_at'])
        RiderEarnings.objects.create(
            rider=self.profile, order=order, amount=Decimal('20.00'),
            delivery_fee=Decimal('20.00'))

        response = self.api_for(self.rider).get(f'{RIDERS}me/summary/')
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(1, response.data['stats']['deliveries_total'])
        self.assertEqual(1, response.data['stats']['deliveries_today'])
        self.assertEqual('20.00', str(response.data['stats']['earnings_total']))
        self.assertEqual(1, len(response.data['earnings']))
        self.assertEqual('RA-1001', response.data['earnings'][0]['order_no'])


class DoorStepCashfreeTests(RiderAppBase):

    def wired_task(self, *, status='ARRIVED'):
        order = self.make_order(status='OUT_FOR_DELIVERY')
        task = self.make_task(order, status=status, rider=self.profile)
        task.pickup_at = timezone.now()
        task.save(update_fields=['pickup_at'])
        return order, task

    def cashfree(self, method, path, payload=None, **kwargs):
        if method == 'POST':
            return {'order_id': payload['order_id'],
                    'payment_session_id': 'door-session'}
        return {'order_amount': '110.00', 'order_currency': 'INR',
                'order_status': 'PAID'}

    @patch('bounded.orders.payments._request')
    def test_a_cod_order_can_be_paid_online_and_then_closed_without_cash(self, provider):
        provider.side_effect = self.cashfree
        order, task = self.wired_task()
        rider = self.api_for(self.rider)

        started = rider.post(
            f'{TASKS}{task.task_id}/start-payment/',
            {'phone': '9876543210'}, format='json')
        self.assertEqual(200, started.status_code, started.data)
        self.assertEqual('110.00', started.data['amount'])
        self.assertEqual('door-session', started.data['cashfree']['payment_session_id'])
        self.assertTrue(started.data['cashfree']['order_id'].startswith('zp_cod_'))

        status = rider.get(f'{TASKS}{task.task_id}/payment-status/')
        self.assertEqual(200, status.status_code, status.data)
        self.assertEqual('CAPTURED', status.data['payment_status'])
        self.assertEqual('CASHFREE', status.data['payment_method'])

        order.refresh_from_db()
        self.assertEqual('CASHFREE', order.payment_method)
        self.assertEqual('CAPTURED', order.payment_status)
        payment = Payment.objects.get(order=order, method='COD_UPI')
        self.assertEqual(Decimal('110.00'), payment.amount)
        self.assertEqual('CAPTURED', payment.status)

        otp = issue_pickup_otp(order)
        delivered = rider.post(POD, {
            'task_id': str(task.task_id), 'otp': otp,
        }, format='json')
        self.assertEqual(200, delivered.status_code, delivered.data)
        order.refresh_from_db()
        self.assertEqual('DELIVERED', order.status)
        self.assertFalse(Payment.objects.filter(
            order=order, method='COD_CASH').exists(),
            'a captured online payment must not also be booked as cash')
        self.assertTrue(RiderEarnings.objects.filter(
            order=order, rider=self.profile).exists(),
            'the ride still earns its delivery fee')

    @patch('bounded.orders.payments._request')
    def test_payment_cannot_start_before_the_tote_is_collected(self, provider):
        provider.side_effect = self.cashfree
        order = self.make_order()
        task = self.make_task(order, status='ACCEPTED', rider=self.profile)

        response = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/start-payment/',
            {'phone': '9876543210'}, format='json')
        self.assertEqual(409, response.status_code, response.data)
        provider.assert_not_called()

    @patch('bounded.orders.payments._request')
    def test_the_rider_must_supply_a_customer_number_when_none_is_on_file(self, provider):
        provider.side_effect = self.cashfree
        _, task = self.wired_task()

        missing = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/start-payment/', {}, format='json')
        self.assertEqual(400, missing.status_code, missing.data)
        self.assertTrue(missing.data['phone_required'])
        provider.assert_not_called()

        accepted = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/start-payment/',
            {'phone': '9876543210'}, format='json')
        self.assertEqual(200, accepted.status_code, accepted.data)

    @patch('bounded.orders.payments._request')
    def test_another_rider_cannot_open_the_payment(self, provider):
        from django.contrib.auth.hashers import make_password
        from bounded.delivery.models import RiderProfile
        from bounded.iam.models import User

        other = User.objects.create(
            email='other-door@zippzo.in', password_hash=make_password('Ride123!'),
            role='RIDER', status='ACTIVE')
        RiderProfile.objects.create(
            user=other, name='Other Rider', phone='9777777777',
            vehicle_type='BIKE', is_online=True, current_site=self.site)
        _, task = self.wired_task()

        response = self.api_for(other).post(
            f'{TASKS}{task.task_id}/start-payment/',
            {'phone': '9876543210'}, format='json')
        # The task queryset is scoped to the caller's own jobs, so another
        # rider cannot even see this task, let alone open a payment for it.
        self.assertEqual(404, response.status_code, response.data)
        provider.assert_not_called()

    @patch('bounded.orders.payments._request')
    def test_the_webhook_settles_a_door_payment_without_the_app_polling(self, provider):
        """A captured door payment must not wait for the rider's phone.

        `sync_attempt` only promotes a PAYMENT_PENDING order, so routing the
        door-step attempt through it would mark the attempt PAID and leave the
        order saying COD/PENDING - cash still due for money already taken.
        """
        provider.side_effect = self.cashfree
        order, task = self.wired_task()
        rider = self.api_for(self.rider)
        started = rider.post(
            f'{TASKS}{task.task_id}/start-payment/',
            {'phone': '9876543210'}, format='json')
        self.assertEqual(200, started.status_code, started.data)
        provider_order_id = started.data['cashfree']['order_id']

        body = json.dumps({
            'data': {
                'order': {'order_id': provider_order_id},
                'payment': {'cf_payment_id': 'cf-door-1'},
            },
        }).encode()
        with patch('bounded.orders.payments.verify_webhook', return_value=True):
            response = self.client.post(
                '/api/orders/payments/cashfree/webhook', data=body,
                content_type='application/json')
        self.assertEqual(200, response.status_code, response.data)

        order.refresh_from_db()
        self.assertEqual('CASHFREE', order.payment_method)
        self.assertEqual('CAPTURED', order.payment_status)
        self.assertTrue(Payment.objects.filter(
            order=order, method='COD_UPI', gateway_payment_id='cf-door-1').exists())

    def test_cash_is_not_booked_when_the_door_payment_already_cleared(self):
        """The provider attempt outranks the rider's cash field.

        The app polls after a capture, but a phone that lost signal can still
        submit cash for an order Cashfree already settled. Closing the POD must
        follow the attempt, or the customer pays twice.
        """
        order, task = self.wired_task()
        PaymentAttempt.objects.create(
            order=order, provider_order_id='zp_cod_webhook_paid',
            payment_session_id='session', amount=order.grand_total,
            status='PAID', provider_payment_id='cf-door-2')

        otp = issue_pickup_otp(order)
        response = self.api_for(self.rider).post(POD, {
            'task_id': str(task.task_id), 'otp': otp,
            'cod_amount': str(order.grand_total),
        }, format='json')
        self.assertEqual(200, response.status_code, response.data)
        self.assertTrue(response.data['paid_online'])

        order.refresh_from_db()
        self.assertEqual('CASHFREE', order.payment_method)
        self.assertEqual('CAPTURED', order.payment_status)
        self.assertFalse(Payment.objects.filter(
            order=order, method='COD_CASH').exists())
        self.assertFalse(CashMovement.objects.filter(
            movement_type='COD_COLLECT', ref_id=str(order.order_id)).exists())
        self.assertTrue(Payment.objects.filter(
            order=order, method='COD_UPI', gateway_payment_id='cf-door-2').exists())
