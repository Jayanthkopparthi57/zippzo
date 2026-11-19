"""The whole journey, in order, with no shortcuts.

Every earlier test fakes something to isolate one rule. This one fakes nothing:
stock is put away through the ledger, the order is allocated, each unit is
scanned off a shelf, the pick is completed, the order is packed into a scanned
bag, a rider collects the bag, and the customer reads a code off their phone
so the delivery can close.

The assertions are the ones that matter at the end: where the stock is, what the
order says happened, who the ledger says did it, and whether the promises made to
the rider and the customer are queued rather than lost.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.delivery.handoff import _hash_otp
from bounded.delivery.models import DeliveryTask, RiderProfile
from bounded.ds_ops.allocation import allocate_order
from bounded.iam.models import User
from bounded.inventory.models import StockBalance, StockMovement
from bounded.network.models import EmployeeSiteAssignment, Location, Site
from bounded.notifications.models import Notification
from bounded.notifications.publish import publish_batch
from bounded.orders.models import (
    Customer, CustomerAddress, CustomerOrder, CustomerOrderLine,
)
from bounded.outbox.models import OutboxEvent

ALLOCATE = '/api/ds-ops/allocate-order'
PICK_LINES = '/api/ds-ops/pick-lines'
PICK_LINE = '/api/ds-ops/pick-line'
RESOLVE_BIN = '/api/ds-ops/resolve-bin'
ORDER_ACTION = '/api/ds-ops/order-action'
PACK = '/api/ds-ops/pack-order'
PICKUP = '/api/delivery/handoff/pickup'
POD = '/api/delivery/handoff/pod'


class EndToEndWorkflowTests(TestCase):
    """Place -> allocate -> pick -> pack -> pickup -> POD -> notify."""

    @classmethod
    def setUpTestData(cls):
        cls.picker = User.objects.create(
            email='e2e-picker@zippzo.in', password_hash=make_password('E2e123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        cls.rider_user = User.objects.create(
            email='e2e-rider@zippzo.in', password_hash=make_password('E2e123!'),
            role='RIDER', status='ACTIVE')
        cls.customer_user = User.objects.create(
            email='e2e-shopper@zippzo.in', password_hash=make_password('E2e123!'),
            role='CUSTOMER', status='ACTIVE')

        cls.site = Site.objects.create(
            code='DS-E2E', site_type='DARK_STORE', name='E2E Dark Store',
            address='e2e')
        EmployeeSiteAssignment.objects.create(
            employee='E2EPICKR', user=cls.picker, site=cls.site,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)

        cls.rider = RiderProfile.objects.create(
            user=cls.rider_user, name='E2E Rider', phone='9800000000',
            vehicle_type='BIKE', is_online=True, current_site=cls.site)

        # Two bins, deliberately non-adjacent ids so the picker's walk order is
        # decided by allocation and not by the database.
        cls.bin_1 = Location.objects.create(
            site=cls.site, location_id='BIN-E2E-A', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='BIN-E2E-A', qr_payload='loc:e2e-a',
            is_sellable_bin=True, created_by='test')
        cls.bin_2 = Location.objects.create(
            site=cls.site, location_id='BIN-E2E-B', location_type='BIN',
            aisle='B2', rack='R2', level='L2', position='P2',
            barcode='BIN-E2E-B', qr_payload='loc:e2e-b',
            is_sellable_bin=True, created_by='test')


        cls.cereal = Sku.objects.create(
            sku_code='E2E-CEREAL', name='Cereal', sub_category='Grocery',
            brand='Zippzo', pack_size='1', hsn_code='1904', weight_g=400)
        cls.milk = Sku.objects.create(
            sku_code='E2E-MILK', name='Milk', sub_category='Dairy',
            brand='Zippzo', pack_size='1', hsn_code='0401', weight_g=1000)

        cls.cereal_lot = InventoryLot.objects.create(
            sku=cls.cereal, site=cls.site, batch_number='LOT-E2E-C',
            inbound_type='PURCHASE', inbound_ref='PO-E2E-C')
        cls.milk_lot = InventoryLot.objects.create(
            sku=cls.milk, site=cls.site, batch_number='LOT-E2E-M',
            inbound_type='PURCHASE', inbound_ref='PO-E2E-M')

        # Cereal is split across both bins, milk lives on one. This is the case
        # that used to be unpickable.
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin_1.location_id,
            sku=cls.cereal, lot=cls.cereal_lot, qty=3)
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin_2.location_id,
            sku=cls.cereal, lot=cls.cereal_lot, qty=2)
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin_1.location_id,
            sku=cls.milk, lot=cls.milk_lot, qty=4)

        cls.customer = Customer.objects.create(
            user=cls.customer_user, name='E2E Shopper')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 End To End Road',
            pincode='560001', city='Bengaluru')
        cls.order = CustomerOrder.objects.create(
            order_no='ORD-E2E-1', customer=cls.customer, site=cls.site,
            address=cls.address, status='CONFIRMED', payment_method='COD',
            payment_status='PENDING', subtotal=Decimal('240.00'),
            delivery_fee=Decimal('20.00'), grand_total=Decimal('260.00'),
            placed_at=timezone.now())
        cls.cereal_line = CustomerOrderLine.objects.create(
            order=cls.order, line_no=1, sku=cls.cereal, lot=cls.cereal_lot,
            qty=4, unit_price=Decimal('30.00'), line_total=Decimal('120.00'))
        cls.milk_line = CustomerOrderLine.objects.create(
            order=cls.order, line_no=2, sku=cls.milk, lot=cls.milk_lot,
            qty=2, unit_price=Decimal('60.00'), line_total=Decimal('120.00'))

    def setUp(self):
        self.picker_api = APIClient()
        self.picker_api.force_authenticate(self.picker)
        self.rider_api = APIClient()
        self.rider_api.force_authenticate(self.rider_user)

    # -- helpers ---------------------------------------------------------
    def bin_qty(self, location_id, sku=None, lot=None):
        qs = StockBalance.objects.filter(
            site=self.site, container='BIN', container_ref=location_id)
        if sku is not None:
            qs = qs.filter(sku=sku, lot=lot)
        return sum(q.qty for q in qs)

    def scan_next_bin(self, line, expect_bin=None):
        """Walk the work list: read it, scan the bin it names, scan one unit."""
        lines = self.picker_api.get(
            PICK_LINES, {'order_id': str(self.order.order_id)}).data['lines']
        work = next(l for l in lines if str(l['line_id']) == str(line.line_id))
        self.assertGreater(work['outstanding'], 0, 'nothing left to pick')

        expected = expect_bin or work['bin_location_id']
        self.assertEqual(expected, work['bin_location_id'],
                         'the work list does not point at the bin under test')

        # The operator scans the printed label, not the internal id.
        resolved = self.picker_api.get(RESOLVE_BIN, {
            'store_code': self.site.code, 'q': expected}).data
        self.assertEqual(expected, resolved['matches'][0]['location_id'])

        return self.picker_api.post(PICK_LINE, {
            'order_id': str(self.order.order_id),
            'line_id': str(line.line_id),
            'bin_location_id': resolved['matches'][0]['location_id'],
            'qty': 1,
            'scan_id': str(uuid.uuid4()),
        }, format='json')

    def pickup_task(self):
        return DeliveryTask.objects.get(order=self.order)

    def pick_everything(self):
        """Walk the whole order off the shelves and complete the pick."""
        allocate_order(self.order)
        for _ in range(3):
            self.assertEqual(200, self.scan_next_bin(
                self.cereal_line, self.bin_1.location_id).status_code)
        self.assertEqual(200, self.scan_next_bin(
            self.cereal_line, self.bin_2.location_id).status_code)
        for _ in range(2):
            self.assertEqual(200, self.scan_next_bin(
                self.milk_line, self.bin_1.location_id).status_code)
        response = self.picker_api.post(ORDER_ACTION, {
            'order_id': str(self.order.order_id),
            'action': 'COMPLETE_PICK'}, format='json')
        self.assertEqual(200, response.status_code, response.data)
        return response

    # -- the journey -----------------------------------------------------
    def test_full_order_to_delivery(self):
        # 1. Allocate: fix the route and the shelves.
        allocated = self.picker_api.post(
            ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')
        self.assertEqual(200, allocated.status_code, allocated.data)

        # Cereal needs 4 units but no single bin holds 4, so the order is split
        # across both shelves and neither bin is stranded.
        self.assertEqual(
            {'BIN-E2E-A', 'BIN-E2E-B'},
            {a['location_id'] for a in allocated.data['allocations']
             if a['line_id'] == str(self.cereal_line.line_id)})

        # 2. Allocate moved nothing. This is a plan, not a reservation.
        self.assertEqual(3, self.bin_qty(
            self.bin_1.location_id, self.cereal, self.cereal_lot))
        self.assertEqual(2, self.bin_qty(
            self.bin_2.location_id, self.cereal, self.cereal_lot))
        self.assertEqual(4, self.bin_qty(
            self.bin_1.location_id, self.milk, self.milk_lot))

        # 3. Pick, following the work list bin by bin. Allocation drains the
        #    fuller shelf first, so the walk is A, A, A, then B.
        for _ in range(3):
            first = self.scan_next_bin(self.cereal_line, self.bin_1.location_id)
            self.assertEqual(200, first.status_code, first.data)

        second = self.scan_next_bin(self.cereal_line, self.bin_2.location_id)
        self.assertEqual(200, second.status_code, second.data)

        for _ in range(2):
            milk = self.scan_next_bin(self.milk_line, self.bin_1.location_id)
            self.assertEqual(200, milk.status_code, milk.data)

        # Allocation drained bin A completely and took only the one unit it needed from
        # bin B, so B keeps the unit that was never allocated to this order.
        self.assertEqual(0, self.bin_qty(
            self.bin_1.location_id, self.cereal, self.cereal_lot))
        self.assertEqual(1, self.bin_qty(
            self.bin_2.location_id, self.cereal, self.cereal_lot))
        self.assertEqual(2, self.bin_qty(
            self.bin_1.location_id, self.milk, self.milk_lot))
        self.assertEqual(0, StockBalance.objects.filter(
            site=self.site, container='LPN').count())

        # 4. Complete the pick.
        completed = self.picker_api.post(ORDER_ACTION, {
            'order_id': str(self.order.order_id),
            'action': 'COMPLETE_PICK',
        }, format='json')
        self.assertEqual(200, completed.status_code, completed.data)
        self.assertEqual('PICKED', completed.data['status'])

        # 5. Pack the loose bag, staged where the rider will be told.
        packed = self.picker_api.post(PACK, {
            'order_id': str(self.order.order_id),
            'staging_bin': 'STAGE-E2E-7',
        }, format='json')
        self.assertEqual(200, packed.status_code, packed.data)
        self.assertEqual('PACKED', packed.data['status'])
        self.assertEqual('STAGE-E2E-7', packed.data['delivery_task']['staging_bin'])

        # 6. The rider collects the bag, no tote involved at all.
        picked_up = self.rider_api.post(PICKUP, {
            'task_id': str(self.pickup_task().task_id),
        }, format='json')
        self.assertEqual(200, picked_up.status_code, picked_up.data)
        self.assertEqual('PICKED_UP', picked_up.data['status'])
        self.assertEqual(6, picked_up.data['shipped_qty'])

        self.cereal_line.refresh_from_db()
        self.milk_line.refresh_from_db()
        self.assertEqual(4, self.cereal_line.shipped_qty)
        self.assertEqual(2, self.milk_line.shipped_qty)

        # 7. Close the delivery. No OTP has been issued, so the first attempt
        #    issues one and refuses; the customer reads it to the rider.
        issued = self.rider_api.post(POD, {
            'task_id': str(self.pickup_task().task_id)}, format='json')
        self.assertEqual(409, issued.status_code)
        self.assertTrue(issued.data['otp_required'])
        self.assertNotIn(
            'otp_issued', issued.data,
            'the pickup code was handed back to the rider, which is the one '
            'thing the code exists to prevent')
        self.order.refresh_from_db()
        self.assertEqual('PICKED_UP', self.order.status,
                         'an OTP request closed the order')

        # The code is read the way the customer receives it: off the outbox
        # notification, not off the API response. Asserting the delivered value
        # is the one that works ties the two together.
        event = OutboxEvent.objects.filter(
            event_type='delivery.pod_requested').order_by('-created_at').first()
        self.assertIsNotNone(event, 'no pickup code was ever sent to the customer')
        otp = event.payload_json['otp']
        self.assertEqual(6, len(str(otp)))
        self.assertNotIn(otp, str(issued.data),
                         'the code leaked into the response body')

        wrong = self.rider_api.post(POD, {
            'task_id': str(self.pickup_task().task_id),
            'otp': '000000' if otp != '000000' else '111111',
            'cod_amount': '260.00'}, format='json')
        self.assertEqual(400, wrong.status_code)

        delivered = self.rider_api.post(POD, {
            'task_id': str(self.pickup_task().task_id),
            'otp': otp,
            'cod_amount': '260.00',
        }, format='json')
        self.assertEqual(200, delivered.status_code, delivered.data)
        self.assertEqual('DELIVERED', delivered.data['status'])
        self.assertEqual('CAPTURED', delivered.data['payment_status'])
        self.assertEqual('260.00', delivered.data['cod_amount'])
        self.assertEqual('0.00', delivered.data['cod_variance'])

        # 8. Publish the promises.
        published, summary = publish_batch()
        self.assertGreaterEqual(published, 4, summary)
        self.assertEqual([], summary.get('_errors', []))

        types = set(OutboxEvent.objects.values_list('event_type', flat=True))
        self.assertLessEqual(
            {'order.packed', 'delivery_task.created', 'order.picked_up',
             'delivery.pod_requested', 'order.delivered'}, types)

        # The rider is told where to collect; the customer is told it is on the
        # way and, finally, that it arrived.
        self.assertTrue(Notification.objects.filter(
            type='RIDER_ASSIGNED', payload_json__order_no='ORD-E2E-1'
        ).exists())
        self.assertTrue(Notification.objects.filter(
            type='ORDER_ON_THE_WAY', user=str(self.customer_user.user_id)
        ).exists())
        self.assertTrue(Notification.objects.filter(
            type='ORDER_DELIVERED', user=str(self.customer_user.user_id)
        ).exists())
        self.assertTrue(Notification.objects.filter(
            type='DELIVERY_OTP', user=str(self.customer_user.user_id)
        ).exists(), 'the customer never received the pickup code')

        # 9. Final ledger. Six units out of the bins, six out with the rider.
        refs = {}
        for m in StockMovement.objects.filter(site=self.site):
            refs[m.movement_ref] = refs.get(m.movement_ref, 0) + m.qty
        self.assertEqual(6, refs['PICK'])
        self.assertEqual(6, refs['SHIP'])

        order = CustomerOrder.objects.get(pk=self.order.pk)
        self.assertEqual('DELIVERED', order.status)
        self.assertIsNotNone(order.delivered_at)
        self.assertIsNone(order.pod_otp_hash,
                          'the pickup code was left reusable after the delivery')

        # Every transition in the journey, with nothing skipped and no unaudited
        # jump: CONFIRMED -> PICKED -> PACKED -> PICKED_UP -> DELIVERED.
        transitions = [(h.from_status, h.to_status)
                       for h in order.status_history.all()]
        self.assertEqual(
            [('PICKED_UP', 'DELIVERED'), ('PACKED', 'PICKED_UP'),
             ('PICKED', 'PACKED'), ('CONFIRMED', 'PICKED')],
            transitions)

    def test_the_journey_cannot_skip_the_pick(self):
        """Pack is refused until the units are really off the shelf."""
        allocate_order(self.order)

        response = self.picker_api.post(PACK, {
            'order_id': str(self.order.order_id),
            'staging_bin': 'STAGE-E2E-7',
        }, format='json')

        self.assertEqual(409, response.status_code)
        self.assertEqual(0, StockBalance.objects.filter(
            site=self.site, container='LPN').count())
        self.assertEqual(0, DeliveryTask.objects.count())
        self.assertEqual(3, self.bin_qty(
            self.bin_1.location_id, self.cereal, self.cereal_lot))

    def test_cod_has_to_be_an_amount_the_rider_actually_counted(self):
        """`str(x)` never raises, so junk used to be recorded as cash."""
        self.pick_everything()
        self.picker_api.post(PACK, {
            'order_id': str(self.order.order_id),
            'staging_bin': 'STAGE-E2E-8'}, format='json')
        self.rider_api.post(PICKUP, {
            'task_id': str(self.pickup_task().task_id),
            }, format='json')

        first = self.rider_api.post(POD, {
            'task_id': str(self.pickup_task().task_id)}, format='json')
        self.assertEqual(409, first.status_code)
        otp = OutboxEvent.objects.filter(
            event_type='delivery.pod_requested').order_by(
                '-created_at').first().payload_json['otp']

        for junk in ('not money', '260,00', '', 'NaN', '-5'):
            response = self.rider_api.post(POD, {
                'task_id': str(self.pickup_task().task_id),
                'otp': otp,
                'cod_amount': junk}, format='json')
            self.assertEqual(
                400, response.status_code,
                f'cod_amount={junk!r} was accepted as cash collected')
            self.order.refresh_from_db()
            self.assertEqual('PICKED_UP', self.order.status,
                             f'cod_amount={junk!r} closed the order')

        # A shortfall is a real event, so it is allowed and made visible rather
        # than silently absorbed into CAPTURED.
        short = self.rider_api.post(POD, {
            'task_id': str(self.pickup_task().task_id),
            'otp': otp,
            'cod_amount': '250.00'}, format='json')
        self.assertEqual(200, short.status_code, short.data)
        self.assertEqual('250.00', short.data['cod_amount'])
        self.assertEqual('260.00', short.data['cod_due'])
        self.assertEqual('-10.00', short.data['cod_variance'])

    def test_the_dark_store_cannot_skip_pickup_and_pod(self):
        """HANDOFF_RIDER and DELIVERED used to be a back door to the last mile."""
        self.pick_everything()
        self.picker_api.post(PACK, {
            'order_id': str(self.order.order_id),
            'staging_bin': 'STAGE-E2E-9'}, format='json')

        for action in ('HANDOFF_RIDER', 'DELIVERED'):
            response = self.picker_api.post(ORDER_ACTION, {
                'order_id': str(self.order.order_id),
                'action': action,
                'picker': str(self.picker.user_id)}, format='json')
            self.assertEqual(
                410, response.status_code,
                f'{action} is still reachable from the dark store')
            self.order.refresh_from_db()
            self.assertEqual('PACKED', self.order.status,
                             f'{action} moved the order')
            self.assertIsNone(self.order.delivered_at)
            self.assertIsNone(self.order.picked_up_at)

        # Pack auto-assigns the online rider at the store — the task must not
        # have advanced past that into PICKED_UP without a real pickup.
        self.assertEqual('ACCEPTED', self.pickup_task().status,
                         'the delivery task advanced without a pickup')

    def test_publishing_twice_does_not_notify_twice(self):
        allocate_order(self.order)
        self.pick_everything()
        self.picker_api.post(PACK, {
            'order_id': str(self.order.order_id),
            'staging_bin': 'STAGE-E2E-7'}, format='json')

        first, _ = publish_batch()
        count = Notification.objects.count()
        second, _ = publish_batch()

        self.assertGreater(first, 0)
        self.assertEqual(0, second, 'a drained outbox was republished')
        self.assertEqual(count, Notification.objects.count())

    def test_a_rider_cannot_pick_up_another_riders_task(self):
        self.pick_everything()
        self.picker_api.post(PACK, {
            'order_id': str(self.order.order_id),
            'staging_bin': 'STAGE-E2E-7'}, format='json')

        task = self.pickup_task()
        other_rider = User.objects.create(
            email='e2e-other-rider@zippzo.in',
            password_hash=make_password('E2e123!'), role='RIDER', status='ACTIVE')
        RiderProfile.objects.create(
            user=other_rider, name='Other Rider', phone='9800000001',
            vehicle_type='BIKE', is_online=True, current_site=self.site)
        task.rider = RiderProfile.objects.get(user=other_rider)
        task.save(update_fields=['rider'])

        intruder = APIClient()
        intruder.force_authenticate(self.rider_user)
        response = intruder.post(PICKUP, {'task_id': str(task.task_id)},
                                 format='json')

        self.assertEqual(403, response.status_code)
        self.order.refresh_from_db()
        self.assertEqual('PACKED', self.order.status)