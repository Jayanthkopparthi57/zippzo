"""The two halves of a delivery a shopper needs and a rider must not get.

Delivery already knew how to *check* a pickup code. What it never had was the
other end: the customer seeing one. `complete_pod` mints a code, deliberately
returns only `otp_required`, and the notification that would have carried it
has no provider behind it - so in practice nobody could read the code aloud
and every cash delivery stalled at the same door.

These cases pin the customer-facing half:

  * the shopper who owns the order reads the code, and only while it is live:
    not requested yet, ready, spent, gone;
  * the rider at that door, who can otherwise track the order, cannot read the
    code out of it - nor can an admin, nor a stranger;
  * an address is remembered as *the* default exactly once, because checkout
    takes whichever row it finds first, and a malformed address id is a bad
    request rather than a 500.
"""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.delivery.models import DeliveryTask, RiderProfile
from bounded.iam.models import User
from bounded.network.models import Site
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder

ORDERS = '/api/orders/orders/'
ADDRESSES = '/api/orders/addresses/'
CHECKOUT = '/api/orders/checkout'
POD = '/api/delivery/handoff/pod'
PICKUP = '/api/delivery/handoff/pickup'


class ShopperUxBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.shopper = User.objects.create(
            email='buyer@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        cls.stranger = User.objects.create(
            email='nosy@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        cls.admin = User.objects.create(
            email='boss@zippzo.in', password_hash=make_password('Shop123!'),
            role='ADMIN', status='ACTIVE')
        cls.rider = User.objects.create(
            email='rider@zippzo.in', password_hash=make_password('Shop123!'),
            role='RIDER', status='ACTIVE')

        cls.site = Site.objects.create(
            code='DS-UX', site_type='DARK_STORE', name='UX Dark Store',
            address='ux road')

        cls.customer = Customer.objects.create(user=cls.shopper, name='Buyer')
        cls.other_customer = Customer.objects.create(
            user=cls.stranger, name='Nosy')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Basket Road',
            pincode='560001', city='Bengaluru', is_default=True)
        cls.stranger_address = CustomerAddress.objects.create(
            customer=cls.other_customer, label='Home', line1='9 Nosy Road',
            pincode='560002', city='Bengaluru', is_default=True)

        cls.profile = RiderProfile.objects.create(
            user=cls.rider, name='Ravi', phone='9999999999',
            vehicle_type='BIKE', vehicle_number='KA-01')

    def api_for(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api

    def make_order(self, *, status='ARRIVED', customer=None, order_no='UX-1001'):
        return CustomerOrder.objects.create(
            order_no=order_no,
            customer=customer or self.customer,
            site=self.site, address=self.address, status=status,
            payment_method='COD', subtotal=Decimal('90.00'),
            grand_total=Decimal('110.00'))

    def make_task(self, order, *, status='AT_DS'):
        # AT_DS: staged at the store, waiting for the rider to collect. The
        # old default of ARRIVED described a task already at the customer's
        # door with nothing ever shipped out of the store, which is exactly the
        # state pickup refuses and POD used to accept.
        return DeliveryTask.objects.create(
            order=order, site=self.site, rider=self.profile, status=status)

    def rider_requests_code(self, task, order):
        """The rider's first POD call, which mints the code and hands back nothing.

        The collection is recorded first. `complete_pod` now refuses a task
        that has never been picked up - a task could otherwise be walked to
        DELIVERED straight out of the store with `shipped_qty` still 0 and no
        SHIP movement behind it - so a code cannot be minted until the goods
        have actually left.
        """
        collected = self.api_for(self.rider).post(
            PICKUP, {'task_id': str(task.task_id)}, format='json')
        self.assertEqual(200, collected.status_code, collected.data)
        response = self.api_for(self.rider).post(
            POD, {'task_id': str(task.task_id)}, format='json')
        self.assertEqual(409, response.status_code, response.data)
        self.assertTrue(response.data.get('otp_required'))
        return response


class DeliveryCodeTests(ShopperUxBase):

    def test_the_shopper_reads_the_code_the_rider_was_not_given(self):
        order = self.make_order()
        task = self.make_task(order)

        asked = self.rider_requests_code(task, order)
        self.assertNotIn('otp', asked.data,
                         'the rider was handed the very code it is meant to be '
                         'checked against')

        code = self.api_for(self.shopper).get(
            f'{ORDERS}{order.order_id}/delivery-code/')

        self.assertEqual(200, code.status_code, code.data)
        self.assertEqual('ready', code.data['state'])
        self.assertRegex(str(code.data['code']), r'^\d{6}$')

        # And it is the code that actually closes the delivery.
        closed = self.api_for(self.rider).post(POD, {
            'task_id': str(task.task_id),
            'otp': code.data['code'],
            'cod_amount': str(order.grand_total),
        }, format='json')
        self.assertEqual(200, closed.status_code, closed.data)
        self.assertTrue(closed.data.get('success'))

    def test_a_code_has_not_been_requested_yet(self):
        order = self.make_order()

        response = self.api_for(self.shopper).get(
            f'{ORDERS}{order.order_id}/delivery-code/')

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('not_requested', response.data['state'])
        self.assertIsNone(response.data['code'])

    def test_a_code_that_has_been_spent_cannot_be_read_back(self):
        """A code the rider already used must not survive as a standing pass."""
        order = self.make_order()
        task = self.make_task(order)
        rider = self.api_for(self.rider)
        self.rider_requests_code(task, order)

        issued = self.api_for(self.shopper).get(
            f'{ORDERS}{order.order_id}/delivery-code/')
        closed = rider.post(POD, {
            'task_id': str(task.task_id),
            'otp': issued.data['code'],
            'cod_amount': str(order.grand_total),
        }, format='json')
        self.assertEqual(200, closed.status_code, closed.data)

        order.refresh_from_db()
        self.assertIsNone(order.pod_otp_hash)

        response = self.api_for(self.shopper).get(
            f'{ORDERS}{order.order_id}/delivery-code/')
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('used', response.data['state'])
        self.assertIsNone(response.data['code'])

    def test_the_rider_at_the_door_cannot_read_the_code_from_the_order(self):
        """They can see the job and the order behind it - that is what they
        are carrying, and the dashboard asks for the order. That is not the
        same as knowing the code the customer has to read out."""
        order = self.make_order()
        task = self.make_task(order)
        self.rider_requests_code(task, order)
        rider = self.api_for(self.rider)

        job = rider.get(f'/api/delivery/delivery-tasks/{task.task_id}/')
        detail = rider.get(f'{ORDERS}{order.order_id}/')
        code = rider.get(f'{ORDERS}{order.order_id}/delivery-code/')

        self.assertEqual(200, job.status_code,
                         'a rider assigned to the job should be able to read it')
        self.assertEqual(
            200, detail.status_code,
            'the rider is carrying this order and must be able to read it')
        self.assertEqual(404, code.status_code, code.data)

    def test_a_rider_cannot_read_an_order_they_are_not_carrying(self):
        """Being a rider opens their own tasks, not the network."""
        mine = self.make_order(order_no='UX-2001')
        self.make_task(mine)
        theirs = self.make_order(order_no='UX-2002')
        rider = self.api_for(self.rider)

        seen = rider.get(f'{ORDERS}{mine.order_id}/')
        unseen = rider.get(f'{ORDERS}{theirs.order_id}/')
        listing = rider.get(ORDERS)

        self.assertEqual(200, seen.status_code, seen.data)
        self.assertEqual(404, unseen.status_code, unseen.data)
        self.assertEqual([str(mine.order_id)],
                         [o['order_id'] for o in listing.data['results']])

    def test_an_admin_cannot_read_the_code(self):
        """`get_queryset` opens orders to admins for support - not this route."""
        order = self.make_order()
        task = self.make_task(order)
        self.rider_requests_code(task, order)

        detail = self.api_for(self.admin).get(f'{ORDERS}{order.order_id}/')
        code = self.api_for(self.admin).get(
            f'{ORDERS}{order.order_id}/delivery-code/')

        self.assertEqual(200, detail.status_code,
                         'an admin should still be able to see the order')
        self.assertEqual(404, code.status_code, code.data)

    def test_another_shopper_cannot_read_the_code(self):
        order = self.make_order()
        task = self.make_task(order)
        self.rider_requests_code(task, order)

        detail = self.api_for(self.stranger).get(f'{ORDERS}{order.order_id}/')
        code = self.api_for(self.stranger).get(
            f'{ORDERS}{order.order_id}/delivery-code/')

        self.assertEqual(404, detail.status_code)
        self.assertEqual(404, code.status_code)

    def test_the_code_is_not_carried_on_the_order_payload(self):
        """The tracking response must stay a tracking response."""
        order = self.make_order()
        task = self.make_task(order)
        self.rider_requests_code(task, order)

        body = self.api_for(self.shopper).get(f'{ORDERS}{order.order_id}/')

        self.assertEqual(200, body.status_code, body.data)
        self.assertNotIn('pod_otp_hash', body.data)
        self.assertNotIn('code', body.data)


class AddressUxTests(ShopperUxBase):

    def test_saving_a_second_default_clears_the_first(self):
        """Checkout takes whichever row is flagged, so there can only be one."""
        api = self.api_for(self.shopper)

        created = api.post(ADDRESSES, {
            'label': 'Work', 'line1': '2 Office Road',
            'pincode': '560004', 'city': 'Bengaluru', 'is_default': True,
        }, format='json')

        self.assertEqual(201, created.status_code, created.data)
        self.address.refresh_from_db()
        row = CustomerAddress.objects.get(address_id=created.data['address_id'])
        self.assertTrue(row.is_default)
        self.assertFalse(
            self.address.is_default,
            'the older address stayed flagged, so checkout could pick either')

    def test_the_default_can_be_moved_back(self):
        api = self.api_for(self.shopper)
        first = api.post(ADDRESSES, {
            'label': 'Work', 'line1': '2 Office Road',
            'pincode': '560004', 'city': 'Bengaluru', 'is_default': True,
        }, format='json')
        self.assertEqual(201, first.status_code, first.data)

        moved = api.patch(
            f'{ADDRESSES}{self.address.address_id}/',
            {'is_default': True}, format='json')

        self.assertEqual(200, moved.status_code, moved.data)
        self.address.refresh_from_db()
        other = CustomerAddress.objects.get(
            address_id=first.data['address_id'])
        self.assertTrue(self.address.is_default)
        self.assertFalse(other.is_default)

    def test_a_shopper_cannot_set_a_default_on_a_foreign_address(self):
        """A write at an id outside the drawer is a 404, and changes nothing."""
        response = self.api_for(self.shopper).patch(
            f'{ADDRESSES}{self.stranger_address.address_id}/',
            {'is_default': True}, format='json')

        self.stranger_address.refresh_from_db()
        self.assertEqual(404, response.status_code, response.data)
        self.assertTrue(self.stranger_address.is_default)

    def test_an_address_is_deleted_by_its_owner_and_nobody_else(self):
        denied = self.api_for(self.stranger).delete(
            f'{ADDRESSES}{self.address.address_id}/')

        self.assertEqual(404, denied.status_code)
        self.assertTrue(
            CustomerAddress.objects.filter(pk=self.address.address_id).exists(),
            'a stranger deleted a saved address')

        removed = self.api_for(self.shopper).delete(
            f'{ADDRESSES}{self.address.address_id}/')

        self.assertEqual(204, removed.status_code)
        self.assertFalse(
            CustomerAddress.objects.filter(pk=self.address.address_id).exists())

    def test_an_address_with_orders_against_it_cannot_be_deleted(self):
        """`CustomerOrder.address` cascades, so tidying up an address book
        would otherwise take the order history - totals, proof of delivery
        and all - with it."""
        order = self.make_order()

        response = self.api_for(self.shopper).delete(
            f'{ADDRESSES}{self.address.address_id}/')

        self.assertEqual(400, response.status_code, response.data)
        self.assertTrue(CustomerAddress.objects.filter(
            pk=self.address.address_id).exists())
        self.assertTrue(CustomerOrder.objects.filter(pk=order.order_id).exists())

    def test_a_malformed_address_id_is_bad_input_not_a_crash(self):
        """Django raises on a non-UUID id, which used to surface as a 500."""
        response = self.api_for(self.shopper).post(CHECKOUT, {
            'site': self.site.code,
            'address_id': 'ADDR1',
            'items': [],
            'payment_method': 'COD',
        }, format='json')

        self.assertEqual(404, response.status_code, response.data)
        self.assertEqual(0, CustomerOrder.objects.count())
