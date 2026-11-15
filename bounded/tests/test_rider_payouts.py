"""Rider payouts: a batch that settles earnings, and a statement that survives.

The gap this covers is simple and expensive: ``RiderEarnings`` rows were
written on every delivery and nothing ever settled them, so a rider's app could
say "₹1,240 pending" forever. A payout run is now the only thing that moves a
row from PENDING to PAID, and it leaves a ``RiderPayout`` behind so the amount,
the delivery count and the transfer reference can be reprinted later.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.delivery.models import RiderProfile
from bounded.iam.models import User
from bounded.money.models import RiderEarnings, RiderPayout
from bounded.network.models import Site
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder

PAYOUTS = '/api/money/rider-payouts/'
STATEMENT = '/api/money/rider-payouts/statement/'


class RiderPayoutBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(
            code='DS-PAYOUT', site_type='DARK_STORE', name='Payout DS',
            address='1 Payout Road', status='ACTIVE')
        cls.ops = User.objects.create(
            email='ops-payout@zippzo.in', password_hash=make_password('Pay123!'),
            role='OPS_MANAGER', status='ACTIVE')
        cls.rider_user = User.objects.create(
            email='rider-payout@zippzo.in',
            password_hash=make_password('Pay123!'), role='RIDER',
            status='ACTIVE')
        cls.other_rider_user = User.objects.create(
            email='rider-other@zippzo.in',
            password_hash=make_password('Pay123!'), role='RIDER',
            status='ACTIVE')
        cls.shopper = User.objects.create(
            email='buyer-payout@zippzo.in',
            password_hash=make_password('Pay123!'), role='CUSTOMER',
            status='ACTIVE')

        cls.rider = RiderProfile.objects.create(
            user=cls.rider_user, name='Ravi', phone='9999999999',
            vehicle_type='BIKE', current_site=cls.site)
        cls.other_rider = RiderProfile.objects.create(
            user=cls.other_rider_user, name='Sita', phone='8888888888',
            vehicle_type='SCOOTER', current_site=cls.site)

        cls.customer = Customer.objects.create(user=cls.shopper, name='Buyer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Basket Road',
            pincode='560001', city='Bengaluru', is_default=True)

    def api_for(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api

    def make_order(self, order_no):
        return CustomerOrder.objects.create(
            order_no=order_no, customer=self.customer, site=self.site,
            address=self.address, status='DELIVERED', payment_method='COD',
            payment_status='CAPTURED', subtotal=Decimal('90.00'),
            grand_total=Decimal('110.00'))

    def make_earning(self, order_no, amount='40.00', rider=None, status='PENDING'):
        order = self.make_order(order_no)
        return RiderEarnings.objects.create(
            rider=rider or self.rider, order=order, amount=Decimal(amount),
            delivery_fee=Decimal('20.00'), status=status)


class PayoutRunTests(RiderPayoutBase):

    def test_a_run_settles_every_pending_earning_in_one_batch(self):
        self.make_earning('PO-1001', '40.00')
        self.make_earning('PO-1002', '55.00')

        response = self.api_for(self.ops).post(
            f'{PAYOUTS}run/', {'rider': str(self.rider.rider_id),
                              'reference': 'UTR-7788'}, format='json')

        self.assertEqual(201, response.status_code, response.data)
        self.assertEqual('95.00', response.data['amount'])
        self.assertEqual(2, response.data['earnings_count'])
        self.assertEqual('PAID', response.data['status'])
        self.assertEqual('DS-PAYOUT', response.data['site'])
        self.assertEqual(2, len(response.data['earnings']))
        self.assertEqual(
            {'PO-1001', 'PO-1002'},
            {row['order_no'] for row in response.data['earnings']})

        for earning in RiderEarnings.objects.filter(rider=self.rider):
            self.assertEqual('PAID', earning.status)
            self.assertEqual(response.data['payout_id'], str(earning.payout_id))
            self.assertIsNotNone(earning.paid_at)

    def test_the_statement_shows_what_is_left_and_what_was_paid(self):
        earning = self.make_earning('PO-2001', '60.00')
        self.make_earning('PO-2002', '25.00')
        self.api_for(self.ops).post(
            f'{PAYOUTS}run/', {'rider': str(self.rider.rider_id)}, format='json')

        response = self.api_for(self.rider_user).get(
            f'{STATEMENT}?rider={self.rider.rider_id}')

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('85.00', response.data['paid_amount'])
        self.assertEqual(2, response.data['paid_count'])
        self.assertEqual('0.00', response.data['pending_amount'])
        self.assertEqual(0, response.data['pending_count'])
        self.assertEqual(1, len(response.data['payouts']))
        self.assertIn('PO-2001', {row['order_no'] for row in
                                  response.data['payouts'][0]['earnings']})
        earning.refresh_from_db()
        self.assertIsNotNone(earning.payout_id)

    def test_a_second_run_has_nothing_to_pay(self):
        self.make_earning('PO-3001')
        first = self.api_for(self.ops).post(
            f'{PAYOUTS}run/', {'rider': str(self.rider.rider_id)}, format='json')
        self.assertEqual(201, first.status_code, first.data)

        second = self.api_for(self.ops).post(
            f'{PAYOUTS}run/', {'rider': str(self.rider.rider_id)}, format='json')

        self.assertEqual(400, second.status_code, second.data)
        self.assertIn('no unsettled earnings', second.data['error'])
        self.assertEqual(1, RiderPayout.objects.count())

    def test_another_riders_earnings_are_not_swept_in(self):
        self.make_earning('PO-4001', '40.00')
        self.make_earning('PO-4002', '70.00', rider=self.other_rider)

        response = self.api_for(self.ops).post(
            f'{PAYOUTS}run/', {'rider': str(self.rider.rider_id)}, format='json')

        self.assertEqual(201, response.status_code, response.data)
        self.assertEqual('40.00', response.data['amount'])
        other = RiderEarnings.objects.get(rider=self.other_rider)
        self.assertEqual('PENDING', other.status)
        self.assertIsNone(other.payout_id)

    def test_a_rider_cannot_run_their_own_payout(self):
        self.make_earning('PO-5001')
        response = self.api_for(self.rider_user).post(
            f'{PAYOUTS}run/', {'rider': str(self.rider.rider_id)}, format='json')
        self.assertEqual(403, response.status_code, response.data)
        self.assertEqual(
            1, RiderEarnings.objects.filter(status='PENDING').count())

    def test_a_rider_can_only_read_their_own_statement(self):
        self.make_earning('PO-6001', rider=self.other_rider)
        response = self.api_for(self.rider_user).get(
            f'{STATEMENT}?rider={self.other_rider.rider_id}')
        self.assertEqual(403, response.status_code, response.data)

    def test_an_unknown_rider_is_a_clean_404(self):
        response = self.api_for(self.ops).post(
            f'{PAYOUTS}run/', {'rider': str(uuid.uuid4())}, format='json')
        self.assertEqual(404, response.status_code, response.data)
