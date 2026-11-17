"""Scan-first warehouse rules, end to end, at the API boundary.

These pin the behaviours the floor depends on and that a UI cannot enforce on
its own:

  * QC is what accepts stock. Only scanned PASS units become accepted; failed
    and uninspected units never reach a putaway task or a balance.
  * Putaway posts stock on every Proceed, not only when the task closes, and a
    bin's capacity is enforced at the moment of the write.
  * A bin-to-bin sort is all-or-nothing: a bad line leaves the source intact.
  * A scanned LPN label resolves to its manifest and destination dark store.
  * A typed batch reference is a labelled exception that records who and why.
"""
import json
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.iam.models import User
from bounded.inventory.models import LpnContent, LpnMaster, StockBalance
from bounded.inventory.stock import apply_stock
from bounded.network.models import Location, Site
from bounded.routing.models import DeliveryArea
from bounded.outbox.models import OutboxEvent
from bounded.supply.models import Asn, AsnLine, DockDiscrepancy, Grn, GrnLine, PutawayTask, QcInspection

API = '/api'


def _user(email='scan-ops@zippzo.in', role='SUPER_ADMIN'):
    return User.objects.create(
        email=email, password_hash=make_password('Test123!'),
        role=role, status='ACTIVE', full_name='Scan Ops')


def _site(code='DS-SCAN', site_type='DARK_STORE'):
    return Site.objects.create(code=code, site_type=site_type, name=code, address='test')


def _sku(code='SKU-SCAN-1', ean='9999999999991'):
    return Sku.objects.create(
        sku_code=code, name=f'Product {code}', ean=ean,
        mrp=Decimal('10.00'), weight_g=100, status='ACTIVE')


def _lot(sku, site, batch='BATCH-SCAN-1'):
    return InventoryLot.objects.create(
        sku=sku, site=site, batch_number=batch,
        inbound_type='PURCHASE', inbound_ref='PO-SCAN-1')


def _bin(site, location_id='BIN-SCAN-0001', capacity=None, barcode=None):
    return Location.objects.create(
        site=site, location_id=location_id, location_type='BIN',
        aisle='A1', rack='R1', level='L1', position='P1',
        barcode=barcode or location_id, capacity_qty=capacity,
        is_sellable_bin=True, created_by='test')


def _asn(site):
    return Asn.objects.create(
        asn_no=f'ASN-SCAN-{uuid.uuid4().hex[:6].upper()}',
        type='VENDOR_PO', dest_site=site)


def _grn(asn, status='IN_PROGRESS'):
    return Grn.objects.create(
        grn_no=f'GRN-SCAN-{uuid.uuid4().hex[:6].upper()}',
        asn=asn, mode='LPN_SCAN', status=status, batch_code='BATCH-SCAN-1')


class QcAcceptanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _user()
        self.client.force_authenticate(user=self.user)
        self.site = _site()
        self.sku = _sku()
        self.lot = _lot(self.sku, self.site)
        self.asn = _asn(self.site)
        self.grn = _grn(self.asn)
        self.line = GrnLine.objects.create(
            grn=self.grn, sku=self.sku, ordered_qty=5,
            received_qty=5, accepted_qty=0, lot=self.lot)

    def test_receiving_alone_accepts_nothing_and_releases_no_putaway(self):
        r = self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(PutawayTask.objects.filter(grn_line=self.line).count(), 0)
        inspection = QcInspection.objects.get(grn_line=self.line)
        self.assertEqual(inspection.status, 'PENDING')
        self.grn.refresh_from_db()
        self.assertEqual(self.grn.status, 'COMPLETED')

    def test_scanned_piece_receipt_records_shortage_and_requires_qc_before_acceptance(self):
        grn = _grn(self.asn)
        grn.mode = 'PIECE'
        grn.save(update_fields=['mode'])
        line = GrnLine.objects.create(
            grn=grn, sku=self.sku, ordered_qty=5,
            received_qty=0, accepted_qty=0, lot=None)

        response = self.client.post(f'{API}/supply/grns/{grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(QcInspection.objects.filter(grn_line=line).exists())
        self.assertTrue(DockDiscrepancy.objects.filter(
            grn_line=line, discrepancy_type='SHORT', shortage_qty=5,
        ).exists())

        self.grn.mode = 'PIECE'
        self.grn.save(update_fields=['mode'])
        response = self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        inspection = QcInspection.objects.get(grn_line=self.line)
        response = self.client.post(
            f'{API}/supply/qc-inspections/{inspection.qc_id}/verify/',
            {'pass_count': 2, 'fail_count': 0, 'require_full_inspection': True},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('inspect all 5', response.data['detail'])

    def test_scanned_receipt_is_atomic_and_creates_qc_and_variance_records(self):
        asn = _asn(self.site)
        asn.status = 'CONFIRMED'
        asn.save(update_fields=['status'])
        asn_line = AsnLine.objects.create(
            asn=asn, line_no=1, sku=self.sku, ean=self.sku.ean, ordered_qty=5,
        )

        response = self.client.post(
            f'{API}/supply/asns/{asn.asn_id}/receive-scanned/',
            {'lines': [{'asn_line': str(asn_line.line_id), 'received_qty': 3}]},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        grn = Grn.objects.get(grn_id=response.data['grn_id'])
        line = GrnLine.objects.get(grn=grn, asn_line=asn_line)
        self.assertEqual(grn.status, 'COMPLETED')
        self.assertEqual(line.accepted_qty, 0)
        self.assertEqual(line.lot.bucket, 'QC_HOLD')
        self.assertTrue(QcInspection.objects.filter(grn_line=line, status='PENDING').exists())
        self.assertTrue(DockDiscrepancy.objects.filter(
            grn_line=line, discrepancy_type='SHORT', shortage_qty=2,
        ).exists())
        self.assertFalse(PutawayTask.objects.filter(grn_line=line).exists())
        self.assertEqual(
            self.client.post(
                f'{API}/supply/asns/{asn.asn_id}/receive-scanned/',
                {'lines': [{'asn_line': str(asn_line.line_id), 'received_qty': 3}]},
                format='json',
            ).status_code,
            409,
        )

    def test_qc_pass_units_are_the_only_units_accepted(self):
        r = self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(r.status_code, 200)

        qc = QcInspection.objects.create(grn_line=self.line, sample_size=0, status='PENDING')
        r = self.client.post(
            f'{API}/supply/qc-inspections/{qc.qc_id}/verify/',
            {'pass_count': 3, 'fail_count': 2, 'status': 'PARTIAL'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)

        self.line.refresh_from_db()
        self.assertEqual(self.line.accepted_qty, 3)
        self.assertEqual(self.line.damaged_qty, 2)

        task = PutawayTask.objects.get(grn_line=self.line)
        self.assertEqual(task.qty, 3)
        self.assertEqual(task.placed_qty, 0)
        self.assertEqual(r.data['accepted_qty'], 3)
        self.assertEqual(r.data['damaged_qty'], 2)
        self.assertEqual(r.data['uninspected_qty'], 0)

    def test_uninspected_units_stay_out_of_putaway(self):
        self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')
        qc = QcInspection.objects.create(grn_line=self.line, sample_size=0, status='PENDING')
        r = self.client.post(
            f'{API}/supply/qc-inspections/{qc.qc_id}/verify/',
            {'pass_count': 2, 'fail_count': 0, 'status': 'PASSED'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)

        self.line.refresh_from_db()
        self.assertEqual(self.line.accepted_qty, 2)
        task = PutawayTask.objects.get(grn_line=self.line)
        self.assertEqual(task.qty, 2)
        self.assertEqual(r.data['uninspected_qty'], 3)

    def test_completing_grn_with_accepted_stock_creates_one_putaway_task(self):
        """1. Completing a GRN with accepted stock creates one putaway task."""
        self.line.accepted_qty = 5
        self.line.save(update_fields=['accepted_qty'])

        r = self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.data)

        tasks = PutawayTask.objects.filter(grn_line=self.line)
        self.assertEqual(tasks.count(), 1)
        task = tasks.first()
        self.assertEqual(task.qty, 5)
        self.assertEqual(task.placed_qty, 0)
        self.assertEqual(task.status, 'GENERATED')
        self.assertEqual(task.sku_id, self.sku.sku_id)
        self.assertEqual(task.lot_id, self.lot.lot_id)

    def test_repeating_grn_completion_is_idempotent_and_repairs_missing_task(self):
        """2. Repeating GRN completion does not create duplicates and repairs a missing task."""
        self.line.accepted_qty = 4
        self.line.save(update_fields=['accepted_qty'])

        # First completion
        r1 = self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(r1.status_code, 200, r1.data)
        self.assertEqual(PutawayTask.objects.filter(grn_line=self.line).count(), 1)

        # Repeating completion does not duplicate
        r2 = self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(r2.status_code, 200, r2.data)
        self.assertTrue(r2.data.get('already_completed'))
        self.assertEqual(PutawayTask.objects.filter(grn_line=self.line).count(), 1)

        # Delete the task to simulate incomplete / interrupted prior execution
        PutawayTask.objects.filter(grn_line=self.line).delete()
        self.assertEqual(PutawayTask.objects.filter(grn_line=self.line).count(), 0)

        # Re-running completion repairs the missing task
        r3 = self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(r3.status_code, 200, r3.data)
        tasks = PutawayTask.objects.filter(grn_line=self.line)
        self.assertEqual(tasks.count(), 1)
        self.assertEqual(tasks.first().qty, 4)

    def test_qc_acceptance_after_grn_completion_creates_or_updates_putaway_task(self):
        """3. QC acceptance after GRN completion creates or updates the putaway task to the accepted quantity."""
        # Complete GRN with 0 initial accepted stock (normal floor flow)
        r = self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(PutawayTask.objects.filter(grn_line=self.line).count(), 0)

        # Initial QC inspection accepts 3 units -> creates task with qty 3
        qc = QcInspection.objects.create(grn_line=self.line, sample_size=0, status='PENDING')
        r_qc1 = self.client.post(
            f'{API}/supply/qc-inspections/{qc.qc_id}/verify/',
            {'pass_count': 3, 'fail_count': 1, 'status': 'PARTIAL'}, format='json')
        self.assertEqual(r_qc1.status_code, 200, r_qc1.data)

        self.assertEqual(PutawayTask.objects.filter(grn_line=self.line).count(), 1)
        task = PutawayTask.objects.get(grn_line=self.line)
        self.assertEqual(task.qty, 3)

        # QC inspection updated/re-verified to accept 4 units -> updates task qty to 4
        r_qc2 = self.client.post(
            f'{API}/supply/qc-inspections/{qc.qc_id}/verify/',
            {'pass_count': 4, 'fail_count': 1, 'status': 'PARTIAL'}, format='json')
        self.assertEqual(r_qc2.status_code, 200, r_qc2.data)

        self.assertEqual(PutawayTask.objects.filter(grn_line=self.line).count(), 1)
        task.refresh_from_db()
        self.assertEqual(task.qty, 4)

    def test_re_qc_cannot_reduce_accepted_quantity_below_units_already_placed(self):
        """4. Re-QC cannot reduce accepted quantity below units already placed."""
        self.client.post(f'{API}/supply/grns/{self.grn.grn_id}/complete/', {}, format='json')

        qc = QcInspection.objects.create(grn_line=self.line, sample_size=0, status='PENDING')
        r_qc1 = self.client.post(
            f'{API}/supply/qc-inspections/{qc.qc_id}/verify/',
            {'pass_count': 4, 'fail_count': 0, 'status': 'PASSED'}, format='json')
        self.assertEqual(r_qc1.status_code, 200, r_qc1.data)

        task = PutawayTask.objects.get(grn_line=self.line)
        self.assertEqual(task.qty, 4)

        # Simulate 2 units physically placed into a bin
        bin_loc = _bin(self.site, 'BIN-SCAN-QC-1', capacity=10)
        r_place = self.client.post(
            f'{API}/supply/putaway-tasks/{task.task_id}/place/',
            {'destination_location_id': bin_loc.location_id, 'qty': 2}, format='json')
        self.assertEqual(r_place.status_code, 200, r_place.data)
        task.refresh_from_db()
        self.assertEqual(task.placed_qty, 2)

        # Attempting to re-QC reduce pass_count to 1 (below placed_qty of 2) must be rejected
        r_qc2 = self.client.post(
            f'{API}/supply/qc-inspections/{qc.qc_id}/verify/',
            {'pass_count': 1, 'fail_count': 3, 'status': 'PARTIAL'}, format='json')
        self.assertEqual(r_qc2.status_code, 400, r_qc2.data)
        self.assertIn('already placed', r_qc2.data['detail'])

        # Verify line and task remain intact at 4 and placed 2
        self.line.refresh_from_db()
        self.assertEqual(self.line.accepted_qty, 4)
        task.refresh_from_db()
        self.assertEqual(task.qty, 4)
        self.assertEqual(task.placed_qty, 2)



class PutawayPlacementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _user('put-ops@zippzo.in')
        self.client.force_authenticate(user=self.user)
        self.site = _site('DS-PUT')
        self.sku = _sku('SKU-PUT-1', '9999999999992')
        self.lot = _lot(self.sku, self.site, 'BATCH-PUT-1')
        self.bin = _bin(self.site, 'BIN-PUT-0001', capacity=3)
        self.bin2 = _bin(self.site, 'BIN-PUT-0002', capacity=5)
        self.asn = _asn(self.site)
        self.grn = _grn(self.asn, status='COMPLETED')
        self.line = GrnLine.objects.create(
            grn=self.grn, sku=self.sku, ordered_qty=4,
            received_qty=4, accepted_qty=4, lot=self.lot)
        self.task = PutawayTask.objects.create(
            grn_line=self.line, sku=self.sku, lot=self.lot, qty=4,
            from_container='QC_PASSED_STAGING', to_container='PUTAWAY_PENDING')

    def _balance(self, loc):
        return (StockBalance.objects
                .filter(container='BIN', container_ref=loc.location_id)
                .values_list('qty', flat=True).first() or 0)

    def test_each_proceed_posts_stock_immediately(self):
        r = self.client.post(
            f'{API}/supply/putaway-tasks/{self.task.task_id}/place/',
            {'destination_location_id': self.bin.location_id, 'qty': 2}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self._balance(self.bin), 2)
        self.task.refresh_from_db()
        self.assertEqual(self.task.placed_qty, 2)
        self.assertEqual(self.task.status, 'IN_PROGRESS')
        self.assertEqual(r.data['bin']['occupied_qty'], 2)
        self.assertEqual(r.data['bin']['free_qty'], 1)

    def test_capacity_is_enforced_at_the_write(self):
        self.client.post(
            f'{API}/supply/putaway-tasks/{self.task.task_id}/place/',
            {'destination_location_id': self.bin.location_id, 'qty': 2}, format='json')
        r = self.client.post(
            f'{API}/supply/putaway-tasks/{self.task.task_id}/place/',
            {'destination_location_id': self.bin.location_id, 'qty': 2}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self._balance(self.bin), 2)
        self.task.refresh_from_db()
        self.assertEqual(self.task.placed_qty, 2)

    def test_complete_refuses_a_partly_placed_task(self):
        self.client.post(
            f'{API}/supply/putaway-tasks/{self.task.task_id}/place/',
            {'destination_location_id': self.bin.location_id, 'qty': 1}, format='json')
        r = self.client.post(
            f'{API}/supply/putaway-tasks/{self.task.task_id}/complete/',
            {'destination_location_id': self.bin.location_id}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('still to place', r.data['detail'])
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, 'IN_PROGRESS')
        self.assertEqual(self._balance(self.bin), 1)

    def test_complete_confirms_after_every_unit_is_placed(self):
        for loc, qty in ((self.bin, 2), (self.bin2, 2)):
            r = self.client.post(
                f'{API}/supply/putaway-tasks/{self.task.task_id}/place/',
                {'destination_location_id': loc.location_id, 'qty': qty}, format='json')
            self.assertEqual(r.status_code, 200, r.data)
        r = self.client.post(
            f'{API}/supply/putaway-tasks/{self.task.task_id}/complete/',
            {'destination_location_id': self.bin2.location_id}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, 'CONFIRMED')
        self.assertEqual(self.task.placed_qty, 4)
        self.assertEqual(self._balance(self.bin), 2)
        self.assertEqual(self._balance(self.bin2), 2)

    def test_bin_list_shows_capacity_space_and_existing_products(self):
        self.client.post(
            f'{API}/supply/putaway-tasks/{self.task.task_id}/place/',
            {'destination_location_id': self.bin.location_id, 'qty': 2}, format='json')
        r = self.client.get(f'{API}/supply/putaway-bins/?site={self.site.site_id}')
        self.assertEqual(r.status_code, 200)
        row = next(x for x in r.data['results'] if x['location_id'] == self.bin.location_id)
        self.assertEqual(row['capacity_qty'], 3)
        self.assertEqual(row['occupied_qty'], 2)
        self.assertEqual(row['free_qty'], 1)
        self.assertEqual(row['product_count'], 1)
        self.assertEqual(row['contents'][0]['sku_code'], self.sku.sku_code)


class BinSortAtomicityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _user('sort-ops@zippzo.in')
        self.client.force_authenticate(user=self.user)
        self.site = _site('DS-SORT')
        self.sku_a = _sku('SKU-SORT-A', '9999999999993')
        self.sku_b = _sku('SKU-SORT-B', '9999999999994')
        self.lot_a = _lot(self.sku_a, self.site, 'BATCH-SORT-A')
        self.lot_b = _lot(self.sku_b, self.site, 'BATCH-SORT-B')
        self.src = _bin(self.site, 'BIN-SORT-SRC')
        self.dst = _bin(self.site, 'BIN-SORT-DST', capacity=10)
        apply_stock(
            site=self.site, sku=self.sku_a, lot=self.lot_a, qty=5, direction='IN',
            movement_type='PUTAWAY', ref_type='TEST', ref_id='sort-setup-a',
            container='BIN', container_ref=self.src.location_id)
        apply_stock(
            site=self.site, sku=self.sku_b, lot=self.lot_b, qty=2, direction='IN',
            movement_type='PUTAWAY', ref_type='TEST', ref_id='sort-setup-b',
            container='BIN', container_ref=self.src.location_id)

    def _qty(self, loc, sku):
        return (StockBalance.objects
                .filter(container='BIN', container_ref=loc.location_id, sku=sku)
                .values_list('qty', flat=True).first() or 0)

    def test_a_bad_line_moves_nothing(self):
        r = self.client.post(f'{API}/inventory/bin-sort', {
            'from_location_id': self.src.location_id,
            'to_location_id': self.dst.location_id,
            'items': [
                {'sku': str(self.sku_a.sku_id), 'lot': str(self.lot_a.lot_id), 'qty': 2},
                {'sku': str(self.sku_b.sku_id), 'lot': str(self.lot_b.lot_id), 'qty': 99},
            ],
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self._qty(self.src, self.sku_a), 5)
        self.assertEqual(self._qty(self.src, self.sku_b), 2)
        self.assertEqual(self._qty(self.dst, self.sku_a), 0)

    def test_valid_sort_moves_every_line_and_records_one_audit_row(self):
        r = self.client.post(f'{API}/inventory/bin-sort', {
            'from_location_id': self.src.location_id,
            'to_location_id': self.dst.location_id,
            'items': [
                {'sku': str(self.sku_a.sku_id), 'lot': str(self.lot_a.lot_id), 'qty': 2},
                {'sku': str(self.sku_b.sku_id), 'lot': str(self.lot_b.lot_id), 'qty': 1},
            ],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['total_qty'], 3)
        self.assertEqual(self._qty(self.src, self.sku_a), 3)
        self.assertEqual(self._qty(self.src, self.sku_b), 1)
        self.assertEqual(self._qty(self.dst, self.sku_a), 2)
        self.assertEqual(self._qty(self.dst, self.sku_b), 1)

        from bounded.ds_ops.models import BinTransfer
        self.assertEqual(BinTransfer.objects.filter(status='COMPLETED').count(), 1)

    def test_target_capacity_refuses_the_whole_sort(self):
        small = _bin(self.site, 'BIN-SORT-SMALL', capacity=1)
        r = self.client.post(f'{API}/inventory/bin-sort', {
            'from_location_id': self.src.location_id,
            'to_location_id': small.location_id,
            'items': [{'sku': str(self.sku_a.sku_id), 'lot': str(self.lot_a.lot_id), 'qty': 2}],
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self._qty(self.src, self.sku_a), 5)
        self.assertEqual(self._qty(small, self.sku_a), 0)


class LpnManifestResolveTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _user('lpn-ops@zippzo.in')
        self.client.force_authenticate(user=self.user)
        self.mh = _site('MH-LPN', site_type='MH')
        self.ds = _site('DS-LPN', site_type='DS')
        self.sku = _sku('SKU-LPN-1', '9999999999995')
        self.lot = _lot(self.sku, self.mh, 'BATCH-LPN-1')
        self.lpn = LpnMaster.objects.create(
            lpn_id='TOTE-LPN-1', barcode='LPN-LABEL-1', lpn_type='TOTE',
            current_site=self.mh, source_site=self.mh, dest_site=self.ds,
            status='PACKED',
            manifest={
                'destination': {'site_id': str(self.ds.site_id), 'code': 'DS-LPN', 'name': 'DS-LPN'},
                'items': [{'sku_code': 'SKU-LPN-1', 'sku_name': 'Product SKU-LPN-1',
                           'qty': 2, 'location': 'BIN-MH-01'}],
                'total_qty': 2,
            })
        LpnContent.objects.create(lpn=self.lpn, sku=self.sku, lot=self.lot, qty=2)

    def test_scanning_the_label_resolves_contents_and_destination(self):
        r = self.client.get(f'{API}/inventory/lpns/resolve/?code=LPN-LABEL-1')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['lpn_id'], 'TOTE-LPN-1')
        self.assertEqual(r.data['destination']['code'], 'DS-LPN')
        self.assertEqual(r.data['manifest']['items'][0]['location'], 'BIN-MH-01')
        self.assertEqual(r.data['total_qty'], 2)
        self.assertEqual(r.data['contents'][0]['sku_code'], 'SKU-LPN-1')

    def test_the_lpn_id_also_resolves(self):
        r = self.client.get(f'{API}/inventory/lpns/resolve/?code=TOTE-LPN-1')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['barcode'], 'LPN-LABEL-1')

    def test_an_unknown_label_is_a_404(self):
        r = self.client.get(f'{API}/inventory/lpns/resolve/?code=NO-SUCH-LABEL')
        self.assertEqual(r.status_code, 404)


class PackLpnManifestTests(TestCase):
    """Packing builds one tote, one manifest and one stock move atomically."""

    def setUp(self):
        self.client = APIClient()
        self.user = _user('pack-ops@zippzo.in')
        self.client.force_authenticate(user=self.user)
        self.mh = _site('MH-PACK', site_type='MH')
        self.ds = _site('DS-PACK', site_type='DS')
        self.ss = _site('SS-PACK', site_type='SS')
        self.sku = _sku('SKU-PACK-1', '9999999999997')
        self.lot = _lot(self.sku, self.mh, 'BATCH-PACK-1')
        self.bin = _bin(self.mh, 'BIN-PACK-0001', barcode='A1-R1-L1-P1')
        apply_stock(
            site=self.mh, sku=self.sku, lot=self.lot, qty=5, direction='IN',
            movement_type='PUTAWAY', ref_type='TEST', ref_id='pack-setup',
            container='BIN', container_ref=self.bin.location_id)

    def _payload(self, qty=3, dest=None, items=None):
        return {
            'lpn_id': 'LPN-PACK-1',
            'barcode': 'ZIP-LPN-PACK-1',
            'lpn_type': 'TOTE',
            'dest_site': str((dest or self.ds).site_id),
            'batch_no': 'BATCH-PACK-1',
            'items': items if items is not None else [{
                'sku': str(self.sku.sku_id), 'lot': str(self.lot.lot_id),
                'qty': qty, 'bin_location_id': self.bin.location_id,
            }],
        }

    def _balance(self, container, ref):
        return (StockBalance.objects
                .filter(container=container, container_ref=ref, sku=self.sku)
                .values_list('qty', flat=True).first() or 0)

    def test_pack_writes_manifest_contents_and_moves_stock(self):
        r = self.client.post(f'{API}/inventory/pack-lpn', self._payload(), format='json')
        self.assertEqual(r.status_code, 200, r.data)

        lpn = LpnMaster.objects.get(lpn_id='LPN-PACK-1')
        self.assertEqual(lpn.status, 'PACKED')
        self.assertEqual(lpn.dest_site_id, self.ds.site_id)
        self.assertEqual(lpn.manifest['destination']['code'], 'DS-PACK')
        self.assertEqual(lpn.manifest['items'][0]['location'], 'A1-R1-L1-P1')
        self.assertEqual(lpn.manifest['items'][0]['qty'], 3)
        self.assertEqual(lpn.manifest['total_qty'], 3)

        content = LpnContent.objects.get(lpn=lpn)
        self.assertEqual(content.qty, 3)
        self.assertEqual(self._balance('BIN', self.bin.location_id), 2)
        self.assertEqual(self._balance('LPN', 'LPN-PACK-1'), 3)

    def test_scanned_label_resolves_manifest_and_destination(self):
        self.client.post(f'{API}/inventory/pack-lpn', self._payload(), format='json')
        r = self.client.get(f'{API}/inventory/lpns/resolve/?code=ZIP-LPN-PACK-1')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['destination']['code'], 'DS-PACK')
        self.assertEqual(r.data['manifest']['items'][0]['location'], 'A1-R1-L1-P1')
        self.assertEqual(r.data['total_qty'], 3)

    def test_qr_payload_with_lpn_id_also_resolves(self):
        self.client.post(f'{API}/inventory/pack-lpn', self._payload(), format='json')
        qr = json.dumps({
            'lpn_id': 'LPN-PACK-1', 'barcode': 'ZIP-LPN-PACK-1',
            'destination': {'code': 'DS-PACK'}, 'total_qty': 3,
        })
        r = self.client.get(f'{API}/inventory/lpns/resolve/', {'code': qr})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['lpn_id'], 'LPN-PACK-1')
        self.assertEqual(r.data['destination']['code'], 'DS-PACK')

    def test_over_packing_moves_nothing_and_creates_no_lpn(self):
        r = self.client.post(f'{API}/inventory/pack-lpn', self._payload(qty=9), format='json')
        self.assertEqual(r.status_code, 400)
        self.assertFalse(LpnMaster.objects.filter(lpn_id='LPN-PACK-1').exists())
        self.assertEqual(self._balance('BIN', self.bin.location_id), 5)
        self.assertEqual(self._balance('LPN', 'LPN-PACK-1'), 0)

    def test_packing_requires_a_destination_site(self):
        r = self.client.post(f'{API}/inventory/pack-lpn', self._payload(dest=self.ss), format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('cannot receive a bundle', r.data['detail'])
        self.assertFalse(LpnMaster.objects.filter(lpn_id='LPN-PACK-1').exists())

    def test_packing_to_a_mother_hub_is_allowed(self):
        r = self.client.post(f'{API}/inventory/pack-lpn', self._payload(dest=self.mh), format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(LpnMaster.objects.get(lpn_id='LPN-PACK-1').dest_site_id, self.mh.site_id)

    def test_typed_quantities_without_scanned_items_are_refused(self):
        r = self.client.post(f'{API}/inventory/pack-lpn', self._payload(items=[]), format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self._balance('BIN', self.bin.location_id), 5)


class ManualBatchExceptionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _user('manual-ops@zippzo.in')
        self.client.force_authenticate(user=self.user)
        self.site = _site('DS-MANUAL')
        self.sku = _sku('SKU-MAN-1', '9999999999996')
        self.asn = _asn(self.site)
        self.grn = _grn(self.asn)

    def test_a_typed_batch_needs_a_reason_and_records_who(self):
        r = self.client.post(
            f'{API}/supply/grns/{self.grn.grn_id}/manual_batch/',
            {'batch_code': 'TORN-LABEL-77'}, format='json')
        self.assertEqual(r.status_code, 400)

        r = self.client.post(
            f'{API}/supply/grns/{self.grn.grn_id}/manual_batch/',
            {'batch_code': 'TORN-LABEL-77', 'reason': 'Pallet label water damaged'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.grn.refresh_from_db()
        self.assertEqual(self.grn.batch_code, 'TORN-LABEL-77')
        self.assertEqual(str(self.grn.manual_entry_by), str(self.user.user_id))
        self.assertEqual(self.grn.manual_entry_reason, 'Pallet label water damaged')
        self.assertIsNotNone(self.grn.manual_entry_at)


class HubTransferToShelfTests(TestCase):
    """End-to-end hub transfer through dark-store shelf putaway."""

    def setUp(self):
        self.client = APIClient()
        self.user = _user('hub-ds-ops@zippzo.in')
        self.client.force_authenticate(user=self.user)
        self.mh = _site('MH-HUB-1', site_type='MH')
        self.ds = _site('DS-DEST-1', site_type='DS')
        self.sku = _sku('SKU-HUB-1', '9999999999998')
        self.lot = _lot(self.sku, self.mh, 'BATCH-HUB-1')
        self.mh_bin = _bin(self.mh, 'BIN-MH-0001', barcode='MH-A1-R1-L1')
        self.ds_bin = _bin(self.ds, 'BIN-DS-0001', barcode='DS-A1-R1-L1', capacity=20)

        # Pre-seed stock in MH bin
        apply_stock(
            site=self.mh, sku=self.sku, lot=self.lot, qty=10, direction='IN',
            movement_type='PUTAWAY', ref_type='TEST', ref_id='hub-setup',
            container='BIN', container_ref=self.mh_bin.location_id)

    def _balance(self, site, container, ref):
        return (StockBalance.objects
                .filter(site=site, container=container, container_ref=ref, sku=self.sku)
                .values_list('qty', flat=True).first() or 0)

    def test_hub_transfer_through_darkstore_shelf_putaway_end_to_end(self):
        """Covers creation, packing LPN against transfer, dispatch, destination receipt, and shelf putaway."""
        from bounded.ds_ops.models import TransferOrder

        # 1. Create TransferOrder
        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        self.assertEqual(r_to.status_code, 201, r_to.data)
        transfer_id = r_to.data['transfer_id']

        # 2. Pack LPN against this transfer (associated via API, no direct DB edit)
        r_pack = self.client.post(f'{API}/inventory/pack-lpn', {
            'lpn_id': 'LPN-TR-001',
            'barcode': 'ZIP-LPN-TR-001',
            'lpn_type': 'TOTE',
            'dest_site': str(self.ds.site_id),
            'transfer': transfer_id,
            'batch_no': 'BATCH-HUB-1',
            'items': [{
                'sku': str(self.sku.sku_id),
                'lot': str(self.lot.lot_id),
                'qty': 6,
                'bin_location_id': self.mh_bin.location_id,
            }],
        }, format='json')
        self.assertEqual(r_pack.status_code, 200, r_pack.data)

        lpn = LpnMaster.objects.get(lpn_id='LPN-TR-001')
        self.assertEqual(str(lpn.transfer_id), str(transfer_id))

        # Stock left MH bin into LPN
        self.assertEqual(self._balance(self.mh, 'BIN', self.mh_bin.location_id), 4)
        self.assertEqual(self._balance(self.mh, 'LPN', 'LPN-TR-001'), 6)
        self.assertEqual(lpn.status, 'PACKED')

        # 3. Dispatch transfer
        r_dispatch = self.client.post(f'{API}/ds-ops/transfer-orders/{transfer_id}/dispatch/', {}, format='json')
        self.assertEqual(r_dispatch.status_code, 200, r_dispatch.data)
        self.assertIn('ZIP-LPN-TR-001', r_dispatch.data['lpns_dispatched'])

        lpn.refresh_from_db()
        self.assertEqual(lpn.status, 'IN_TRANSIT')

        # Re-dispatch is idempotent
        r_dispatch_repeat = self.client.post(f'{API}/ds-ops/transfer-orders/{transfer_id}/dispatch/', {}, format='json')
        self.assertEqual(r_dispatch_repeat.status_code, 200, r_dispatch_repeat.data)
        self.assertTrue(r_dispatch_repeat.data.get('already_dispatched'))

        # 4. Destination Dark-Store Receipt
        r_receive = self.client.post(f'{API}/ds-ops/receive-lpn', {
            'barcode': 'ZIP-LPN-TR-001',
            'store_code': self.ds.code,
            'received_by': str(self.user.user_id),
        }, format='json')
        self.assertEqual(r_receive.status_code, 200, r_receive.data)
        self.assertEqual(r_receive.data['stock_moved'], [{'sku': self.sku.sku_code, 'qty': 6}])

        lpn.refresh_from_db()
        self.assertEqual(lpn.status, 'RECEIVED')
        self.assertEqual(lpn.current_site_id, self.ds.site_id)
        # Stock is now in DS custody inside the LPN container
        self.assertEqual(self._balance(self.ds, 'LPN', 'LPN-TR-001'), 6)

        # Repeating receipt is idempotent
        r_receive_repeat = self.client.post(f'{API}/ds-ops/receive-lpn', {
            'barcode': 'ZIP-LPN-TR-001',
            'store_code': self.ds.code,
            'received_by': str(self.user.user_id),
        }, format='json')
        self.assertEqual(r_receive_repeat.status_code, 200, r_receive_repeat.data)
        self.assertTrue(r_receive_repeat.data.get('already_received'))
        self.assertEqual(self._balance(self.ds, 'LPN', 'LPN-TR-001'), 6)

        # Transfer order is automatically marked RECEIVED once all its LPNs are received
        to = TransferOrder.objects.get(pk=transfer_id)
        self.assertEqual(to.status, 'RECEIVED')

        # 5. Shelf Putaway (place items from LPN onto dark-store shelf bins)
        r_shelf = self.client.post(f'{API}/ds-ops/shelf-putaway', {
            'lpn': 'LPN-TR-001',
            'placements': [{
                'bin': self.ds_bin.location_id,
                'sku': str(self.sku.sku_id),
                'lot': str(self.lot.lot_id),
                'qty': 6,
            }],
        }, format='json')
        self.assertEqual(r_shelf.status_code, 200, r_shelf.data)
        self.assertTrue(r_shelf.data.get('lpn_emptied'))

        lpn.refresh_from_db()
        self.assertEqual(lpn.status, 'EMPTY')

        # Stock is now live and pickable in the destination dark-store bin!
        self.assertEqual(self._balance(self.ds, 'LPN', 'LPN-TR-001'), 0)
        self.assertEqual(self._balance(self.ds, 'BIN', self.ds_bin.location_id), 6)

        # Dispatch, receipt and shelf movement each leave a durable outbox row.
        # LPN ids are operational labels, so their event aggregate UUID is the
        # deterministic UUID5 representation used by enqueue_event().
        lpn_aggregate_id = uuid.uuid5(uuid.NAMESPACE_DNS, 'LPN-TR-001')
        self.assertTrue(OutboxEvent.objects.filter(
            event_type='warehouse.transfer.dispatched',
            aggregate_id=uuid.UUID(transfer_id),
        ).exists())
        self.assertTrue(OutboxEvent.objects.filter(
            event_type='warehouse.lpn.received',
            aggregate_id=lpn_aggregate_id,
        ).exists())
        self.assertTrue(OutboxEvent.objects.filter(
            event_type='warehouse.shelf.putaway',
            aggregate_id=lpn_aggregate_id,
        ).exists())



class TransferPackingUiWorkflowTests(TestCase):
    """Pin the exact request sequence of PackSealView.jsx end-to-end.

    Traces:
      1. TransferOrder creation and pick task completion.
      2. Tote creation via POST /inventory/lpns/ with `transfer` reference.
      3. First unit scan via POST /inventory/lpn-contents/.
      4. Subsequent scan increments via PATCH /inventory/lpn-contents/{id}/.
      5. Validation:
         - Reject products not on completed picks.
         - Reject overpacking exceeding completed pick tally.
         - Enforce source-bin stock availability.
         - Incomplete totes (partial transfer packing leaves transfer in PACKING).
         - Refuse sealing empty totes.
      6. Idempotent retries on POST /lpn-contents and PATCH /lpns/{id}/.
      7. Sealing via PATCH /inventory/lpns/{lpn_id}/ with status=PACKED:
         - Freezes manifest with destinations and item counts.
         - Updates transfer order status to PACKED.
      8. Verifies stock ledger (StockBalance and StockMovement) reflect true custody.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = _user('packer-ui@zippzo.in', role='SUPER_ADMIN')
        self.client.force_authenticate(user=self.user)

        self.mh = _site('MH-UI-PACK', site_type='MOTHER_HUB')
        self.ds = _site('DS-UI-DEST', site_type='DARK_STORE')
        self.mh_bin = Location.objects.create(
            site=self.mh, location_id='MH-UI-BIN-01', location_type='BIN',
            aisle='U1', rack='R1', level='L1', position='P1',
            barcode='MH-UI-BIN-01', is_sellable_bin=True, created_by='test')

        self.sku_a = _sku('SKU-UI-A', '8888888888881')
        self.sku_b = _sku('SKU-UI-B', '8888888888882')
        self.lot_a = _lot(self.sku_a, self.mh, 'BATCH-UI-A')
        self.lot_b = _lot(self.sku_b, self.mh, 'BATCH-UI-B')

        # Stock initially in MH bin
        apply_stock(
            site=self.mh, sku=self.sku_a, lot=self.lot_a, qty=10,
            direction='IN', movement_type='PUTAWAY', ref_type='GRN', ref_id='GRN-UI-1',
            container='BIN', container_ref=self.mh_bin.location_id,
        )
        apply_stock(
            site=self.mh, sku=self.sku_b, lot=self.lot_b, qty=10,
            direction='IN', movement_type='PUTAWAY', ref_type='GRN', ref_id='GRN-UI-1',
            container='BIN', container_ref=self.mh_bin.location_id,
        )

    def _balance(self, site, container, ref, sku):
        return (StockBalance.objects
                .filter(site=site, container=container, container_ref=ref, sku=sku)
                .values_list('qty', flat=True).first() or 0)

    def test_pack_seal_ui_sequence_end_to_end_with_stock_ledger(self):
        from bounded.ds_ops.models import PickTask, TransferOrder

        # 1. Create Transfer Order via API
        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        self.assertEqual(r_to.status_code, 201)
        transfer_id = r_to.data['transfer_id']

        # 2. Pick tasks completed for this transfer (batch=transfer_id)
        pick_task = PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id),
            sku=self.sku_a.sku_id,
            lot=self.lot_a.lot_id,
            bin=self.mh_bin.location_id,
            qty=4,
            picked_qty=4,
            status='COMPLETED',
        )

        # 3. UI Step 2: Create Tote via POST /inventory/lpns/ (associated via API)
        r_tote = self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-UI-001',
            'barcode': 'LPN-TOTE-UI-001',
            'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id),
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
            'transfer': transfer_id,
            'current_container': 'LPN',
            'current_ref_id': str(transfer_id)[:50],
            'status': 'CREATED',
            'created_by': 'console',
        }, format='json')
        self.assertEqual(r_tote.status_code, 201, r_tote.data)
        self.assertEqual(str(r_tote.data['transfer']), str(transfer_id))
        self.assertEqual(r_tote.data['status'], 'CREATED')

        # 4. UI Step 3: Scan first unit via POST /inventory/lpn-contents/
        r_first_scan = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-UI-001',
            'sku': str(self.sku_a.sku_id),
            'lot': str(self.lot_a.lot_id),
            'qty': 1,
        }, format='json')
        self.assertEqual(r_first_scan.status_code, 201, r_first_scan.data)
        content_id = r_first_scan.data['id']

        # Stock moved immediately on scan: 1 unit out of BIN and into LPN
        self.assertEqual(self._balance(self.mh, 'BIN', self.mh_bin.location_id, self.sku_a), 9)
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-UI-001', self.sku_a), 1)

        # 5. UI Step 3b: Subsequent scans increment via PATCH /inventory/lpn-contents/{id}/
        r_patch_scan = self.client.patch(f'{API}/inventory/lpn-contents/{content_id}/', {
            'qty': 4,
        }, format='json')
        self.assertEqual(r_patch_scan.status_code, 200, r_patch_scan.data)
        self.assertEqual(r_patch_scan.data['qty'], 4)

        # Stock reflects full 4 units in LPN
        self.assertEqual(self._balance(self.mh, 'BIN', self.mh_bin.location_id, self.sku_a), 6)
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-UI-001', self.sku_a), 4)

        # 6. UI Step 4: Seal the tote via PATCH /inventory/lpns/{lpn_id}/ with status=PACKED
        r_seal = self.client.patch(f'{API}/inventory/lpns/TOTE-UI-001/', {
            'status': 'PACKED',
        }, format='json')
        self.assertEqual(r_seal.status_code, 200, r_seal.data)
        self.assertEqual(r_seal.data['status'], 'PACKED')
        self.assertEqual(r_seal.data['manifest']['total_qty'], 4)
        self.assertEqual(r_seal.data['manifest']['destination']['code'], 'DS-UI-DEST')

        # Transfer order status is updated to PACKED
        to = TransferOrder.objects.get(pk=transfer_id)
        self.assertEqual(to.status, 'PACKED')

        # 7. Dispatch can now pick up and move this tote on the road
        r_dispatch = self.client.post(f'{API}/ds-ops/transfer-orders/{transfer_id}/dispatch/', {}, format='json')
        self.assertEqual(r_dispatch.status_code, 200, r_dispatch.data)
        self.assertIn('LPN-TOTE-UI-001', r_dispatch.data['lpns_dispatched'])

    def test_reject_product_not_on_transfer_completed_picks(self):
        from bounded.ds_ops.models import PickTask

        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        transfer_id = r_to.data['transfer_id']

        # Completed pick for SKU A only
        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id), sku=self.sku_a.sku_id, lot=self.lot_a.lot_id,
            bin=self.mh_bin.location_id, qty=3, picked_qty=3, status='COMPLETED')

        r_tote = self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-UI-002', 'barcode': 'LPN-TOTE-UI-002', 'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id), 'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id), 'transfer': transfer_id,
            'status': 'CREATED',
        }, format='json')
        self.assertEqual(r_tote.status_code, 201)

        # Attempt to scan SKU B (outsider product not on completed picks)
        r_bad = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-UI-002',
            'sku': str(self.sku_b.sku_id),
            'lot': str(self.lot_b.lot_id),
            'qty': 1,
        }, format='json')
        self.assertEqual(r_bad.status_code, 400)
        self.assertIn('not on completed picks', str(r_bad.data))
        # No stock moved
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-UI-002', self.sku_b), 0)

    def test_reject_overpacking_exceeding_picked_quantity(self):
        from bounded.ds_ops.models import PickTask

        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        transfer_id = r_to.data['transfer_id']

        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id), sku=self.sku_a.sku_id, lot=self.lot_a.lot_id,
            bin=self.mh_bin.location_id, qty=3, picked_qty=3, status='COMPLETED')

        self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-UI-003', 'barcode': 'LPN-TOTE-UI-003', 'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id), 'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id), 'transfer': transfer_id,
            'status': 'CREATED',
        }, format='json')

        # Try to pack 5 units when only 3 were picked
        r_over = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-UI-003',
            'sku': str(self.sku_a.sku_id),
            'lot': str(self.lot_a.lot_id),
            'qty': 5,
        }, format='json')
        self.assertEqual(r_over.status_code, 400)
        self.assertIn('exceeds completed picks', str(r_over.data))
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-UI-003', self.sku_a), 0)

    def test_incomplete_tote_partial_transfer_allowed(self):
        from bounded.ds_ops.models import PickTask, TransferOrder

        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        transfer_id = r_to.data['transfer_id']

        # Total 6 units picked across 2 lines
        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id), sku=self.sku_a.sku_id, lot=self.lot_a.lot_id,
            bin=self.mh_bin.location_id, qty=4, picked_qty=4, status='COMPLETED')
        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id), sku=self.sku_b.sku_id, lot=self.lot_b.lot_id,
            bin=self.mh_bin.location_id, qty=2, picked_qty=2, status='COMPLETED')

        self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-UI-PART-1', 'barcode': 'LPN-TOTE-UI-PART-1', 'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id), 'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id), 'transfer': transfer_id,
            'status': 'CREATED',
        }, format='json')

        # Pack first tote with only 4 units of SKU A
        self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-UI-PART-1',
            'sku': str(self.sku_a.sku_id),
            'lot': str(self.lot_a.lot_id),
            'qty': 4,
        }, format='json')

        # Sealing Tote 1 succeeds
        r_seal = self.client.patch(f'{API}/inventory/lpns/TOTE-UI-PART-1/', {
            'status': 'PACKED',
        }, format='json')
        self.assertEqual(r_seal.status_code, 200)

        # Transfer remains in PACKING since 2 units of SKU B are still outstanding
        to = TransferOrder.objects.get(pk=transfer_id)
        self.assertEqual(to.status, 'PACKING')

    def test_refuse_sealing_empty_tote(self):
        r_tote = self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-UI-EMPTY', 'barcode': 'LPN-TOTE-UI-EMPTY', 'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id), 'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
            'status': 'CREATED',
        }, format='json')
        self.assertEqual(r_tote.status_code, 201)

        # Attempt to seal without any scans
        r_seal = self.client.patch(f'{API}/inventory/lpns/TOTE-UI-EMPTY/', {
            'status': 'PACKED',
        }, format='json')
        self.assertEqual(r_seal.status_code, 400)
        self.assertIn('Cannot seal an empty tote', str(r_seal.data))

    def test_retry_idempotency_behavior(self):
        from bounded.ds_ops.models import PickTask

        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        transfer_id = r_to.data['transfer_id']

        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id), sku=self.sku_a.sku_id, lot=self.lot_a.lot_id,
            bin=self.mh_bin.location_id, qty=2, picked_qty=2, status='COMPLETED')

        self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-UI-RETRY', 'barcode': 'LPN-TOTE-UI-RETRY', 'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id), 'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id), 'transfer': transfer_id,
            'status': 'CREATED',
        }, format='json')

        # First scan
        r1 = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-UI-RETRY', 'sku': str(self.sku_a.sku_id), 'lot': str(self.lot_a.lot_id), 'qty': 2,
        }, format='json')
        self.assertEqual(r1.status_code, 201)

        # Retried scan after network drop with identical payload: returns 200 without double counting
        r2 = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-UI-RETRY', 'sku': str(self.sku_a.sku_id), 'lot': str(self.lot_a.lot_id), 'qty': 2,
        }, format='json')
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-UI-RETRY', self.sku_a), 2)

        # Seal tote
        r_seal1 = self.client.patch(f'{API}/inventory/lpns/TOTE-UI-RETRY/', {'status': 'PACKED'}, format='json')
        self.assertEqual(r_seal1.status_code, 200)

        # Retried seal returns 200 idempotently
        r_seal2 = self.client.patch(f'{API}/inventory/lpns/TOTE-UI-RETRY/', {'status': 'PACKED'}, format='json')
        self.assertEqual(r_seal2.status_code, 200)

    def test_pack_seal_lot_filter_query_and_resolution(self):
        """PackSealView.resolveLot() queries GET /catalog/lots/ with sku, site, status.
        
        Tests:
          1. GET /catalog/lots/?sku=...&site=...&status=AVAILABLE filters strictly by
             sku, site, and status, and returns lots ordered FEFO (earliest expiry first).
          2. When PickTask.lot is None (multi-lot or unassigned pick line), the UI
             resolves the lot via this endpoint and scans/commits the unit with the
             resolved lot ID.
          3. Stock ledger moves from bin to LPN under the resolved lot ID.
          4. Sealing freezes the manifest with the resolved lot ID and batch number.
        """
        import datetime
        from bounded.ds_ops.models import PickTask, TransferOrder

        today = datetime.date.today()
        # Dedicated SKU so setup fixtures from other tests do not pollute lot queries
        sku_resolve = _sku('SKU-UI-RESOLVE', '8888888888889')

        # Create FEFO-ordered lots for sku_resolve at MH
        lot_soon = InventoryLot.objects.create(
            sku=sku_resolve, site=self.mh, batch_number='BATCH-SOON',
            expiry_date=today + datetime.timedelta(days=15),
            status='AVAILABLE', bucket='Good', inbound_type='PURCHASE', inbound_ref='PO-LOT-1')
        lot_later = InventoryLot.objects.create(
            sku=sku_resolve, site=self.mh, batch_number='BATCH-LATER',
            expiry_date=today + datetime.timedelta(days=90),
            status='AVAILABLE', bucket='Good', inbound_type='PURCHASE', inbound_ref='PO-LOT-2')
        # Excluded lots: QC hold and other site
        InventoryLot.objects.create(
            sku=sku_resolve, site=self.mh, batch_number='BATCH-HOLD',
            expiry_date=today + datetime.timedelta(days=5),
            status='QC_HOLD', bucket='QC_HOLD', inbound_type='PURCHASE', inbound_ref='PO-LOT-3')
        InventoryLot.objects.create(
            sku=sku_resolve, site=self.ds, batch_number='BATCH-OTHER-SITE',
            expiry_date=today + datetime.timedelta(days=1),
            status='AVAILABLE', bucket='Good', inbound_type='PURCHASE', inbound_ref='PO-LOT-4')

        # 1. UI queries GET /catalog/lots/
        r_lots = self.client.get(
            f'{API}/catalog/lots/?sku={sku_resolve.sku_id}&site={self.mh.site_id}&status=AVAILABLE&page_size=1'
        )
        self.assertEqual(r_lots.status_code, 200)
        lot_results = r_lots.data.get('results', r_lots.data)
        self.assertTrue(len(lot_results) >= 1)
        # Verify FEFO ordering: earliest expiry (lot_soon) returned first
        self.assertEqual(str(lot_results[0]['lot_id']), str(lot_soon.lot_id))
        self.assertEqual(lot_results[0]['batch_number'], 'BATCH-SOON')
        resolved_lot_id = lot_results[0]['lot_id']

        # 2. Stock initial balance in source bin for lot_soon
        apply_stock(
            site=self.mh, sku=sku_resolve, lot=lot_soon, qty=5,
            direction='IN', movement_type='PUTAWAY', ref_type='GRN', ref_id='GRN-RESOLVE-1',
            container='BIN', container_ref=self.mh_bin.location_id,
        )

        # 3. Create Transfer Order and PickTask with lot=None
        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        transfer_id = r_to.data['transfer_id']

        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id),
            sku=sku_resolve.sku_id,
            lot=None,  # Nullable lot on pick task
            bin=self.mh_bin.location_id,
            qty=2,
            picked_qty=2,
            status='COMPLETED',
        )

        # 4. Create Tote via UI API call
        r_tote = self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-UI-RESOLVE',
            'barcode': 'LPN-TOTE-UI-RESOLVE',
            'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id),
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
            'transfer': transfer_id,
            'status': 'CREATED',
            'created_by': 'console',
        }, format='json')
        self.assertEqual(r_tote.status_code, 201)

        # 5. Pack first unit using resolved lot
        r_scan1 = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-UI-RESOLVE',
            'sku': str(sku_resolve.sku_id),
            'lot': str(resolved_lot_id),
            'qty': 1,
        }, format='json')
        self.assertEqual(r_scan1.status_code, 201)
        content_id = r_scan1.data['id']

        # 6. Increment to full pick qty
        r_scan2 = self.client.patch(f'{API}/inventory/lpn-contents/{content_id}/', {
            'qty': 2,
        }, format='json')
        self.assertEqual(r_scan2.status_code, 200)

        # Stock moved: 2 units OUT of bin, 2 units IN to LPN under lot_soon
        self.assertEqual(
            StockBalance.objects.filter(
                site=self.mh, container='BIN', container_ref=self.mh_bin.location_id,
                sku=sku_resolve, lot=lot_soon).values_list('qty', flat=True).first(), 3)
        self.assertEqual(
            StockBalance.objects.filter(
                site=self.mh, container='LPN', container_ref='TOTE-UI-RESOLVE',
                sku=sku_resolve, lot=lot_soon).values_list('qty', flat=True).first(), 2)

        # 7. Seal tote: freezes manifest and advances transfer status to PACKED
        r_seal = self.client.patch(f'{API}/inventory/lpns/TOTE-UI-RESOLVE/', {
            'status': 'PACKED',
        }, format='json')
        self.assertEqual(r_seal.status_code, 200)
        self.assertEqual(r_seal.data['manifest']['total_qty'], 2)
        item = r_seal.data['manifest']['items'][0]
        self.assertEqual(item['lot'], str(resolved_lot_id))
        self.assertEqual(item['batch_number'], 'BATCH-SOON')

        to = TransferOrder.objects.get(pk=transfer_id)
        self.assertEqual(to.status, 'PACKED')

    def test_multi_lot_pick_and_tote_packing_for_same_sku(self):
        """PackSealView packing a tote that spans multiple lots of the same SKU.

        Scenario:
          Transfer of 5 units of SKU A:
            - 2 units from Lot 1 located in MH-UI-BIN-01
            - 3 units from Lot 2 located in MH-UI-BIN-02
          Both are packed into the same tote (TOTE-UI-MULTI).

        Verifies:
          1. Each lot line is committed independently to LpnContent (unique on lpn, sku, lot).
          2. Per-lot stock deduction from the respective bins (Bin 1 for Lot 1, Bin 2 for Lot 2).
          3. Total pick ceiling enforced across lots: cannot pack beyond 5 total units for SKU A.
          4. Sealing tote captures both lots in the manifest with correct per-lot tallies.
          5. TransferOrder status advances to PACKED only when the total picked tally is satisfied.
        """
        import datetime
        from bounded.ds_ops.models import PickTask, TransferOrder

        today = datetime.date.today()
        # Two distinct lots for SKU A
        lot_1 = InventoryLot.objects.create(
            sku=self.sku_a, site=self.mh, batch_number='BATCH-MULTI-1',
            expiry_date=today + datetime.timedelta(days=30),
            status='AVAILABLE', bucket='Good', inbound_type='PURCHASE', inbound_ref='PO-M1')
        lot_2 = InventoryLot.objects.create(
            sku=self.sku_a, site=self.mh, batch_number='BATCH-MULTI-2',
            expiry_date=today + datetime.timedelta(days=60),
            status='AVAILABLE', bucket='Good', inbound_type='PURCHASE', inbound_ref='PO-M2')

        # A second bin in MH
        mh_bin_2 = Location.objects.create(
            site=self.mh, location_id='MH-UI-BIN-02', location_type='BIN',
            aisle='U1', rack='R1', level='L1', position='P2',
            barcode='MH-UI-BIN-02', is_sellable_bin=True, created_by='test')

        # Seed initial bin stock
        apply_stock(
            site=self.mh, sku=self.sku_a, lot=lot_1, qty=5,
            direction='IN', movement_type='PUTAWAY', ref_type='GRN', ref_id='GRN-M-1',
            container='BIN', container_ref=self.mh_bin.location_id,
        )
        apply_stock(
            site=self.mh, sku=self.sku_a, lot=lot_2, qty=5,
            direction='IN', movement_type='PUTAWAY', ref_type='GRN', ref_id='GRN-M-2',
            container='BIN', container_ref=mh_bin_2.location_id,
        )

        # Create transfer order
        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        transfer_id = r_to.data['transfer_id']

        # Two completed pick tasks for SKU A across the two lots and bins
        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id),
            sku=self.sku_a.sku_id,
            lot=lot_1.lot_id,
            bin=self.mh_bin.location_id,
            qty=2,
            picked_qty=2,
            status='COMPLETED',
        )
        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id),
            sku=self.sku_a.sku_id,
            lot=lot_2.lot_id,
            bin=mh_bin_2.location_id,
            qty=3,
            picked_qty=3,
            status='COMPLETED',
        )

        # Create Tote
        r_tote = self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-UI-MULTI',
            'barcode': 'LPN-TOTE-UI-MULTI',
            'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id),
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
            'transfer': transfer_id,
            'status': 'CREATED',
            'created_by': 'console',
        }, format='json')
        self.assertEqual(r_tote.status_code, 201)

        # 1. Pack Lot 1: 1st unit via POST, then increment to 2 via PATCH
        r_l1_post = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-UI-MULTI',
            'sku': str(self.sku_a.sku_id),
            'lot': str(lot_1.lot_id),
            'qty': 1,
        }, format='json')
        self.assertEqual(r_l1_post.status_code, 201)
        l1_content_id = r_l1_post.data['id']

        r_l1_patch = self.client.patch(f'{API}/inventory/lpn-contents/{l1_content_id}/', {
            'qty': 2,
        }, format='json')
        self.assertEqual(r_l1_patch.status_code, 200)

        # Verify Bin 1 decremented by 2 (5 -> 3), Bin 2 untouched (5)
        self.assertEqual(
            StockBalance.objects.filter(
                site=self.mh, container='BIN', container_ref=self.mh_bin.location_id,
                sku=self.sku_a, lot=lot_1).values_list('qty', flat=True).first(), 3)
        self.assertEqual(
            StockBalance.objects.filter(
                site=self.mh, container='BIN', container_ref=mh_bin_2.location_id,
                sku=self.sku_a, lot=lot_2).values_list('qty', flat=True).first(), 5)
        # Tote holds 2 of Lot 1
        self.assertEqual(
            StockBalance.objects.filter(
                site=self.mh, container='LPN', container_ref='TOTE-UI-MULTI',
                sku=self.sku_a, lot=lot_1).values_list('qty', flat=True).first(), 2)

        # 2. Pack Lot 2 into the SAME tote: 1st unit via POST, increment to 3 via PATCH
        r_l2_post = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-UI-MULTI',
            'sku': str(self.sku_a.sku_id),
            'lot': str(lot_2.lot_id),
            'qty': 1,
        }, format='json')
        self.assertEqual(r_l2_post.status_code, 201)
        l2_content_id = r_l2_post.data['id']

        r_l2_patch = self.client.patch(f'{API}/inventory/lpn-contents/{l2_content_id}/', {
            'qty': 3,
        }, format='json')
        self.assertEqual(r_l2_patch.status_code, 200)

        # Verify Bin 2 decremented by 3 (5 -> 2)
        self.assertEqual(
            StockBalance.objects.filter(
                site=self.mh, container='BIN', container_ref=mh_bin_2.location_id,
                sku=self.sku_a, lot=lot_2).values_list('qty', flat=True).first(), 2)
        # Tote holds 3 of Lot 2
        self.assertEqual(
            StockBalance.objects.filter(
                site=self.mh, container='LPN', container_ref='TOTE-UI-MULTI',
                sku=self.sku_a, lot=lot_2).values_list('qty', flat=True).first(), 3)

        # 3. Overpack rejection across multiple lots for the same SKU
        # Total packed is 2 + 3 = 5 (ceiling is 5). Trying to bump Lot 1 to 3 must fail.
        r_over_l1 = self.client.patch(f'{API}/inventory/lpn-contents/{l1_content_id}/', {
            'qty': 3,
        }, format='json')
        self.assertEqual(r_over_l1.status_code, 400)
        self.assertIn('exceeds completed picks', str(r_over_l1.data))

        # Trying to bump Lot 2 to 4 must fail
        r_over_l2 = self.client.patch(f'{API}/inventory/lpn-contents/{l2_content_id}/', {
            'qty': 4,
        }, format='json')
        self.assertEqual(r_over_l2.status_code, 400)
        self.assertIn('exceeds completed picks', str(r_over_l2.data))

        # 4. Seal Tote
        r_seal = self.client.patch(f'{API}/inventory/lpns/TOTE-UI-MULTI/', {
            'status': 'PACKED',
        }, format='json')
        self.assertEqual(r_seal.status_code, 200)

        # Manifest contains 2 item lines for SKU A (one for each lot), total_qty is 5
        manifest = r_seal.data['manifest']
        self.assertEqual(manifest['total_qty'], 5)
        self.assertEqual(len(manifest['items']), 2)
        manifest_lots = {item['lot']: item['qty'] for item in manifest['items']}
        self.assertEqual(manifest_lots[str(lot_1.lot_id)], 2)
        self.assertEqual(manifest_lots[str(lot_2.lot_id)], 3)

        # Transfer order status is PACKED
        to = TransferOrder.objects.get(pk=transfer_id)
        self.assertEqual(to.status, 'PACKED')




class TransferStockAccountingLifecycleTests(TestCase):
    """End-to-end stock accounting and lifecycle trace across facilities:
    UI Tote Creation -> Per-unit scan & packing -> Sealing -> Outbound Dispatch ->
    Destination Receipt -> Shelf Putaway.

    Verifies:
      1. Source, in-transit, and destination stock balances at each step.
      2. Prevention of network inventory duplication across facility hops.
      3. Ledger contracts (StockBalance, StockMovement) and transactional safety.
      4. Safe retry / idempotency at each transition (scan, seal, dispatch, receive).
      5. Partial receipt handling across multiple LPNs and transfer status progression.
      6. Rollback behavior on receipt and putaway errors.
      7. Outbox events and supervisor notification dispatch for dispatch and receipt.
    """

    def setUp(self):
        from bounded.network.models import EmployeeSiteAssignment

        self.client = APIClient()
        self.operator = _user('hub-packer@zippzo.in', role='SUPER_ADMIN')
        self.client.force_authenticate(user=self.operator)

        self.mh = _site('MH-FLOW-1', site_type='MOTHER_HUB')
        self.ds = _site('DS-FLOW-1', site_type='DARK_STORE')
        self.foreign_ds = _site('DS-FOREIGN-1', site_type='DARK_STORE')

        self.supervisor = _user('ds-supervisor@zippzo.in', role='WAREHOUSE_STAFF')
        EmployeeSiteAssignment.objects.create(
            employee='EMP-FLOW-SUP', user=self.supervisor, site=self.ds,
            mode='DARKHOUSE', role_at_site='STORE_MANAGER', is_primary=True, is_active=True,
        )

        self.mh_bin = Location.objects.create(
            site=self.mh, location_id='MH-FLOW-BIN-1', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='MH-FLOW-BIN-1', is_sellable_bin=True, created_by='test')

        self.ds_bin = Location.objects.create(
            site=self.ds, location_id='DS-FLOW-BIN-1', location_type='BIN',
            aisle='D1', rack='R1', level='L1', position='P1',
            barcode='DS-FLOW-BIN-1', is_sellable_bin=True, created_by='test')

        self.foreign_bin = Location.objects.create(
            site=self.foreign_ds, location_id='DS-FOREIGN-BIN-1', location_type='BIN',
            aisle='F1', rack='R1', level='L1', position='P1',
            barcode='DS-FOREIGN-BIN-1', is_sellable_bin=True, created_by='test')

        self.sku = _sku('SKU-FLOW-1', '7777777777771')
        self.lot = _lot(self.sku, self.mh, 'BATCH-FLOW-1')

        # Initial source stock: 10 units in MH bin
        apply_stock(
            site=self.mh, sku=self.sku, lot=self.lot, qty=10,
            direction='IN', movement_type='PUTAWAY', ref_type='GRN', ref_id='GRN-FLOW-1',
            container='BIN', container_ref=self.mh_bin.location_id,
        )

    def _balance(self, site, container, ref):
        return (StockBalance.objects
                .filter(site=site, container=container, container_ref=ref, sku=self.sku)
                .values_list('qty', flat=True).first() or 0)

    def _total_network(self):
        from django.db.models import Sum
        return StockBalance.objects.filter(sku=self.sku).aggregate(t=Sum('qty'))['t'] or 0

    def _transit_balance(self, lpn_id):
        from django.db.models import Sum
        from bounded.ds_ops.views import _transfer_transit_ref
        lpn = LpnMaster.objects.get(pk=lpn_id)
        return (StockBalance.objects.filter(
            site=self.mh, container='SITE',
            container_ref=_transfer_transit_ref(lpn), sku=self.sku,
        ).aggregate(t=Sum('qty'))['t'] or 0)

    def test_stock_accounting_end_to_end_from_ui_pack_to_shelf_putaway(self):
        from bounded.ds_ops.models import PickTask, TransferOrder
        from bounded.notifications.models import Notification
        from bounded.notifications.publish import publish_batch

        # Initial baseline
        self.assertEqual(self._balance(self.mh, 'BIN', self.mh_bin.location_id), 10)
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-E2E-001'), 0)
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-E2E-001'), 0)
        self.assertEqual(self._balance(self.ds, 'BIN', self.ds_bin.location_id), 0)
        self.assertEqual(self._total_network(), 10)

        # 1. Create TransferOrder via API
        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        self.assertEqual(r_to.status_code, 201)
        transfer_id = r_to.data['transfer_id']

        # PickTask setup fixture (6 units picked from source bin for this transfer batch)
        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id),
            sku=self.sku.sku_id,
            lot=self.lot.lot_id,
            bin=self.mh_bin.location_id,
            qty=6,
            picked_qty=6,
            status='COMPLETED',
        )

        # 2. UI Tote Creation via POST /inventory/lpns/ (associated with transfer through API)
        r_tote = self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-E2E-001',
            'barcode': 'LPN-TOTE-E2E-001',
            'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id),
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
            'transfer': transfer_id,
            'current_container': 'LPN',
            'status': 'CREATED',
            'created_by': 'console',
        }, format='json')
        self.assertEqual(r_tote.status_code, 201)
        self.assertEqual(str(r_tote.data['transfer']), str(transfer_id))

        # 3. Scanning and packing: first unit + subsequent increments
        r_scan1 = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-E2E-001',
            'sku': str(self.sku.sku_id),
            'lot': str(self.lot.lot_id),
            'qty': 2,
        }, format='json')
        self.assertEqual(r_scan1.status_code, 201)
        content_id = r_scan1.data['id']

        # Increment to full 6 units
        r_scan2 = self.client.patch(f'{API}/inventory/lpn-contents/{content_id}/', {
            'qty': 6,
        }, format='json')
        self.assertEqual(r_scan2.status_code, 200)

        # Balances after packing: stock moved from source BIN to source LPN
        self.assertEqual(self._balance(self.mh, 'BIN', self.mh_bin.location_id), 4)
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-E2E-001'), 6)
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-E2E-001'), 0)
        self.assertEqual(self._total_network(), 10)

        # 4. Seal Tote via PATCH /inventory/lpns/
        r_seal = self.client.patch(f'{API}/inventory/lpns/TOTE-E2E-001/', {
            'status': 'PACKED',
        }, format='json')
        self.assertEqual(r_seal.status_code, 200)
        self.assertEqual(r_seal.data['status'], 'PACKED')

        to = TransferOrder.objects.get(pk=transfer_id)
        self.assertEqual(to.status, 'PACKED')

        # 5. Outbound Dispatch via POST /ds-ops/transfer-orders/{id}/dispatch/
        r_disp = self.client.post(f'{API}/ds-ops/transfer-orders/{transfer_id}/dispatch/', {}, format='json')
        self.assertEqual(r_disp.status_code, 200)
        self.assertIn('LPN-TOTE-E2E-001', r_disp.data['lpns_dispatched'])

        to.refresh_from_db()
        self.assertEqual(to.status, 'IN_TRANSIT')

        lpn = LpnMaster.objects.get(lpn_id='TOTE-E2E-001')
        self.assertEqual(lpn.status, 'IN_TRANSIT')

        # Balances during transit: units remain in StockBalance at the source
        # under a distinct transit reference, not only in the LPN manifest.
        self.assertEqual(self._balance(self.mh, 'BIN', self.mh_bin.location_id), 4)
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-E2E-001'), 0)
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-E2E-001'), 0)
        self.assertEqual(self._transit_balance('TOTE-E2E-001'), 6)
        self.assertEqual(self._total_network(), 10)

        # Dispatch is idempotent on retry
        r_disp_retry = self.client.post(f'{API}/ds-ops/transfer-orders/{transfer_id}/dispatch/', {}, format='json')
        self.assertEqual(r_disp_retry.status_code, 200)
        self.assertTrue(r_disp_retry.data.get('already_dispatched'))
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-E2E-001'), 0)

        # Dispatch published outbox event and notifications
        self.assertTrue(OutboxEvent.objects.filter(
            event_type='warehouse.transfer.dispatched',
            aggregate_id=uuid.UUID(transfer_id),
        ).exists())
        publish_batch()
        self.assertTrue(Notification.objects.filter(
            user=str(self.supervisor.user_id),
            type='TRANSFER_DISPATCHED',
        ).exists())

        # 6. Destination Receipt via POST /ds-ops/receive-lpn
        r_rec = self.client.post(f'{API}/ds-ops/receive-lpn', {
            'barcode': 'LPN-TOTE-E2E-001',
            'store_code': self.ds.code,
            'received_by': str(self.supervisor.user_id),
        }, format='json')
        self.assertEqual(r_rec.status_code, 200)
        self.assertEqual(r_rec.data['stock_moved'], [{'sku': self.sku.sku_code, 'qty': 6}])

        lpn.refresh_from_db()
        self.assertEqual(lpn.status, 'RECEIVED')
        self.assertEqual(lpn.current_site_id, self.ds.site_id)

        to.refresh_from_db()
        self.assertEqual(to.status, 'RECEIVED')

        # Balances after receipt:
        # Stock is now in DS LPN custody. Source LPN is 0.
        # CRITICAL CHECK: Total network inventory must remain exactly 10, NOT duplicated!
        self.assertEqual(self._balance(self.mh, 'BIN', self.mh_bin.location_id), 4)
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-E2E-001'), 0)
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-E2E-001'), 6)
        self.assertEqual(self._total_network(), 10)

        # Receipt retry is idempotent
        r_rec_retry = self.client.post(f'{API}/ds-ops/receive-lpn', {
            'barcode': 'LPN-TOTE-E2E-001',
            'store_code': self.ds.code,
            'received_by': str(self.supervisor.user_id),
        }, format='json')
        self.assertEqual(r_rec_retry.status_code, 200)
        self.assertTrue(r_rec_retry.data.get('already_received'))
        self.assertEqual(self._total_network(), 10)

        # Receipt outbox event and notifications
        lpn_aggregate_id = uuid.uuid5(uuid.NAMESPACE_DNS, 'TOTE-E2E-001')
        self.assertTrue(OutboxEvent.objects.filter(
            event_type='warehouse.lpn.received',
            aggregate_id=lpn_aggregate_id,
        ).exists())
        publish_batch()
        self.assertTrue(Notification.objects.filter(
            user=str(self.supervisor.user_id),
            type='LPN_RECEIVED',
        ).exists())

        # 7. Shelf Putaway via POST /ds-ops/shelf-putaway
        r_shelf = self.client.post(f'{API}/ds-ops/shelf-putaway', {
            'lpn': 'TOTE-E2E-001',
            'placements': [{
                'bin': self.ds_bin.location_id,
                'sku': str(self.sku.sku_id),
                'lot': str(self.lot.lot_id),
                'qty': 6,
            }],
        }, format='json')
        self.assertEqual(r_shelf.status_code, 200)
        self.assertTrue(r_shelf.data.get('lpn_emptied'))

        lpn.refresh_from_db()
        self.assertEqual(lpn.status, 'EMPTY')

        # Final balances:
        # DS bin has 6 live sellable units, DS LPN is 0, MH bin has 4 units, network total is 10.
        self.assertEqual(self._balance(self.ds, 'BIN', self.ds_bin.location_id), 6)
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-E2E-001'), 0)
        self.assertEqual(self._balance(self.mh, 'BIN', self.mh_bin.location_id), 4)
        self.assertEqual(self._total_network(), 10)

        # Shelf putaway outbox event verified
        self.assertTrue(OutboxEvent.objects.filter(
            event_type='warehouse.shelf.putaway',
            aggregate_id=lpn_aggregate_id,
        ).exists())

    def test_multiple_lpns_and_partial_receipt_advances_transfer_status(self):
        from bounded.ds_ops.models import PickTask, TransferOrder

        # Create TransferOrder
        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED',
            'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        transfer_id = r_to.data['transfer_id']

        # PickTask for 6 units total
        PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=str(transfer_id),
            sku=self.sku.sku_id,
            lot=self.lot.lot_id,
            bin=self.mh_bin.location_id,
            qty=6,
            picked_qty=6,
            status='COMPLETED',
        )

        # Tote 1: 3 units
        self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-MULTI-1', 'barcode': 'LPN-TOTE-MULTI-1', 'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id), 'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id), 'transfer': transfer_id, 'status': 'CREATED',
        }, format='json')
        self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-MULTI-1', 'sku': str(self.sku.sku_id), 'lot': str(self.lot.lot_id), 'qty': 3,
        }, format='json')
        self.client.patch(f'{API}/inventory/lpns/TOTE-MULTI-1/', {'status': 'PACKED'}, format='json')

        # Partial pack: Transfer order stays in PACKING
        to = TransferOrder.objects.get(pk=transfer_id)
        self.assertEqual(to.status, 'PACKING')

        # Tote 2: 3 units
        self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-MULTI-2', 'barcode': 'LPN-TOTE-MULTI-2', 'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id), 'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id), 'transfer': transfer_id, 'status': 'CREATED',
        }, format='json')
        self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-MULTI-2', 'sku': str(self.sku.sku_id), 'lot': str(self.lot.lot_id), 'qty': 3,
        }, format='json')
        self.client.patch(f'{API}/inventory/lpns/TOTE-MULTI-2/', {'status': 'PACKED'}, format='json')

        # All units packed: Transfer order promoted to PACKED
        to.refresh_from_db()
        self.assertEqual(to.status, 'PACKED')

        # Dispatch moves both totes to IN_TRANSIT
        r_disp = self.client.post(f'{API}/ds-ops/transfer-orders/{transfer_id}/dispatch/', {}, format='json')
        self.assertEqual(r_disp.status_code, 200)
        self.assertEqual(set(r_disp.data['lpns_dispatched']), {'LPN-TOTE-MULTI-1', 'LPN-TOTE-MULTI-2'})

        to.refresh_from_db()
        self.assertEqual(to.status, 'IN_TRANSIT')

        # Both totes move to explicit transit balances at the source site.
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-MULTI-1'), 0)
        self.assertEqual(self._balance(self.mh, 'LPN', 'TOTE-MULTI-2'), 0)
        self.assertEqual(self._transit_balance('TOTE-MULTI-1'), 3)
        self.assertEqual(self._transit_balance('TOTE-MULTI-2'), 3)
        self.assertEqual(self._total_network(), 10)

        # Partial receipt: receive Tote 1 only
        r_rec1 = self.client.post(f'{API}/ds-ops/receive-lpn', {
            'barcode': 'LPN-TOTE-MULTI-1', 'store_code': self.ds.code,
            'received_by': str(self.supervisor.user_id),
        }, format='json')
        self.assertEqual(r_rec1.status_code, 200)

        # Tote 1 is RECEIVED, Tote 2 is still IN_TRANSIT
        lpn1 = LpnMaster.objects.get(lpn_id='TOTE-MULTI-1')
        lpn2 = LpnMaster.objects.get(lpn_id='TOTE-MULTI-2')
        self.assertEqual(lpn1.status, 'RECEIVED')
        self.assertEqual(lpn2.status, 'IN_TRANSIT')

        # Transfer order remains IN_TRANSIT because Tote 2 has not been received
        to.refresh_from_db()
        self.assertEqual(to.status, 'IN_TRANSIT')

        # Network inventory reflects 4 in MH bin + 3 in DS LPN 1 + 3 in-transit (Tote 2) = 10
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-MULTI-1'), 3)
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-MULTI-2'), 0)
        self.assertEqual(self._transit_balance('TOTE-MULTI-2'), 3)
        self.assertEqual(self._total_network(), 10)

        # Receive Tote 2: completing transfer receipt
        r_rec2 = self.client.post(f'{API}/ds-ops/receive-lpn', {
            'barcode': 'LPN-TOTE-MULTI-2', 'store_code': self.ds.code,
            'received_by': str(self.supervisor.user_id),
        }, format='json')
        self.assertEqual(r_rec2.status_code, 200)

        lpn2.refresh_from_db()
        self.assertEqual(lpn2.status, 'RECEIVED')

        # Transfer order is now promoted to RECEIVED
        to.refresh_from_db()
        self.assertEqual(to.status, 'RECEIVED')

        # Total network inventory is conserved: 4 (MH bin) + 6 (DS LPNs) = 10
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-MULTI-1'), 3)
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-MULTI-2'), 3)
        self.assertEqual(self._total_network(), 10)

    def test_rollback_behavior_on_invalid_destination_and_shelving_errors(self):
        from bounded.ds_ops.models import PickTask, TransferOrder

        # Transfer created for DS
        r_to = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'status': 'APPROVED', 'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id),
        }, format='json')
        transfer_id = r_to.data['transfer_id']

        PickTask.objects.create(
            picklist_id=uuid.uuid4(), batch=str(transfer_id),
            sku=self.sku.sku_id, lot=self.lot.lot_id,
            bin=self.mh_bin.location_id, qty=4, picked_qty=4, status='COMPLETED')

        self.client.post(f'{API}/inventory/lpns/', {
            'lpn_id': 'TOTE-ERR-1', 'barcode': 'LPN-TOTE-ERR-1', 'lpn_type': 'TOTE',
            'current_site': str(self.mh.site_id), 'source_site': str(self.mh.site_id),
            'dest_site': str(self.ds.site_id), 'transfer': transfer_id, 'status': 'CREATED',
        }, format='json')
        self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': 'TOTE-ERR-1', 'sku': str(self.sku.sku_id), 'lot': str(self.lot.lot_id), 'qty': 4,
        }, format='json')
        self.client.patch(f'{API}/inventory/lpns/TOTE-ERR-1/', {'status': 'PACKED'}, format='json')

        self.client.post(f'{API}/ds-ops/transfer-orders/{transfer_id}/dispatch/', {}, format='json')

        # 1. Receipt rollback: Attempt to receive at foreign dark store (dest mismatch)
        r_wrong_store = self.client.post(f'{API}/ds-ops/receive-lpn', {
            'barcode': 'LPN-TOTE-ERR-1',
            'store_code': self.foreign_ds.code,
            'received_by': str(self.supervisor.user_id),
        }, format='json')
        self.assertEqual(r_wrong_store.status_code, 400)
        self.assertIn('destined for', r_wrong_store.data['error'])

        # Transaction was rolled back: LPN status remains IN_TRANSIT, no stock credited to foreign DS
        lpn = LpnMaster.objects.get(lpn_id='TOTE-ERR-1')
        self.assertEqual(lpn.status, 'IN_TRANSIT')
        self.assertEqual(self._balance(self.foreign_ds, 'LPN', 'TOTE-ERR-1'), 0)

        # Receive at correct dark store
        r_correct = self.client.post(f'{API}/ds-ops/receive-lpn', {
            'barcode': 'LPN-TOTE-ERR-1',
            'store_code': self.ds.code,
            'received_by': str(self.supervisor.user_id),
        }, format='json')
        self.assertEqual(r_correct.status_code, 200)

        # 2. Shelf Putaway rollback: Attempt to shelf into a foreign bin
        r_wrong_bin = self.client.post(f'{API}/ds-ops/shelf-putaway', {
            'lpn': 'TOTE-ERR-1',
            'placements': [{
                'bin': self.foreign_bin.location_id,
                'sku': str(self.sku.sku_id),
                'lot': str(self.lot.lot_id),
                'qty': 4,
            }],
        }, format='json')
        self.assertEqual(r_wrong_bin.status_code, 400)
        self.assertIn('does not belong to', r_wrong_bin.data['error'])

        # Transaction rolled back: LPN remains RECEIVED with full 4 units, foreign bin has 0 units
        lpn.refresh_from_db()
        self.assertEqual(lpn.status, 'RECEIVED')
        self.assertEqual(self._balance(self.ds, 'LPN', 'TOTE-ERR-1'), 4)
        self.assertEqual(self._balance(self.foreign_ds, 'BIN', self.foreign_bin.location_id), 0)



class SupplierInboundPutawayUiWorkflowTests(TestCase):
    """End-to-end live API journey for Supplier Inbound Receipt -> QC Inspection -> Putaway Placement.
    Traces the exact request sequence of InboundReceivingView, QcInspectionView, and PutawayView:
      1. Consignment creation via POST /supply/asns/ and POST /supply/asn-lines/.
      2. Receipt opening via POST /supply/grns/, POST /supply/grn-lines/, and PATCH /supply/asns/{id}/.
      3. Physical unit scanning via PATCH /supply/grn-lines/{id}/ (received_qty increments).
      4. Batch registration via POST /catalog/lots/ and linking via PATCH /supply/grn-lines/{id}/.
      5. GRN completion via POST /supply/grns/{id}/complete/ (uninspected stock creates 0 tasks, 0 balances).
      6. QC Inspection via POST /supply/qc-inspections/ and POST /supply/qc-inspections/{id}/verify/.
         - Only PASS units accepted; damaged units rejected and excluded from putaway.
         - PutawayTask automatically generated for accepted quantity.
      7. Putaway Assignment via POST /supply/putaway-tasks/{id}/assign/.
      8. Bin placement via POST /supply/putaway-tasks/{id}/place/ (split placement across bins, capacity checks).
      9. Putaway completion via POST /supply/putaway-tasks/{id}/complete/.
      10. Stock ledger verification: sellable stock in bins, inventory conserved.
      11. Retry idempotency (GRN complete, QC verify, Putaway complete).
      12. Atomic rollback on errors (uninspected close, overcapacity bin, premature complete, re-QC reduction).
      13. Outbox events & supervisor notification dispatch.
    """

    def setUp(self):
        from bounded.network.models import EmployeeSiteAssignment

        self.client = APIClient()
        self.operator = _user('inbound-op@zippzo.in', role='SUPER_ADMIN')
        self.worker = _user('putaway-worker@zippzo.in', role='WAREHOUSE_STAFF')
        self.supervisor = _user('wh-supervisor@zippzo.in', role='WAREHOUSE_STAFF')
        self.client.force_authenticate(user=self.operator)

        self.site = _site('MH-INBOUND-01', site_type='MOTHER_HUB')
        EmployeeSiteAssignment.objects.create(
            employee='EMP-IN-SUP', user=self.supervisor, site=self.site,
            mode='DARKHOUSE', role_at_site='STORE_MANAGER', is_primary=True, is_active=True,
        )
        EmployeeSiteAssignment.objects.create(
            employee='EMP-IN-WRK', user=self.worker, site=self.site,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True, is_active=True,
        )

        self.sku = _sku('SKU-IN-01', '5555555555551')

        # Bins: Bin 1 capacity 6, Bin 2 capacity 8
        self.bin1 = Location.objects.create(
            site=self.site, location_id='BIN-IN-01', location_type='BIN',
            aisle='I1', rack='R1', level='L1', position='P1',
            barcode='BIN-IN-01', capacity_qty=6, is_sellable_bin=True, created_by='test')

        self.bin2 = Location.objects.create(
            site=self.site, location_id='BIN-IN-02', location_type='BIN',
            aisle='I1', rack='R1', level='L1', position='P2',
            barcode='BIN-IN-02', capacity_qty=8, is_sellable_bin=True, created_by='test')

    def _balance(self, loc):
        return (StockBalance.objects
                .filter(site=self.site, container='BIN', container_ref=loc.location_id, sku=self.sku)
                .values_list('qty', flat=True).first() or 0)

    def _total_sellable(self):
        from django.db.models import Sum
        return StockBalance.objects.filter(site=self.site, sku=self.sku, sellable=True).aggregate(t=Sum('qty'))['t'] or 0

    def test_supplier_receipt_through_putaway_ui_journey_end_to_end(self):
        from bounded.supply.models import Asn, Grn, PutawayTask
        from bounded.notifications.models import Notification
        from bounded.notifications.publish import publish_batch

        # 0. Initial baseline: no stock
        self.assertEqual(self._balance(self.bin1), 0)
        self.assertEqual(self._balance(self.bin2), 0)
        self.assertEqual(self._total_sellable(), 0)

        # 1. UI Step: Consignment creation via POST /supply/asns/
        r_asn = self.client.post(f'{API}/supply/asns/', {
            'type': 'VENDOR_PO',
            'dest_site': str(self.site.site_id),
            'status': 'CONFIRMED',
        }, format='json')
        self.assertEqual(r_asn.status_code, 201)
        asn_id = r_asn.data['asn_id']
        asn_no = r_asn.data['asn_no']
        self.assertTrue(asn_no.startswith('ASN-'))

        # Add line via POST /supply/asn-lines/ (10 units expected)
        r_aline = self.client.post(f'{API}/supply/asn-lines/', {
            'asn': asn_id,
            'sku': str(self.sku.sku_id),
            'ean': self.sku.ean,
            'ordered_qty': 10,
        }, format='json')
        self.assertEqual(r_aline.status_code, 201)
        asn_line_id = r_aline.data['line_id']

        # 2. UI Step: Start receiving via POST /supply/grns/
        r_grn = self.client.post(f'{API}/supply/grns/', {
            'asn': asn_id,
            'mode': 'LPN_SCAN',
            'batch_code': 'LPN-IN-BATCH-01',
            'status': 'DRAFT',
        }, format='json')
        self.assertEqual(r_grn.status_code, 201)
        grn_id = r_grn.data['grn_id']
        grn_no = r_grn.data['grn_no']
        self.assertTrue(grn_no.startswith('GRN-'))

        # Initialize receipt line via POST /supply/grn-lines/
        r_gline = self.client.post(f'{API}/supply/grn-lines/', {
            'grn': grn_id,
            'asn_line': asn_line_id,
            'sku': str(self.sku.sku_id),
            'ordered_qty': 10,
            'received_qty': 0,
        }, format='json')
        self.assertEqual(r_gline.status_code, 201)
        grn_line_id = r_gline.data['line_id']

        # Update ASN status to GRN_IN_PROGRESS
        r_asn_prog = self.client.patch(f'{API}/supply/asns/{asn_id}/', {'status': 'GRN_IN_PROGRESS'}, format='json')
        self.assertEqual(r_asn_prog.status_code, 200)

        # 3. UI Step: Scan units (10 physical units received)
        r_scan = self.client.patch(f'{API}/supply/grn-lines/{grn_line_id}/', {'received_qty': 10}, format='json')
        self.assertEqual(r_scan.status_code, 200)
        self.assertEqual(r_scan.data['received_qty'], 10)

        # 4. UI Step: Register InventoryLot via POST /catalog/lots/
        r_lot = self.client.post(f'{API}/catalog/lots/', {
            'sku': str(self.sku.sku_id),
            'site': str(self.site.site_id),
            'batch_number': 'BATCH-PO-01',
            'inbound_type': 'VENDOR_PO',
            'inbound_ref': asn_no,
            'box_size': 1,
            'bucket': 'Good',
            'status': 'AVAILABLE',
        }, format='json')
        self.assertEqual(r_lot.status_code, 201)
        lot_id = r_lot.data['lot_id']

        # Link lot to GRN line with initial accepted_qty=0 (uninspected)
        r_link = self.client.patch(f'{API}/supply/grn-lines/{grn_line_id}/', {'accepted_qty': 0, 'lot': lot_id}, format='json')
        self.assertEqual(r_link.status_code, 200)

        # 5. UI Step: Complete Receiving via POST /supply/grns/{id}/complete/
        r_comp = self.client.post(f'{API}/supply/grns/{grn_id}/complete/', {}, format='json')
        self.assertEqual(r_comp.status_code, 200)
        self.assertEqual(r_comp.data['status'], 'COMPLETED')
        # Uninspected receiving creates 0 putaway tasks and 0 stock balances
        self.assertEqual(r_comp.data['putaway_task_count'], 0)
        self.assertEqual(self._total_sellable(), 0)

        asn = Asn.objects.get(pk=asn_id)
        self.assertEqual(asn.status, 'CLOSED')

        # Outbox event for GRN completion enqueued
        self.assertTrue(OutboxEvent.objects.filter(
            event_type='warehouse.grn.completed',
            aggregate_id=uuid.UUID(grn_id),
        ).exists())

        # 6. UI Step: QC Inspection
        r_qc = self.client.post(f'{API}/supply/qc-inspections/', {
            'grn_line': grn_line_id,
            'sample_size': 0,
            'pass_count': 0,
            'fail_count': 0,
            'status': 'IN_PROGRESS',
        }, format='json')
        self.assertEqual(r_qc.status_code, 201)
        qc_id = r_qc.data['qc_id']

        # Inspector inspects 10 units: 8 PASS, 2 FAIL (damaged)
        r_verify = self.client.post(f'{API}/supply/qc-inspections/{qc_id}/verify/', {
            'pass_count': 8,
            'fail_count': 2,
            'status': 'PARTIAL',
        }, format='json')
        self.assertEqual(r_verify.status_code, 200)
        self.assertEqual(r_verify.data['accepted_qty'], 8)
        self.assertEqual(r_verify.data['damaged_qty'], 2)
        self.assertEqual(r_verify.data['uninspected_qty'], 0)

        putaway_task_id = r_verify.data['putaway_task_id']
        self.assertIsNotNone(putaway_task_id)

        # Putaway task generated for the 8 accepted units ONLY
        task = PutawayTask.objects.get(task_id=putaway_task_id)
        self.assertEqual(task.qty, 8)
        self.assertEqual(task.placed_qty, 0)
        self.assertEqual(task.status, 'GENERATED')

        # Outbox event for QC discrepancy enqueued because 2 units were damaged
        self.assertTrue(OutboxEvent.objects.filter(
            event_type='warehouse.qc.exception',
            aggregate_id=uuid.UUID(qc_id),
        ).exists())

        # 7. UI Step: Worker assigns task via POST /supply/putaway-tasks/{id}/assign/
        r_assign = self.client.post(f'{API}/supply/putaway-tasks/{putaway_task_id}/assign/', {
            'user': str(self.worker.user_id),
        }, format='json')
        self.assertEqual(r_assign.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.status, 'ACCEPTED')
        self.assertEqual(str(task.assigned_to), str(self.worker.user_id))

        # 8. UI Step: Split Placement across Bins
        # Placement 1: Place 5 units into Bin 1 (capacity 6)
        r_place1 = self.client.post(f'{API}/supply/putaway-tasks/{putaway_task_id}/place/', {
            'destination_location_id': self.bin1.location_id,
            'qty': 5,
        }, format='json')
        self.assertEqual(r_place1.status_code, 200)
        self.assertEqual(r_place1.data['placed_qty'], 5)
        self.assertEqual(r_place1.data['remaining_qty'], 3)
        self.assertEqual(self._balance(self.bin1), 5)

        # Placement 2: Place remaining 3 units into Bin 2 (capacity 8)
        r_place2 = self.client.post(f'{API}/supply/putaway-tasks/{putaway_task_id}/place/', {
            'destination_location_id': self.bin2.location_id,
            'qty': 3,
        }, format='json')
        self.assertEqual(r_place2.status_code, 200)
        self.assertEqual(r_place2.data['placed_qty'], 8)
        self.assertEqual(r_place2.data['remaining_qty'], 0)
        self.assertEqual(self._balance(self.bin2), 3)

        # Total stock placed so far: 8 units in bins
        self.assertEqual(self._total_sellable(), 8)

        # 9. UI Step: Complete Putaway Task via POST /supply/putaway-tasks/{id}/complete/
        r_pcomp = self.client.post(f'{API}/supply/putaway-tasks/{putaway_task_id}/complete/', {
            'destination_location_id': self.bin2.location_id,
        }, format='json')
        self.assertEqual(r_pcomp.status_code, 200)
        self.assertEqual(r_pcomp.data['status'], 'CONFIRMED')

        task.refresh_from_db()
        self.assertEqual(task.status, 'CONFIRMED')

        # 10. Ledger verification:
        # Bin 1 has 5, Bin 2 has 3. Total network sellable inventory = 8.
        # The 2 damaged units were quarantined and never entered sellable bins.
        self.assertEqual(self._balance(self.bin1), 5)
        self.assertEqual(self._balance(self.bin2), 3)
        self.assertEqual(self._total_sellable(), 8)

        # 11. Outbox events & supervisor notifications:
        task_uuid = uuid.UUID(putaway_task_id)
        self.assertTrue(OutboxEvent.objects.filter(
            event_type='warehouse.putaway.completed',
            aggregate_id=task_uuid,
        ).exists())

        publish_batch()
        self.assertTrue(Notification.objects.filter(
            user=str(self.supervisor.user_id),
            type='PUTAWAY_COMPLETED',
        ).exists())

    def test_inbound_retry_idempotency_across_lifecycle(self):
        from bounded.supply.models import PutawayTask

        # Setup ASN and GRN with 4 units received
        r_asn = self.client.post(f'{API}/supply/asns/', {'type': 'VENDOR_PO', 'dest_site': str(self.site.site_id), 'status': 'CONFIRMED'}, format='json')
        asn_id = r_asn.data['asn_id']
        r_aline = self.client.post(f'{API}/supply/asn-lines/', {'asn': asn_id, 'sku': str(self.sku.sku_id), 'ordered_qty': 4}, format='json')
        r_grn = self.client.post(f'{API}/supply/grns/', {'asn': asn_id, 'mode': 'LPN_SCAN', 'status': 'DRAFT'}, format='json')
        grn_id = r_grn.data['grn_id']
        r_gline = self.client.post(f'{API}/supply/grn-lines/', {'grn': grn_id, 'asn_line': r_aline.data['line_id'], 'sku': str(self.sku.sku_id), 'ordered_qty': 4, 'received_qty': 4}, format='json')
        gline_id = r_gline.data['line_id']

        r_lot = self.client.post(f'{API}/catalog/lots/', {'sku': str(self.sku.sku_id), 'site': str(self.site.site_id), 'batch_number': 'B-RETRY-01', 'inbound_type': 'PO'}, format='json')
        self.client.patch(f'{API}/supply/grn-lines/{gline_id}/', {'accepted_qty': 0, 'lot': r_lot.data['lot_id']}, format='json')

        # 1. GRN complete replay is idempotent
        r_c1 = self.client.post(f'{API}/supply/grns/{grn_id}/complete/', {}, format='json')
        self.assertEqual(r_c1.status_code, 200)
        r_c2 = self.client.post(f'{API}/supply/grns/{grn_id}/complete/', {}, format='json')
        self.assertEqual(r_c2.status_code, 200)
        self.assertTrue(r_c2.data.get('already_completed'))

        # 2. QC verify replay
        r_qc = self.client.post(f'{API}/supply/qc-inspections/', {'grn_line': gline_id, 'sample_size': 0, 'pass_count': 0, 'fail_count': 0, 'status': 'IN_PROGRESS'}, format='json')
        qc_id = r_qc.data['qc_id']
        r_v1 = self.client.post(f'{API}/supply/qc-inspections/{qc_id}/verify/', {'pass_count': 4, 'fail_count': 0, 'status': 'PASSED'}, format='json')
        self.assertEqual(r_v1.status_code, 200)
        task_id = r_v1.data['putaway_task_id']

        # Replaying verify does not duplicate the task
        r_v2 = self.client.post(f'{API}/supply/qc-inspections/{qc_id}/verify/', {'pass_count': 4, 'fail_count': 0, 'status': 'PASSED'}, format='json')
        self.assertEqual(r_v2.status_code, 200)
        self.assertEqual(PutawayTask.objects.filter(grn_line_id=gline_id).count(), 1)

        # 3. Place all 4 units into Bin 1
        self.client.post(f'{API}/supply/putaway-tasks/{task_id}/place/', {'destination_location_id': self.bin1.location_id, 'qty': 4}, format='json')
        self.assertEqual(self._balance(self.bin1), 4)

        # 4. Putaway complete replay
        r_pc1 = self.client.post(f'{API}/supply/putaway-tasks/{task_id}/complete/', {'destination_location_id': self.bin1.location_id}, format='json')
        self.assertEqual(r_pc1.status_code, 200)
        self.assertEqual(r_pc1.data['status'], 'CONFIRMED')

        r_pc2 = self.client.post(f'{API}/supply/putaway-tasks/{task_id}/complete/', {'destination_location_id': self.bin1.location_id}, format='json')
        self.assertEqual(r_pc2.status_code, 200)
        self.assertEqual(r_pc2.data['status'], 'CONFIRMED')

        # Stock is never double-counted on replaying completion
        self.assertEqual(self._balance(self.bin1), 4)

    def test_inbound_rollback_and_safety_guards(self):
        from bounded.supply.models import PutawayTask

        # Setup ASN and GRN
        r_asn = self.client.post(f'{API}/supply/asns/', {'type': 'VENDOR_PO', 'dest_site': str(self.site.site_id), 'status': 'CONFIRMED'}, format='json')
        asn_id = r_asn.data['asn_id']
        r_aline = self.client.post(f'{API}/supply/asn-lines/', {'asn': asn_id, 'sku': str(self.sku.sku_id), 'ordered_qty': 5}, format='json')
        r_grn = self.client.post(f'{API}/supply/grns/', {'asn': asn_id, 'mode': 'LPN_SCAN', 'status': 'DRAFT'}, format='json')
        grn_id = r_grn.data['grn_id']
        r_gline = self.client.post(f'{API}/supply/grn-lines/', {'grn': grn_id, 'asn_line': r_aline.data['line_id'], 'sku': str(self.sku.sku_id), 'ordered_qty': 5, 'received_qty': 0}, format='json')
        gline_id = r_gline.data['line_id']

        # 1. Guard: Closing GRN with received_qty=0 is refused (400)
        r_bad_comp = self.client.post(f'{API}/supply/grns/{grn_id}/complete/', {}, format='json')
        self.assertEqual(r_bad_comp.status_code, 400)
        self.assertIn('received_qty', r_bad_comp.data['detail'])

        # Now record 5 units received
        self.client.patch(f'{API}/supply/grn-lines/{gline_id}/', {'received_qty': 5}, format='json')
        r_lot = self.client.post(f'{API}/catalog/lots/', {'sku': str(self.sku.sku_id), 'site': str(self.site.site_id), 'batch_number': 'B-GUARD-01', 'inbound_type': 'PO'}, format='json')
        self.client.patch(f'{API}/supply/grn-lines/{gline_id}/', {'accepted_qty': 0, 'lot': r_lot.data['lot_id']}, format='json')
        self.client.post(f'{API}/supply/grns/{grn_id}/complete/', {}, format='json')

        # QC accepts 5 units
        r_qc = self.client.post(f'{API}/supply/qc-inspections/', {'grn_line': gline_id, 'sample_size': 0, 'pass_count': 0, 'fail_count': 0, 'status': 'IN_PROGRESS'}, format='json')
        qc_id = r_qc.data['qc_id']
        r_ver = self.client.post(f'{API}/supply/qc-inspections/{qc_id}/verify/', {'pass_count': 5, 'fail_count': 0, 'status': 'PASSED'}, format='json')
        task_id = r_ver.data['putaway_task_id']

        # 2. Guard: Place overcapacity is refused (Bin 1 capacity is 6, attempt to place 7)
        r_overcap = self.client.post(f'{API}/supply/putaway-tasks/{task_id}/place/', {'destination_location_id': self.bin1.location_id, 'qty': 7}, format='json')
        self.assertEqual(r_overcap.status_code, 400)
        self.assertEqual(self._balance(self.bin1), 0)

        # Place 3 units into Bin 1 (valid)
        r_p1 = self.client.post(f'{API}/supply/putaway-tasks/{task_id}/place/', {'destination_location_id': self.bin1.location_id, 'qty': 3}, format='json')
        self.assertEqual(r_p1.status_code, 200)
        self.assertEqual(self._balance(self.bin1), 3)

        # 3. Guard: Premature complete before all units placed is refused (3 of 5 placed)
        r_precomp = self.client.post(f'{API}/supply/putaway-tasks/{task_id}/complete/', {'destination_location_id': self.bin1.location_id}, format='json')
        self.assertEqual(r_precomp.status_code, 400)
        self.assertIn('still to place', r_precomp.data['detail'])
        task = PutawayTask.objects.get(task_id=task_id)
        self.assertEqual(task.status, 'IN_PROGRESS')

        # 4. Guard: Re-QC cannot reduce accepted quantity below units already placed (placed=3, attempt pass_count=2)
        r_bad_qc = self.client.post(f'{API}/supply/qc-inspections/{qc_id}/verify/', {'pass_count': 2, 'fail_count': 3, 'status': 'PARTIAL'}, format='json')
        self.assertEqual(r_bad_qc.status_code, 400)
        self.assertIn('already placed', r_bad_qc.data['detail'])

        # Stock balance remains intact at 3 units
        self.assertEqual(self._balance(self.bin1), 3)


class CustomerOrderFulfillmentWorkflowTests(TestCase):
    """Customer order picking through packing and rider handoff live UI/API journey.

    Traces the entire customer order journey end to end via public REST APIs:
      1. Customer places order: POST /api/orders/checkout (prices via listing, allocates bin stock, creates pick task)
      2. Dark store staff assigns pick: POST /api/ds-ops/pick-tasks/{id}/assign/ (notifies picker)
      3. Picker reads route: GET /api/ds-ops/pick-lines?order_id={id}
      4. Picker scans units: POST /api/ds-ops/pick-line (decrements bin stock in ledger, completes pick task)
      5. Picker completes pick: POST /api/ds-ops/order-action (COMPLETE_PICK advances order to PICKED)
      6. Staff packs and seals tote: POST /api/ds-ops/pack-order (moves stock to LPN, stages tote, creates delivery task)
      7. Rider accepts job: POST /api/delivery/delivery-tasks/{id}/accept/ (advances order to RIDER_ASSIGNED)
      8. Rider collects tote from DS staging: POST /api/delivery/handoff/pickup (LPN moves to transit, custody to rider)
      9. Rider updates transit: POST /api/delivery/delivery-tasks/{id}/advance/ (EN_ROUTE -> ARRIVED)
     10. Delivery POD flow: POST /api/delivery/handoff/pod (mints OTP -> customer retrieves -> rider submits with COD)
     11. Final settlement: Order DELIVERED, COD cash captured, tote returned empty to store pool.
     12. In-app notifications: Checked for customer and relevant staff.
    """

    @classmethod
    def setUpTestData(cls):
        import datetime
        from bounded.catalog.models import Listing
        from bounded.delivery.models import RiderProfile
        from bounded.network.models import EmployeeSiteAssignment
        from bounded.orders.models import Customer, CustomerAddress

        # Stores
        cls.ds_site = Site.objects.create(
            code='DS-BLR-01', site_type='DS', name='Bengaluru Dark Store 1', address='1 Koramangala',
            is_accepting_orders=True, status='ACTIVE')
        cls.other_site = Site.objects.create(
            code='DS-MUM-01', site_type='DS', name='Mumbai Dark Store 1', address='2 Andheri',
            is_accepting_orders=True, status='ACTIVE')
        DeliveryArea.objects.create(site=cls.ds_site, pincode='560034', band='CORE')
        DeliveryArea.objects.create(site=cls.other_site, pincode='560034', band='CORE')

        # Sellable shelf location
        cls.shelf_bin = Location.objects.create(
            site=cls.ds_site, location_id='BIN-DS-01', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='BIN-DS-01', is_sellable_bin=True, created_by='fixture')

        # SKU & Fresh Lot
        cls.sku = Sku.objects.create(
            sku_code='SKU-MILK-1L', name='Farm Fresh Milk 1L', ean='8901234567890',
            mrp=Decimal('55.00'), weight_g=1000, status='ACTIVE')
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.ds_site, batch_number='LOT-MILK-101',
            bucket='Good', expiry_date=datetime.date.today() + datetime.timedelta(days=15),
            inbound_type='PO')

        # Storefront listing
        Listing.objects.create(
            site=cls.ds_site, sku=cls.sku, price=Decimal('50.00'), mrp=Decimal('55.00'),
            is_listed=True, is_available=True)

        # Baseline stock in bin: 10 units
        apply_stock(
            site=cls.ds_site, sku=cls.sku, lot=cls.lot, qty=10,
            direction='IN', movement_type='INITIAL',
            ref_type='FIXTURE', ref_id='SETUP-INIT',
            container='BIN', container_ref=cls.shelf_bin.location_id,
            sellable=True)

        # Empty reusable tote at DS
        cls.tote = LpnMaster.objects.create(
            lpn_id='TOTE-DS-01', barcode='LPN-TOTE-DS-01', lpn_type='TOTE',
            current_site=cls.ds_site, status='EMPTY', created_by='fixture')

        # Customer User & Profile
        cls.shopper_user = User.objects.create(
            email='shopper.alice@zippzo.in', password_hash=make_password('Pass123!'),
            role='CUSTOMER', status='ACTIVE', full_name='Alice Shopper')
        cls.customer = Customer.objects.create(
            user=cls.shopper_user, name='Alice Shopper', trust_tier='T1')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='100 1st Cross, Koramangala',
            city='Bengaluru', pincode='560034', is_default=True)

        # Floor staff at DS-BLR-01
        cls.picker_user = User.objects.create(
            email='picker.raj@zippzo.in', password_hash=make_password('Pass123!'),
            role='OPERATOR', status='ACTIVE', full_name='Raj Picker')
        EmployeeSiteAssignment.objects.create(
            employee='EMP-PICK-01', user=cls.picker_user, site=cls.ds_site,
            mode='DARKHOUSE', role_at_site='OPERATOR', is_primary=True, is_active=True)

        cls.packer_user = User.objects.create(
            email='packer.suman@zippzo.in', password_hash=make_password('Pass123!'),
            role='OPERATOR', status='ACTIVE', full_name='Suman Packer')
        EmployeeSiteAssignment.objects.create(
            employee='EMP-PACK-01', user=cls.packer_user, site=cls.ds_site,
            mode='DARKHOUSE', role_at_site='OPERATOR', is_primary=True, is_active=True)

        # Cross-store operator at DS-MUM-01
        cls.other_operator = User.objects.create(
            email='other.mumbai@zippzo.in', password_hash=make_password('Pass123!'),
            role='OPERATOR', status='ACTIVE', full_name='Mumbai Operator')
        EmployeeSiteAssignment.objects.create(
            employee='EMP-MUM-01', user=cls.other_operator, site=cls.other_site,
            mode='DARKHOUSE', role_at_site='OPERATOR', is_primary=True, is_active=True)

        # Assigned & Rival riders at DS-BLR-01
        cls.rider_user = User.objects.create(
            email='rider.bob@zippzo.in', password_hash=make_password('Pass123!'),
            role='RIDER', status='ACTIVE', full_name='Bob Rider')
        cls.rider_profile = RiderProfile.objects.create(
            user=cls.rider_user, name='Bob Rider', phone='9811111111',
            vehicle_type='BIKE', is_online=True, current_site=cls.ds_site,
            kyc_status='VERIFIED')

        cls.rival_rider_user = User.objects.create(
            email='rider.charlie@zippzo.in', password_hash=make_password('Pass123!'),
            role='RIDER', status='ACTIVE', full_name='Charlie Rider')
        cls.rival_rider_profile = RiderProfile.objects.create(
            user=cls.rival_rider_user, name='Charlie Rider', phone='9822222222',
            vehicle_type='BIKE', is_online=True, current_site=cls.ds_site,
            kyc_status='VERIFIED')

    def setUp(self):
        self.client = APIClient()

    def _shelf_qty(self):
        b = StockBalance.objects.filter(
            site=self.ds_site, container='BIN', container_ref=self.shelf_bin.location_id,
            sku=self.sku, lot=self.lot).first()
        return b.qty if b else 0

    def _tote_qty(self):
        b = StockBalance.objects.filter(
            site=self.ds_site, container='LPN', container_ref=self.tote.lpn_id,
            sku=self.sku, lot=self.lot).first()
        return b.qty if b else 0

    def test_customer_order_full_journey_to_rider_delivery_otp(self):
        from bounded.delivery.models import DeliveryTask
        from bounded.ds_ops.models import OrderLineAllocation, PickTask
        from bounded.lastmile.models import PODEvidence
        from bounded.money.models import CashMovement, Payment, RiderCustodyState, RiderEarnings
        from bounded.notifications.models import Notification
        from bounded.notifications.publish import publish_batch
        from bounded.orders.models import CustomerOrder, CustomerOrderLine

        # ── Step 1: Customer checkout ─────────────────────────────────────────
        self.client.force_authenticate(self.shopper_user)
        r_checkout = self.client.post(f'{API}/orders/checkout', {
            'site': self.ds_site.code,
            'address_id': str(self.address.address_id),
            'items': [{'sku_id': str(self.sku.sku_id), 'qty': 2}],
            'payment_method': 'COD',
        }, format='json')
        self.assertEqual(r_checkout.status_code, 201, r_checkout.data)
        order_id = r_checkout.data['order_id']
        order_no = r_checkout.data['order_no']
        self.assertEqual(r_checkout.data['status'], 'CONFIRMED')
        self.assertEqual(r_checkout.data['grand_total'], '120.00')  # 2 * 50 + 20 delivery fee

        order = CustomerOrder.objects.get(order_id=order_id)
        self.assertEqual(order.status, 'CONFIRMED')

        # Reserved stock allocation exists immediately
        alloc = OrderLineAllocation.objects.filter(order=order, location_id=self.shelf_bin.location_id).first()
        self.assertIsNotNone(alloc)
        self.assertEqual(alloc.qty, 2)
        self.assertEqual(self._shelf_qty(), 10)  # Physical balance unchanged until scan

        # PickTask exists for dark store queue
        pick_task = PickTask.objects.filter(order=order, sku=self.sku.sku_id).first()
        self.assertIsNotNone(pick_task)
        self.assertEqual(pick_task.qty, 2)
        self.assertEqual(pick_task.status, 'NOT_STARTED')

        # ── Step 2: Dark store pick assignment & unit scans ───────────────────
        self.client.force_authenticate(self.picker_user)
        r_assign = self.client.post(
            f'{API}/ds-ops/pick-tasks/{pick_task.pk}/assign/',
            {'user': str(self.picker_user.user_id)}, format='json')
        self.assertEqual(r_assign.status_code, 200)
        pick_task.refresh_from_db()
        self.assertEqual(pick_task.status, 'IN_PROGRESS')
        self.assertEqual(str(pick_task.assigned_to), str(self.picker_user.user_id))

        # Picker queries lines
        r_lines = self.client.get(f'{API}/ds-ops/pick-lines?order_id={order_id}')
        self.assertEqual(r_lines.status_code, 200)
        line_item = r_lines.data['lines'][0]
        line_id = line_item['line_id']
        self.assertEqual(line_item['outstanding'], 2)
        self.assertEqual(line_item['bin_location_id'], self.shelf_bin.location_id)

        # Scan Unit 1
        r_scan1 = self.client.post(f'{API}/ds-ops/pick-line', {
            'order_id': order_id,
            'line_id': line_id,
            'bin_location_id': self.shelf_bin.location_id,
            'qty': 1,
            'scan_id': 'scan-unit-1',
        }, format='json')
        self.assertEqual(r_scan1.status_code, 200)
        self.assertEqual(r_scan1.data['picked_qty'], 1)
        self.assertEqual(r_scan1.data['outstanding'], 1)
        self.assertEqual(self._shelf_qty(), 9)  # Ledger immediately decrements

        # Scan Unit 2
        r_scan2 = self.client.post(f'{API}/ds-ops/pick-line', {
            'order_id': order_id,
            'line_id': line_id,
            'bin_location_id': self.shelf_bin.location_id,
            'qty': 1,
            'scan_id': 'scan-unit-2',
        }, format='json')
        self.assertEqual(r_scan2.status_code, 200)
        self.assertEqual(r_scan2.data['picked_qty'], 2)
        self.assertEqual(r_scan2.data['outstanding'], 0)
        self.assertEqual(r_scan2.data['line_status'], 'PICKED')
        self.assertEqual(self._shelf_qty(), 8)  # Shelf stock is now 8

        # PickTask is COMPLETED
        pick_task.refresh_from_db()
        self.assertEqual(pick_task.status, 'COMPLETED')

        # Complete Pick action
        r_pick_comp = self.client.post(f'{API}/ds-ops/order-action', {
            'order_id': order_id,
            'action': 'COMPLETE_PICK',
            'picker': str(self.picker_user.user_id),
        }, format='json')
        self.assertEqual(r_pick_comp.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, 'PICKED')

        # ── Step 3: Dark store pack and seal into tote ─────────────────────────
        self.client.force_authenticate(self.packer_user)
        r_pack = self.client.post(f'{API}/ds-ops/pack-order', {
            'order_id': order_id,
            'lpn_barcode': self.tote.barcode,
            'staging_bin': 'STAGE-BLR-01',
        }, format='json')
        self.assertEqual(r_pack.status_code, 200, r_pack.data)
        self.assertEqual(r_pack.data['status'], 'PACKED')
        self.assertEqual(r_pack.data['tote_qty'], 2)

        order.refresh_from_db()
        self.assertEqual(order.status, 'PACKED')

        self.tote.refresh_from_db()
        self.assertEqual(self.tote.status, 'STAGED')
        self.assertEqual(self._tote_qty(), 2)

        delivery_task_id = r_pack.data['delivery_task']['task_id']
        del_task = DeliveryTask.objects.get(task_id=delivery_task_id)
        self.assertEqual(del_task.status, 'ACCEPTED')
        self.assertEqual(del_task.staging_bin, 'STAGE-BLR-01')

        # ── Step 4: Rider accepts delivery task ───────────────────────────────
        self.client.force_authenticate(self.rider_user)
        r_accept = self.client.post(
            f'{API}/delivery/delivery-tasks/{delivery_task_id}/accept/', {}, format='json')
        self.assertEqual(r_accept.status_code, 200)
        del_task.refresh_from_db()
        self.assertEqual(del_task.status, 'ACCEPTED')
        self.assertEqual(del_task.rider_id, self.rider_profile.rider_id)

        order.refresh_from_db()
        self.assertEqual(order.status, 'RIDER_ASSIGNED')

        # ── Step 5: Rider collects tote from DS staging ───────────────────────
        r_pickup = self.client.post(f'{API}/delivery/handoff/pickup', {
            'task_id': delivery_task_id,
            'lpn_barcode': self.tote.barcode,
        }, format='json')
        self.assertEqual(r_pickup.status_code, 200)
        del_task.refresh_from_db()
        self.assertEqual(del_task.status, 'PICKED_UP')

        order.refresh_from_db()
        self.assertEqual(order.status, 'PICKED_UP')

        # Dark store tote stock is relieved; tote moves to transit
        self.assertEqual(self._tote_qty(), 0)
        self.tote.refresh_from_db()
        self.assertEqual(self.tote.status, 'IN_TRANSIT')
        self.assertIsNone(self.tote.current_site)

        # Rider custody updated
        custody = RiderCustodyState.objects.get(rider_id=self.rider_profile.rider_id)
        self.assertEqual(custody.bags_in_custody, 1)

        # ── Step 6: Rider updates transit & arrives ───────────────────────────
        r_enroute = self.client.post(
            f'{API}/delivery/delivery-tasks/{delivery_task_id}/advance/',
            {'to': 'EN_ROUTE'}, format='json')
        self.assertEqual(r_enroute.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, 'OUT_FOR_DELIVERY')

        r_arrived = self.client.post(
            f'{API}/delivery/delivery-tasks/{delivery_task_id}/advance/',
            {'to': 'ARRIVED'}, format='json')
        self.assertEqual(r_arrived.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, 'ARRIVED')

        # ── Step 7: Delivery POD flow (OTP minting & handoff) ─────────────────
        # Rider attempts completion without OTP -> triggers minting & returns 409
        r_pod_req = self.client.post(f'{API}/delivery/handoff/pod', {
            'task_id': delivery_task_id,
        }, format='json')
        self.assertEqual(r_pod_req.status_code, 409)
        self.assertTrue(r_pod_req.data.get('otp_required'))
        del_task.refresh_from_db()
        self.assertEqual(del_task.status, 'POD_PENDING')

        # Customer reads their delivery code
        self.client.force_authenticate(self.shopper_user)
        r_code = self.client.get(f'{API}/orders/orders/{order_id}/delivery-code/')
        self.assertEqual(r_code.status_code, 200)
        self.assertEqual(r_code.data['state'], 'ready')
        otp = r_code.data['code']
        self.assertIsNotNone(otp)
        self.assertEqual(len(otp), 6)

        # Rider submits customer OTP with COD collected
        self.client.force_authenticate(self.rider_user)
        r_pod_close = self.client.post(f'{API}/delivery/handoff/pod', {
            'task_id': delivery_task_id,
            'otp': otp,
            'cod_amount': '120.00',
            'method': 'PIN',
        }, format='json')
        self.assertEqual(r_pod_close.status_code, 200)
        self.assertEqual(r_pod_close.data['status'], 'DELIVERED')
        self.assertEqual(r_pod_close.data['payment_status'], 'CAPTURED')

        order.refresh_from_db()
        self.assertEqual(order.status, 'DELIVERED')
        self.assertEqual(order.payment_status, 'CAPTURED')
        self.assertIsNone(order.pod_otp_hash)  # OTP hash is spent and cleared

        del_task.refresh_from_db()
        self.assertEqual(del_task.status, 'DELIVERED')

        # Tote is returned empty to store pool
        self.tote.refresh_from_db()
        self.assertEqual(self.tote.status, 'EMPTY')
        self.assertEqual(self.tote.current_site, self.ds_site)

        # Cash & evidence settlements
        custody.refresh_from_db()
        self.assertEqual(custody.bags_in_custody, 0)
        self.assertEqual(custody.current_cash, Decimal('120.00'))

        self.assertTrue(Payment.objects.filter(
            order=order, status='CAPTURED', amount=Decimal('120.00')).exists())
        self.assertTrue(CashMovement.objects.filter(
            ref_id=str(order.order_id), movement_type='COD_COLLECT').exists())
        self.assertTrue(PODEvidence.objects.filter(
            task=del_task, otp_verified=True).exists())
        self.assertTrue(RiderEarnings.objects.filter(
            order=order, status='PENDING', delivery_fee=Decimal('20.00')).exists())

        # ── Step 8: In-app notifications verification ─────────────────────────
        publish_batch()

        # Customer inbox
        self.client.force_authenticate(self.shopper_user)
        r_c_notifs = self.client.get(f'{API}/notifications/notifications/')
        self.assertEqual(r_c_notifs.status_code, 200)
        c_types = {n['type'] for n in r_c_notifs.data['results'] if 'type' in n}
        expected_customer_types = {
            'ORDER_PLACED', 'ORDER_PACKED', 'RIDER_ASSIGNED',
            'ORDER_ON_THE_WAY', 'RIDER_ARRIVED', 'DELIVERY_OTP', 'ORDER_DELIVERED'
        }
        self.assertTrue(expected_customer_types.issubset(c_types),
                        f"Missing customer notification types: {expected_customer_types - c_types}")

        # Picker inbox
        self.client.force_authenticate(self.picker_user)
        r_p_notifs = self.client.get(f'{API}/notifications/notifications/')
        self.assertEqual(r_p_notifs.status_code, 200)
        p_types = {n['type'] for n in r_p_notifs.data['results'] if 'type' in n}
        self.assertIn('PICK_TASK_ASSIGNED', p_types)

    def test_customer_order_journey_safety_and_rollback_guards(self):
        from bounded.delivery.models import DeliveryTask
        from bounded.ds_ops.models import PickTask
        from bounded.orders.models import CustomerOrder

        # 1. Guard: Insufficient stock at checkout refused (409)
        self.client.force_authenticate(self.shopper_user)
        r_short = self.client.post(f'{API}/orders/checkout', {
            'site': self.ds_site.code,
            'address_id': str(self.address.address_id),
            'items': [{'sku_id': str(self.sku.sku_id), 'qty': 20}],
            'payment_method': 'COD',
        }, format='json')
        self.assertEqual(r_short.status_code, 409)
        self.assertIn('not enough shelved stock', r_short.data['error'])

        # 2. Guard: Non-customer login cannot checkout as customer
        self.client.force_authenticate(self.picker_user)
        r_staff = self.client.post(f'{API}/orders/checkout', {
            'site': self.ds_site.code,
            'items': [{'sku_id': str(self.sku.sku_id), 'qty': 1}],
        }, format='json')
        self.assertEqual(r_staff.status_code, 403)
        self.assertIn('No customer account', r_staff.data['error'])

        admin_guard = User.objects.create(
            email='admin.guard@zippzo.in', password_hash=make_password('Pass123!'),
            role='ADMIN', status='ACTIVE')
        self.client.force_authenticate(admin_guard)
        r_admin = self.client.post(f'{API}/orders/checkout', {
            'site': self.ds_site.code,
            'items': [{'sku_id': str(self.sku.sku_id), 'qty': 1}],
        }, format='json')
        self.assertEqual(r_admin.status_code, 400)
        self.assertIn('Log in as the shopper', r_admin.data['error'])

        # Place valid order of 1 unit
        self.client.force_authenticate(self.shopper_user)
        r_ok = self.client.post(f'{API}/orders/checkout', {
            'site': self.ds_site.code,
            'address_id': str(self.address.address_id),
            'items': [{'sku_id': str(self.sku.sku_id), 'qty': 1}],
            'payment_method': 'COD',
        }, format='json')
        self.assertEqual(r_ok.status_code, 201)
        order_id = r_ok.data['order_id']
        order = CustomerOrder.objects.get(order_id=order_id)

        # 3. Guard: Cross-store operator blocked from picking DS-BLR-01 order (403)
        self.client.force_authenticate(self.other_operator)
        r_cross = self.client.get(f'{API}/ds-ops/pick-lines?order_id={order_id}')
        self.assertEqual(r_cross.status_code, 403)

        # 4. Guard: Scan wrong bin during pick refused (409)
        self.client.force_authenticate(self.picker_user)
        line = order.lines.first()
        r_wrong_bin = self.client.post(f'{API}/ds-ops/pick-line', {
            'order_id': order_id,
            'line_id': str(line.line_id),
            'bin_location_id': 'BIN-NONEXISTENT',
            'qty': 1,
            'scan_id': 'scan-wrong-bin',
        }, format='json')
        self.assertEqual(r_wrong_bin.status_code, 409)
        self.assertEqual(self._shelf_qty(), 10)  # Shelf stock unchanged by rejected scan

        # 5. Guard: Premature COMPLETE_PICK before line picked refused (409)
        r_pre_pick = self.client.post(f'{API}/ds-ops/order-action', {
            'order_id': order_id,
            'action': 'COMPLETE_PICK',
            'picker': str(self.picker_user.user_id),
        }, format='json')
        self.assertEqual(r_pre_pick.status_code, 409)
        self.assertIn('not fully picked', r_pre_pick.data['error'])

        # Pick the 1 unit properly
        self.client.post(f'{API}/ds-ops/pick-line', {
            'order_id': order_id,
            'line_id': str(line.line_id),
            'bin_location_id': self.shelf_bin.location_id,
            'qty': 1,
            'scan_id': 'scan-guard-1',
        }, format='json')
        self.client.post(f'{API}/ds-ops/order-action', {
            'order_id': order_id,
            'action': 'COMPLETE_PICK',
            'picker': str(self.picker_user.user_id),
        }, format='json')
        order.refresh_from_db()
        self.assertEqual(order.status, 'PICKED')

        # 6. Guard: Packing into non-empty tote refused (409)
        busy_tote = LpnMaster.objects.create(
            lpn_id='TOTE-BUSY-01', barcode='LPN-TOTE-BUSY-01', lpn_type='TOTE',
            current_site=self.ds_site, status='STAGED')
        self.client.force_authenticate(self.packer_user)
        r_busy_pack = self.client.post(f'{API}/ds-ops/pack-order', {
            'order_id': order_id,
            'lpn_barcode': busy_tote.barcode,
            'staging_bin': 'STAGE-01',
        }, format='json')
        self.assertEqual(r_busy_pack.status_code, 409)
        self.assertIn('not empty', r_busy_pack.data['error'])

        # Pack into empty tote
        r_pack = self.client.post(f'{API}/ds-ops/pack-order', {
            'order_id': order_id,
            'lpn_barcode': self.tote.barcode,
            'staging_bin': 'STAGE-01',
        }, format='json')
        self.assertEqual(r_pack.status_code, 200)
        delivery_task_id = r_pack.data['delivery_task']['task_id']

        # 7. Guard: Assignment conflict between riders (409)
        self.client.force_authenticate(self.rider_user)
        r_accept1 = self.client.post(
            f'{API}/delivery/delivery-tasks/{delivery_task_id}/accept/', {}, format='json')
        self.assertEqual(r_accept1.status_code, 200)

        # Rival rider tries to accept the same task: refused (404 via queryset isolation or 409 conflict)
        self.client.force_authenticate(self.rival_rider_user)
        r_accept2 = self.client.post(
            f'{API}/delivery/delivery-tasks/{delivery_task_id}/accept/', {}, format='json')
        self.assertIn(r_accept2.status_code, (404, 409))

        # 8. Guard: Wrong tote scanned at pickup refused (409)
        self.client.force_authenticate(self.rider_user)
        r_bad_pickup = self.client.post(f'{API}/delivery/handoff/pickup', {
            'task_id': delivery_task_id,
            'lpn_barcode': 'LPN-TOTE-BUSY-01',
        }, format='json')
        self.assertEqual(r_bad_pickup.status_code, 409)
        self.assertIn('Wrong tote', r_bad_pickup.data['error'])

        # Proper pickup & advance
        self.client.post(f'{API}/delivery/handoff/pickup', {
            'task_id': delivery_task_id,
            'lpn_barcode': self.tote.barcode,
        }, format='json')
        self.client.post(f'{API}/delivery/delivery-tasks/{delivery_task_id}/advance/',
                         {'to': 'EN_ROUTE'}, format='json')
        self.client.post(f'{API}/delivery/delivery-tasks/{delivery_task_id}/advance/',
                         {'to': 'ARRIVED'}, format='json')

        # Request OTP
        self.client.post(f'{API}/delivery/handoff/pod', {'task_id': delivery_task_id}, format='json')

        # 9. Guard: Non-customer denied delivery code (404)
        self.client.force_authenticate(self.rider_user)
        r_snoop = self.client.get(f'{API}/orders/orders/{order_id}/delivery-code/')
        self.assertEqual(r_snoop.status_code, 404)

        # 10. Guard: Invalid OTP on delivery rejected (400)
        r_wrong_otp = self.client.post(f'{API}/delivery/handoff/pod', {
            'task_id': delivery_task_id,
            'otp': '000000',
            'cod_amount': '70.00',
        }, format='json')
        self.assertEqual(r_wrong_otp.status_code, 400)
        self.assertIn('does not match', r_wrong_otp.data['error'])
        order.refresh_from_db()
        self.assertNotEqual(order.status, 'DELIVERED')

        # 11. Guard: Invalid/negative COD amount rejected (400)
        self.client.force_authenticate(self.shopper_user)
        real_otp = self.client.get(f'{API}/orders/orders/{order_id}/delivery-code/').data['code']
        self.client.force_authenticate(self.rider_user)
        r_bad_cod = self.client.post(f'{API}/delivery/handoff/pod', {
            'task_id': delivery_task_id,
            'otp': real_otp,
            'cod_amount': '-10.00',
        }, format='json')
        self.assertEqual(r_bad_cod.status_code, 400)
        self.assertIn('cannot be negative', r_bad_cod.data['error'])
        order.refresh_from_db()
        self.assertNotEqual(order.status, 'DELIVERED')

    def test_customer_order_idempotent_retries_and_replay_safety(self):
        from bounded.delivery.models import DeliveryTask
        from bounded.orders.models import CustomerOrder

        # Checkout 1 unit
        self.client.force_authenticate(self.shopper_user)
        r_chk = self.client.post(f'{API}/orders/checkout', {
            'site': self.ds_site.code,
            'address_id': str(self.address.address_id),
            'items': [{'sku_id': str(self.sku.sku_id), 'qty': 1}],
            'payment_method': 'COD',
        }, format='json')
        order_id = r_chk.data['order_id']
        order = CustomerOrder.objects.get(order_id=order_id)
        line = order.lines.first()

        # 1. Duplicate pick scan idempotency (same scan_id)
        self.client.force_authenticate(self.picker_user)
        initial_shelf = self._shelf_qty()
        payload = {
            'order_id': order_id,
            'line_id': str(line.line_id),
            'bin_location_id': self.shelf_bin.location_id,
            'qty': 1,
            'scan_id': 'idemp-scan-1',
        }
        r1 = self.client.post(f'{API}/ds-ops/pick-line', payload, format='json')
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(self._shelf_qty(), initial_shelf - 1)

        # Replaying scan with same scan_id returns already_applied=True without deducting stock
        r2 = self.client.post(f'{API}/ds-ops/pick-line', payload, format='json')
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.data.get('already_applied'))
        self.assertEqual(self._shelf_qty(), initial_shelf - 1)

        # Complete pick
        self.client.post(f'{API}/ds-ops/order-action', {
            'order_id': order_id, 'action': 'COMPLETE_PICK', 'picker': str(self.picker_user.user_id),
        }, format='json')

        # Replaying COMPLETE_PICK is refused (409)
        r_re_pick = self.client.post(f'{API}/ds-ops/order-action', {
            'order_id': order_id, 'action': 'COMPLETE_PICK', 'picker': str(self.picker_user.user_id),
        }, format='json')
        self.assertEqual(r_re_pick.status_code, 409)

        # Pack order
        self.client.force_authenticate(self.packer_user)
        r_pack = self.client.post(f'{API}/ds-ops/pack-order', {
            'order_id': order_id, 'lpn_barcode': self.tote.barcode, 'staging_bin': 'STAGE-01',
        }, format='json')
        self.assertEqual(r_pack.status_code, 200)
        delivery_task_id = r_pack.data['delivery_task']['task_id']

        # Replaying pack_order on already PACKED order is refused (409)
        r_re_pack = self.client.post(f'{API}/ds-ops/pack-order', {
            'order_id': order_id, 'lpn_barcode': self.tote.barcode, 'staging_bin': 'STAGE-01',
        }, format='json')
        self.assertEqual(r_re_pack.status_code, 409)
        self.assertEqual(DeliveryTask.objects.filter(order=order).count(), 1)

        # Rider accept replay is idempotent
        self.client.force_authenticate(self.rider_user)
        r_acc1 = self.client.post(f'{API}/delivery/delivery-tasks/{delivery_task_id}/accept/', {}, format='json')
        self.assertEqual(r_acc1.status_code, 200)
        r_acc2 = self.client.post(f'{API}/delivery/delivery-tasks/{delivery_task_id}/accept/', {}, format='json')
        self.assertEqual(r_acc2.status_code, 200)

        # Pickup
        self.client.post(f'{API}/delivery/handoff/pickup', {
            'task_id': delivery_task_id, 'lpn_barcode': self.tote.barcode,
        }, format='json')

        # Replaying pickup on already PICKED_UP task is refused (409)
        r_re_pickup = self.client.post(f'{API}/delivery/handoff/pickup', {
            'task_id': delivery_task_id, 'lpn_barcode': self.tote.barcode,
        }, format='json')
        self.assertEqual(r_re_pickup.status_code, 409)

        # Advance to ARRIVED
        self.client.post(f'{API}/delivery/delivery-tasks/{delivery_task_id}/advance/', {'to': 'EN_ROUTE'}, format='json')
        self.client.post(f'{API}/delivery/delivery-tasks/{delivery_task_id}/advance/', {'to': 'ARRIVED'}, format='json')

        # Delivery POD
        self.client.post(f'{API}/delivery/handoff/pod', {'task_id': delivery_task_id}, format='json')
        self.client.force_authenticate(self.shopper_user)
        otp = self.client.get(f'{API}/orders/orders/{order_id}/delivery-code/').data['code']
        self.client.force_authenticate(self.rider_user)
        r_del = self.client.post(f'{API}/delivery/handoff/pod', {
            'task_id': delivery_task_id, 'otp': otp, 'cod_amount': '70.00',
        }, format='json')
        self.assertEqual(r_del.status_code, 200)

        # Replaying POD completion on already DELIVERED task is refused (409)
        r_re_del = self.client.post(f'{API}/delivery/handoff/pod', {
            'task_id': delivery_task_id, 'otp': otp, 'cod_amount': '70.00',
        }, format='json')
        self.assertEqual(r_re_del.status_code, 409)
