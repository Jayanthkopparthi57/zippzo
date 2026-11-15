"""Dock discrepancies: create, resolve and replay."""

from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.iam.models import User
from bounded.network.models import Site
from bounded.supply.models import Asn, DockDiscrepancy, Grn, GrnLine, PutawayTask


class DockDiscrepancyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email='discrepancy-ops@zippzo.in',
            password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Discrepancy Ops',
        )
        self.client.force_authenticate(user=self.user)
        self.site = Site.objects.create(
            code='MH-DOCK-DISCREPANCY', site_type='MH', name='Dock Discrepancy MH',
            address='test', status='ACTIVE',
        )
        self.sku = Sku.objects.create(
            sku_code='SKU-DISCREPANCY-1', name='Discrepancy Rice',
            ean='9999999999941', mrp=Decimal('10.00'), status='ACTIVE',
        )
        self.lot = InventoryLot.objects.create(
            sku=self.sku, site=self.site, batch_number='BATCH-DISCREPANCY-1',
            inbound_type='PURCHASE', inbound_ref='PO-DISCREPANCY-1',
        )
        self.asn = Asn.objects.create(
            asn_no='ASN-DISCREPANCY-1', type='VENDOR_PO', dest_site=self.site,
        )
        self.grn = Grn.objects.create(
            grn_no='GRN-DISCREPANCY-1', asn=self.asn,
            status='COMPLETED', has_discrepancy=True,
        )
        self.line = GrnLine.objects.create(
            grn=self.grn, sku=self.sku, ordered_qty=20, received_qty=17,
            accepted_qty=17, lot=self.lot,
        )

    def _payload(self, **overrides):
        payload = {
            'code': 'DISC-2026-0001',
            'grn': str(self.grn.grn_id),
            'grn_line': str(self.line.line_id),
            'site': str(self.site.site_id),
            'sku': str(self.sku.sku_id),
            'lot': str(self.lot.lot_id),
            'discrepancy_type': 'SHORT',
            'expected_qty': 20,
            'received_qty': 17,
            'accepted_qty': 17,
            'reason_code': 'VENDOR_SHORT',
            'remarks': 'Three units short at dock',
        }
        payload.update(overrides)
        return payload

    def test_create_resolve_and_replay(self):
        response = self.client.post(
            '/api/supply/dock-discrepancies/', self._payload(), format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        discrepancy = DockDiscrepancy.objects.get(
            discrepancy_id=response.data['discrepancy_id'],
        )
        self.assertEqual(discrepancy.status, 'OPEN')
        self.assertEqual(discrepancy.shortage_qty, 3)
        self.assertEqual(discrepancy.created_by_id, self.user.user_id)
        self.assertEqual(response.data['grn_no'], 'GRN-DISCREPANCY-1')
        self.assertEqual(response.data['site_code'], 'MH-DOCK-DISCREPANCY')

        response = self.client.patch(
            f'/api/supply/dock-discrepancies/{discrepancy.discrepancy_id}/',
            {'status': 'INVESTIGATING'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        response = self.client.post(
            f'/api/supply/dock-discrepancies/{discrepancy.discrepancy_id}/resolve/',
            {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        discrepancy.refresh_from_db()
        self.assertEqual(discrepancy.status, 'RESOLVED')
        self.assertEqual(discrepancy.resolved_by_id, self.user.user_id)
        self.assertIsNotNone(discrepancy.resolved_at)

        response = self.client.post(
            f'/api/supply/dock-discrepancies/{discrepancy.discrepancy_id}/resolve/',
            {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['already_resolved'])

    def test_inbound_lists_can_be_filtered_to_destination_darkstore(self):
        other_site = Site.objects.create(
            code='DS-DOCK-DISCREPANCY', site_type='DARK_STORE',
            name='Darkstore Dock', address='test', status='ACTIVE',
        )
        other_asn = Asn.objects.create(
            asn_no='ASN-DISCREPANCY-OTHER', type='MH_TRANSFER',
            dest_site=other_site, source_site=self.site,
        )
        other_grn = Grn.objects.create(
            grn_no='GRN-DISCREPANCY-OTHER', asn=other_asn,
            status='COMPLETED',
        )
        other_lot = InventoryLot.objects.create(
            sku=self.sku, site=other_site, batch_number='BATCH-DISCREPANCY-OTHER',
            inbound_type='ASN', inbound_ref='ASN-DISCREPANCY-OTHER',
        )
        other_line = GrnLine.objects.create(
            grn=other_grn, sku=self.sku, ordered_qty=5,
            received_qty=5, accepted_qty=5, lot=other_lot,
        )
        own_task = PutawayTask.objects.create(
            grn_line=self.line, to_container='BIN', sku=self.sku,
            lot=self.lot, qty=17,
        )
        other_task = PutawayTask.objects.create(
            grn_line=other_line, to_container='BIN', sku=self.sku,
            lot=other_lot, qty=5,
        )

        grn_response = self.client.get('/api/supply/grns/', {
            'asn__dest_site': str(self.site.site_id),
        })
        self.assertEqual(grn_response.status_code, 200, grn_response.data)
        self.assertEqual(
            [row['grn_id'] for row in grn_response.data['results']],
            [str(self.grn.grn_id)],
        )

        putaway_response = self.client.get('/api/supply/putaway-tasks/', {
            'grn_line__grn__asn__dest_site': str(self.site.site_id),
        })
        self.assertEqual(putaway_response.status_code, 200, putaway_response.data)
        self.assertEqual(
            [row['task_id'] for row in putaway_response.data['results']],
            [str(own_task.task_id)],
        )
        self.assertNotEqual(own_task.task_id, other_task.task_id)
