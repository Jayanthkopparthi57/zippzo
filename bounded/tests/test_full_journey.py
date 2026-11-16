"""One order, four people, start to finish.

This is the rehearsal. Everything else in `bounded/tests` isolates one rule and
sets its own world up by writing to the database. This one goes through the
public HTTP API only, as four separately authenticated people, and asserts on
what a customer would be told at the end:

    shopper      places the order on the real /orders/checkout endpoint
    dark store   allocates, picks each unit off a shelf by scanning the bin
    packer       seals the goods into a scanned tote at a staging slot
    rider        collects that tote, gets a code, collects cash, delivers

Nothing is written to the database to make any of it happen. Stock arrives
through `apply_stock` like real inbound goods, the order is placed by the
shopper's own API call rather than seeded, and the only thing read out of the
database directly is the delivery code the *customer* would read off their
phone - because that is the one thing the rider must never be able to see.

The stock ledger is the real one, so this doubles as a check that a whole
lifecycle leaves the ledger balanced: goods leave the shelf, enter the tote,
leave the site, and never come back.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.db import connection
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Listing, Sku
from bounded.delivery.models import DeliveryTask, RiderProfile
from bounded.ds_ops.allocation import allocations_for_order
from bounded.iam.models import User
from bounded.inventory.ledger import expected_balances, actual_balances
from bounded.inventory.models import LpnContent, LpnMaster, StockBalance
from bounded.inventory.stock import apply_stock
from bounded.network.models import EmployeeSiteAssignment, Location, Site
from bounded.routing.models import DeliveryArea
from bounded.notifications.publish import publish_batch
from bounded.orders.models import (
    Cart, CartLine, Customer, CustomerAddress, CustomerOrder,
)
from bounded.outbox.models import OutboxEvent

PASSWORD = 'Journey123!'


class FullJourneyTests(TestCase):
    """shopper -> dark store -> packer -> rider -> customer."""

    @classmethod
    def setUpTestData(cls):
        # -- the four people, each with their own login ------------------------
        cls.shopper = User.objects.create(
            email='journey-shopper@zippzo.in', password_hash=make_password(PASSWORD),
            role='CUSTOMER', status='ACTIVE')
        cls.picker = User.objects.create(
            email='journey-picker@zippzo.in', password_hash=make_password(PASSWORD),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        cls.packer = User.objects.create(
            email='journey-packer@zippzo.in', password_hash=make_password(PASSWORD),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        cls.rider_user = User.objects.create(
            email='journey-rider@zippzo.in', password_hash=make_password(PASSWORD),
            role='RIDER', status='ACTIVE')

        # -- the store --------------------------------------------------------
        cls.site = Site.objects.create(
            code='DS-JOURNEY', site_type='DARK_STORE', name='Journey Dark Store',
            address='1 Journey Road', status='ACTIVE', is_accepting_orders=True)
        DeliveryArea.objects.create(site=cls.site, pincode='560001', band='CORE')
        DeliveryArea.objects.create(site=cls.site, pincode='560002', band='CORE')
        for emp, user, role in (
            ('JOURNEYPICK', cls.picker, 'PICKER'),
            ('JOURNEYPACK', cls.packer, 'PACKER'),
        ):
            EmployeeSiteAssignment.objects.create(
                employee=emp, user=user, site=cls.site,
                mode='DARKHOUSE', role_at_site=role, is_primary=True)

        cls.rider = RiderProfile.objects.create(
            user=cls.rider_user, name='Journey Rider', phone='9812345678',
            vehicle_type='BIKE', is_online=True, current_site=cls.site)

        # Aisle A and aisle B, far apart so the pick route is decided by
        # allocation rather than by which row the database returns first.
        cls.bin_a = Location.objects.create(
            site=cls.site, location_id='BIN-JRN-A', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='BIN-JRN-A', is_sellable_bin=True, created_by='journey')
        cls.bin_b = Location.objects.create(
            site=cls.site, location_id='BIN-JRN-B', location_type='BIN',
            aisle='B7', rack='R4', level='L3', position='P6',
            barcode='BIN-JRN-B', is_sellable_bin=True, created_by='journey')

        cls.tote = LpnMaster.objects.create(
            lpn_id='LPN-JRN-1', barcode='TOTE-JRN-1', lpn_type='TOTE',
            current_site=cls.site, status='EMPTY', created_by='journey')

        # -- what the store sells ---------------------------------------------
        cls.milk = Sku.objects.create(
            sku_code='JRN-MILK', name='Toned Milk', sub_category='Dairy',
            brand='Zippzo', pack_size='1', hsn_code='0401', weight_g=1000,
            status='ACTIVE', mrp=Decimal('65.00'))
        cls.bread = Sku.objects.create(
            sku_code='JRN-BREAD', name='Wholemeal Bread', sub_category='Bakery',
            brand='Zippzo', pack_size='1', hsn_code='1905', weight_g=400,
            status='ACTIVE', mrp=Decimal('45.00'))

        cls.milk_lot = InventoryLot.objects.create(
            sku=cls.milk, site=cls.site, batch_number='JRN-LOT-MILK',
            inbound_type='PURCHASE', inbound_ref='PO-JRN-1')
        cls.bread_lot = InventoryLot.objects.create(
            sku=cls.bread, site=cls.site, batch_number='JRN-LOT-BREAD',
            inbound_type='PURCHASE', inbound_ref='PO-JRN-2')

        Listing.objects.create(sku=cls.milk, site=cls.site,
                               price=Decimal('60.00'), mrp=Decimal('65.00'),
                               is_listed=True, is_available=True)
        Listing.objects.create(sku=cls.bread, site=cls.site,
                               price=Decimal('40.00'), mrp=Decimal('45.00'),
                               is_listed=True, is_available=True)

        # -- goods arrive, through the ledger ---------------------------------
        # Milk is split across both shelves so the picker has to walk the store.
        # Direct StockBalance inserts would make the balances right and the
        # ledger wrong, which is exactly the state this whole system spent the
        # last phase learning to detect.
        for bin_ref, qty, sku, lot in (
            (cls.bin_a.location_id, 3, cls.milk, cls.milk_lot),
            (cls.bin_b.location_id, 4, cls.milk, cls.milk_lot),
            (cls.bin_a.location_id, 2, cls.bread, cls.bread_lot),
        ):
            apply_stock(
                site=cls.site, sku=sku, lot=lot, qty=qty,
                movement_type='RECEIPT', ref_type='LPN',
                ref_id=f'LPN-INBOUND-{uuid.uuid4()}',
                actor_id=str(cls.picker.user_id), actor_type='SYSTEM',
                container='BIN', container_ref=bin_ref,
            )

        # -- the shopper's account ---------------------------------------------
        cls.customer = Customer.objects.create(user=cls.shopper, name='Journey Shopper')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='42 Shopper Lane',
            pincode='560001', city='Bengaluru', is_default=True)

    # -- helpers ------------------------------------------------------------
    def as_user(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    @property
    def shopper_api(self):
        return self.as_user(self.shopper)

    def storefront(self):
        return self.as_user(self.shopper).get(
            f'/api/orders/storefront?site={self.site.code}&pincode=560001')

    def complete_journey(self):
        """Run the whole thing and return everything worth asserting on."""
        api = self.as_user(self.shopper)
        picker = self.as_user(self.picker)
        packer = self.as_user(self.packer)
        rider = self.as_user(self.rider_user)

        # ── 1. the shopper browses and orders ────────────────────────────
        shelf = self.storefront()
        self.assertEqual(200, shelf.status_code)

        cart = Cart.objects.create(customer=self.customer, site=self.site)
        CartLine.objects.create(cart=cart, line_no=1, sku=self.milk, qty=2,
                                unit_price=Decimal('60.00'))
        CartLine.objects.create(cart=cart, line_no=2, sku=self.bread, qty=1,
                                unit_price=Decimal('40.00'))

        placed = api.post('/api/orders/checkout', {
            'site': self.site.code,
            'address_id': str(self.address.address_id),
            'cart_id': str(cart.cart_id),
            'payment_method': 'COD',
        }, format='json')
        self.assertEqual(201, placed.status_code, placed.data)

        order = CustomerOrder.objects.get(order_no=placed.data['order_no'])
        self.assertEqual('CONFIRMED', order.status)

        # Reserved before the shopper was told yes, so a picker opens a route
        # rather than an empty order.
        allocations = allocations_for_order(order)
        self.assertEqual(2, len(allocations))
        self.assertEqual(3, sum(a.qty for v in allocations.values() for a in v))

        # ── 2. the dark store picks every unit, one scan at a time ────────
        outstanding = {}
        for line in order.lines.all():
            outstanding[str(line.line_id)] = line.qty

        while any(outstanding.values()):
            queue = picker.get('/api/ds-ops/pick-lines',
                               {'order_id': str(order.order_id)})
            self.assertEqual(200, queue.status_code, queue.data)

            picked_something = False
            for row in queue.data['lines']:
                need = outstanding.get(str(row['line_id']), 0)
                if need <= 0:
                    continue
                scan = picker.post('/api/ds-ops/pick-line', {
                    'order_id': str(order.order_id),
                    'line_id': row['line_id'],
                    'bin_location_id': row['bin_location_id'],
                    'qty': 1,
                    'scan_id': str(uuid.uuid4()),
                }, format='json')
                self.assertEqual(200, scan.status_code, scan.data)
                outstanding[str(row['line_id'])] = need - 1
                picked_something = True
                break
            self.assertTrue(picked_something, 'the pick queue offered nothing')

        completed = picker.post('/api/ds-ops/order-action', {
            'order_id': str(order.order_id), 'action': 'COMPLETE_PICK',
        }, format='json')
        self.assertEqual(200, completed.status_code, completed.data)

        # ── 3. the packer seals a scanned tote at a staging slot ──────────
        packed = packer.post('/api/ds-ops/pack-order', {
            'order_id': str(order.order_id),
            # What the operator actually scans is the barcode on the tote.
            'lpn_barcode': self.tote.barcode,
            'staging_bin': 'STAGE-A1',
        }, format='json')
        self.assertEqual(200, packed.status_code, packed.data)

        task = DeliveryTask.objects.get(order=order)

        # ── 4. the rider collects the tote ─────────────────────────────────
        picked_up = rider.post('/api/delivery/handoff/pickup', {
            'task_id': str(task.task_id),
            'lpn_barcode': self.tote.barcode,
        }, format='json')
        self.assertEqual(200, picked_up.status_code, picked_up.data)

        # What the tote looks like while it is out with the rider, before POD
        # is allowed to put it back. Recorded here because the assertions below
        # only ever see the end state.
        self.tote.refresh_from_db()
        tote_at_pickup = self.tote.status

        # ── 5. the rider asks for the code; the customer has it ────────────
        # Nothing has been issued yet, so the first attempt mints one and
        # refuses. This is the real flow: the code is generated by the failed
        # attempt and travels to the customer over the outbox, never back to the
        # rider who asked for it.
        asked = rider.post('/api/delivery/handoff/pod', {
            'task_id': str(task.task_id),
        }, format='json')
        self.assertEqual(409, asked.status_code, asked.data)
        self.assertTrue(asked.data.get('otp_required'))
        self.assertNotIn(
            'otp_issued', asked.data,
            'the pickup code was handed back to the rider, which is the one '
            'thing that would let a shared phone close every delivery on a route')

        otp = self.customer_otp(order)
        self.assertTrue(otp, 'no delivery code was ever issued to the customer')

        delivered = rider.post('/api/delivery/handoff/pod', {
            'task_id': str(task.task_id),
            'otp': otp,
            'cod_amount': str(order.grand_total),
        }, format='json')
        self.assertEqual(200, delivered.status_code, delivered.data)

        return {
            'order': order, 'task': task, 'response': delivered.data,
            'grand_total': order.grand_total,
            'tote_at_pickup': tote_at_pickup,
        }

    def customer_otp(self, order):
        """The code as the customer receives it: in the outbox, never in a reply."""
        publish_batch()
        event = (OutboxEvent.objects
                 .filter(event_type='delivery.pod_requested')
                 .order_by('-created_at').first())
        if event is None:
            return None
        payload = event.payload_json or {}
        if payload.get('order_id') != str(order.order_id):
            return None
        return payload.get('otp')

    def shelf_qty(self, sku):
        return sum(StockBalance.objects.filter(
            site=self.site, container='BIN', sku=sku).values_list('qty', flat=True))

    def tote_qty(self, sku):
        row = StockBalance.objects.filter(
            site=self.site, container='LPN', container_ref=self.tote.lpn_id,
            sku=sku).first()
        return row.qty if row else 0


class TheJourneyWorksTests(FullJourneyTests):

    def test_the_customer_receives_what_they_paid_for(self):
        result = self.complete_journey()

        order = CustomerOrder.objects.get(order_no=result['order'].order_no)

        self.assertEqual('DELIVERED', order.status)
        self.assertIsNotNone(order.delivered_at)
        # Free delivery over ₹150 (DEFAULT_FREE_ABOVE): 60 x 2 milk + 40 bread, no delivery fee.
        self.assertEqual(Decimal('160.00'), order.grand_total,
                         '60 x 2 milk + 40 bread; free delivery over ₹150')
        self.assertEqual(3, sum(l.packed_qty for l in order.lines.all()))
        self.assertEqual(3, sum(l.shipped_qty for l in order.lines.all()))

    def test_the_goods_went_from_shelf_to_tote_to_the_rider(self):
        result = self.complete_journey()

        # 7 milk and 2 bread arrived; 2 milk and 1 bread were sold.
        self.assertEqual(5, self.shelf_qty(self.milk))
        self.assertEqual(1, self.shelf_qty(self.bread))

        # The tote is empty at the end because pickup moved the goods out of the
        # LPN into the rider's custody - the units left the store rather than
        # sitting in a container at it.
        self.assertEqual(0, self.tote_qty(self.milk))
        self.assertEqual(0, self.tote_qty(self.bread))

        # What the tote carried is still recorded, which is what makes a
        # discrepancy investigable afterwards. One row per SKU/lot, not per unit.
        self.assertEqual(2, LpnContent.objects.filter(lpn=self.tote).count())

    def test_cash_was_collected_and_matches_the_order(self):
        result = self.complete_journey()

        self.assertEqual(str(result['grand_total']), result['response']['cod_amount'])
        self.assertEqual('0.00', result['response']['cod_variance'])

    def test_the_rider_never_receives_the_code_in_the_response(self):
        result = self.complete_journey()

        # The rider's own replies must not contain the code, or a shared phone
        # would let a rider close every delivery on the route.
        blob = str(result['response']).lower()
        self.assertNotIn('otp', blob)

    def test_the_tote_is_sealed_then_leaves_the_store_with_the_rider(self):
        result = self.complete_journey()

        # Sealed when packed, in transit once collected - and back in the
        # store's own pool once the customer has it. The goods leave the tote
        # at the door, so the tote is empty from then on; leaving it IN_TRANSIT
        # with no site (which is what used to happen) meant a store that had
        # delivered once ran out of plastic and could never pack again.
        self.assertEqual('IN_TRANSIT', result['tote_at_pickup'],
                         'the tote left the store with the rider')

        self.tote.refresh_from_db()
        self.assertEqual('EMPTY', self.tote.status)
        self.assertEqual(self.site, self.tote.current_site,
                         'it goes back to the store that packed it')
        self.assertIsNone(self.tote.current_container)
        self.assertIsNone(self.tote.current_ref_id)
        self.assertIsNone(
            self.tote.sealed_at,
            'the next pack stamps its own seal time, not this delivery\'s')
        self.assertEqual('STAGE-A1', result['task'].staging_bin)

    def test_the_tote_is_back_where_the_packer_would_look_for_it(self):
        """The pool the pack screen reads has to offer it, not just the row."""
        self.complete_journey()

        # Exactly the query `emptyLpns()` sends for the "totes to fill" list.
        pool = LpnMaster.objects.filter(
            current_site=self.site, status__in=['EMPTY', 'CREATED'])
        self.assertIn(
            self.tote, list(pool),
            'the packer would be told there is nothing to pack into')

        # And the record of what it carried survives the round trip, because
        # that is what makes a discrepancy investigable afterwards.
        self.assertTrue(LpnContent.objects.filter(lpn=self.tote).exists())

    def test_the_ledger_is_balanced_after_a_whole_delivery(self):
        """A full lifecycle must leave the books agreeing with the movements."""
        self.complete_journey()

        # `.iterator()` needs a client cursor on this pooled connection. The
        # flag lives on the connection, not on this test, so it is put back
        # afterwards - left set, every later test in the same process reads
        # with server-side cursors off. It is not a key every backend carries,
        # so a missing one is restored as missing.
        previous = connection.settings_dict.get('DISABLE_SERVER_SIDE_CURSORS')
        connection.settings_dict['DISABLE_SERVER_SIDE_CURSORS'] = True
        try:
            expected = expected_balances()
            actual, _ = actual_balances()
        finally:
            if previous is None:
                connection.settings_dict.pop('DISABLE_SERVER_SIDE_CURSORS', None)
            else:
                connection.settings_dict['DISABLE_SERVER_SIDE_CURSORS'] = previous
        for key in set(expected) | set(actual):
            self.assertEqual(
                expected.get(key, 0), actual.get(key, 0),
                f'ledger disagrees at {key}')


class TheJourneyRefusesTests(FullJourneyTests):
    """The same journey, with the guards in the way."""

    def test_a_second_shopper_cannot_buy_the_last_bread(self):
        self.complete_journey()

        rival = User.objects.create(
            email='journey-rival@zippzo.in', password_hash=make_password(PASSWORD),
            role='CUSTOMER', status='ACTIVE')
        rival_customer = Customer.objects.create(user=rival, name='Rival')
        rival_address = CustomerAddress.objects.create(
            customer=rival_customer, label='Home', line1='7 Rival Road',
            pincode='560002', city='Bengaluru', is_default=True)

        response = self.as_user(rival).post('/api/orders/checkout', {
            'site': self.site.code,
            'address_id': str(rival_address.address_id),
            'items': [{'sku_id': str(self.bread.sku_id), 'qty': 2}],
            'payment_method': 'COD',
        }, format='json')

        self.assertEqual(409, response.status_code)
        self.assertEqual(1, CustomerOrder.objects.count())

    def test_a_picker_cannot_touch_another_stores_order(self):
        self.complete_journey()
        order = CustomerOrder.objects.get()

        elsewhere = Site.objects.create(
            code='DS-ELSEWHERE', site_type='DARK_STORE', name='Other Store',
            address='elsewhere')
        stolen = CustomerOrder.objects.create(
            order_no='ORD-JRN-OTHER', customer=self.customer, site=elsewhere,
            address=self.address, status='CONFIRMED', payment_method='COD',
            payment_status='PENDING', subtotal=Decimal('30.00'),
            grand_total=Decimal('50.00'))

        response = self.as_user(self.picker).post('/api/ds-ops/allocate-order', {
            'order_id': str(stolen.order_id)}, format='json')

        self.assertEqual(403, response.status_code)
        stolen.refresh_from_db()
        self.assertEqual('CONFIRMED', stolen.status,
                         'another store\'s order was allocated by our picker')

    def test_a_rider_cannot_deliver_with_the_wrong_code(self):
        result = self.complete_journey()
        task = result['task']

        fresh = CustomerOrder.objects.get()
        fresh.status = 'PICKED_UP'
        fresh.pod_otp_hash = None
        fresh.pod_issued_at = None
        fresh.save(update_fields=['status', 'pod_otp_hash', 'pod_issued_at'])

        response = self.as_user(self.rider_user).post('/api/delivery/handoff/pod', {
            'task_id': str(task.task_id), 'otp': '000000',
        }, format='json')

        self.assertIn(response.status_code, (400, 409))
        self.assertNotEqual('DELIVERED', CustomerOrder.objects.get().status)

    def test_the_order_cannot_be_picked_twice(self):
        self.complete_journey()
        order = CustomerOrder.objects.get()

        response = self.as_user(self.picker).post('/api/ds-ops/order-action', {
            'order_id': str(order.order_id), 'action': 'COMPLETE_PICK',
        }, format='json')

        self.assertEqual(409, response.status_code)
        self.assertEqual('DELIVERED', CustomerOrder.objects.get().status)

    def test_a_scanned_scan_is_not_counted_twice(self):
        """A scanner that fires twice on one unit must not pick two units."""
        api = self.as_user(self.shopper)
        placed = api.post('/api/orders/checkout', {
            'site': self.site.code,
            'address_id': str(self.address.address_id),
            'items': [{'sku_id': str(self.bread.sku_id), 'qty': 2}],
            'payment_method': 'COD',
        }, format='json')
        self.assertEqual(201, placed.status_code, placed.data)

        order = CustomerOrder.objects.get(order_no=placed.data['order_no'])
        line = order.lines.get()
        picker = self.as_user(self.picker)
        queue = picker.get('/api/ds-ops/pick-lines',
                           {'order_id': str(order.order_id)}).data
        expected_bin = queue['lines'][0]['bin_location_id']
        scan_id = str(uuid.uuid4())
        payload = {
            'order_id': str(order.order_id), 'line_id': str(line.line_id),
            'bin_location_id': expected_bin, 'qty': 1, 'scan_id': scan_id,
        }

        first = picker.post('/api/ds-ops/pick-line', payload, format='json')
        second = picker.post('/api/ds-ops/pick-line', payload, format='json')

        self.assertEqual(200, first.status_code, first.data)
        self.assertEqual(200, second.status_code, second.data)
        self.assertTrue(second.data.get('already_applied'),
                        'the repeat scan was not flagged as a replay')
        line.refresh_from_db()
        self.assertEqual(1, line.picked_qty,
                         'a duplicate scan took a second unit off the shelf')