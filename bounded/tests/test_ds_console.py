"""The half of the dark-store console that nothing else exercised.

Nine screens make up the store console. Picking and packing are driven end to
end by the pick/pack suites; these cases cover the five that were only ever
*mounted* by the walkthrough, plus the return that the walkthrough does not
reach at all, plus the rider-handoff buttons the journey only ever pressed as
the rider - never as the operator whose screen they are.

Two of them were broken and stayed broken precisely because nothing called
them:

  * Shelf Inventory filtered `InventoryLot` by the dark store's own site, but a
    lot is raised at the warehouse that owns the product (WH-02A599 for
    DS-02A599). Every store therefore rendered "no stock" while the command
    centre beside it reported units from the same `StockBalance` rows.
  * Receive Totes and Shelf Putaway had no test at all, so the custody hand-off
    that makes a transferred tote pickable was unverified.
  * Returns were deadlocked: `/qc/` refused until `received_at_ds` was set and
    only `/restock/` set it, while `/restock/` refused until `qc_disposition`
    was RESTOCK and only `/qc/` set that. Every gate blocked the one behind it,
    so a store could see a return it had no way to act on. Receipt is a step of
    its own now, and the three are covered end to end.
  * Rider Handoff gated both of its buttons on owning a *rider* profile, so the
    operator whose screen it is could list every job and record none of them.
    The site assignment is what earns that right, and it is asserted here from
    both sides - the operator's, and a rider's.

The fixtures deliberately raise the lot at the warehouse, which is the shape
production actually has and the shape the older suites did not.
"""
import uuid

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone

from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.delivery.models import DeliveryTask, RiderProfile
from bounded.ds_ops.models import PickTask  # noqa: F401  (keeps the app loaded)
from bounded.inventory.models import LpnContent, LpnMaster, StockBalance, StockMovement
from bounded.iam.models import User
from bounded.network.models import EmployeeSiteAssignment, Location, Site
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder, CustomerOrderLine
from bounded.reverse.models import ReturnOrder

OVERVIEW = '/api/ds-ops/overview'
INCOMING = '/api/ds-ops/incoming-lpns'
INVENTORY = '/api/ds-ops/inventory'
RECEIVE = '/api/ds-ops/receive-lpn'
PUTAWAY = '/api/ds-ops/shelf-putaway'
RETURNS = '/api/reverse/returns/'


class ConsoleBase(TestCase):
    """A warehouse, a dark store that holds its stock, and an operator at it."""

    @classmethod
    def setUpTestData(cls):
        cls.operator = User.objects.create(
            email='console-op@zippzo.in', password_hash=make_password('Console123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        cls.customer_user = User.objects.create(
            email='console-cust@zippzo.in', password_hash=make_password('Console123!'),
            role='CUSTOMER', status='ACTIVE')

        cls.hub = Site.objects.create(
            code='WH-CONSOLE', site_type='HUB', name='Console Hub', address='test')
        cls.store = Site.objects.create(
            code='DS-CONSOLE', site_type='DARK_STORE', name='Console DS', address='test')
        cls.other = Site.objects.create(
            code='DS-OTHER', site_type='DARK_STORE', name='Other DS', address='test')

        for site in (cls.store, cls.other):
            EmployeeSiteAssignment.objects.create(
                employee=f'OP{site.code[-3:]}', user=cls.operator, site=site,
                mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)

        cls.bin = Location.objects.create(
            site=cls.store, location_id='BIN-CONSOLE-1', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='BIN-CONSOLE-1', is_sellable_bin=True, created_by='test')
        cls.foreign_bin = Location.objects.create(
            site=cls.other, location_id='BIN-FOREIGN-1', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='BIN-FOREIGN-1', is_sellable_bin=True, created_by='test')

        cls.sku = Sku.objects.create(
            sku_code='CONSOLE-SKU-1', name='Console Test Oats', sub_category='Grocery',
            brand='Zippzo', pack_size='1', hsn_code='1904', weight_g=500)
        # The production shape: the lot belongs to the warehouse, the dark store
        # holds the balance against it.
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.hub, batch_number='LOT-CONSOLE-1',
            inbound_type='PURCHASE', inbound_ref='PO-CONSOLE-1')
        StockBalance.objects.create(
            site=cls.store, container='BIN', container_ref=cls.bin.location_id,
            sku=cls.sku, lot=cls.lot, qty=12)

        # A tote on its way to the store, and one already sitting at the other.
        cls.inbound = LpnMaster.objects.create(
            lpn_id='LPN-CONSOLE-IN', barcode='TOTE-CONSOLE-IN', lpn_type='TOTE',
            current_site=cls.hub, source_site=cls.hub, dest_site=cls.store,
            status='IN_TRANSIT', created_by='test')
        LpnContent.objects.create(lpn=cls.inbound, sku=cls.sku, lot=cls.lot, qty=7)
        # Receipt must move real source custody into the destination tote. Seed
        # the source LPN balance explicitly instead of relying on manifest-only
        # inventory, which would create stock during receipt.
        StockBalance.objects.create(
            site=cls.hub, container='LPN', container_ref=str(cls.inbound.lpn_id),
            sku=cls.sku, lot=cls.lot, qty=7)
        cls.foreign = LpnMaster.objects.create(
            lpn_id='LPN-CONSOLE-FOREIGN', barcode='TOTE-CONSOLE-FOREIGN', lpn_type='TOTE',
            current_site=cls.hub, source_site=cls.hub, dest_site=cls.other,
            status='IN_TRANSIT', created_by='test')

        cls.customer = Customer.objects.create(user=cls.customer_user, name='Console Customer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Console Road',
            pincode='560001', city='Bengaluru')
        cls.order = CustomerOrder.objects.create(
            order_no='ORD-CONSOLE-1', customer=cls.customer, site=cls.store,
            address=cls.address, status='DELIVERED', payment_method='COD',
            payment_status='PAID', subtotal='40.00', grand_total='40.00',
            placed_at=timezone.now())
        cls.line = CustomerOrderLine.objects.create(
            order=cls.order, line_no=1, sku=cls.sku, lot=cls.lot, qty=2,
            picked_qty=2, shipped_qty=2, unit_price='20.00', line_total='40.00')

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.operator)
        self.shopper = APIClient()
        self.shopper.force_authenticate(self.customer_user)


class OverviewTests(ConsoleBase):

    def test_overview_is_scoped_to_the_store_it_is_asked_for(self):
        mine = self.api.get(OVERVIEW, {'store_code': self.store.code})
        theirs = self.api.get(OVERVIEW, {'store_code': self.other.code})
        self.assertEqual(200, mine.status_code, mine.data)
        self.assertEqual(200, theirs.status_code, theirs.data)
        self.assertEqual(self.store.code, mine.data['scope']['site'])
        self.assertEqual(self.other.code, theirs.data['scope']['site'])
        # `scope.site` is echoed out of the query string, so on its own it
        # proves the endpoint was *asked* for two stores and nothing about what
        # it counted. The shelf tile underneath has to follow the store too:
        # this fixture's store holds twelve units and the other holds none.
        self.assertEqual(12, mine.data['shelf_inventory']['total_units'])
        self.assertEqual(0, theirs.data['shelf_inventory']['total_units'] or 0,
                         'the overview counted this store behind the other one')

    def test_overview_rejects_a_store_that_does_not_exist(self):
        response = self.api.get(OVERVIEW, {'store_code': 'DS-NOWHERE'})
        self.assertEqual(404, response.status_code)

    def test_the_shelf_tile_counts_the_store_s_balance(self):
        response = self.api.get(OVERVIEW, {'store_code': self.store.code})
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(12, response.data['shelf_inventory']['total_units'])
        self.assertEqual(1, response.data['shelf_inventory']['total_skus'])

    def test_a_completed_pick_reports_its_duration_instead_of_500ing(self):
        """A pick with both timestamps used to take the whole tile down.

        `completed_at - started_at` is an interval. Averaging it through a
        FloatField annotation made Postgres return a timedelta that Django
        refused to cast, so the command centre 500'd the moment the store had
        completed its first pick. Nothing caught it because every other
        overview fixture had no finished pick.
        """
        completed = timezone.now()
        PickTask.objects.create(
            picklist_id=uuid.uuid4(), batch=uuid.uuid4(), order=self.order,
            sku=self.sku.sku_id, lot=self.lot.lot_id, bin=self.bin.location_id,
            qty=2, picked_qty=2, status='COMPLETED', started_at=completed,
            completed_at=completed + timezone.timedelta(seconds=90))

        response = self.api.get(OVERVIEW, {'store_code': self.store.code})
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(90.0, response.data['avg_pick_time_sec'])

    def test_an_unfinished_pick_does_not_claim_a_duration(self):
        PickTask.objects.create(
            picklist_id=uuid.uuid4(), batch=uuid.uuid4(), order=self.order,
            sku=self.sku.sku_id, lot=self.lot.lot_id, bin=self.bin.location_id,
            qty=2, status='IN_PROGRESS', started_at=timezone.now())

        response = self.api.get(OVERVIEW, {'store_code': self.store.code})
        self.assertEqual(200, response.status_code, response.data)
        self.assertIsNone(response.data['avg_pick_time_sec'])


class IncomingTotesTests(ConsoleBase):

    def test_only_totes_bound_for_this_store_are_listed(self):
        response = self.api.get(INCOMING, {'store_code': self.store.code})
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(['TOTE-CONSOLE-IN'], [r['barcode'] for r in response.data])

    def test_it_reports_the_units_the_tote_is_carrying(self):
        row = self.api.get(INCOMING, {'store_code': self.store.code}).data[0]
        self.assertEqual(1, row['item_count'])
        self.assertEqual(7, row['total_units'])
        self.assertEqual('IN_TRANSIT', row['status'])

    def test_an_unknown_store_is_404(self):
        response = self.api.get(INCOMING, {'store_code': 'DS-NOWHERE'})
        self.assertEqual(404, response.status_code)


class ShelfInventoryTests(ConsoleBase):
    """The regression the walkthrough could not have caught: a mounted screen
    showing "no stock" while the tile next to it reported twelve units."""

    def test_a_lot_owned_by_the_warehouse_is_listed_for_the_store_that_holds_it(self):
        response = self.api.get(INVENTORY, {'store_code': self.store.code})
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(1, len(response.data), response.data)
        row = response.data[0]
        self.assertEqual(self.sku.sku_code, row['sku_code'])
        self.assertEqual(12, row['stock_qty'])
        self.assertEqual(self.bin.location_id, row['shelf_bin'])
        self.assertNotEqual(self.store.code, self.lot.site.code,
                            'fixture must put the lot at the warehouse, as production does')

    def test_it_agrees_with_the_command_centre_tile(self):
        shelf = self.api.get(INVENTORY, {'store_code': self.store.code}).data
        tile = self.api.get(OVERVIEW, {'store_code': self.store.code}).data
        self.assertEqual(tile['shelf_inventory']['total_units'],
                         sum(r['stock_qty'] for r in shelf))
        self.assertEqual(tile['shelf_inventory']['total_skus'], len(shelf))

    def test_stock_at_one_store_is_not_reported_for_another(self):
        StockBalance.objects.create(
            site=self.other, container='BIN', container_ref=self.foreign_bin.location_id,
            sku=self.sku, lot=self.lot, qty=5)
        response = self.api.get(INVENTORY, {'store_code': self.other.code})
        self.assertEqual([5], [r['stock_qty'] for r in response.data])

    def test_with_no_store_selected_there_is_no_shelf_to_describe(self):
        response = self.api.get(INVENTORY)
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual([], response.data)


class ReceiveToteTests(ConsoleBase):

    def receive(self, **extra):
        payload = {'barcode': self.inbound.barcode, 'store_code': self.store.code,
                   'received_by': 'test'}
        payload.update(extra)
        return self.api.post(RECEIVE, payload, format='json')

    def test_receipt_moves_the_tote_and_its_stock_into_the_store(self):
        response = self.receive()
        self.assertEqual(200, response.status_code, response.data)
        self.assertTrue(response.data['success'])
        self.inbound.refresh_from_db()
        self.assertEqual('RECEIVED', self.inbound.status)
        self.assertEqual(self.store, self.inbound.current_site)
        self.assertEqual(self.store, self.inbound.dest_site)

        balance = StockBalance.objects.get(
            site=self.store, container='LPN', container_ref=str(self.inbound.lpn_id))
        self.assertEqual(7, balance.qty)
        self.assertTrue(StockMovement.objects.filter(
            movement_ref='LPN_RECEIPT', ref_id=self.inbound.lpn_id).exists())

    def test_receipt_ignores_a_tote_already_at_this_store(self):
        self.api.post(RECEIVE, {'barcode': self.inbound.barcode,
                                'store_code': self.store.code}, format='json')
        held = StockBalance.objects.filter(site=self.store, container='LPN')
        before = sum(held.values_list('qty', flat=True))
        response = self.receive()
        self.assertEqual(200, response.status_code, response.data)
        after = sum(held.values_list('qty', flat=True))
        self.assertEqual(before, after,
                         're-scanning a received tote must not credit the units twice')
        # The quantity, not the number of rows: crediting the same balance
        # row twice leaves one row either way.
        self.assertEqual(7, after)

    def test_receipt_needs_a_store(self):
        response = self.api.post(RECEIVE, {'barcode': self.inbound.barcode}, format='json')
        self.assertEqual(400, response.status_code)

    def test_receipt_rejects_an_unknown_tote(self):
        response = self.api.post(
            RECEIVE, {'barcode': 'TOTE-NOPE', 'store_code': self.store.code},
            format='json')
        self.assertEqual(404, response.status_code)


class ShelfPutawayTests(ConsoleBase):

    def setUp(self):
        super().setUp()
        response = self.api.post(
            RECEIVE, {'barcode': self.inbound.barcode, 'store_code': self.store.code},
            format='json')
        self.assertEqual(200, response.status_code, response.data)

    def putaway(self, **extra):
        payload = {
            'lpn': str(self.inbound.lpn_id),
            'placements': [{'sku': str(self.sku.sku_id), 'lot': str(self.lot.lot_id),
                            'bin': self.bin.location_id, 'qty': 7}],
        }
        payload.update(extra)
        return self.api.post(PUTAWAY, payload, format='json')

    def test_putaway_shelves_the_units_and_frees_the_tote(self):
        response = self.putaway()
        self.assertEqual(200, response.status_code, response.data)
        self.assertTrue(response.data['success'])
        self.assertEqual(7, response.data['shelved'][0]['qty'])
        self.assertTrue(response.data['lpn_emptied'])
        self.assertEqual('EMPTY', response.data['lpn_status'])

        bin_row = StockBalance.objects.get(
            site=self.store, container='BIN', container_ref=self.bin.location_id,
            lot=self.lot)
        self.assertEqual(19, bin_row.qty, '12 shelved before + 7 from the tote')
        self.assertFalse(StockBalance.objects.filter(
            site=self.store, container='LPN',
            container_ref=str(self.inbound.lpn_id), qty__gt=0).exists())
        self.assertTrue(StockMovement.objects.filter(movement_ref='SHELF_PUTAWAY').exists())

    def test_a_tote_that_has_not_been_received_cannot_be_shelved(self):
        self.inbound.status = 'IN_TRANSIT'
        self.inbound.save(update_fields=['status'])
        response = self.putaway()
        self.assertEqual(400, response.status_code)
        self.assertIn('must be RECEIVED', response.data['error'])

    def test_a_bin_from_another_store_is_refused(self):
        response = self.putaway(placements=[{
            'sku': str(self.sku.sku_id), 'lot': str(self.lot.lot_id),
            'bin': self.foreign_bin.location_id, 'qty': 7}])
        self.assertEqual(400, response.status_code)
        self.assertIn('does not belong', response.data['error'])

    def test_putaway_without_placements_is_refused(self):
        response = self.api.post(PUTAWAY, {'lpn': str(self.inbound.lpn_id)},
                                 format='json')
        self.assertEqual(400, response.status_code)

    def test_putaway_beyond_what_the_tote_holds_is_refused(self):
        response = self.putaway(placements=[{
            'sku': str(self.sku.sku_id), 'lot': str(self.lot.lot_id),
            'bin': self.bin.location_id, 'qty': 999}])
        self.assertEqual(400, response.status_code)


class ReturnLifecycleTests(ConsoleBase):
    """Goods come back to the store, get inspected, and go on sale again."""

    def open_return(self):
        response = self.shopper.post(
            RETURNS, {'order': str(self.order.order_id),
                      'reason': 'Ordered oats, received something else'},
            format='json')
        self.assertEqual(201, response.status_code, response.data)
        return response.data

    def test_a_return_can_be_opened_by_the_person_who_bought_it(self):
        row = self.open_return()
        self.assertEqual('RETURN_CREATED', row['status'])
        self.assertIsNone(row['qc_disposition'])
        self.assertIsNone(row['received_at_ds'])

    def test_the_store_sees_returns_against_its_own_orders(self):
        row = self.open_return()
        listed = self.api.get(RETURNS).data
        rows = listed.get('results', listed) if isinstance(listed, dict) else listed
        self.assertIn(row['return_id'], [r['return_id'] for r in rows])

    # The lifecycle runs in the order the goods actually move: the store
    # receives them, inspects them, then puts what passed back on the shelf.
    # Each step refuses to run before the one before it, and re-running one
    # changes nothing.
    def receive(self, row, **body):
        return self.api.post(f"{RETURNS}{row['return_id']}/receive/",
                             {'site_code': self.store.code, **body},
                             format='json')

    def inspect(self, row, disposition='RESTOCK'):
        return self.api.post(f"{RETURNS}{row['return_id']}/qc/",
                             {'qc_disposition': disposition}, format='json')

    def restock(self, row, **body):
        return self.api.post(
            f"{RETURNS}{row['return_id']}/restock/",
            {'site_code': self.store.code, 'bin': self.bin.location_id,
             'actor_id': 'test', **body}, format='json')

    def units(self):
        return sum(b.qty for b in StockBalance.objects.filter(
            site=self.store, lot=self.lot))

    def take_it_all_the_way(self):
        row = self.open_return()
        got = self.receive(row)
        self.assertEqual(200, got.status_code, got.data)
        verdict = self.inspect(row)
        self.assertEqual(200, verdict.status_code, verdict.data)
        return row

    def test_the_store_can_take_a_return_all_the_way_back_into_stock(self):
        row = self.take_it_all_the_way()
        before = self.units()

        restock = self.restock(row)
        self.assertEqual(200, restock.status_code, restock.data)
        self.assertTrue(restock.data['success'])
        self.assertEqual('CLOSED', restock.data['status'])
        self.assertEqual(before + 2, self.units(),
                         'shipped units must come back into the shelf')

        settled = ReturnOrder.objects.get(pk=row['return_id'])
        self.assertEqual('CLOSED', settled.status)
        self.assertEqual('RESTOCK', settled.qc_disposition)
        self.assertIsNotNone(settled.received_at_ds)

        # The units land as a typed RETURN movement, which is the column the
        # store's Stock Ledger screen labels and filters on.
        moves = StockMovement.objects.filter(
            movement_ref='RETURN', ref_id=str(row['return_id']), site=self.store)
        self.assertTrue(moves)
        self.assertEqual({'RETURN'}, {m.movement_ref for m in moves})

    def test_restocking_twice_does_not_double_the_units(self):
        row = self.take_it_all_the_way()
        first = self.restock(row)
        self.assertEqual(200, first.status_code, first.data)
        stock = self.units()

        # A second bin at the same store: `apply_stock` would key that as a
        # different movement, so the return's own state has to close the hole.
        elsewhere = Location.objects.create(
            site=self.store, location_id='BIN-CONSOLE-2', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P2',
            barcode='BIN-CONSOLE-2', is_sellable_bin=True, created_by='test')
        second = self.restock(row, bin=elsewhere.location_id)
        self.assertEqual(200, second.status_code, second.data)
        self.assertTrue(second.data['already_restocked'])
        self.assertEqual(stock, self.units(),
                         'restocking again must not add the units a second time')

    def test_the_goods_cannot_be_inspected_before_they_are_received(self):
        row = self.open_return()
        refused = self.inspect(row)
        self.assertEqual(409, refused.status_code, refused.data)
        self.assertIn('receive', refused.data['error'].lower())
        self.assertIsNone(
            ReturnOrder.objects.get(pk=row['return_id']).qc_disposition)

    def test_receiving_twice_changes_nothing(self):
        row = self.open_return()
        first = self.receive(row)
        self.assertEqual(200, first.status_code, first.data)
        at = first.data['received_at_ds']

        second = self.receive(row)
        self.assertEqual(200, second.status_code, second.data)
        self.assertTrue(second.data['already_received'])
        self.assertEqual(at, second.data['received_at_ds'])
        self.assertEqual(
            'RECEIVED_AT_DS',
            ReturnOrder.objects.get(pk=row['return_id']).status)

    def test_a_settled_return_cannot_be_received_again(self):
        row = self.take_it_all_the_way()
        self.assertEqual(200, self.restock(row).status_code)
        self.assertEqual('CLOSED',
                         ReturnOrder.objects.get(pk=row['return_id']).status)

        again = self.receive(row)
        self.assertEqual(200, again.status_code, again.data)
        self.assertTrue(again.data['already_received'])
        self.assertEqual(
            'CLOSED',
            ReturnOrder.objects.get(pk=row['return_id']).status,
            'a receipt must not reopen a return that is already back on sale')

    def test_a_different_store_cannot_touch_this_return(self):
        row = self.open_return()
        wrong = self.receive(row, site_code=self.other.code)
        self.assertEqual(400, wrong.status_code, wrong.data)
        self.assertIn(self.store.code, wrong.data['error'])

        wrong_restock = self.restock(row, site_code=self.other.code)
        self.assertEqual(400, wrong_restock.status_code, wrong_restock.data)
        self.assertIn(self.store.code, wrong_restock.data['error'])
        self.assertFalse(StockMovement.objects.filter(
            movement_ref='RETURN', ref_id=str(row['return_id'])).exists())

    def test_a_caller_with_no_site_assignment_is_refused(self):
        row = self.open_return()
        for step in ('receive', 'qc', 'restock'):
            refused = self.shopper.post(f"{RETURNS}{row['return_id']}/{step}/",
                                        {'site_code': self.store.code,
                                         'qc_disposition': 'RESTOCK',
                                         'bin': self.bin.location_id},
                                        format='json')
            self.assertEqual(403, refused.status_code, (step, refused.data))
        self.assertIsNone(
            ReturnOrder.objects.get(pk=row['return_id']).received_at_ds)

    def test_restock_refuses_a_disposition_that_is_not_restock(self):
        row = self.open_return()
        self.assertEqual(200, self.receive(row).status_code)
        verdict = self.inspect(row, 'SCRAP')
        self.assertEqual(200, verdict.status_code, verdict.data)

        refused = self.restock(row)
        self.assertEqual(400, refused.status_code, refused.data)
        self.assertIn('RESTOCK', refused.data['error'])
        self.assertFalse(StockMovement.objects.filter(
            movement_ref='RETURN', ref_id=str(row['return_id'])).exists())


class StockLedgerSourceTests(ConsoleBase):
    """The store's Stock Ledger screen, and the contract it reads.

    The screen labels, filters and searches every row by `movement_ref`, so
    that field has to carry the type. `movement_type` is the column
    `apply_stock` deliberately leaves blank (pinned by test_ledger_integrity);
    reading it gave the ledger an empty label, an empty type dropdown, and a
    type filter that could never match.
    """

    def movements(self):
        response = self.api.get(
            '/api/inventory/movements/',
            {'site': str(self.store.site_id), 'page_size': 100})
        self.assertEqual(200, response.status_code, response.data)
        payload = response.data
        return payload.get('results', payload) if isinstance(payload, dict) else payload

    def receive_tote(self):
        response = self.api.post(
            RECEIVE, {'barcode': self.inbound.barcode, 'store_code': self.store.code},
            format='json')
        self.assertEqual(200, response.status_code, response.data)

    def test_a_receipt_at_this_store_is_typed(self):
        self.receive_tote()
        rows = [r for r in self.movements() if r['ref_id'] == self.inbound.lpn_id]
        self.assertTrue(rows, 'the receipt must appear in the store ledger')
        self.assertEqual({'LPN_RECEIPT'}, {r['movement_ref'] for r in rows})

    def test_every_row_the_ledger_renders_carries_a_type(self):
        self.receive_tote()
        rows = self.movements()
        self.assertTrue(rows)
        self.assertTrue(all(r['movement_ref'] for r in rows),
                        'movement_ref is the column StockLedgerView renders')


class StoreHandoffTests(ConsoleBase):
    """The rider-handoff screen, as the store at the counter uses it.

    That screen is built from delivery tasks and its two buttons post to
    `/delivery/handoff/*`. Both were gated on owning a *rider* profile, so the
    operator the screen is written for could list every job and record none of
    them: "No rider profile for this account" on the counter's own button. The
    site assignment is what earns the right; the profile is what a rider brings
    on top of it.
    """

    PICKUP = '/api/delivery/handoff/pickup'
    POD = '/api/delivery/handoff/pod'

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()

        cls.staged = LpnMaster.objects.create(
            lpn_id='LPN-CONSOLE-OUT', barcode='TOTE-CONSOLE-OUT', lpn_type='TOTE',
            current_site=cls.store, status='STAGED', sealed_at=timezone.now(),
            created_by='test')
        LpnContent.objects.create(lpn=cls.staged, sku=cls.sku, lot=cls.lot, qty=2)
        # What the pickup ships out of the tote. The sellable shelf balance was
        # already drawn down at pick time, so this is a custody move.
        StockBalance.objects.create(
            site=cls.store, container='LPN', container_ref=cls.staged.lpn_id,
            sku=cls.sku, lot=cls.lot, qty=2, sellable=False)

        cls.outbound = CustomerOrder.objects.create(
            order_no='ORD-CONSOLE-OUT', customer=cls.customer, site=cls.store,
            address=cls.address, status='PACKED', payment_method='COD',
            payment_status='PENDING', subtotal='40.00', grand_total='40.00',
            placed_at=timezone.now())
        cls.out_line = CustomerOrderLine.objects.create(
            order=cls.outbound, line_no=1, sku=cls.sku, lot=cls.lot, qty=2,
            picked_qty=2, packed_qty=2, shipped_qty=0,
            unit_price='20.00', line_total='40.00')
        cls.task = DeliveryTask.objects.create(
            order=cls.outbound, site=cls.store, status='UNASSIGNED',
            bin=cls.staged.lpn_id, staging_bin='STAGE-01',
            packed_at=timezone.now())

        cls.rider_user = User.objects.create(
            email='console-rider@zippzo.in',
            password_hash=make_password('Console123!'),
            role='RIDER', status='ACTIVE')
        cls.rider = RiderProfile.objects.create(
            user=cls.rider_user, name='Console Rider', phone='9999999999',
            vehicle_type='BIKE', current_site=cls.store, is_online=True)

        cls.foreign_op = User.objects.create(
            email='console-foreign-op@zippzo.in',
            password_hash=make_password('Console123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        EmployeeSiteAssignment.objects.create(
            employee='OPFOR', user=cls.foreign_op, site=cls.other,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)

    def payload(self):
        return {'task_id': str(self.task.task_id),
                'lpn_barcode': self.staged.barcode}

    def test_the_store_records_that_the_rider_took_the_tote(self):
        response = self.api.post(self.PICKUP, self.payload(), format='json')

        self.assertEqual(200, response.status_code, response.data)
        self.task.refresh_from_db()
        self.assertEqual('PICKED_UP', self.task.status)
        self.staged.refresh_from_db()
        self.assertEqual('IN_TRANSIT', self.staged.status,
                         'the tote leaves the store with the rider')
        self.assertIsNone(self.staged.current_site_id)
        self.out_line.refresh_from_db()
        self.assertEqual(2, self.out_line.shipped_qty,
                         'the ledger has to know how many units left')
        self.assertTrue(StockMovement.objects.filter(
            site=self.store, movement_ref='SHIP',
            ref_id=str(self.out_line.line_id)).exists())

    def test_a_packed_order_with_no_rider_online_is_not_handed_over(self):
        """A bag may not leave the counter into nobody's hands.

        Packing assigns an online rider; a store with nobody online leaves the
        task UNASSIGNED. Handing that over shipped the stock and set the order
        PICKED_UP against no rider at all, so the job was invisible in every
        rider app and could never be delivered or closed.
        """
        self.rider.is_online = False
        self.rider.save(update_fields=['is_online'])

        response = self.api.post(self.PICKUP, self.payload(), format='json')

        self.assertEqual(409, response.status_code, response.data)
        self.assertTrue(response.data.get('rider_required'),
                        'the console needs a reason it can show the counter')
        self.task.refresh_from_db()
        self.assertEqual('UNASSIGNED', self.task.status)
        self.assertIsNone(self.task.pickup_at)
        self.assertIsNone(self.task.rider_id, 'nobody took this job')
        self.out_line.refresh_from_db()
        self.assertEqual(0, self.out_line.shipped_qty,
                         'nothing left the store')
        self.staged.refresh_from_db()
        self.assertEqual('STAGED', self.staged.status,
                         'the bag is still on the staging rack')

    def test_handover_assigns_the_rider_that_came_online(self):
        """The counter retries dispatch: a rider online now takes the bag."""
        self.assertIsNone(self.task.rider_id)
        response = self.api.post(self.PICKUP, self.payload(), format='json')

        self.assertEqual(200, response.status_code, response.data)
        self.task.refresh_from_db()
        self.assertEqual(self.rider.rider_id, self.task.rider_id)
        self.assertEqual('PICKED_UP', self.task.status)

    def test_the_store_can_ask_for_the_customer_pickup_code(self):
        picked = self.api.post(self.PICKUP, self.payload(), format='json')
        self.assertEqual(200, picked.status_code, picked.data)

        response = self.api.post(self.POD, {'task_id': str(self.task.task_id)},
                                 format='json')

        # The first call mints the code and refuses; the code itself never
        # comes back to the caller, whoever they are.
        self.assertEqual(409, response.status_code, response.data)
        self.assertTrue(response.data.get('otp_required'))
        self.assertNotIn('otp', response.data,
                         'the minted code went back to the rider')
        self.assertNotIn('code', response.data,
                         'the minted code went back to the rider')

    def test_an_operator_at_another_store_cannot_record_it(self):
        api = APIClient()
        api.force_authenticate(self.foreign_op)

        response = api.post(self.PICKUP, self.payload(), format='json')

        self.assertEqual(403, response.status_code, response.data)
        self.task.refresh_from_db()
        self.assertEqual('UNASSIGNED', self.task.status)

    def test_an_operator_with_no_assignment_at_all_cannot_record_it(self):
        nowhere = User.objects.create(
            email='console-drifter@zippzo.in',
            password_hash=make_password('Console123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        api = APIClient()
        api.force_authenticate(nowhere)

        response = api.post(self.PICKUP, self.payload(), format='json')

        self.assertEqual(403, response.status_code, response.data)
        self.assertIn('no active site assignment', str(response.data))
        self.task.refresh_from_db()
        self.assertEqual('UNASSIGNED', self.task.status)

    def test_the_rider_still_records_their_own_collection(self):
        """Opening the store's door must not close the rider's."""
        self.task.rider = self.rider
        self.task.save(update_fields=['rider'])
        api = APIClient()
        api.force_authenticate(self.rider_user)

        response = api.post(self.PICKUP, self.payload(), format='json')

        self.assertEqual(200, response.status_code, response.data)
        self.task.refresh_from_db()
        self.assertEqual('PICKED_UP', self.task.status)

    def test_a_rider_on_another_job_cannot_take_this_one(self):
        self.task.rider = self.rider
        self.task.save(update_fields=['rider'])
        other_user = User.objects.create(
            email='console-other-rider@zippzo.in',
            password_hash=make_password('Console123!'),
            role='RIDER', status='ACTIVE')
        other_profile = RiderProfile.objects.create(
            user=other_user, name='Other Console Rider', phone='8888888888',
            vehicle_type='SCOOTER')
        api = APIClient()
        api.force_authenticate(other_user)

        response = api.post(self.PICKUP, self.payload(), format='json')

        self.assertEqual(403, response.status_code, response.data)
        self.task.refresh_from_db()
        self.assertEqual('UNASSIGNED', self.task.status)
