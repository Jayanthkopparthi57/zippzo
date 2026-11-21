"""The ledger has to be able to contradict itself, or it is not a check.

`verify_ledger` reconciles three things against each other: what the balances
say, what the order-line counters say, and whether the hash chain still holds.
It was written after the workflow work, and while building it three separate
assumptions turned out to be wrong in ways that each produced a clean-looking
"358 problems found" against a database whose stock was fine:

  * filtering `movement_type` instead of `movement_ref`, which `apply_stock`
    never populates, so every order looked unbacked;
  * expecting a balance row for `CUSTODY` and `SUPPLIER`, which hold no stock;
  * comparing balance rows one at a time when `StockBalance` has no unique
    constraint on its key.

So these tests do two jobs. They pin the behaviour that matters - the check
catches a real mismatch and the repair refuses an unsafe one - and they pin the
specific traps, because a reconciliation tool that cries wolf on clean data gets
switched off, and then it is worse than not having one.
"""
import io
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management import CommandError, call_command
from django.db import models
from django.test import TestCase
from django.utils import timezone

from bounded.audit.models import AuditLog
from bounded.catalog.models import InventoryLot, Sku
from bounded.inventory.ledger import (
    BALANCE_CONTAINERS, expected_balances, line_movement_totals,
)
from bounded.inventory.models import StockBalance, StockMovement
from bounded.iam.models import User
from bounded.network.models import Location, Site
from bounded.orders.models import (
    Customer, CustomerAddress, CustomerOrder, CustomerOrderLine,
)
from bounded.inventory.stock import apply_stock


class LedgerBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.operator = User.objects.create(
            email='ledger-operator@zippzo.in',
            password_hash=make_password('Ledger123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        cls.site = Site.objects.create(
            code='DS-LEDGER-TEST', site_type='DARK_STORE', name='Ledger Test DS',
            address='test')
        cls.bin = Location.objects.create(
            site=cls.site, location_id='BIN-LEDGER-0001', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='BIN-LEDGER-0001', is_sellable_bin=True, created_by='test')
        cls.sku = Sku.objects.create(
            sku_code='LEDGER-SKU-1', name='Ledger Test Cereal',
            sub_category='Grocery', brand='Zippzo', pack_size='1',
            hsn_code='1904', weight_g=500)
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.site, batch_number='LOT-LEDGER-1',
            inbound_type='PURCHASE', inbound_ref='PO-LEDGER-1')

        cls.customer = Customer.objects.create(
            user=cls.operator, name='Ledger Customer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Ledger Road',
            pincode='560001', city='Bengaluru')

    def make_order(self, order_no, status='CONFIRMED', qty=2):
        order = CustomerOrder.objects.create(
            order_no=order_no, customer=self.customer, site=self.site,
            address=self.address, status=status, payment_method='PREPAID',
            payment_status='CAPTURED', subtotal=Decimal('80.00'),
            grand_total=Decimal('80.00'), placed_at=timezone.now())
        line = CustomerOrderLine.objects.create(
            order=order, line_no=1, sku=self.sku, lot=self.lot, qty=qty,
            unit_price=Decimal('40.00'), line_total=Decimal('80.00'))
        return order, line

    def receive(self, qty=10):
        apply_stock(
            site=self.site, sku=self.sku, lot=self.lot, qty=qty,
            movement_type='RECEIPT', ref_type='LPN', ref_id=f'LPN-{uuid.uuid4()}',
            actor_id=str(self.operator.user_id), actor_type='SYSTEM',
            container='BIN', container_ref=self.bin.location_id,
            supply_from='SUPPLIER',
        )

    def run_verify(self, *args):
        out = io.StringIO()
        try:
            call_command('verify_ledger', *args, stdout=out, stderr=out)
            return out.getvalue(), None
        except CommandError as exc:
            return out.getvalue(), exc

    def run_zero(self, *args):
        out = io.StringIO()
        try:
            call_command('zero_unsupported_picks', *args, stdout=out, stderr=out)
            return out.getvalue(), None
        except CommandError as exc:
            return out.getvalue(), exc

    def run_repair(self, *args):
        out = io.StringIO()
        try:
            call_command('repair_ledger_chain', *args, stdout=out, stderr=out)
            return out.getvalue(), None
        except CommandError as exc:
            return out.getvalue(), exc


class LedgerCheckTests(LedgerBase):
    """verify_ledger has to be right about clean data before it can be trusted."""

    def test_a_correct_ledger_passes(self):
        self.receive(10)
        output, error = self.run_verify()

        self.assertIsNone(error, output)
        self.assertIn('all balanced', output)
        self.assertIn('all agree', output)
        self.assertIn('Ledger is consistent', output)

    def test_it_catches_stock_that_never_moved(self):
        """A balance with no movement behind it is the corruption that started this."""
        self.receive(10)
        StockBalance.objects.filter(site=self.site).update(qty=999)

        output, error = self.run_verify()

        self.assertIsNotNone(error, output)
        self.assertIn('ledger problem', str(error))
        self.assertIn('balance says 999', output)

    def test_it_catches_an_order_claiming_units_it_never_picked(self):
        self.receive(10)
        order, line = self.make_order('ORD-LEDGER-COUNT')
        CustomerOrderLine.objects.filter(pk=line.pk).update(picked_qty=2)

        output, error = self.run_verify()

        self.assertIsNotNone(error, output)
        self.assertIn('picked_qty=2, PICK movements=0', output)

    def test_a_real_pick_is_not_reported_as_unsupported(self):
        """The counter check must agree with a pick that genuinely happened."""
        self.receive(10)
        order, line = self.make_order('ORD-LEDGER-REAL')
        apply_stock(
            site=self.site, sku=self.sku, lot=self.lot, qty=2,
            movement_type='PICK', ref_type='ORDERLINE',
            ref_id=str(line.line_id),
            actor_id=str(self.operator.user_id), actor_type='SYSTEM',
            container='BIN', container_ref=self.bin.location_id,
        )
        CustomerOrderLine.objects.filter(pk=line.pk).update(picked_qty=2)

        output, error = self.run_verify()
        self.assertIsNone(error, output)

    def test_custody_and_supplier_are_not_treated_as_stock(self):
        """CUSTODY is a per-ref transit hop; SUPPLIER is outside. Neither holds stock."""
        self.receive(10)
        output, error = self.run_verify()

        self.assertIsNone(error, output)
        # apply_stock emits a CUSTODY hop per movement and a SUPPLIER leg on
        # receipt, so both containers are present in the ledger. Neither should
        # ever produce a balance complaint.
        self.assertTrue(
            StockMovement.objects.filter(
                models.Q(from_container='CUSTODY')
                | models.Q(from_container='SUPPLIER')).exists())
        self.assertNotIn('which holds no stock', output)
        self.assertNotIn('CUSTODY', output.replace('SUPPLIER', ''))
        self.assertEqual({'SITE', 'BIN', 'LPN'}, set(BALANCE_CONTAINERS))

    def test_ownership_spellings_do_not_split_the_same_stock(self):
        """The two tables disagree on how to spell "unowned".

        `StockBalance.owner_id` is an empty string on every row this codebase
        writes, while the movement rows behind them store NULL. Keyed on raw
        values, one balance and its movements land in different buckets and the
        whole site reports as missing stock.
        """
        self.receive(10)
        balance = StockBalance.objects.get(site=self.site)
        self.assertEqual('', balance.owner_id)
        self.assertTrue(
            StockMovement.objects.filter(owner_id__isnull=True).exists())

        output, error = self.run_verify()

        self.assertIsNone(error, output)
        self.assertIn('all balanced', output)

    def test_stock_owned_by_someone_else_is_tracked_separately(self):
        """Owner is part of the unique constraint, so a consigned row is a real
        second balance - not a duplicate to be merged into ours."""
        self.receive(10)
        balance = StockBalance.objects.get(site=self.site)
        StockBalance.objects.create(
            site=balance.site, container=balance.container,
            container_ref=balance.container_ref, sku=balance.sku, lot=balance.lot,
            owner_type='SUPPLIER', owner_id='SUP-9', qty=4)

        output, error = self.run_verify()

        # Ours is untouched and correct; the consigned row has no movements
        # behind it, so it is reported rather than quietly assumed fine.
        self.assertIsNotNone(error, output)
        self.assertIn('owner SUPPLIER', output)

    def test_the_movement_type_column_is_never_read_as_the_type(self):
        """apply_stock writes movement_ref and leaves movement_type blank.

        Reading the wrong column makes every order look unbacked, which is how a
        clean database reports hundreds of false problems.
        """
        self.receive(10)
        self.assertEqual(
            StockMovement.objects.filter(movement_type='').count(),
            StockMovement.objects.count())
        self.assertEqual(
            StockMovement.objects.filter(movement_ref='RECEIPT').count(), 1)

        picked, shipped = line_movement_totals()
        self.assertEqual(0, sum(picked.values()))
        self.assertEqual(0, sum(shipped.values()))


class ZeroUnsupportedPicksTests(LedgerBase):
    """The repair has to be conservative. It is running against real orders."""

    def test_it_refuses_an_order_that_is_still_in_fulfilment(self):
        self.receive(10)
        order, line = self.make_order('ORD-LEDGER-LIVE', status='PICKED')
        CustomerOrderLine.objects.filter(pk=line.pk).update(picked_qty=2)

        output, error = self.run_zero()

        self.assertIsNone(error, output)
        self.assertIn('Nothing to correct', output)
        line.refresh_from_db()
        self.assertEqual(2, line.picked_qty,
                         'a live order was corrected without a human decision')

    def test_it_does_nothing_without_apply(self):
        self.receive(10)
        order, line = self.make_order('ORD-LEDGER-DRY', status='REFUNDED')
        CustomerOrderLine.objects.filter(pk=line.pk).update(picked_qty=2)

        output, error = self.run_zero()

        self.assertIsNone(error, output)
        self.assertIn('Dry run', output)
        line.refresh_from_db()
        self.assertEqual(2, line.picked_qty)
        self.assertEqual(0, AuditLog.objects.count())

    def test_it_zeroes_an_unsupported_counter_and_audits_it(self):
        self.receive(10)
        order, line = self.make_order('ORD-LEDGER-FIX', status='REFUNDED')
        CustomerOrderLine.objects.filter(pk=line.pk).update(
            picked_qty=2, shipped_qty=2, status='PICKED')

        movements_before = StockMovement.objects.count()
        output, error = self.run_zero('--apply')

        self.assertIsNone(error, output)
        line.refresh_from_db()
        self.assertEqual(0, line.picked_qty)
        self.assertEqual(0, line.shipped_qty)
        self.assertEqual('CANCELLED', line.status,
                         'a line with nothing picked must not still read as PICKED')

        # The point of the whole exercise: no stock is invented or moved.
        self.assertEqual(movements_before, StockMovement.objects.count())
        self.assertEqual(10, StockBalance.objects.get(site=self.site).qty)

        log = AuditLog.objects.get(action='ledger.zero_unsupported_pick')
        self.assertEqual(2, log.before_json['picked_qty'])
        self.assertEqual(0, log.after_json['picked_qty'])
        self.assertEqual('SYSTEM', log.actor_type)

    def test_after_correction_the_ledger_verifies(self):
        self.receive(10)
        order, line = self.make_order('ORD-LEDGER-CLEAN', status='REFUNDED')
        CustomerOrderLine.objects.filter(pk=line.pk).update(picked_qty=2)

        self.assertIsNotNone(self.run_verify()[1])

        self.run_zero('--apply')

        output, error = self.run_verify()
        self.assertIsNone(error, output)
        self.assertIn('Ledger is consistent', output)

    def test_a_partially_backed_line_is_left_for_a_human(self):
        """If the ledger disagrees but not by a clean zero, guessing is wrong."""
        self.receive(10)
        order, line = self.make_order('ORD-LEDGER-PART', status='REFUNDED')
        apply_stock(
            site=self.site, sku=self.sku, lot=self.lot, qty=1,
            movement_type='PICK', ref_type='ORDERLINE', ref_id=str(line.line_id),
            actor_id=str(self.operator.user_id), actor_type='SYSTEM',
            container='BIN', container_ref=self.bin.location_id,
        )
        CustomerOrderLine.objects.filter(pk=line.pk).update(picked_qty=2)

        output, error = self.run_zero('--apply')

        self.assertIsNone(error, output)
        self.assertIn('SKIPPED', output)
        line.refresh_from_db()
        self.assertEqual(2, line.picked_qty)

    def test_it_only_touches_the_named_order(self):
        self.receive(10)
        order_a, line_a = self.make_order('ORD-LEDGER-A', status='REFUNDED')
        order_b, line_b = self.make_order('ORD-LEDGER-B', status='REFUNDED')
        CustomerOrderLine.objects.filter(
            pk__in=[line_a.pk, line_b.pk]).update(picked_qty=2)

        self.run_zero('--apply', '--order', 'ORD-LEDGER-A')

        line_a.refresh_from_db()
        line_b.refresh_from_db()
        self.assertEqual(0, line_a.picked_qty)
        self.assertEqual(2, line_b.picked_qty)

class CustodyBalanceTests(LedgerBase):
    """A shipped bag leaves a zero CUSTODY row behind; that is not corruption."""

    def _custody_row(self, qty):
        return StockBalance.objects.create(
            site=self.site, container='CUSTODY',
            container_ref=str(uuid.uuid4()), container_ref_type='ORDERLINE',
            sku=self.sku, lot=self.lot, qty=qty, sellable=False,
            counts_toward_site_custody=False)

    def test_a_shipped_bag_that_now_holds_nothing_is_not_stock_from_nowhere(self):
        self.receive(10)
        self._custody_row(0)

        output, error = self.run_verify()

        self.assertIsNone(error, output)
        self.assertNotIn('which holds no stock', output)
        self.assertNotIn('on CUSTODY', output)
        self.assertIn('Ledger is consistent', output)

    def test_a_bag_that_still_holds_stock_is_reported(self):
        """Zero is bookkeeping; units left in a bag nobody shipped are real stock."""
        self.receive(10)
        self._custody_row(3)

        output, error = self.run_verify()

        self.assertIsNotNone(error, output)
        self.assertIn('which holds no stock', output)


class ChainRepairTests(LedgerBase):
    """A hole in the chain is reported, and only an explicit --apply closes it."""

    def _make_hole(self):
        for _ in range(3):
            self.receive(1)
        movements = list(
            StockMovement.objects.filter(site=self.site).order_by('site_seq'))
        self.assertEqual([1, 2, 3], [m.site_seq for m in movements])
        # Deleting history is exactly what a partial restore does.
        movements[1].delete()
        return movements

    def test_the_check_names_the_missing_sequence(self):
        self._make_hole()

        output, error = self.run_verify()

        self.assertIsNotNone(error, output)
        self.assertIn('site_seq 2 expected, found 3', output)

    def test_dry_run_changes_nothing(self):
        self._make_hole()
        before = list(
            StockMovement.objects.filter(site=self.site)
            .order_by('entry_id').values_list('entry_id', 'site_seq', 'row_hash'))

        output, error = self.run_repair()

        self.assertIsNone(error, output)
        self.assertIn('Dry run', output)
        after = list(
            StockMovement.objects.filter(site=self.site)
            .order_by('entry_id').values_list('entry_id', 'site_seq', 'row_hash'))
        self.assertEqual(before, after)
        self.assertFalse(
            AuditLog.objects.filter(action='LEDGER_CHAIN_REBUILT').exists())

    def test_apply_closes_the_hole_and_audits_the_rebuild(self):
        self._make_hole()
        # The missing row took its unit with it; the cached balance has to be
        # brought in line or the balance gate fails for a different reason.
        StockBalance.objects.filter(site=self.site).update(qty=2)

        output, error = self.run_repair('--apply')

        self.assertIsNone(error, output)
        self.assertIn('rebuilt', output)

        rows = list(StockMovement.objects.filter(site=self.site)
                    .order_by('site_seq'))
        self.assertEqual([1, 2], [m.site_seq for m in rows])
        prev = None
        for row in rows:
            self.assertEqual(prev, row.prev_hash)
            prev = row.row_hash

        audit = AuditLog.objects.get(action='LEDGER_CHAIN_REBUILT')
        self.assertEqual('SUCCESS', audit.result)
        self.assertEqual('SITE', audit.entity_type)
        # The pre-rebuild head and the break it hid are preserved in the audit.
        self.assertEqual(3, audit.before_json['head_seq'])
        self.assertEqual(1, len(audit.before_json['seq_breaks']))

        # And the gate that blocked the deploy now passes.
        output, error = self.run_verify()
        self.assertIsNone(error, output)
        self.assertIn('intact', output)

    def test_an_intact_chain_is_left_alone(self):
        self.receive(1)

        output, error = self.run_repair('--apply')

        self.assertIsNone(error, output)
        self.assertIn('All chains are intact', output)
        self.assertFalse(
            AuditLog.objects.filter(action='LEDGER_CHAIN_REBUILT').exists())

    def test_a_site_whose_movements_were_all_pruned_verifies_clean_again(self):
        """A head pointing at rows that no longer exist is a dangling head."""
        self.receive(1)
        StockMovement.objects.filter(site=self.site).delete()
        # The cached balance went with the history, or it would be stock
        # standing on no movements at all.
        StockBalance.objects.filter(site=self.site).delete()

        output, error = self.run_verify()
        self.assertIsNotNone(error, output)
        self.assertIn('chain head is', output)

        output, error = self.run_repair('--apply')
        self.assertIsNone(error, output)

        output, error = self.run_verify()
        self.assertIsNone(error, output)
        self.assertIn('intact', output)
