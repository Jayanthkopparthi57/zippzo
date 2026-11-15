"""Replenishment tasks: planning, assignment, ledger completion and replay."""

from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.iam.models import User
from bounded.inventory.models import ReplenishmentTask, StockBalance
from bounded.inventory.stock import apply_stock
from bounded.network.models import Site


class ReplenishmentTaskTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email='replenish-ops@zippzo.in',
            password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Replenish Ops',
        )
        self.client.force_authenticate(user=self.user)
        self.site = Site.objects.create(
            code='MH-REPLENISH', site_type='MH', name='Replenish MH',
            address='test', status='ACTIVE',
        )
        self.sku = Sku.objects.create(
            sku_code='SKU-REPLENISH-1', name='Replenish Rice',
            ean='9999999999921', mrp=Decimal('10.00'), status='ACTIVE',
        )
        self.lot = InventoryLot.objects.create(
            sku=self.sku, site=self.site, batch_number='BATCH-REPLENISH-1',
            inbound_type='PURCHASE', inbound_ref='PO-REPLENISH-1',
        )
        apply_stock(
            site=self.site, sku=self.sku, lot=self.lot, qty=40,
            movement_type='PUTAWAY', ref_type='TEST', ref_id='seed-replenish',
            direction='IN', container='BIN', container_ref='RESERVE-1',
        )

    def _payload(self, **overrides):
        payload = {
            'site': str(self.site.site_id),
            'sku': str(self.sku.sku_id),
            'lot': str(self.lot.lot_id),
            'from_container': 'BIN',
            'from_container_ref': 'RESERVE-1',
            'to_container': 'BIN',
            'to_container_ref': 'PICKFACE-1',
            'qty': 12,
            'trigger': 'LOW_STOCK',
            'reason': 'Forward bin below par level',
        }
        payload.update(overrides)
        return payload

    def _balance(self, container_ref):
        return StockBalance.objects.get(
            site=self.site, container='BIN', container_ref=container_ref,
            sku=self.sku, lot=self.lot,
        ).qty

    def test_create_assign_complete_and_replay_moves_stock_once(self):
        response = self.client.post(
            '/api/inventory/replenishment-tasks/', self._payload(), format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        task = ReplenishmentTask.objects.get(task_id=response.data['task_id'])
        self.assertEqual(task.status, 'OPEN')
        self.assertEqual(task.created_by_id, self.user.user_id)

        response = self.client.post(
            f'/api/inventory/replenishment-tasks/{task.task_id}/assign/',
            {'user': str(self.user.user_id)}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.status, 'ASSIGNED')
        self.assertEqual(task.assigned_to_id, self.user.user_id)

        self.assertEqual(self._balance('RESERVE-1'), 40)
        response = self.client.post(
            f'/api/inventory/replenishment-tasks/{task.task_id}/complete/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.status, 'COMPLETED')
        self.assertIsNotNone(task.completed_at)
        self.assertEqual(self._balance('RESERVE-1'), 28)
        self.assertEqual(self._balance('PICKFACE-1'), 12)

        response = self.client.post(
            f'/api/inventory/replenishment-tasks/{task.task_id}/complete/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['already_completed'])
        self.assertEqual(self._balance('RESERVE-1'), 28)
        self.assertEqual(self._balance('PICKFACE-1'), 12)

    def test_completion_rejects_insufficient_source_stock(self):
        response = self.client.post(
            '/api/inventory/replenishment-tasks/', self._payload(qty=999), format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        task = ReplenishmentTask.objects.get(task_id=response.data['task_id'])

        response = self.client.post(
            f'/api/inventory/replenishment-tasks/{task.task_id}/complete/', {}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('need 999, have 40', response.data['error'])
        task.refresh_from_db()
        self.assertEqual(task.status, 'OPEN')
        self.assertEqual(self._balance('RESERVE-1'), 40)
