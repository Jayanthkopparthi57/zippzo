"""Who may work a store, and which bin an order is actually drawn from.

Two gaps these close:

  * `EmployeeSiteAssignment.employee` was a bare code matching no user, so no
    operational endpoint could tell whose store it was. Every pick, drop-out,
    bin resolve and order action accepted any logged-in caller against any
    store's order and any store's stock.

  * Nothing recorded which bin an order line was drawn from. The pick screen
    asked StockBalance for wherever the lot happened to sit, which moves under
    the picker as stock drains and left a lot split across bins unpickable.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.ds_ops.allocation import AllocationError, allocate_order
from bounded.ds_ops.models import OrderLineAllocation, PickTask
from bounded.inventory.models import StockBalance
from bounded.iam.models import User
from bounded.network.models import EmployeeSiteAssignment, Location, Site
from bounded.orders.models import (
    Customer, CustomerAddress, CustomerOrder, CustomerOrderLine,
)

ALLOCATE = '/api/ds-ops/allocate-order'
PICK_LINES = '/api/ds-ops/pick-lines'
PICK_LINE = '/api/ds-ops/pick-line'
PICK_ABANDON = '/api/ds-ops/pick-abandon'
RESOLVE_BIN = '/api/ds-ops/resolve-bin'
ORDER_ACTION = '/api/ds-ops/order-action'


class SiteFenceBase(TestCase):
    """Two stores, two pickers, one order at each."""

    @classmethod
    def setUpTestData(cls):
        cls.here = User.objects.create(
            email='fence-here@zippzo.in', password_hash=make_password('Fence123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE',
        )
        cls.there = User.objects.create(
            email='fence-there@zippzo.in', password_hash=make_password('Fence123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE',
        )
        cls.unassigned = User.objects.create(
            email='fence-nowhere@zippzo.in', password_hash=make_password('Fence123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE',
        )

        cls.site_a = Site.objects.create(
            code='DS-FENCE-A', site_type='DARK_STORE', name='Fence A',
            address='a')
        cls.site_b = Site.objects.create(
            code='DS-FENCE-B', site_type='DARK_STORE', name='Fence B',
            address='b')

        EmployeeSiteAssignment.objects.create(
            employee='FENCEHERE', user=cls.here, site=cls.site_a,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)
        EmployeeSiteAssignment.objects.create(
            employee='FENCETHERE', user=cls.there, site=cls.site_b,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)

        for site, tag in ((cls.site_a, 'A'), (cls.site_b, 'B')):
            setattr(cls, f'bin_{tag.lower()}', Location.objects.create(
                site=site, location_id=f'BIN-FENCE-{tag}-1', location_type='BIN',
                aisle='A1', rack='R1', level='L1', position=f'P{tag}',
                barcode=f'BIN-FENCE-{tag}-1', is_sellable_bin=True, created_by='test'))

        cls.sku = Sku.objects.create(
            sku_code='FENCE-SKU-1', name='Fence Cereal', sub_category='Grocery',
            brand='Zippzo', pack_size='1', hsn_code='1904')
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.site_a, batch_number='LOT-FENCE-1',
            inbound_type='PURCHASE', inbound_ref='PO-FENCE-1')
        StockBalance.objects.create(
            site=cls.site_a, container='BIN',
            container_ref=cls.bin_a.location_id, sku=cls.sku, lot=cls.lot, qty=20)

        cls.customer = Customer.objects.create(user=cls.here, name='Fence Customer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Fence Road',
            pincode='560001', city='Bengaluru')
        cls.order = CustomerOrder.objects.create(
            order_no='ORD-FENCE-1', customer=cls.customer, site=cls.site_a,
            address=cls.address, status='PICKING', payment_method='PREPAID',
            payment_status='CAPTURED', subtotal=Decimal('80.00'),
            grand_total=Decimal('80.00'), placed_at=timezone.now())
        cls.line = CustomerOrderLine.objects.create(
            order=cls.order, line_no=1, sku=cls.sku, lot=cls.lot, qty=4,
            unit_price=Decimal('20.00'), line_total=Decimal('80.00'))

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.here)

    def scan(self, qty=1, bin_location_id=None, scan_id=None):
        return self.api.post(PICK_LINE, {
            'order_id': str(self.order.order_id),
            'line_id': str(self.line.line_id),
            'bin_location_id': bin_location_id or self.bin_a.location_id,
            'qty': qty,
            'scan_id': scan_id or str(uuid.uuid4()),
        }, format='json')

    def bin_qty(self):
        return StockBalance.objects.get(
            container_ref=self.bin_a.location_id, sku=self.sku, lot=self.lot).qty


class SiteAccessFenceTests(SiteFenceBase):
    """A picker must not be able to reach into a store they are not assigned to."""

    def test_an_operator_with_no_assignment_is_refused_everywhere(self):
        self.api.force_authenticate(self.unassigned)

        for response in (
            self.api.get(PICK_LINES, {'order_id': str(self.order.order_id)}),
            self.scan(),
            self.api.post(PICK_ABANDON, {'order_id': str(self.order.order_id)},
                          format='json'),
            self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)},
                          format='json'),
            self.api.post(ORDER_ACTION, {'order_id': str(self.order.order_id),
                                         'action': 'COMPLETE_PICK'}, format='json'),
        ):
            self.assertEqual(403, response.status_code, response.data)

    def test_a_picker_at_another_store_is_refused(self):
        self.api.force_authenticate(self.there)

        response = self.scan()

        self.assertEqual(403, response.status_code)
        self.assertIn('DS-FENCE-A', response.data['detail'])
        self.assertEqual(20, self.bin_qty(), 'a refused scan still moved stock')

    def test_the_refusal_names_the_stores_the_operator_does_have(self):
        self.api.force_authenticate(self.there)

        detail = self.api.get(RESOLVE_BIN, {
            'store_code': self.site_a.code, 'q': self.bin_a.barcode}).data['detail']

        self.assertIn('DS-FENCE-B', detail)

    def test_an_inactive_assignment_does_not_grant_access(self):
        EmployeeSiteAssignment.objects.filter(user=self.here).update(is_active=False)

        self.assertEqual(403, self.scan().status_code)

    def test_resolving_a_bin_at_another_store_is_refused(self):
        self.api.force_authenticate(self.there)

        response = self.api.get(RESOLVE_BIN, {
            'store_code': self.site_a.code, 'q': self.bin_a.barcode})

        self.assertEqual(403, response.status_code)

    def test_an_assigned_picker_is_allowed_at_their_own_store(self):
        allocate_order(self.order)

        self.assertEqual(200, self.api.get(
            PICK_LINES, {'order_id': str(self.order.order_id)}).status_code)
        self.assertEqual(200, self.scan(qty=1).status_code)

    def test_anonymous_callers_are_refused(self):
        anon = APIClient()

        # The project authenticates by session cookie, so DRF answers 403 rather
        # than 401 for a missing identity.
        self.assertIn(anon.get(
            PICK_LINES, {'order_id': str(self.order.order_id)}).status_code,
            (401, 403))


class AllocationTests(SiteFenceBase):

    def test_allocation_fixes_the_route_and_creates_pick_tasks(self):
        response = self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)},
                                 format='json')

        self.assertEqual(200, response.status_code, response.data)
        alloc = OrderLineAllocation.objects.get(line=self.line)
        self.assertEqual(self.bin_a.location_id, alloc.location_id)
        self.assertEqual(4, alloc.qty)
        self.assertEqual('A1-R1-L1-PA', alloc.bin_label)

        task = PickTask.objects.get(order=self.order, bin=self.bin_a.location_id)
        self.assertEqual(4, task.qty)
        self.assertEqual('NOT_STARTED', task.status)

    def test_allocation_does_not_move_any_stock(self):
        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')

        self.assertEqual(20, self.bin_qty())

    def test_reallocating_is_idempotent(self):
        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')
        self.scan(qty=1)

        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')

        self.assertEqual(1, OrderLineAllocation.objects.get().picked_qty,
                         're-allocation threw away a pick already in progress')
        self.assertEqual(1, OrderLineAllocation.objects.count())

    def _split_bins(self, a_qty=2, c_qty=2):
        """Force a genuine 2-bin split on the 4-unit line.

        Allocation drains the largest bin first, so a split only happens when no
        single bin can cover the line. Two bins of two is the smallest split that
        exercises the ordering.
        """
        bin_c = Location.objects.create(
            site=self.site_a, location_id='BIN-FENCE-A-2', location_type='BIN',
            aisle='A2', rack='R1', level='L1', position='PA',
            barcode='BIN-FENCE-A-2', is_sellable_bin=True, created_by='test')
        StockBalance.objects.filter(
            container_ref=self.bin_a.location_id).update(qty=a_qty)
        StockBalance.objects.create(
            site=self.site_a, container='BIN', container_ref=bin_c.location_id,
            sku=self.sku, lot=self.lot, qty=c_qty)
        return bin_c

    def test_a_lot_split_across_bins_is_picked_in_allocation_order(self):
        """The reason allocation exists: two bins, one lot, both must be walkable."""
        bin_c = self._split_bins()

        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')

        allocs = list(OrderLineAllocation.objects.order_by('seq'))
        self.assertEqual(2, len(allocs))
        # Largest bin first, then the remainder, so the picker empties one shelf
        # before crossing to the next.
        self.assertEqual(self.bin_a.location_id, allocs[0].location_id)
        self.assertEqual(2, allocs[0].qty)
        self.assertEqual(bin_c.location_id, allocs[1].location_id)
        self.assertEqual(2, allocs[1].qty)

        # Both bins accept scans while they owe units.
        self.assertEqual(200, self.scan(qty=1).status_code)
        self.assertEqual(200, self.scan(
            qty=1, bin_location_id=bin_c.location_id).status_code)

        picked = {a.location_id: a.picked_qty for a in
                  OrderLineAllocation.objects.order_by('seq')}
        self.assertEqual({self.bin_a.location_id: 1, bin_c.location_id: 1}, picked)

    def test_an_exhausted_allocation_stops_accepting_scans(self):
        bin_c = self._split_bins()
        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')

        self.assertEqual(200, self.scan(
            qty=2, bin_location_id=self.bin_a.location_id).status_code)

        # A-1 is fully credited but the line still needs two, so this has to be
        # refused by the allocation check and point the picker at A-2.
        response = self.scan(qty=1, bin_location_id=self.bin_a.location_id)

        self.assertEqual(409, response.status_code)
        self.assertEqual(bin_c.location_id,
                         response.data['expected_bin_location_id'])
        self.assertEqual(2, CustomerOrderLine.objects.get(
            pk=self.line.pk).picked_qty)

    def test_a_bin_holding_the_sku_but_never_allocated_is_refused(self):
        bin_c = Location.objects.create(
            site=self.site_a, location_id='BIN-FENCE-A-2', location_type='BIN',
            barcode='BIN-FENCE-A-2', aisle='A2', rack='R1', level='L1',
            position='PA', is_sellable_bin=True, created_by='test')
        StockBalance.objects.create(
            site=self.site_a, container='BIN', container_ref=bin_c.location_id,
            sku=self.sku, lot=self.lot, qty=10)
        # Deliberately NOT allocated: this order was told to use bin A-1 only.
        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')

        response = self.scan(bin_location_id=bin_c.location_id)

        self.assertEqual(409, response.status_code)
        self.assertTrue(response.data['needs_allocation'])
        self.assertEqual(20, StockBalance.objects.get(
            container_ref=self.bin_a.location_id).qty)

    def test_pick_lines_lists_every_bin_holding_the_lot(self):
        bin_c = Location.objects.create(
            site=self.site_a, location_id='BIN-FENCE-A-2', location_type='BIN',
            barcode='BIN-FENCE-A-2', aisle='A2', rack='R1', level='L1',
            position='PA', is_sellable_bin=True, created_by='test')
        StockBalance.objects.create(
            site=self.site_a, container='BIN', container_ref=bin_c.location_id,
            sku=self.sku, lot=self.lot, qty=10)
        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')

        line = self.api.get(PICK_LINES, {
            'order_id': str(self.order.order_id)}).data['lines'][0]

        self.assertTrue(line['allocated'])
        self.assertEqual(
            {self.bin_a.location_id, bin_c.location_id},
            {b['location_id'] for b in line['bins']})

    def test_an_order_that_cannot_be_covered_is_refused_with_detail(self):
        StockBalance.objects.filter(
            container_ref=self.bin_a.location_id).update(qty=1)

        response = self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)},
                                 format='json')

        self.assertEqual(409, response.status_code)
        short = response.data['short_lines'][0]
        self.assertEqual(4, short['needed'])
        self.assertEqual(1, short['available'])
        self.assertEqual('FENCE-SKU-1', short['sku_code'])

    def test_a_short_allocation_commits_nothing(self):
        StockBalance.objects.filter(
            container_ref=self.bin_a.location_id).update(qty=1)

        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')

        # The line is short but the allocation is all-or-nothing: a half-built
        # route would send a picker to a shelf for some lines and strand them on
        # the rest, and the shortfall would only surface at the shelf.
        self.assertEqual(0, OrderLineAllocation.objects.count())
        self.assertEqual(0, PickTask.objects.count())

    def test_an_unallocatable_order_raises_instead_of_half_writing(self):
        StockBalance.objects.filter(
            container_ref=self.bin_a.location_id).update(qty=0)

        with self.assertRaises(AllocationError):
            allocate_order(self.order)

        self.assertEqual(0, OrderLineAllocation.objects.count())

    def test_drop_out_releases_the_allocation_for_picking_again(self):
        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')
        self.scan(qty=2)

        self.api.post(PICK_ABANDON, {'order_id': str(self.order.order_id)},
                      format='json')

        alloc = OrderLineAllocation.objects.get()
        self.assertEqual(0, alloc.picked_qty)
        self.assertEqual('ALLOCATED', alloc.status)
        self.assertEqual(20, self.bin_qty())
        self.assertEqual(200, self.scan(qty=1).status_code)

    def test_drop_out_resets_the_allocated_pick_task(self):
        self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)}, format='json')
        self.scan(qty=1)

        self.api.post(PICK_ABANDON, {'order_id': str(self.order.order_id)},
                      format='json')

        task = PickTask.objects.get(order=self.order)
        self.assertEqual(0, task.picked_qty)
        self.assertEqual('NOT_STARTED', task.status)

    def test_allocation_is_refused_for_a_blocked_order(self):
        CustomerOrder.objects.filter(pk=self.order.pk).update(status='PACKED')

        response = self.api.post(ALLOCATE, {'order_id': str(self.order.order_id)},
                                 format='json')

        self.assertEqual(409, response.status_code)
        self.assertEqual(0, OrderLineAllocation.objects.count())

    def test_allocation_requires_an_order_id(self):
        self.assertEqual(400, self.api.post(ALLOCATE, {}, format='json').status_code)

    def test_allocation_of_an_unknown_order_is_a_404(self):
        self.assertEqual(404, self.api.post(
            ALLOCATE, {'order_id': str(uuid.uuid4())}, format='json').status_code)