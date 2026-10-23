"""Attribution: every ledger actor is stamped server-side, and rendered by name.

The platform's answer to "who transferred them / who received / who picked" has
to survive a lying client. These tests pin the three rules:

  1. Actor columns are stamped from the JWT (never the request body) — the same
     convention bounded/tests/test_pick_scan.py enforces on stock movements.
  2. Actor columns are read-only to clients: a PATCH cannot claim someone
     else's work.
  3. List endpoints resolve the bare UUIDs to display names via one bulk
     lookup (bounded.iam.names), so a ledger row says "Ops Alice", not a UUID.

Covers the inbound feed (ASN / GRN / QC / putaway) and the outbound feed
(pick / pack / transfer orders / bin transfers) that the Inbound and Outbound
ledger screens render.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.ds_ops.models import BinTransfer, PackTask, PickTask, TransferOrder
from bounded.iam.models import User
from bounded.network.models import Location, Site
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder
from bounded.supply.models import Asn, Grn, GrnLine, PutawayTask, QcInspection

API = '/api'


def _mk_user(email, role='SUPER_ADMIN', full_name=''):
    return User.objects.create(
        email=email, password_hash=make_password('Test123!'),
        role=role, status='ACTIVE', full_name=full_name)


def _mk_site(code, name='Test DS'):
    return Site.objects.create(
        code=code, site_type='DARK_STORE', name=name, address='test')


class InboundAttributionTests(TestCase):
    """ASN / GRN / QC / putaway — who raised, received, tested, shelved."""

    def setUp(self):
        self.client = APIClient()
        self.ops = _mk_user('attr-ops@zippzo.in', full_name='Ops Alice')
        # Second actor with no full_name: name resolution must fall back to
        # the email rather than showing a UUID.
        self.qc_user = _mk_user('attr-qc@zippzo.in')
        self.evil = _mk_user('attr-evil@zippzo.in')
        self.site = _mk_site('DS-ATTR')
        self.client.force_authenticate(user=self.ops)

        self.sku = Sku.objects.create(
            sku_code='SKU-ATTR-1', name='Attr SKU', ean='2222222222222',
            mrp=10, weight_g=100, status='ACTIVE')
        self.lot = InventoryLot.objects.create(
            sku=self.sku, site=self.site, batch_number='LOT-ATTR-1',
            inbound_type='PURCHASE', inbound_ref='PO-ATTR-1')
        self.bin = Location.objects.create(
            site=self.site, location_id='BIN-ATTR-0001', location_type='BIN',
            aisle='A1', rack='R2', level='L3', position='P4',
            barcode='BIN-ATTR-0001', qr_payload='loc:attr-bin-1',
            is_sellable_bin=True, created_by='test')

    def _mk_asn(self):
        return Asn.objects.create(
            asn_no=f'ASN-ATTR-{uuid.uuid4().hex[:8].upper()}',
            type='VENDOR_PO', dest_site=self.site)

    def _mk_grn(self, asn=None):
        return Grn.objects.create(
            grn_no=f'GRN-ATTR-{uuid.uuid4().hex[:8].upper()}',
            asn=asn or self._mk_asn(), mode='LPN_SCAN')

    def _mk_grn_line(self, grn, received=0, accepted=0):
        return GrnLine.objects.create(
            grn=grn, sku=self.sku, ordered_qty=10,
            received_qty=received, accepted_qty=accepted, lot=self.lot)

    # -- stamping ---------------------------------------------------------

    def test_grn_create_stamps_created_by_from_token(self):
        r = self.client.post(f'{API}/supply/grns/', {
            'asn': str(self._mk_asn().asn_id), 'mode': 'LPN_SCAN',
        }, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['created_by'], str(self.ops.user_id))
        self.assertEqual(r.data['created_by_name'], 'Ops Alice')

    def test_grn_complete_stamps_received_by_even_with_body_value(self):
        grn = self._mk_grn()
        self._mk_grn_line(grn, received=4, accepted=4)
        r = self.client.post(
            f'{API}/supply/grns/{grn.grn_id}/complete/',
            {'received_by': str(self.evil.user_id)}, format='json')
        self.assertEqual(r.status_code, 200)
        grn.refresh_from_db()
        # The client tried to pin the receipt on somebody else.
        self.assertEqual(str(grn.received_by), str(self.ops.user_id))

    def test_grn_complete_stamps_received_by_with_no_body(self):
        grn = self._mk_grn()
        self._mk_grn_line(grn, received=1, accepted=1)
        r = self.client.post(
            f'{API}/supply/grns/{grn.grn_id}/complete/', {}, format='json')
        self.assertEqual(r.status_code, 200)
        grn.refresh_from_db()
        self.assertEqual(str(grn.received_by), str(self.ops.user_id))

    def test_received_by_is_read_only_to_clients(self):
        grn = self._mk_grn()
        r = self.client.patch(
            f'{API}/supply/grns/{grn.grn_id}/',
            {'received_by': str(self.evil.user_id)}, format='json')
        self.assertEqual(r.status_code, 200)
        grn.refresh_from_db()
        self.assertIsNone(grn.received_by)

    def test_qc_verify_stamps_tested_by_from_token_not_body(self):
        grn = self._mk_grn()
        line = self._mk_grn_line(grn, received=5, accepted=5)
        qc = QcInspection.objects.create(
            grn_line=line, sample_size=5, status='PENDING')
        r = self.client.post(
            f'{API}/supply/qc-inspections/{qc.qc_id}/verify/',
            {'status': 'PASSED', 'tested_by': str(self.evil.user_id),
             'pass_count': 5}, format='json')
        self.assertEqual(r.status_code, 200)
        qc.refresh_from_db()
        self.assertEqual(str(qc.tested_by), str(self.ops.user_id))
        self.assertIsNotNone(qc.tested_at)

    def test_putaway_complete_stamps_confirmed_by(self):
        grn = self._mk_grn()
        line = self._mk_grn_line(grn, received=3, accepted=3)
        task = PutawayTask.objects.create(
            grn_line=line, sku=self.sku, lot=self.lot, qty=3,
            from_container='QC_PASSED_STAGING', to_container='PUTAWAY_PENDING')
        r = self.client.post(
            f'{API}/supply/putaway-tasks/{task.task_id}/complete/',
            {'destination_location_id': self.bin.location_id}, format='json')
        self.assertEqual(r.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(str(task.confirmed_by), str(self.ops.user_id))
        self.assertEqual(r.data['confirmed_by_name'], 'Ops Alice')

    # -- name resolution on lists ----------------------------------------

    def test_asn_list_resolves_created_by_names_in_one_map(self):
        second = _mk_user('attr-second@zippzo.in', full_name='Second Op')
        Asn.objects.create(
            asn_no='ASN-ATTR-A1', type='VENDOR_PO', dest_site=self.site,
            created_by=self.ops.user_id)
        Asn.objects.create(
            asn_no='ASN-ATTR-A2', type='VENDOR_PO', dest_site=self.site,
            created_by=second.user_id)
        r = self.client.get(f'{API}/supply/asns/?type=VENDOR_PO')
        self.assertEqual(r.status_code, 200)
        by_no = {row['asn_no']: row for row in r.data['results']}
        self.assertEqual(by_no['ASN-ATTR-A1']['created_by_name'], 'Ops Alice')
        self.assertEqual(by_no['ASN-ATTR-A2']['created_by_name'], 'Second Op')

    def test_grn_list_resolves_received_by_name(self):
        grn = self._mk_grn()
        self._mk_grn_line(grn, received=1, accepted=1)
        self.client.post(f'{API}/supply/grns/{grn.grn_id}/complete/',
                         {}, format='json')
        r = self.client.get(f'{API}/supply/grns/?status=COMPLETED')
        row = next(x for x in r.data['results']
                   if x['grn_id'] == str(grn.grn_id))
        self.assertEqual(row['received_by'], str(self.ops.user_id))
        self.assertEqual(row['received_by_name'], 'Ops Alice')

    # -- ledger filters ---------------------------------------------------

    def test_grn_filter_by_received_by(self):
        grn = self._mk_grn()
        self._mk_grn_line(grn, received=1, accepted=1)
        self.client.post(f'{API}/supply/grns/{grn.grn_id}/complete/',
                         {}, format='json')
        r = self.client.get(
            f'{API}/supply/grns/?received_by={self.ops.user_id}')
        self.assertEqual(r.status_code, 200)
        self.assertIn(str(grn.grn_id),
                      [x['grn_id'] for x in r.data['results']])
        r = self.client.get(
            f'{API}/supply/grns/?received_by={self.evil.user_id}')
        self.assertNotIn(str(grn.grn_id),
                         [x['grn_id'] for x in r.data['results']])

    def test_asn_filter_by_created_at_window(self):
        Asn.objects.create(
            asn_no='ASN-ATTR-W1', type='VENDOR_PO', dest_site=self.site)
        # Params go through the test client's dict form so the timezone
        # offset's '+' is percent-encoded; an f-string URL would decode it as
        # a space and the filter would 400.
        now = timezone.now().isoformat()
        r = self.client.get(f'{API}/supply/asns/',
                            {'created_at__gte': now})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['count'], 0)
        r = self.client.get(f'{API}/supply/asns/',
                            {'created_at__lte': now})
        self.assertEqual(r.status_code, 200)
        self.assertGreaterEqual(r.data['count'], 1)


class OutboundAttributionTests(TestCase):
    """Pick / pack / transfer orders / bin transfers — who did the work."""

    def setUp(self):
        self.client = APIClient()
        self.picker = _mk_user('attr-picker@zippzo.in', role='WAREHOUSE_STAFF',
                               full_name='Picker Bob')
        self.manager = _mk_user('attr-manager@zippzo.in')
        self.evil = _mk_user('attr-out-evil@zippzo.in')
        self.site = _mk_site('DS-ATTR-OUT')
        self.site2 = _mk_site('DS-ATTR-OUT-2')
        self.client.force_authenticate(user=self.picker)

        customer = Customer.objects.create(user=self.picker, name='Attr Cust')
        address = CustomerAddress.objects.create(
            customer=customer, label='Home', line1='1 Test Road',
            pincode='560001', city='Bengaluru')
        self.order = CustomerOrder.objects.create(
            order_no='ORD-ATTR-1', customer=customer, site=self.site,
            address=address, status='PICKING', payment_method='COD',
            subtotal=Decimal('100.00'), grand_total=Decimal('100.00'))

    def _mk_pick(self, **kwargs):
        base = dict(
            picklist_id=uuid.uuid4(), batch=uuid.uuid4(), order=self.order,
            zone='A1', sku=uuid.uuid4(), bin='BIN-NO-SUCH-ROW', qty=2,
            status='NOT_STARTED')
        base.update(kwargs)
        return PickTask.objects.create(**base)

    # -- pick -------------------------------------------------------------

    def test_pick_assign_stamps_started_by_the_assignee(self):
        task = self._mk_pick()
        r = self.client.post(
            f'{API}/ds-ops/pick-tasks/{task.pk}/assign/',
            {'user': str(self.picker.user_id)}, format='json')
        self.assertEqual(r.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(str(task.started_by), str(self.picker.user_id))

    def test_pick_complete_stamps_completed_by_token_body_actor_ignored(self):
        task = self._mk_pick(status='IN_PROGRESS', picked_qty=2)
        r = self.client.post(
            f'{API}/ds-ops/pick-tasks/{task.pk}/complete/',
            {'picked_qty': 2, 'actor_id': str(self.evil.user_id)},
            format='json')
        self.assertEqual(r.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(str(task.completed_by), str(self.picker.user_id))
        self.assertIsNotNone(task.completed_at)

    def test_pick_patch_completion_stamps_and_backfills(self):
        task = self._mk_pick(status='IN_PROGRESS')
        r = self.client.patch(
            f'{API}/ds-ops/pick-tasks/{task.pk}/',
            {'status': 'COMPLETED', 'picked_qty': 2,
             'completed_by': str(self.evil.user_id)}, format='json')
        self.assertEqual(r.status_code, 200)
        task.refresh_from_db()
        # completed_by is read-only: the PATCH value was ignored and the
        # token won, and the completion timestamp was backfilled too.
        self.assertEqual(str(task.completed_by), str(self.picker.user_id))
        self.assertIsNotNone(task.completed_at)

    def test_pick_list_resolves_actor_names(self):
        task = self._mk_pick(status='COMPLETED', completed_by=self.picker.user_id,
                             assigned_to=self.picker.user_id)
        r = self.client.get(
            f'{API}/ds-ops/pick-tasks/?completed_by={self.picker.user_id}')
        self.assertEqual(r.status_code, 200)
        row = r.data['results'][0]
        # PickTask's pk is an integer, so compare numerically.
        self.assertEqual(int(row['id']), int(task.pk))
        self.assertEqual(row['completed_by_name'], 'Picker Bob')
        self.assertEqual(row['assigned_to_name'], 'Picker Bob')

    def test_pick_filter_by_completed_by(self):
        mine = self._mk_pick(status='COMPLETED', completed_by=self.picker.user_id)
        self._mk_pick(status='COMPLETED', completed_by=self.evil.user_id)
        r = self.client.get(
            f'{API}/ds-ops/pick-tasks/?completed_by={self.picker.user_id}')
        ids = {str(x['id']) for x in r.data['results']}
        self.assertIn(str(mine.pk), ids)
        self.assertEqual(len(ids), 1)

    # -- pack -------------------------------------------------------------

    def test_pack_order_stamps_completed_by(self):
        from bounded.ds_ops.pack import pack_order
        from bounded.inventory.models import LpnMaster
        from bounded.orders.models import CustomerOrderLine

        sku = Sku.objects.create(
            sku_code='SKU-ATTR-P', name='Pack Attr SKU', mrp=10,
            weight_g=100, status='ACTIVE')
        lot = InventoryLot.objects.create(
            sku=sku, site=self.site, batch_number='LOT-ATTR-P',
            inbound_type='PURCHASE', inbound_ref='PO-ATTR-P')
        CustomerOrderLine.objects.create(
            order=self.order, line_no=1, sku=sku, lot=lot, qty=2,
            picked_qty=2, unit_price=Decimal('50.00'),
            line_total=Decimal('100.00'))
        CustomerOrder.objects.filter(pk=self.order.pk).update(status='PICKED')
        self.order.refresh_from_db()
        LpnMaster.objects.create(
            lpn_id='LPN-ATTR-1', barcode='TOTE-ATTR-1', lpn_type='TOTE',
            current_site=self.site, status='EMPTY', created_by='test')

        pack_order(order=self.order, actor=self.picker,
                   lpn_barcode='TOTE-ATTR-1', staging_bin='STAGE-01')

        task = PackTask.objects.get(order=self.order, sku=sku.sku_id)
        self.assertEqual(task.status, 'COMPLETED')
        self.assertEqual(str(task.completed_by), str(self.picker.user_id))

    def test_pack_list_resolves_completed_by_name(self):
        PackTask.objects.create(
            packlist_id=uuid.uuid4(), order=self.order, sku=uuid.uuid4(),
            qty=1, status='COMPLETED', completed_by=self.picker.user_id)
        r = self.client.get(
            f'{API}/ds-ops/pack-tasks/?status=COMPLETED'
            f'&completed_by={self.picker.user_id}')
        row = r.data['results'][0]
        self.assertEqual(row['completed_by_name'], 'Picker Bob')

    # -- transfer orders ---------------------------------------------------

    def test_transfer_create_stamps_created_by(self):
        r = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'source_site': str(self.site.site_id),
            'dest_site': str(self.site2.site_id),
        }, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['created_by'], str(self.picker.user_id))

    def test_transfer_dispatch_stamps_dispatched_by(self):
        r = self.client.post(f'{API}/ds-ops/transfer-orders/', {
            'source_site': str(self.site.site_id),
            'dest_site': str(self.site2.site_id),
        }, format='json')
        tid = r.data['transfer_id']
        r = self.client.post(
            f'{API}/ds-ops/transfer-orders/{tid}/dispatch/', {}, format='json')
        self.assertEqual(r.status_code, 200)
        to = TransferOrder.objects.get(transfer_id=tid)
        self.assertEqual(str(to.dispatched_by), str(self.picker.user_id))

    def test_transfer_put_to_in_transit_stamps_dispatched_by(self):
        to = TransferOrder.objects.create(
            source_site=self.site, dest_site=self.site2)
        r = self.client.put(
            f'{API}/ds-ops/transfer-orders/{to.transfer_id}/',
            {'source_site': str(self.site.site_id),
             'dest_site': str(self.site2.site_id),
             'status': 'IN_TRANSIT'}, format='json')
        self.assertEqual(r.status_code, 200)
        to.refresh_from_db()
        self.assertEqual(str(to.dispatched_by), str(self.picker.user_id))

    # -- bin transfers -----------------------------------------------------

    def test_bin_transfer_create_and_complete_stamps(self):
        r = self.client.post(f'{API}/ds-ops/bin-transfers/', {
            'source_bin': 'BIN-A', 'dest_bin': 'BIN-B',
        }, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['created_by'], str(self.picker.user_id))
        tid = r.data['transfer_id']
        r = self.client.patch(
            f'{API}/ds-ops/bin-transfers/{tid}/',
            {'status': 'COMPLETED'}, format='json')
        self.assertEqual(r.status_code, 200)
        bt = BinTransfer.objects.get(transfer_id=tid)
        self.assertEqual(str(bt.completed_by), str(self.picker.user_id))

    def test_bin_transfer_list_resolves_names(self):
        BinTransfer.objects.create(
            source_bin='BIN-A', dest_bin='BIN-B',
            created_by=self.picker.user_id)
        r = self.client.get(
            f'{API}/ds-ops/bin-transfers/?created_by={self.picker.user_id}')
        row = r.data['results'][0]
        self.assertEqual(row['created_by_name'], 'Picker Bob')
