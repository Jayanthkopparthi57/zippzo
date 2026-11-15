"""Transfer order lines: create, dispatch update, list payload."""

from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.ds_ops.models import TransferOrder, TransferOrderLine
from bounded.iam.models import User
from bounded.inventory.stock import apply_stock
from bounded.network.models import Location, Site


class TransferOrderLineTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email='sto-lines-ops@zippzo.in',
            password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='STO Lines Ops',
        )
        self.client.force_authenticate(user=self.user)
        self.source = Site.objects.create(
            code='MH-STO-LINES', site_type='MH', name='STO Lines MH',
            address='test', status='ACTIVE',
        )
        self.dest = Site.objects.create(
            code='DS-STO-LINES', site_type='DS', name='STO Lines DS',
            address='test', status='ACTIVE',
        )
        self.sku = Sku.objects.create(
            sku_code='SKU-STO-LINES-1', name='STO Lines Rice',
            ean='9999999999951', mrp=Decimal('10.00'), status='ACTIVE',
        )
        self.lot = InventoryLot.objects.create(
            sku=self.sku, site=self.source, batch_number='BATCH-STO-LINES-1',
            inbound_type='PURCHASE', inbound_ref='PO-STO-LINES-1',
        )
        self.bin = Location.objects.create(
            location_id='BIN-STO-LINES-1', site=self.source,
            location_type='BIN', barcode='BIN-STO-LINES-1',
            capacity_qty=100, created_by='test',
        )
        self.transfer = TransferOrder.objects.create(
            source_site=self.source, dest_site=self.dest,
            status='APPROVED', total_qty=10, created_by=self.user.user_id,
        )
        self.line = TransferOrderLine.objects.create(
            transfer=self.transfer, line_no=1, sku=self.sku, lot=self.lot,
            ordered_qty=10, picked_qty=10,
        )

    def test_create_and_list_line_payload(self):
        response = self.client.get(
            f'/api/ds-ops/transfer-order-lines/?transfer={self.transfer.transfer_id}',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['count'], 1)
        row = response.data['results'][0]
        self.assertEqual(row['sku_code'], 'SKU-STO-LINES-1')
        self.assertEqual(row['sku_name'], 'STO Lines Rice')
        self.assertEqual(row['ordered_qty'], 10)

    def test_pack_lpn_populates_and_aggregates_transfer_lines(self):
        apply_stock(
            site=self.source, sku=self.sku, lot=self.lot, qty=25,
            movement_type='PUTAWAY', ref_type='TEST', ref_id='seed-sto-lines',
            direction='IN', container='BIN', container_ref='BIN-STO-LINES-1',
        )
        response = self.client.post('/api/inventory/pack-lpn', {
            'lpn_id': 'LPN-STO-LINES-1',
            'barcode': 'ZP-STO-LINES-1',
            'lpn_type': 'TOTE',
            'dest_site': str(self.dest.site_id),
            'transfer': str(self.transfer.transfer_id),
            'items': [{
                'sku': str(self.sku.sku_id),
                'lot': str(self.lot.lot_id),
                'bin_location_id': 'BIN-STO-LINES-1',
                'qty': 10,
            }],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.ordered_qty, 20)
        self.assertEqual(self.line.picked_qty, 20)
        self.assertEqual(TransferOrderLine.objects.filter(transfer=self.transfer).count(), 1)

    def test_dispatch_increments_shipped_qty(self):
        from bounded.inventory.models import LpnContent, LpnMaster
        lpn = LpnMaster.objects.create(
            lpn_id='LPN-STO-LINES-DISPATCH', barcode='ZP-STO-LINES-DISPATCH',
            lpn_type='TOTE', current_site=self.source, source_site=self.source,
            dest_site=self.dest, transfer=self.transfer, status='PACKED',
        )
        LpnContent.objects.create(lpn=lpn, sku=self.sku, lot=self.lot, qty=10)
        apply_stock(
            site=self.source, sku=self.sku, lot=self.lot, qty=10,
            movement_type='PACK', ref_type='LPN', ref_id='seed-lpn-balance',
            direction='IN', container='LPN', container_ref=str(lpn.lpn_id),
        )

        response = self.client.post(
            f'/api/ds-ops/transfer-orders/{self.transfer.transfer_id}/dispatch/',
            {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.shipped_qty, 10)
