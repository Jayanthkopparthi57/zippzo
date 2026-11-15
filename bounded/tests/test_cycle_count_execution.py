"""Cycle-count execution: generate from balances, post variances, close."""

from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.counting.models import CycleCount, CycleCountLine
from bounded.iam.models import User
from bounded.inventory.models import StockBalance
from bounded.inventory.stock import apply_stock
from bounded.network.models import EmployeeSiteAssignment, Location, Site


class CycleCountExecutionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email='cycle-count-ops@zippzo.in',
            password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Cycle Count Ops',
        )
        self.client.force_authenticate(user=self.user)
        self.site = Site.objects.create(
            code='MH-CYCLE-COUNT', site_type='MH', name='Cycle Count MH',
            address='test', status='ACTIVE',
        )
        self.sku = Sku.objects.create(
            sku_code='SKU-CYCLE-COUNT-1', name='Cycle Count Rice',
            ean='9999999999961', mrp=Decimal('10.00'), status='ACTIVE',
        )
        self.lot = InventoryLot.objects.create(
            sku=self.sku, site=self.site, batch_number='BATCH-CYCLE-COUNT-1',
            inbound_type='PURCHASE', inbound_ref='PO-CYCLE-COUNT-1',
        )
        self.bin = Location.objects.create(
            location_id='BIN-CYCLE-COUNT-1', site=self.site,
            location_type='BIN', barcode='BIN-CYCLE-COUNT-1',
            capacity_qty=100, created_by='test',
        )
        apply_stock(
            site=self.site, sku=self.sku, lot=self.lot, qty=20,
            movement_type='PUTAWAY', ref_type='TEST', ref_id='seed-cycle-count',
            direction='IN', container='BIN', container_ref=self.bin.location_id,
        )
        self.count = CycleCount.objects.create(
            code='CC-2026-0001', site=self.site, count_type='BIN',
            scope={'container_refs': [self.bin.location_id]},
        )

    def test_generate_count_complete_and_replay_posts_variance_once(self):
        list_response = self.client.get(
            '/api/counting/cycle-counts/', {'site': str(self.site.site_id)},
        )
        self.assertEqual(list_response.status_code, 200, list_response.data)
        self.assertEqual(list_response.data['results'][0]['count_id'], str(self.count.count_id))

        response = self.client.post(
            f'/api/counting/cycle-counts/{self.count.count_id}/generate/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['lines_created'], 1)
        line = self.count.lines.get()
        self.assertEqual(line.system_qty, 20)
        self.assertEqual(line.location_id, self.bin.location_id)

        response = self.client.post(
            f'/api/counting/cycle-counts/{self.count.count_id}/complete/', {}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)

        line.counted_qty = 17
        line.save(update_fields=['counted_qty'])
        response = self.client.post(
            f'/api/counting/cycle-counts/{self.count.count_id}/complete/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.count.refresh_from_db()
        line.refresh_from_db()
        self.assertEqual(self.count.status, 'CLOSED')
        self.assertEqual(line.status, 'APPROVED')
        self.assertEqual(line.variance, -3)
        self.assertEqual(
            StockBalance.objects.get(
                site=self.site, container='BIN', container_ref=self.bin.location_id,
                sku=self.sku, lot=self.lot,
            ).qty,
            17,
        )

        response = self.client.post(
            f'/api/counting/cycle-counts/{self.count.count_id}/complete/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['already_completed'])
        self.assertEqual(
            StockBalance.objects.get(
                site=self.site, container='BIN', container_ref=self.bin.location_id,
                sku=self.sku, lot=self.lot,
            ).qty,
            17,
        )

    def test_variance_waits_for_a_manager_approval(self):
        """The counter may not clear their own difference."""
        self.client.post(
            f'/api/counting/cycle-counts/{self.count.count_id}/generate/',
            {}, format='json',
        )
        line = self.count.lines.get()
        line.counted_qty = 17
        line.save(update_fields=['counted_qty'])

        counter = User.objects.create(
            email='cycle-counter@zippzo.in', role='WAREHOUSE_STAFF',
            status='ACTIVE')
        EmployeeSiteAssignment.objects.create(
            employee='OP-CYCLE-COUNTER', user=counter, site=self.site,
            mode='WAREHOUSE', role_at_site='INVENTORY_ASSOCIATE', is_primary=True)
        counter_client = APIClient()
        counter_client.force_authenticate(counter)

        blocked = counter_client.post(
            f'/api/counting/cycle-counts/{self.count.count_id}/complete/',
            {}, format='json',
        )
        self.assertEqual(409, blocked.status_code, blocked.data)
        self.assertEqual('approval_required', blocked.data['code'])
        self.count.refresh_from_db()
        self.assertEqual('REVIEW', self.count.status)
        line.refresh_from_db()
        self.assertEqual('VARIANCE', line.status)
        self.assertEqual(
            20,
            StockBalance.objects.get(
                site=self.site, container='BIN', container_ref=self.bin.location_id,
                sku=self.sku, lot=self.lot,
            ).qty,
            'stock moved before approval',
        )

        denied = counter_client.post(
            f'/api/counting/cycle-counts/{self.count.count_id}/approve/',
            {}, format='json',
        )
        self.assertEqual(403, denied.status_code, denied.data)

        approved = self.client.post(
            f'/api/counting/cycle-counts/{self.count.count_id}/approve/',
            {}, format='json',
        )
        self.assertEqual(200, approved.status_code, approved.data)
        self.count.refresh_from_db()
        line.refresh_from_db()
        self.assertEqual('CLOSED', self.count.status)
        self.assertEqual('APPROVED', line.status)
        self.assertEqual(
            17,
            StockBalance.objects.get(
                site=self.site, container='BIN', container_ref=self.bin.location_id,
                sku=self.sku, lot=self.lot,
            ).qty,
        )
