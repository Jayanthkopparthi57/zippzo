"""Scan-first picking must be server-authoritative.

Every case here corresponds to a way the previous implementation could report a
pick that never happened, or lose stock that did leave the shelf.

Fixtures are built from scratch so the suite does not depend on seed data, which
is itself inconsistent (seeded orders carry `picked_qty` with no matching ledger
movement).
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku, SkuBarcode
from bounded.ds_ops.allocation import allocate_order
from bounded.ds_ops.models import OrderLineAllocation, PickTask
from bounded.inventory.models import StockBalance, StockMovement
from bounded.iam.models import User
from bounded.network.models import EmployeeSiteAssignment, Location, Site
from bounded.orders.models import (
    Customer, CustomerAddress, CustomerOrder, CustomerOrderLine,
)

PICK_LINES = '/api/ds-ops/pick-lines'
PICK_LINE = '/api/ds-ops/pick-line'
PICK_ABANDON = '/api/ds-ops/pick-abandon'
ORDER_ACTION = '/api/ds-ops/order-action'


class PickScanTestBase(TestCase):
    """One dark store, one bin, one SKU lot, one two-unit order line."""

    @classmethod
    def setUpTestData(cls):
        cls.picker = User.objects.create(
            email='pick-scan-picker@zippzo.in',
            password_hash=make_password('PickScanTest123!'),
            role='WAREHOUSE_STAFF',
            status='ACTIVE',
        )

        cls.site = Site.objects.create(
            code='DS-PICK-TEST', site_type='DARK_STORE', name='Pick Test DS',
            address='test',
        )
        # The picker has to be attached to the store. Every operational endpoint
        # resolves the caller's stores through this row, so without it every
        # case below would be answering 403 instead of testing picking.
        cls.assignment = EmployeeSiteAssignment.objects.create(
            employee='PICKSCAN01', user=cls.picker, site=cls.site,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True,
        )
        cls.bin = Location.objects.create(
            site=cls.site, location_id='BIN-TEST-0001', location_type='BIN',
            aisle='A1', rack='R2', level='L3', position='P4',
            barcode='BIN-TEST-0001', qr_payload='loc:test-bin-1',
            is_sellable_bin=True, created_by='test',
        )
        # A second bin so a "wrong bin" scan has somewhere real to point.
        cls.other_bin = Location.objects.create(
            site=cls.site, location_id='BIN-TEST-0002', location_type='BIN',
            aisle='A1', rack='R2', level='L3', position='P5',
            barcode='BIN-TEST-0002', qr_payload='loc:test-bin-2',
            is_sellable_bin=True, created_by='test',
        )

        cls.sku = Sku.objects.create(
            sku_code='PICK-SKU-1', name='Pick Test Cereal', sub_category='Grocery',
            brand='Zippzo', pack_size='1', hsn_code='1904', ean='5000000000001',
        )
        SkuBarcode.objects.create(
            barcode='PICK-EACH-1', symbology='INTERNAL', sku=cls.sku,
            pack_level='EACH', is_primary=True,
        )
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.site, batch_number='LOT-PICK-1',
            inbound_type='PURCHASE', inbound_ref='PO-PICK-1',
        )

        cls.customer = Customer.objects.create(user=cls.picker, name='Pick Test Customer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Test Road',
            pincode='560001', city='Bengaluru',
        )
        cls.order = CustomerOrder.objects.create(
            order_no='ORD-PICK-TEST-1', customer=cls.customer, site=cls.site,
            address=cls.address, status='PICKING', payment_method='PREPAID',
            payment_status='CAPTURED', subtotal=Decimal('100.00'),
            grand_total=Decimal('100.00'), placed_at=timezone.now(),
        )
        cls.line = CustomerOrderLine.objects.create(
            order=cls.order, line_no=1, sku=cls.sku, lot=cls.lot,
            qty=2, unit_price=Decimal('50.00'), line_total=Decimal('100.00'),
        )
        cls.balance = StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin.location_id,
            sku=cls.sku, lot=cls.lot, qty=10,
        )
        # The order is allocated up front. Bin validation is allocation-aware:
        # scanning a bin that holds the SKU is not enough, it has to be a bin
        # this order was told to draw from. Cases that care about the
        # unallocated path delete the allocations themselves.
        cls.allocation_result = allocate_order(cls.order)

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.picker)

    # -- helpers ---------------------------------------------------------
    def bin_qty(self):
        return StockBalance.objects.get(pk=self.balance.pk).qty

    def picked_qty(self):
        return CustomerOrderLine.objects.get(pk=self.line.pk).picked_qty

    def scan(self, qty=1, scan_id=None, bin_location_id=None, product_barcode=None):
        return self.api.post(PICK_LINE, {
            'order_id': str(self.order.order_id),
            'line_id': str(self.line.line_id),
            'bin_location_id': bin_location_id or self.bin.location_id,
            'product_barcode': product_barcode or self.sku.sku_code,
            'qty': qty,
            'scan_id': scan_id or str(uuid.uuid4()),
        }, format='json')

    def drop_out(self):
        return self.api.post(PICK_ABANDON, {'order_id': str(self.order.order_id)},
                             format='json')

    def set_bin_qty(self, qty):
        StockBalance.objects.filter(pk=self.balance.pk).update(qty=qty)


class PickLineOrderDetailsTests(PickScanTestBase):
    def test_pick_lines_include_order_price_image_and_fulfilment_quantities(self):
        self.sku.image_url = '/media/products/pick-test.webp'
        self.sku.save(update_fields=['image_url'])
        self.line.packed_qty = 1
        self.line.save(update_fields=['packed_qty'])

        response = self.api.get(PICK_LINES, {'order_id': str(self.order.order_id)})

        self.assertEqual(200, response.status_code, response.data)
        line = response.data['lines'][0]
        self.assertEqual('/media/products/pick-test.webp', line['image_url'])
        self.assertEqual('50.00', line['unit_price'])
        self.assertEqual('100.00', line['line_total'])
        self.assertEqual(1, line['packed_qty'])
        self.assertEqual(0, line['shipped_qty'])


class RepeatedScanTests(PickScanTestBase):
    """The ledger's idempotency key does not include quantity.

    apply_stock() keys a movement on
    (movement_type, ref_type, ref_id, sku, lot, site, direction, container,
    container_ref). Keying a pick on the order line alone therefore allows
    exactly one PICK per line per bin: the second one-unit scan of a two-unit
    line was swallowed as a replay and picked_qty stayed at 1 while the operator
    had physically taken two items off the shelf. One unit at a time is what a
    hand scanner does, so this was the normal path, not an edge case.
    """

    def test_two_one_unit_scans_both_count(self):
        first = self.scan(qty=1)
        second = self.scan(qty=1)

        self.assertEqual(200, first.status_code, first.data)
        self.assertEqual(200, second.status_code, second.data)
        self.assertFalse(second.data.get('already_applied'),
                         'the second scan was swallowed as an idempotent replay')
        self.assertEqual(2, self.picked_qty())
        self.assertEqual(8, self.bin_qty())

    def test_replaying_the_same_scan_id_does_not_double_pick(self):
        scan_id = str(uuid.uuid4())
        first = self.scan(qty=1, scan_id=scan_id)
        retry = self.scan(qty=1, scan_id=scan_id)

        self.assertEqual(200, first.status_code, first.data)
        self.assertEqual(200, retry.status_code, retry.data)
        self.assertTrue(retry.data.get('already_applied'))
        self.assertEqual(1, self.picked_qty())
        self.assertEqual(9, self.bin_qty())

    def test_replay_reports_committed_numbers_not_stale_ones(self):
        CustomerOrderLine.objects.filter(pk=self.line.pk).update(qty=3)
        scan_id = str(uuid.uuid4())
        self.scan(qty=1, scan_id=scan_id)
        # A second, different scan lands first and moves the line on.
        self.scan(qty=1, scan_id=str(uuid.uuid4()))

        retry = self.scan(qty=1, scan_id=scan_id)

        self.assertTrue(retry.data.get('already_applied'))
        # 2, not the pre-scan 1 that was in memory when the replay was detected.
        self.assertEqual(2, retry.data['picked_qty'])
        self.assertEqual(1, retry.data['outstanding'])


class BinVerificationTests(PickScanTestBase):

    def test_scanning_the_sku_ean_is_accepted(self):
        response = self.scan(product_barcode=self.sku.ean)

        self.assertEqual(200, response.status_code, response.data)

    def test_scanning_an_active_sku_barcode_is_accepted(self):
        response = self.scan(product_barcode='PICK-EACH-1')

        self.assertEqual(200, response.status_code, response.data)

    def test_scanning_a_different_product_is_refused(self):
        response = self.scan(product_barcode='OTHER-SKU')

        self.assertEqual(409, response.status_code)
        self.assertEqual(self.sku.sku_code, response.data['expected_sku_code'])
        self.assertEqual(0, self.picked_qty())
        self.assertEqual(10, self.bin_qty())

    def test_scanning_the_wrong_bin_is_refused(self):
        response = self.scan(bin_location_id=self.other_bin.location_id)

        self.assertEqual(409, response.status_code)
        self.assertEqual(self.bin.location_id,
                         response.data['expected_bin_location_id'])
        self.assertEqual(10, self.bin_qty(), 'a wrong-bin scan moved stock')
        self.assertEqual(0, self.picked_qty())

    def test_expected_bin_is_stable_while_a_lot_is_split_across_bins(self):
        """Ordering the pick face by quantity re-targets a half-drained line.

        With the lot split over two bins, resolving the pick location by
        `-qty` means the answer flips to whichever bin happens to hold more the
        moment the picker drains the current one. Units already in the picker's
        hand were then credited to a bin they never came from. Ordering by bin
        id keeps the picker on one shelf until it is empty.
        """
        StockBalance.objects.create(
            site=self.site, container='BIN',
            container_ref=self.other_bin.location_id,
            sku=self.sku, lot=self.lot, qty=6,
        )
        self.set_bin_qty(10)

        self.scan(qty=1)

        # 10 -> 9 here, still more than the 6 in the other bin.
        lines = self.api.get(PICK_LINES, {'order_id': str(self.order.order_id)})
        self.assertEqual(self.bin.location_id,
                         lines.data['lines'][0]['bin_location_id'])


class OverScanTests(PickScanTestBase):

    def test_cannot_pick_more_than_the_line_needs(self):
        response = self.scan(qty=99)

        self.assertEqual(409, response.status_code)
        self.assertEqual(0, self.picked_qty())
        self.assertEqual(10, self.bin_qty())

    def test_cannot_pick_a_line_that_is_already_full(self):
        CustomerOrderLine.objects.filter(pk=self.line.pk).update(picked_qty=2)

        response = self.scan(qty=1)

        self.assertEqual(409, response.status_code)
        self.assertEqual(10, self.bin_qty())

    def test_line_without_a_lot_cannot_be_picked(self):
        CustomerOrderLine.objects.filter(pk=self.line.pk).update(lot=None)

        response = self.scan(qty=1)

        self.assertEqual(409, response.status_code)
        self.assertEqual(10, self.bin_qty())


class DropOutTests(PickScanTestBase):
    """A drop-out must restock the bin the units actually came from.

    The reversal used to ask StockBalance which bin held the lot. Once the last
    unit of a lot leaves a bin the balance row reads zero, so that lookup
    answers "nowhere" at exactly the moment the answer matters and the stock is
    lost for good. The source bin has to come from the movements.
    """

    def test_drop_out_restocks_the_original_bin_even_when_it_reads_zero(self):
        self.scan(qty=1)
        self.set_bin_qty(0)

        response = self.drop_out()

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(1, response.data['units_returned'])
        self.assertEqual(1, self.bin_qty(), 'the unit was not put back')
        self.assertEqual(0, self.picked_qty())
        self.assertEqual([self.bin.location_id],
                         [r['bin_location_id'] for r in response.data['reverted']])

    def test_drop_out_restocks_every_bin_the_units_came_from(self):
        """A lot split over two bins must be credited back to both.

        The reversal reads the source bins out of the ledger rather than asking
        the balance, so it stays correct once a bin has emptied. Seeded with two
        direct movements because DSPickLineView only ever targets one pick face
        at a time.
        """
        from bounded.inventory.stock import apply_stock

        StockBalance.objects.create(
            site=self.site, container='BIN',
            container_ref=self.other_bin.location_id,
            sku=self.sku, lot=self.lot, qty=4,
        )
        for bin_location_id in (self.bin.location_id, self.other_bin.location_id):
            apply_stock(site=self.site, sku=self.sku, lot=self.lot, qty=1,
                        direction='OUT', movement_type='PICK',
                        ref_type=f'ORDERLINE:{uuid.uuid4()}', ref_id=self.line.line_id,
                        container='BIN', container_ref=bin_location_id)
        CustomerOrderLine.objects.filter(pk=self.line.pk).update(picked_qty=2)

        response = self.drop_out()

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(2, response.data['units_returned'])
        self.assertEqual(
            {self.bin.location_id, self.other_bin.location_id},
            {r['bin_location_id'] for r in response.data['reverted']})
        self.assertEqual(10, self.bin_qty())
        # 4 seeded, 1 picked off the shelf, 1 credited back by the reversal.
        self.assertEqual(4, StockBalance.objects.get(
            site=self.site, container='BIN',
            container_ref=self.other_bin.location_id,
            sku=self.sku, lot=self.lot).qty)

    def test_second_drop_out_does_not_restock_twice(self):
        self.scan(qty=1)

        first = self.drop_out()
        second = self.drop_out()

        self.assertEqual(200, first.status_code)
        self.assertEqual(200, second.status_code)
        self.assertEqual(1, first.data['units_returned'])
        self.assertEqual(0, second.data['units_returned'])
        self.assertEqual(10, self.bin_qty(), 'the units came back twice')

    def test_a_new_round_of_picks_can_be_dropped_out_again(self):
        self.scan(qty=1)
        self.drop_out()
        self.scan(qty=1)

        response = self.drop_out()

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(1, response.data['units_returned'],
                         'the second round was swallowed by the first reversal '
                         'idempotency token')
        self.assertEqual(10, self.bin_qty())
        self.assertEqual(0, self.picked_qty())

    def test_drop_out_writes_an_auditable_reversal_not_a_rollback(self):
        self.scan(qty=1)
        self.drop_out()

        movements = StockMovement.objects.filter(
            sku=self.sku, lot=self.lot, ref_id=str(self.line.line_id)
        ).order_by('site_seq')
        self.assertEqual(['PICK', 'PICK_ABANDON'],
                         [m.movement_ref for m in movements])
        reversal = movements[1]
        self.assertEqual('BIN', reversal.to_container)
        self.assertEqual(self.bin.location_id, reversal.to_ref_id)
        self.assertEqual(str(self.picker.user_id), reversal.actor_id)

    def test_an_unattributable_picked_qty_is_flagged_not_silently_zeroed(self):
        """Legacy orders can carry picked_qty with no matching movement.

        The drop-out must not reset the column to 0 in that case: nothing was
        returned to a bin, so claiming the line is un-picked would hide real
        shrinkage. It is reported as needing a recount instead.
        """
        CustomerOrderLine.objects.filter(pk=self.line.pk).update(picked_qty=2)

        response = self.drop_out()

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(2, self.picked_qty())
        self.assertEqual([str(self.line.line_id)],
                         [s['line_id'] for s in response.data['skipped']])
        self.assertIn('recount', response.data['message'])


RESOLVE_BIN = '/api/ds-ops/resolve-bin'


class ResolveBinTests(PickScanTestBase):
    """A physical bin scan has to become a Location.location_id.

    Stock is keyed by container_ref, which holds the location id and not the
    barcode printed on the shelf, so an unresolved scan means nothing to the
    ledger. The generic /network/locations search cannot fill the gap: that
    viewset is admin-only, so a picker cannot call it.
    """

    def test_resolves_by_barcode(self):
        response = self.api.get(RESOLVE_BIN, {
            'store_code': self.site.code, 'q': self.bin.barcode})

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(
            [{'location_id': self.bin.location_id, 'label': 'A1-R2-L3-P4',
              'location_type': 'BIN', 'container': 'PICK_FACE'}],
            response.data['matches'])

    def test_resolves_by_printed_coordinates(self):
        response = self.api.get(RESOLVE_BIN, {
            'store_code': self.site.code, 'q': 'a1-r2-l3-p5'})

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(self.other_bin.location_id,
                         response.data['matches'][0]['location_id'])

    def test_resolves_by_location_id(self):
        response = self.api.get(RESOLVE_BIN, {
            'store_code': self.site.code, 'q': self.bin.location_id})

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(self.bin.location_id,
                         response.data['matches'][0]['location_id'])

    def test_unknown_label_is_a_404_with_a_reason(self):
        response = self.api.get(RESOLVE_BIN, {
            'store_code': self.site.code, 'q': 'A9-R9-L9-P9'})

        self.assertEqual(404, response.status_code)
        self.assertIn('A9-R9-L9-P9', response.data['error'])

    def test_bins_from_another_store_are_not_offered(self):
        from bounded.network.models import Site

        other_site = Site.objects.create(
            code='DS-OTHER-STORE', site_type='DARK_STORE', name='Other',
            address='test')
        Location.objects.create(
            site=other_site, location_id='BIN-ELSEWHERE', location_type='BIN',
            barcode='BIN-ELSEWHERE', aisle='B1', rack='R1', level='L1',
            position='P1', created_by='test')

        response = self.api.get(RESOLVE_BIN, {
            'store_code': self.site.code, 'q': 'BIN-ELSEWHERE'})

        self.assertEqual(404, response.status_code,
                         'a picker can be sent to another store\'s bin')

    def test_requires_a_store_and_a_query(self):
        self.assertEqual(400, self.api.get(RESOLVE_BIN, {'q': 'x'}).status_code)
        self.assertEqual(400, self.api.get(
            RESOLVE_BIN, {'store_code': self.site.code}).status_code)

    def test_anonymous_callers_cannot_resolve_bins(self):
        from rest_framework.test import APIClient as _APIClient

        response = _APIClient().get(RESOLVE_BIN, {
            'store_code': self.site.code, 'q': self.bin.barcode})

        self.assertIn(response.status_code, (401, 403))


class OrderStateGateTests(PickScanTestBase):

    def test_picking_a_packed_order_is_refused(self):
        CustomerOrder.objects.filter(pk=self.order.pk).update(status='PACKED')

        self.assertEqual(409, self.scan(qty=1).status_code)
        self.assertEqual(409, self.drop_out().status_code)
        self.assertEqual(10, self.bin_qty())

    def test_picking_a_refunded_order_is_refused(self):
        CustomerOrder.objects.filter(pk=self.order.pk).update(status='REFUNDED')

        response = self.scan(qty=1)

        self.assertEqual(409, response.status_code)
        self.assertEqual(10, self.bin_qty())

    def test_pick_lines_reports_why_an_order_is_blocked(self):
        allowed = self.api.get(PICK_LINES, {'order_id': str(self.order.order_id)})
        self.assertTrue(allowed.data['pickable'])
        self.assertIsNone(allowed.data['blocked_reason'])

        CustomerOrder.objects.filter(pk=self.order.pk).update(status='DELIVERED')
        blocked = self.api.get(PICK_LINES, {'order_id': str(self.order.order_id)})

        self.assertFalse(blocked.data['pickable'])
        self.assertIn('DELIVERED', blocked.data['blocked_reason'])


class CompletePickGuardTests(PickScanTestBase):
    """COMPLETE_PICK must not be a matter of what the browser claims."""

    def test_complete_pick_is_refused_while_a_line_is_short(self):
        self.scan(qty=1)

        response = self.api.post(ORDER_ACTION, {
            'order_id': str(self.order.order_id), 'action': 'COMPLETE_PICK',
        }, format='json')

        self.assertEqual(409, response.status_code)
        self.order.refresh_from_db()
        self.assertEqual('PICKING', self.order.status,
                         'the order advanced to PACKED with stock still on the shelf')

    def test_complete_pick_names_the_short_lines(self):
        second = CustomerOrderLine.objects.create(
            order=self.order, line_no=2, sku=self.sku, lot=self.lot, qty=1,
            unit_price=Decimal('10.00'), line_total=Decimal('10.00'),
        )

        response = self.api.post(ORDER_ACTION, {
            'order_id': str(self.order.order_id), 'action': 'COMPLETE_PICK',
        }, format='json')

        short_ids = {str(s['line_id']) for s in response.data['short_lines']}
        self.assertEqual({str(self.line.line_id), str(second.line_id)}, short_ids)

    def test_complete_pick_succeeds_once_every_line_is_full(self):
        self.scan(qty=2)

        response = self.api.post(ORDER_ACTION, {
            'order_id': str(self.order.order_id), 'action': 'COMPLETE_PICK',
        }, format='json')

        self.assertEqual(200, response.status_code, response.data)
        self.order.refresh_from_db()
        # PICKED, not PACKED: completing the pick says the units are off the
        # shelf, not that they are in a tote. The pack station owns PACKED.
        self.assertEqual('PICKED', self.order.status)
        self.assertEqual(8, self.bin_qty())


class PickTaskTallyTests(PickScanTestBase):

    def _task(self, status='NOT_STARTED'):
        return PickTask.objects.create(
            picklist_id=uuid.uuid4(), batch=uuid.uuid4(), order=self.order,
            sku=self.sku.sku_id, lot=self.lot.lot_id,
            bin=self.bin.location_id, qty=2, status=status,
        )

    def test_scan_moves_the_task_tally(self):
        task = self._task()

        self.scan(qty=1)

        task.refresh_from_db()
        self.assertEqual(1, task.picked_qty)
        self.assertEqual('IN_PROGRESS', task.status)

    def test_filling_the_line_completes_the_task(self):
        task = self._task()

        self.scan(qty=2)

        task.refresh_from_db()
        self.assertEqual(2, task.picked_qty)
        self.assertEqual('COMPLETED', task.status)

    def test_a_scan_does_not_revive_a_cancelled_task(self):
        task = self._task(status='CANCELLED')

        self.scan(qty=1)

        task.refresh_from_db()
        self.assertEqual('CANCELLED', task.status)
        self.assertEqual(0, task.picked_qty)

    def test_drop_out_resets_an_open_task(self):
        task = self._task()
        self.scan(qty=1)

        self.drop_out()

        task.refresh_from_db()
        self.assertEqual(0, task.picked_qty)
        self.assertEqual('NOT_STARTED', task.status)


class AuditTrailTests(PickScanTestBase):

    def test_actor_comes_from_the_token_not_the_request_body(self):
        self.api.post(PICK_LINE, {
            'order_id': str(self.order.order_id),
            'line_id': str(self.line.line_id),
            'bin_location_id': self.bin.location_id,
            'qty': 1,
            'actor_id': '00000000-0000-0000-0000-000000000000',
            'scan_id': str(uuid.uuid4()),
        }, format='json')

        movement = StockMovement.objects.filter(
            sku=self.sku, lot=self.lot, movement_ref='PICK').latest('site_seq')

        self.assertEqual(str(self.picker.user_id), movement.actor_id)
