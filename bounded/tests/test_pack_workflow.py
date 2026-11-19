"""Pack workflow — picked order is staged and handed to the rider.

Packing moves the order from PICKED to STAGED, records the staging slot and
creates the DeliveryTask that hands it to the rider. Loose bags are the only
outbound container; LPNs are an inbound concept and never key on an order.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.db.models import Count, Sum
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.delivery.models import DeliveryTask
from bounded.ds_ops.allocation import allocate_order
from bounded.ds_ops.models import PackTask
from bounded.inventory.models import StockBalance, StockMovement
from bounded.iam.models import User
from bounded.network.models import EmployeeSiteAssignment, Location, Site
from bounded.orders.models import (
    Customer, CustomerAddress, CustomerOrder, CustomerOrderLine,
)
from bounded.outbox.models import OutboxEvent

PACK = '/api/ds-ops/pack-order'
PICK_LINE = '/api/ds-ops/pick-line'
ORDER_ACTION = '/api/ds-ops/order-action'


class PackBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.packer = User.objects.create(
            email='pack-operator@zippzo.in', password_hash=make_password('Pack123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        cls.stranger = User.objects.create(
            email='pack-stranger@zippzo.in', password_hash=make_password('Pack123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')

        cls.site = Site.objects.create(
            code='DS-PACK-TEST', site_type='DARK_STORE', name='Pack Test DS',
            address='test')
        EmployeeSiteAssignment.objects.create(
            employee='PACKOP01', user=cls.packer, site=cls.site,
            mode='DARKHOUSE', role_at_site='PACKER', is_primary=True)

        cls.bin = Location.objects.create(
            site=cls.site, location_id='BIN-PACK-0001', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='BIN-PACK-0001', is_sellable_bin=True, created_by='test')

        cls.sku = Sku.objects.create(
            sku_code='PACK-SKU-1', name='Pack Test Cereal', sub_category='Grocery',
            brand='Zippzo', pack_size='1', hsn_code='1904', weight_g=500)
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.site, batch_number='LOT-PACK-1',
            inbound_type='PURCHASE', inbound_ref='PO-PACK-1')
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin.location_id,
            sku=cls.sku, lot=cls.lot, qty=10)

        cls.customer = Customer.objects.create(user=cls.packer, name='Pack Customer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Pack Road',
            pincode='560001', city='Bengaluru')
        cls.order = CustomerOrder.objects.create(
            order_no='ORD-PACK-1', customer=cls.customer, site=cls.site,
            address=cls.address, status='PICKING', payment_method='PREPAID',
            payment_status='CAPTURED', subtotal=Decimal('80.00'),
            grand_total=Decimal('80.00'), placed_at=timezone.now())
        cls.line = CustomerOrderLine.objects.create(
            order=cls.order, line_no=1, sku=cls.sku, lot=cls.lot, qty=2,
            unit_price=Decimal('40.00'), line_total=Decimal('80.00'))

        allocate_order(cls.order)

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.packer)

    def scan_all(self):
        """Pick the line for real, one unit per scan, through the ledger."""
        for _ in range(self.line.qty):
            response = self.api.post(PICK_LINE, {
                'order_id': str(self.order.order_id),
                'line_id': str(self.line.line_id),
                'bin_location_id': self.bin.location_id,
                'qty': 1,
                'scan_id': str(uuid.uuid4()),
            }, format='json')
            self.assertEqual(200, response.status_code, response.data)

    def pick_all(self, qty=None):
        """Get the order to PICKED. `qty` fakes a short pick, no ledger."""
        if qty is not None:
            CustomerOrderLine.objects.filter(pk=self.line.pk).update(picked_qty=qty)
            CustomerOrder.objects.filter(pk=self.order.pk).update(status='PICKED')
        else:
            self.scan_all()
        return self.api.post(ORDER_ACTION, {
            'order_id': str(self.order.order_id), 'action': 'COMPLETE_PICK',
        }, format='json')

    def pack(self, **kwargs):
        payload = {'order_id': str(self.order.order_id),
                   'staging_bin': 'STAGE-01'}
        payload.update(kwargs)
        return self.api.post(PACK, payload, format='json')


class PackGuardTests(PackBase):

    def test_an_unpicked_order_cannot_be_packed(self):
        response = self.pack()

        self.assertEqual(409, response.status_code)
        self.assertIn('PICKING', response.data['error'])
        self.assertEqual(0, StockBalance.objects.filter(container='LPN').count())
        self.assertEqual(0, DeliveryTask.objects.count())

    def test_an_order_with_a_short_line_cannot_be_packed(self):
        self.pick_all(qty=1)

        response = self.pack()

        self.assertEqual(409, response.status_code)
        self.assertEqual(1, response.data['short_lines'][0]['outstanding'])
        self.assertEqual(0, StockBalance.objects.filter(container='LPN').count())

    def test_a_staging_slot_is_required(self):
        """The rider has to be told where to collect from."""
        self.pick_all()

        response = self.pack(staging_bin=None)

        self.assertEqual(400, response.status_code)
        self.assertIn('staging_bin', response.data['error'])

    def test_an_operator_at_another_store_cannot_pack(self):
        self.pick_all()
        self.api.force_authenticate(self.stranger)

        response = self.pack()

        self.assertEqual(403, response.status_code)
        self.assertEqual(0, StockBalance.objects.filter(container='LPN').count())
        self.assertEqual(0, DeliveryTask.objects.count())

    def test_a_task_being_ridden_for_this_order_blocks_a_repack(self):
        self.pick_all()
        self.pack()
        DeliveryTask.objects.update(status='EN_ROUTE')
        CustomerOrder.objects.filter(pk=self.order.pk).update(status='PICKED')

        response = self.pack()

        self.assertEqual(409, response.status_code)
        self.assertEqual('EN_ROUTE', response.data['delivery_task_status'])


class PackEffectTests(PackBase):

    def test_packing_keeps_the_units_in_store_custody(self):
        self.pick_all()

        response = self.pack()

        self.assertEqual(200, response.status_code, response.data)
        # Bin A had 10, two were picked: 8 remain. No LPN row may exist for this order.
        self.assertEqual(8, StockBalance.objects.get(
            container_ref=self.bin.location_id).qty)
        self.assertEqual(0, StockBalance.objects.filter(
            container='LPN').count())

    def test_packed_goods_stop_counting_as_sellable_stock(self):
        self.pick_all()

        self.pack()

        # The pick itself moved the units out of sellable custody; the pack must
        # not put them back on the shelf.
        shelf = StockBalance.objects.get(
            container='BIN', container_ref=self.bin.location_id)
        self.assertFalse(shelf.sellable,
                         'picked units are still being sold from')

    def test_the_line_records_what_was_packed(self):
        self.pick_all()

        self.pack()

        self.line.refresh_from_db()
        self.assertEqual(2, self.line.packed_qty)

    def test_a_pack_task_records_the_staging_slot(self):
        self.pick_all()

        self.pack()

        task = PackTask.objects.get(order=self.order)
        self.assertEqual('STAGE-01', task.staging_bin)
        self.assertEqual(2, task.packed_qty)
        self.assertEqual('COMPLETED', task.status)
        self.assertEqual('', task.lpn)

    def test_the_delivery_task_names_the_slot_and_when_it_was_packed(self):
        self.pick_all()

        self.pack()

        task = DeliveryTask.objects.get(order=self.order)
        self.assertEqual('UNASSIGNED', task.status)
        self.assertEqual('STAGE-01', task.staging_bin)
        self.assertIsNone(task.bin,
                          'outbound tasks carry no tote')
        self.assertIsNotNone(task.packed_at)
        self.assertEqual(self.site, task.site)
