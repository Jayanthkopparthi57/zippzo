"""Cancellation putaway: create, ledger completion and replay."""

from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.iam.models import User
from bounded.inventory.models import StockBalance
from bounded.network.models import Site
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder
from bounded.reverse.models import CancellationPutaway


class CancellationPutawayTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email='cancel-putaway-ops@zippzo.in',
            password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Cancel Putaway Ops',
        )
        self.client.force_authenticate(user=self.user)
        self.site = Site.objects.create(
            code='DS-CANCEL-PUTAWAY', site_type='DS', name='Cancel Putaway DS',
            address='test', status='ACTIVE',
        )
        self.sku = Sku.objects.create(
            sku_code='SKU-CANCEL-1', name='Cancel Rice',
            ean='9999999999931', mrp=Decimal('10.00'), status='ACTIVE',
        )
        self.lot = InventoryLot.objects.create(
            sku=self.sku, site=self.site, batch_number='BATCH-CANCEL-1',
            inbound_type='PURCHASE', inbound_ref='PO-CANCEL-1',
        )
        customer = Customer.objects.create(user=self.user, name='Cancel Customer')
        address = CustomerAddress.objects.create(
            customer=customer, label='Home', line1='1 Test Road',
            pincode='560001', city='Bengaluru',
        )
        self.order = CustomerOrder.objects.create(
            order_no='ORD-CANCEL-1', customer=customer, site=self.site,
            address=address, status='CANCELLED_PENDING_RETURN', payment_method='COD',
            subtotal=Decimal('20.00'), grand_total=Decimal('20.00'),
        )

    def _payload(self, **overrides):
        payload = {
            'code': 'CPUT-2026-0001',
            'order': str(self.order.order_id),
            'site': str(self.site.site_id),
            'sku': str(self.sku.sku_id),
            'lot': str(self.lot.lot_id),
            'qty': 5,
            'destination_bin': 'CANCEL-BIN-1',
            'status': 'PENDING_QC',
            'reason_code': 'CUSTOMER_CANCEL',
            'remarks': 'Goods returned after cancellation',
        }
        payload.update(overrides)
        return payload

    def test_create_complete_and_replay_posts_stock_once(self):
        response = self.client.post(
            '/api/reverse/cancellation-putaways/', self._payload(), format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        putaway = CancellationPutaway.objects.get(putaway_id=response.data['putaway_id'])
        self.assertEqual(putaway.status, 'PENDING_QC')
        self.assertEqual(putaway.created_by_id, self.user.user_id)
        self.assertEqual(response.data['order_no'], 'ORD-CANCEL-1')

        response = self.client.post(
            f'/api/reverse/cancellation-putaways/{putaway.putaway_id}/complete/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        putaway.refresh_from_db()
        self.assertEqual(putaway.status, 'COMPLETED')
        self.assertIsNotNone(putaway.completed_at)
        self.assertEqual(
            StockBalance.objects.get(
                site=self.site, container='BIN', container_ref='CANCEL-BIN-1',
                sku=self.sku, lot=self.lot,
            ).qty,
            5,
        )

        response = self.client.post(
            f'/api/reverse/cancellation-putaways/{putaway.putaway_id}/complete/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['already_completed'])
        self.assertEqual(
            StockBalance.objects.get(
                site=self.site, container='BIN', container_ref='CANCEL-BIN-1',
                sku=self.sku, lot=self.lot,
            ).qty,
            5,
        )
