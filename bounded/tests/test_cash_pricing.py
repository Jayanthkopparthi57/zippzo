"""The cash a rider carries, and the fee a store charges.

Before this, COD money ended at "the order says CAPTURED": the rider's float,
the remittance at the end of a shift, and the Payment row the capture was
talking about were all declared in the schema and never written. Delivery
pricing was the same story from the other side - every store charged the same
flat twenty, with no way for a store to price differently and no checkout
that would read a price if one existed.

These cases pin the loop a rupee makes: checkout prices the order from the
store's own rule, the door collects it onto the rider, the counter issues and
takes back float against a ceiling, and the vault receives the remittance.
Each step writes a movement row, and each balance is a number the next step
can refuse - a rider is never allowed to go over the ceiling by being handed
more money, and a remittance is never allowed to invent cash that was not
counted into their hands first.
"""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.delivery.handoff import (DEFAULT_CASH_CEILING, _settle_delivery,
                                      issue_pickup_otp)
from bounded.delivery.models import RiderProfile
from bounded.iam.models import User
from bounded.network.models import EmployeeSiteAssignment
from bounded.money.models import (CashMovement, DeliveryPricingRule, Payment,
                                  RiderCustodyState)

from bounded.tests.test_checkout import CheckoutBase
from bounded.tests.test_rider_app import RiderAppBase
from bounded.orders.models import CustomerOrder

PRICING = '/api/money/pricing-rules/'
CUSTODY = '/api/money/rider-custody/'
TASKS = '/api/delivery/delivery-tasks/'
PICKUP = '/api/delivery/handoff/pickup'
POD = '/api/delivery/handoff/pod'


def money(value):
    """Compare a serialized Decimal without caring how the renderer wrote it."""
    return Decimal(str(value)).quantize(Decimal('0.01'))


class PricingRuleTests(CheckoutBase):
    """Checkout must read the store's own fee, and fall back cleanly."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.admin = User.objects.create(
            email='pricing-admin@zippzo.in', password_hash=make_password('Adm1n123!'),
            role='ADMIN', status='ACTIVE')

    def test_a_store_rule_decides_the_fee_checkout_charges(self):
        DeliveryPricingRule.objects.create(
            site=self.site, base_fee=Decimal('35.00'))

        response = self.checkout()

        self.assertEqual(201, response.status_code, response.data)
        order = CustomerOrder.objects.get(order_no=response.data['order_no'])
        self.assertEqual(Decimal('35.00'), order.delivery_fee)
        # 90 of goods + 35 of delivery - the rule, not the flat default.
        self.assertEqual(Decimal('125.00'), order.grand_total)
        self.assertEqual('35.00', response.data['delivery_fee'],
                         'the receipt and the order row must agree')

    def test_an_inactive_rule_is_a_store_without_one(self):
        DeliveryPricingRule.objects.create(
            site=self.site, base_fee=Decimal('99.00'), is_active=False)

        response = self.checkout()

        self.assertEqual(201, response.status_code, response.data)
        from bounded.orders.models import CustomerOrder
        order = CustomerOrder.objects.get(order_no=response.data['order_no'])
        self.assertEqual(Decimal('20.00'), order.delivery_fee)
        self.assertEqual(Decimal('110.00'), order.grand_total)

    def test_pricing_is_written_by_operators_only(self):
        payload = {'site': str(self.site.site_id), 'base_fee': '30.00'}

        shopper = APIClient()
        shopper.force_authenticate(self.shopper)
        denied = shopper.post(PRICING, payload, format='json')
        self.assertEqual(403, denied.status_code, denied.data)

        cashier = APIClient()
        cashier.force_authenticate(self.staff)
        denied = cashier.post(PRICING, payload, format='json')
        self.assertEqual(403, denied.status_code, denied.data)
        self.assertFalse(DeliveryPricingRule.objects.exists())

        admin = APIClient()
        admin.force_authenticate(self.admin)
        created = admin.post(PRICING, payload, format='json')
        self.assertEqual(201, created.status_code, created.data)
        self.assertEqual('30.00', str(created.data['base_fee']))
        rule = DeliveryPricingRule.objects.get(site=self.site)
        self.assertEqual(str(self.admin.user_id), rule.updated_by)

    def test_a_fee_that_cannot_be_real_is_refused(self):
        admin = APIClient()
        admin.force_authenticate(self.admin)

        negative = admin.post(PRICING, {
            'site': str(self.site.site_id), 'base_fee': '-5'}, format='json')
        self.assertEqual(400, negative.status_code, negative.data)

        absurd = admin.post(PRICING, {
            'site': str(self.site.site_id), 'base_fee': '5000'}, format='json')
        self.assertEqual(400, absurd.status_code, absurd.data)
        self.assertFalse(DeliveryPricingRule.objects.exists())


class CashCycleTests(RiderAppBase):
    """Float, remittance, and the Payment row a COD capture talks about."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.admin = User.objects.create(
            email='cash-admin@zippzo.in', password_hash=make_password('Adm1n123!'),
            role='ADMIN', status='ACTIVE')
        cls.cashier = User.objects.create(
            email='cashier@zippzo.in', password_hash=make_password('Cash123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        EmployeeSiteAssignment.objects.create(
            employee='CASHIER', user=cls.cashier, site=cls.site,
            mode='DARKHOUSE', role_at_site='CASHIER', is_primary=True)

    def custody(self, action):
        return f'{CUSTODY}{self.profile.rider_id}/{action}/'

    def walk_to_the_door_cod(self):
        """The full COD path: accept, collect the tote, deliver with the code."""
        order = self.make_order()
        task = self.make_task(order, status='ACCEPTED', rider=self.profile)
        rider = self.api_for(self.rider)

        at_store = rider.post(f'{TASKS}{task.task_id}/advance/',
                              {'to': 'AT_DS'}, format='json')
        self.assertEqual(200, at_store.status_code, at_store.data)
        picked = rider.post(PICKUP, {'task_id': str(task.task_id)},
                            format='json')
        self.assertEqual(200, picked.status_code, picked.data)

        otp = issue_pickup_otp(order)
        delivered = rider.post(POD, {
            'task_id': str(task.task_id),
            'otp': otp,
            'cod_amount': str(order.grand_total),
        }, format='json')
        self.assertEqual(200, delivered.status_code, delivered.data)
        return order, task

    def test_float_is_issued_and_returned_at_the_counter(self):
        api = self.api_for(self.admin)

        issued = api.post(self.custody('issue-float'),
                          {'amount': '500', 'site_code': self.site.code},
                          format='json')
        self.assertEqual(200, issued.status_code, issued.data)
        self.assertEqual(Decimal('500.00'),
                         money(issued.data['custody']['current_float']))

        move = CashMovement.objects.get(movement_type='FLOAT_ISSUE',
                                        to_ref_id=str(self.profile.rider_id))
        self.assertEqual(Decimal('500.00'), move.amount)
        self.assertEqual(self.site.code, move.site)
        self.assertEqual('VAULT', move.from_container)
        self.assertEqual('RIDER', move.to_container)

        taken = api.post(self.custody('return-float'), {'amount': '200'},
                         format='json')
        self.assertEqual(200, taken.status_code, taken.data)
        self.assertEqual(Decimal('300.00'),
                         money(taken.data['custody']['current_float']))

        too_much = api.post(self.custody('return-float'), {'amount': '500'},
                            format='json')
        self.assertEqual(400, too_much.status_code, too_much.data)
        self.assertIn('300.00', too_much.data['error'])

        last = api.post(self.custody('return-float'), {'amount': '300'},
                        format='json')
        self.assertEqual(200, last.status_code, last.data)
        self.assertEqual(Decimal('0.00'),
                         money(last.data['custody']['current_float']))
        self.assertEqual(2, CashMovement.objects.filter(
            movement_type='FLOAT_RETURN').count())

    def test_the_ceiling_caps_what_a_rider_may_carry(self):
        api = self.api_for(self.admin)

        up_to = api.post(self.custody('issue-float'), {
            'amount': str(DEFAULT_CASH_CEILING),
            'site_code': self.site.code,
        }, format='json')
        self.assertEqual(200, up_to.status_code, up_to.data)

        over = api.post(self.custody('issue-float'), {
            'amount': '0.01', 'site_code': self.site.code,
        }, format='json')
        self.assertEqual(400, over.status_code, over.data)
        self.assertIn('ceiling', over.data['error'])
        self.assertEqual(DEFAULT_CASH_CEILING,
                         RiderCustodyState.objects.get(
                             rider_id=self.profile.rider_id).current_float)

    def test_remit_empties_collected_cash_and_refuses_inventing_it(self):
        order, _ = self.walk_to_the_door_cod()
        self.assertEqual(Decimal('110.00'), RiderCustodyState.objects.get(
            rider_id=self.profile.rider_id).current_cash)
        api = self.api_for(self.admin)

        invent = api.post(self.custody('remit'), {'amount': '200'},
                          format='json')
        self.assertEqual(400, invent.status_code, invent.data)
        self.assertIn('110.00', invent.data['error'])

        done = api.post(self.custody('remit'), {'amount': '110.00'},
                        format='json')
        self.assertEqual(200, done.status_code, done.data)
        self.assertEqual(Decimal('0.00'),
                         money(done.data['custody']['current_cash']))

        move = CashMovement.objects.get(movement_type='REMITTANCE_TO_VAULT')
        self.assertEqual(Decimal('110.00'), move.amount)
        self.assertEqual(str(self.profile.rider_id), move.from_ref_id)
        self.assertEqual(self.site.code, move.site)
        self.assertEqual('RIDER', move.from_container)
        self.assertEqual('VAULT', move.to_container)

        again = api.post(self.custody('remit'), {'amount': '1.00'},
                         format='json')
        self.assertEqual(400, again.status_code, again.data)

    def test_a_cod_capture_now_leaves_exactly_one_payment_row(self):
        order, task = self.walk_to_the_door_cod()

        payment = Payment.objects.get(order=order, method='COD_CASH')
        self.assertEqual(Decimal('110.00'), money(payment.amount))
        self.assertEqual('CAPTURED', payment.status)
        self.assertEqual(order.customer, payment.customer)
        self.assertEqual('CASH', payment.gateway)

        # A replayed settlement must not book the same cash a second time.
        _settle_delivery(order=order, task=task, actor=self.rider,
                         cod=Decimal('110.00'),
                         delivered_at=timezone.now())
        self.assertEqual(1, Payment.objects.filter(
            order=order, method='COD_CASH').count())

    def test_only_counter_people_move_the_books(self):
        rider = self.api_for(self.rider)
        refused = rider.post(self.custody('issue-float'), {
            'amount': '100', 'site_code': self.site.code,
        }, format='json')
        self.assertEqual(403, refused.status_code, refused.data)

        stranger = self.api_for(self.shopper)
        refused = stranger.post(self.custody('remit'), {'amount': '1'},
                                format='json')
        self.assertEqual(403, refused.status_code, refused.data)

        cashier = self.api_for(self.cashier)
        ok = cashier.post(self.custody('issue-float'), {
            'amount': '100', 'site_code': self.site.code,
        }, format='json')
        self.assertEqual(200, ok.status_code, ok.data)

        foreign = cashier.post(self.custody('issue-float'), {
            'amount': '100', 'site_code': self.other_site.code,
        }, format='json')
        self.assertEqual(403, foreign.status_code, foreign.data)

    def test_bad_amounts_and_unknown_riders_are_named(self):
        api = self.api_for(self.admin)

        for bad in ('abc', '-5', '0', None):
            payload = {'site_code': self.site.code}
            if bad is not None:
                payload['amount'] = bad
            r = api.post(self.custody('issue-float'), payload, format='json')
            self.assertEqual(400, r.status_code, (bad, r.data))

        no_site = api.post(self.custody('issue-float'), {'amount': '10'},
                           format='json')
        self.assertEqual(400, no_site.status_code, no_site.data)
        self.assertIn('site_code', no_site.data['error'])

        unknown = api.post(
            f'{CUSTODY}11111111-2222-3333-4444-555555555555/issue-float/',
            {'amount': '10', 'site_code': self.site.code}, format='json')
        self.assertEqual(404, unknown.status_code, unknown.data)

        not_a_rider = api.post(
            f'{CUSTODY}not-a-rider/issue-float/',
            {'amount': '10', 'site_code': self.site.code}, format='json')
        self.assertEqual(404, not_a_rider.status_code, not_a_rider.data)

        # A real rider who has never held anything: returning float to them
        # is a 404 rather than a free-floating negative balance.
        nobody = User.objects.create(
            email='never-held@zippzo.in', password_hash=make_password('Nv123!'),
            role='RIDER', status='ACTIVE')
        profile = RiderProfile.objects.create(
            user=nobody, name='Never Held', phone='9000000000',
            vehicle_type='BIKE', vehicle_number='KA-99',
            current_site=self.site)
        empty = api.post(f'{CUSTODY}{profile.rider_id}/return-float/',
                         {'amount': '10'}, format='json')
        self.assertEqual(404, empty.status_code, empty.data)
