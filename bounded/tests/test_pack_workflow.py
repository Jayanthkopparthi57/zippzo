"""Packing is the operation that earns the word PACKED.

Before this existed, COMPLETE_PICK set the order straight to PACKED while the
goods were still on the floor. A rider could be told to collect from a staging
bin with nothing in it, and there was no moment at which the tote, its contents,
and the delivery job it created were known to agree with each other.

These cases pin the four things that had to become true together:
the tote holds real stock, the tote's contents are recorded, the rider job
exists and names the slot, and the events announcing both are written
transactionally.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.db.models import Count, Sum
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.delivery.models import DeliveryTask
from bounded.ds_ops.allocation import allocate_order
from bounded.ds_ops.models import PackTask
from bounded.inventory.models import LpnContent, LpnMaster, StockBalance, StockMovement
from bounded.iam.models import User
from bounded.network.models import EmployeeSiteAssignment, Location, Site
from bounded.orders.models import (
    Customer, CustomerAddress, CustomerOrder, CustomerOrderLine,
)
from bounded.outbox.models import OutboxEvent

PACK = '/api/ds-ops/pack-order'
PICK_LINE = '/api/ds-ops/pick-line'
ORDER_ACTION = '/api/ds-ops/order-action'


class PackBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.packer = User.objects.create(
            email='pack-operator@zippzo.in', password_hash=make_password('Pack123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        cls.stranger = User.objects.create(
            email='pack-stranger@zippzo.in', password_hash=make_password('Pack123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')

        cls.site = Site.objects.create(
            code='DS-PACK-TEST', site_type='DARK_STORE', name='Pack Test DS',
            address='test')
        EmployeeSiteAssignment.objects.create(
            employee='PACKOP01', user=cls.packer, site=cls.site,
            mode='DARKHOUSE', role_at_site='PACKER', is_primary=True)

        cls.bin = Location.objects.create(
            site=cls.site, location_id='BIN-PACK-0001', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='BIN-PACK-0001', is_sellable_bin=True, created_by='test')

        cls.tote = LpnMaster.objects.create(
            lpn_id='LPN-PACK-1', barcode='TOTE-PACK-1', lpn_type='TOTE',
            current_site=cls.site, status='EMPTY', created_by='test')

        cls.sku = Sku.objects.create(
            sku_code='PACK-SKU-1', name='Pack Test Cereal', sub_category='Grocery',
            brand='Zippzo', pack_size='1', hsn_code='1904', weight_g=500)
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.site, batch_number='LOT-PACK-1',
            inbound_type='PURCHASE', inbound_ref='PO-PACK-1')
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin.location_id,
            sku=cls.sku, lot=cls.lot, qty=10)

        cls.customer = Customer.objects.create(user=cls.packer, name='Pack Customer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Pack Road',
            pincode='560001', city='Bengaluru')
        cls.order = CustomerOrder.objects.create(
            order_no='ORD-PACK-1', customer=cls.customer, site=cls.site,
            address=cls.address, status='PICKING', payment_method='PREPAID',
            payment_status='CAPTURED', subtotal=Decimal('80.00'),
            grand_total=Decimal('80.00'), placed_at=timezone.now())
        cls.line = CustomerOrderLine.objects.create(
            order=cls.order, line_no=1, sku=cls.sku, lot=cls.lot, qty=2,
            unit_price=Decimal('40.00'), line_total=Decimal('80.00'))

        allocate_order(cls.order)

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.packer)

    def scan_all(self):
        """Pick the line for real, one unit per scan, through the ledger."""
        for _ in range(self.line.qty):
            response = self.api.post(PICK_LINE, {
                'order_id': str(self.order.order_id),
                'line_id': str(self.line.line_id),
                'bin_location_id': self.bin.location_id,
                'qty': 1,
                'scan_id': str(uuid.uuid4()),
            }, format='json')
            self.assertEqual(200, response.status_code, response.data)

    def pick_all(self, qty=None):
        """Get the order to PICKED. `qty` fakes a short pick, no ledger."""
        if qty is not None:
            CustomerOrderLine.objects.filter(pk=self.line.pk).update(picked_qty=qty)
            CustomerOrder.objects.filter(pk=self.order.pk).update(status='PICKED')
        else:
            self.scan_all()
        return self.api.post(ORDER_ACTION, {
            'order_id': str(self.order.order_id), 'action': 'COMPLETE_PICK',
        }, format='json')

    def pack(self, **kwargs):
        payload = {'order_id': str(self.order.order_id),
                   'lpn_barcode': self.tote.barcode,
                   'staging_bin': 'STAGE-01'}
        payload.update(kwargs)
        return self.api.post(PACK, payload, format='json')

    def tote_qty(self):
        row = StockBalance.objects.filter(
            site=self.site, container='LPN', container_ref=self.tote.lpn_id,
            sku=self.sku, lot=self.lot).first()
        return row.qty if row else 0


class PackGuardTests(PackBase):

    def test_an_unpicked_order_cannot_be_packed(self):
        response = self.pack()

        self.assertEqual(409, response.status_code)
        self.assertIn('PICKING', response.data['error'])
        self.assertEqual(0, self.tote_qty())
        self.assertEqual(0, DeliveryTask.objects.count())

    def test_an_order_with_a_short_line_cannot_be_packed(self):
        self.pick_all(qty=1)

        response = self.pack()

        self.assertEqual(409, response.status_code)
        self.assertEqual(1, response.data['short_lines'][0]['outstanding'])
        self.assertEqual(0, self.tote_qty())

    def test_a_tote_is_required(self):
        self.pick_all()

        response = self.pack(lpn_barcode=None)

        self.assertEqual(400, response.status_code)
        self.assertIn('tote', response.data['error'].lower())

    def test_the_scanned_barcode_is_the_field_that_matters(self):
        """A tote barcode sent through `lpn_barcode` is what the operator
        actually scans.

        The id and the barcode look interchangeable and the packing screen once
        sent the id in this field, which fails as a 404 rather than doing the
        obvious thing. Both routes have to work, and the error has to name the
        field that was wrong.
        """
        self.pick_all()

        by_barcode = self.pack()
        self.assertEqual(200, by_barcode.status_code, by_barcode.data)
        self.assertEqual(self.tote.lpn_id, by_barcode.data['lpn']['lpn_id'])

    def test_an_lpn_id_sent_as_a_barcode_is_rejected_clearly(self):
        """Same value, wrong field: this must not quietly pick the wrong tote."""
        self.pick_all()

        response = self.pack(lpn_barcode=str(self.tote.lpn_id))

        self.assertEqual(404, response.status_code)
        self.assertIn('barcode', response.data['error'])
        self.assertEqual(0, self.tote_qty())

    def test_an_allocated_tote_can_be_named_by_id(self):
        """The other legitimate route, for a tote handed over rather than scanned."""
        self.pick_all()

        response = self.api.post(PACK, {
            'order_id': str(self.order.order_id),
            'lpn_id': str(self.tote.lpn_id),
            'staging_bin': 'STAGE-01',
        }, format='json')

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(self.tote.barcode, response.data['lpn']['barcode'])

    def test_a_staging_slot_is_required(self):
        """The rider has to be told where to collect from."""
        self.pick_all()

        response = self.pack(staging_bin=None)

        self.assertEqual(400, response.status_code)
        self.assertIn('staging_bin', response.data['error'])

    def test_an_unknown_tote_is_a_404(self):
        self.pick_all()

        self.assertEqual(404, self.pack(lpn_barcode='NOPE').status_code)

    def test_a_tote_holding_goods_at_another_store_is_refused(self):
        other = Site.objects.create(
            code='DS-PACK-OTHER', site_type='DARK_STORE', name='Other',
            address='o')
        busy = LpnMaster.objects.create(
            lpn_id='LPN-BUSY', barcode='TOTE-BUSY', lpn_type='TOTE',
            current_site=other, status='STAGED', created_by='test')
        self.pick_all()

        response = self.pack(lpn_barcode=busy.barcode)

        self.assertEqual(409, response.status_code)
        self.assertEqual(0, self.tote_qty())

    def test_a_tote_sealed_onto_another_order_here_is_refused(self):
        """The cross-site case above is not the only way to be busy.

        A tote this store sealed onto a *different* order, or one still out
        with a rider on one, sits at this store in a busy state - so the
        site-only guard waved it through and two orders ended up recorded in
        the same tote under two delivery tasks.
        """
        self.tote.status = 'STAGED'
        self.tote.current_ref_id = str(uuid.uuid4())
        self.tote.save(update_fields=['status', 'current_ref_id'])
        self.pick_all()

        response = self.pack(lpn_barcode=self.tote.barcode)

        self.assertEqual(409, response.status_code, response.data)
        self.assertEqual('STAGED', response.data['lpn_status'])
        self.assertEqual(0, self.tote_qty(),
                         'another order\'s goods went into a sealed tote')
        self.assertEqual(0, DeliveryTask.objects.count())

    def test_a_tote_out_with_a_rider_here_is_refused(self):
        """Same story, but the tote has already left the building."""
        self.tote.status = 'IN_TRANSIT'
        self.tote.current_ref_id = str(uuid.uuid4())
        self.tote.save(update_fields=['status', 'current_ref_id'])
        self.pick_all()

        response = self.pack(lpn_barcode=self.tote.barcode)

        self.assertEqual(409, response.status_code, response.data)
        self.assertEqual('IN_TRANSIT', response.data['lpn_status'])
        self.assertEqual(0, self.tote_qty())

    def test_an_operator_at_another_store_cannot_pack(self):
        self.pick_all()
        self.api.force_authenticate(self.stranger)

        response = self.pack()

        self.assertEqual(403, response.status_code)
        self.assertEqual(0, self.tote_qty())
        self.assertEqual(0, DeliveryTask.objects.count())

    def test_a_tote_being_ridden_for_this_order_blocks_a_repack(self):
        self.pick_all()
        self.pack()
        DeliveryTask.objects.update(status='EN_ROUTE')
        CustomerOrder.objects.filter(pk=self.order.pk).update(status='PICKED')

        response = self.pack()

        self.assertEqual(409, response.status_code)
        self.assertEqual('EN_ROUTE', response.data['delivery_task_status'])


class PackEffectTests(PackBase):

    def test_packing_moves_the_units_into_the_tote(self):
        self.pick_all()

        response = self.pack()

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(2, self.tote_qty())
        self.assertEqual(8, StockBalance.objects.get(
            container_ref=self.bin.location_id).qty)

    def test_the_custody_leg_is_recorded_as_a_hand_off_not_a_purchase(self):
        """SUPPLIER -> LPN would say the units were bought at the store.

        Every shrinkage number in the business is derived from these movements,
        so a packed tote booked as an inflow from a supplier silently inflates
        receipts and reads as the store losing stock it never had.
        """
        self.pick_all()

        self.pack()

        mv = StockMovement.objects.filter(
            sku=self.sku, lot=self.lot, movement_ref='PACK').latest('site_seq')
        self.assertEqual('CUSTODY', mv.from_container)
        self.assertEqual('LPN', mv.to_container)
        self.assertEqual(self.tote.lpn_id, mv.to_ref_id)

    def test_packed_goods_stop_counting_as_sellable_stock(self):
        self.pick_all()

        self.pack()

        tote = StockBalance.objects.get(
            container='LPN', container_ref=self.tote.lpn_id)
        self.assertFalse(tote.sellable,
                         'goods in a sealed tote are still being sold from')

    def test_the_tote_contents_are_recorded(self):
        self.pick_all()

        self.pack()

        content = LpnContent.objects.get(lpn=self.tote)
        self.assertEqual(self.sku, content.sku)
        self.assertEqual(self.lot, content.lot)
        self.assertEqual(2, content.qty)

    def test_the_tote_is_sealed_and_staged(self):
        self.pick_all()

        self.pack()

        self.tote.refresh_from_db()
        self.assertEqual('STAGED', self.tote.status)
        self.assertIsNotNone(self.tote.sealed_at)
        self.assertEqual('LPN', self.tote.current_container)
        self.assertEqual(str(self.order.order_id), self.tote.current_ref_id)

    def test_the_line_records_what_was_packed(self):
        self.pick_all()

        self.pack()

        self.line.refresh_from_db()
        self.assertEqual(2, self.line.packed_qty)

    def test_a_pack_task_records_the_tote_and_the_slot(self):
        self.pick_all()

        self.pack()

        task = PackTask.objects.get(order=self.order)
        self.assertEqual(self.tote.lpn_id, task.lpn)
        self.assertEqual('STAGE-01', task.staging_bin)
        self.assertEqual(2, task.packed_qty)
        self.assertEqual('COMPLETED', task.status)

    def test_the_delivery_task_names_the_slot_and_when_it_was_packed(self):
        self.pick_all()

        self.pack()

        task = DeliveryTask.objects.get(order=self.order)
        self.assertEqual('UNASSIGNED', task.status)
        self.assertEqual('STAGE-01', task.staging_bin)
        self.assertEqual(self.tote.lpn_id, task.bin)
        self.assertIsNotNone(task.packed_at)
        self.assertEqual(self.site, task.site)

    def test_the_order_reaches_packed_via_the_history(self):
        self.pick_all()

        self.pack()

        self.order.refresh_from_db()
        self.assertEqual('PACKED', self.order.status)
        # Meta.ordering is -created_at, so the newest transition is index 0.
        history = list(self.order.status_history.all())
        self.assertEqual(('PICKED', 'PACKED'),
                         (history[0].from_status, history[0].to_status))
        self.assertEqual(self.packer.user_id, history[0].actor_id)
        self.assertEqual(('PICKING', 'PICKED'),
                         (history[1].from_status, history[1].to_status))

    def test_both_events_are_written(self):
        self.pick_all()

        self.pack()

        types = set(OutboxEvent.objects.values_list('event_type', flat=True))
        self.assertEqual({'order.packed', 'delivery_task.created'}, types)

        packed = OutboxEvent.objects.get(event_type='order.packed')
        self.assertEqual(self.order.order_id, packed.aggregate_id)
        self.assertEqual('STAGE-01', packed.payload_json['staging_bin'])
        self.assertEqual(self.tote.barcode, packed.payload_json['lpn_barcode'])

    def test_the_rider_event_carries_the_slot_and_the_tote(self):
        self.pick_all()

        self.pack()

        event = OutboxEvent.objects.get(event_type='delivery_task.created')
        task = DeliveryTask.objects.get(order=self.order)
        self.assertEqual(task.task_id, event.aggregate_id)
        self.assertEqual('STAGE-01', event.payload_json['staging_bin'])

    def test_the_tote_weight_is_reported_for_rider_acceptance(self):
        self.pick_all()

        self.pack()

        # 2 units x 500 g. A rider accepting a job on a fabricated weight is worse
        # than a missing weight, so this has to come from the real SKU figure.
        self.assertEqual(Decimal('1.000'),
                         DeliveryTask.objects.get(order=self.order).order_weight_kg)


class PackRetryTests(PackBase):
    """A dropped response must not mean a second tote or a second rider."""

    def test_repacking_the_same_tote_does_not_double_the_stock(self):
        self.pick_all()
        self.pack()

        CustomerOrder.objects.filter(pk=self.order.pk).update(status='PICKED')
        response = self.pack()

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(2, self.tote_qty(),
                         'the retry credited the tote a second time')

    def test_repacking_reuses_the_delivery_task(self):
        self.pick_all()
        first = self.pack().data['delivery_task']['task_id']

        CustomerOrder.objects.filter(pk=self.order.pk).update(status='PICKED')
        second = self.pack().data['delivery_task']['task_id']

        self.assertEqual(first, second)
        self.assertEqual(1, DeliveryTask.objects.filter(order=self.order).count())

    def test_the_retry_reports_the_state_already_committed(self):
        self.pick_all()
        self.pack()

        CustomerOrder.objects.filter(pk=self.order.pk).update(status='PICKED')
        response = self.pack()

        self.order.refresh_from_db()
        self.assertEqual('PACKED', self.order.status)
        self.assertEqual('PICKED', response.data['previous_status'])
        self.assertEqual(2, response.data['tote_qty'])


class FullHandoffTests(PackBase):
    """Pick -> complete -> pack -> handoff, in that order."""

    def test_the_whole_pack_side_of_the_workflow(self):
        self.scan_all()

        completed = self.api.post(ORDER_ACTION, {
            'order_id': str(self.order.order_id), 'action': 'COMPLETE_PICK',
        }, format='json')
        self.assertEqual(200, completed.status_code, completed.data)
        self.assertEqual('PICKED', completed.data['status'])

        packed = self.pack()
        self.assertEqual(200, packed.status_code, packed.data)

        # Every unit left the shelf exactly once and is in the tote exactly once.
        self.assertEqual(8, StockBalance.objects.get(
            container_ref=self.bin.location_id).qty)
        self.assertEqual(2, self.tote_qty())
        rows = StockMovement.objects.filter(
            site=self.site, sku=self.sku, lot=self.lot
        ).values('movement_ref').annotate(
            n=Count('entry_id'), units=Sum('qty'))

        # Two unit scans come off the shelf. Packing is one bulk custody move per
        # line rather than per unit: the operator tips the tote, they do not scan
        # each item into it again.
        self.assertEqual(
            {'PICK': (2, 2), 'PACK': (1, 2)},
            {r['movement_ref']: (r['n'], r['units']) for r in rows})