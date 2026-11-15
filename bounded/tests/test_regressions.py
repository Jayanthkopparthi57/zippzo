"""Regression pins for correctness bugs found in the audit.

Each case here failed before its fix and would fail again silently if the fix
were reverted:

  * a stock adjustment moved stock and then raised FieldError on a column that
    does not exist, so the caller saw a 500 after the ledger had already moved;
  * re-running allocation doubled the claim on an already allocated order;
  * an open stock hold was invisible to allocation, so held units were sold;
  * completing a bin transfer changed only a status and left the stock behind;
  * a bin transfer could name two different sites.
"""
from decimal import Decimal
import uuid

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.ds_ops.allocation import AllocationError, allocate_order
from bounded.ds_ops.models import BinTransfer, OrderLineAllocation
from bounded.holds.models import Hold
from bounded.iam.models import User
from bounded.inventory.models import StockBalance, StockMovement
from bounded.network.models import Location, Site
from bounded.orders.models import (
    Customer, CustomerAddress, CustomerOrder, CustomerOrderLine,
)

ADJUSTMENTS = '/api/inventory/adjustments'
BIN_TRANSFERS = '/api/ds-ops/bin-transfers/'


def _user(email, role):
    return User.objects.create(
        email=email, password_hash=make_password('Pass123!'),
        role=role, status='ACTIVE',
    )


def _site(code, site_type='DARK_STORE'):
    return Site.objects.create(
        code=code, site_type=site_type, name=code, address='x', status='ACTIVE',
    )


def _sku(code):
    return Sku.objects.create(
        sku_code=code, name=code, sub_category='Grocery', brand='Zippzo',
        pack_size='1', hsn_code='1904',
    )


def _lot(site, sku, batch):
    return InventoryLot.objects.create(
        sku=sku, site=site, batch_number=batch,
        inbound_type='PURCHASE', inbound_ref=f'PO-{batch}',
    )


def _bin(site, location_id, barcode):
    return Location.objects.create(
        site=site, location_id=location_id, location_type='BIN',
        aisle='A1', rack='R1', level='L1', position=location_id[-2:],
        barcode=barcode, is_sellable_bin=True, created_by='test',
    )


def _order_with_line(site, sku, lot, qty, marker):
    customer = Customer.objects.create(
        user=_user(f'cust-{marker}@zippzo.in', 'CUSTOMER'), name='Test Customer')
    address = CustomerAddress.objects.create(
        customer=customer, label='Home', line1='1 Road',
        pincode='560001', city='Bengaluru',
    )
    order = CustomerOrder.objects.create(
        order_no=f'ORD-{marker}', customer=customer, site=site,
        address=address, status='CONFIRMED', payment_method='PREPAID',
        payment_status='CAPTURED', subtotal=Decimal('100.00'),
        grand_total=Decimal('100.00'), placed_at=timezone.now(),
    )
    CustomerOrderLine.objects.create(
        order=order, line_no=1, sku=sku, lot=lot,
        qty=qty, unit_price=Decimal('50.00'), line_total=Decimal('100.00'),
    )
    return order


class StockAdjustmentApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = _site('DS-ADJ-1')
        cls.sku = _sku('ADJ-SKU-1')
        cls.lot = _lot(cls.site, cls.sku, 'LOT-ADJ-1')
        StockBalance.objects.create(
            site=cls.site, container='SITE', container_ref='',
            sku=cls.sku, lot=cls.lot, qty=10, sellable=True,
        )
        cls.admin = _user('adj-admin@zippzo.in', 'SUPER_ADMIN')
        cls.approver = _user('adj-approver@zippzo.in', 'OPS_MANAGER')

    def test_adjustment_links_its_movement_and_returns_201(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        response = api.post(ADJUSTMENTS, {
            'site_code': self.site.code,
            'sku_id': str(self.sku.sku_id),
            'lot_id': str(self.lot.lot_id),
            'qty_delta': -3,
            'reason': 'Cycle count variance found on shelf A1',
            'approved_by': str(self.approver.user_id),
            'idempotency_key': f'adj-{uuid.uuid4()}',
        }, format='json')

        self.assertEqual(201, response.status_code, response.data)
        self.assertIsNotNone(response.data['movement_id'])
        balance = StockBalance.objects.get(
            site=self.site, container='SITE', sku=self.sku, lot=self.lot)
        self.assertEqual(7, balance.qty)
        self.assertTrue(StockMovement.objects.filter(
            movement_ref='ADJUST', ref_id=response.data['adjustment_id']).exists())


class AllocationRegressionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = _site('DS-ALLOC-1')
        cls.bin = _bin(cls.site, 'BIN-ALLOC-01', 'BIN-ALLOC-01')
        cls.sku = _sku('ALLOC-SKU-1')
        cls.lot = _lot(cls.site, cls.sku, 'LOT-ALLOC-1')
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin.location_id,
            sku=cls.sku, lot=cls.lot, qty=10,
        )

    def _order(self, marker, qty=5):
        return _order_with_line(self.site, self.sku, self.lot, qty, marker)

    def test_reallocating_a_full_order_does_not_double_the_claim(self):
        order = self._order('ALLOC-TWICE')
        allocate_order(order)
        allocate_order(order)
        alloc = OrderLineAllocation.objects.get(line__order=order)
        self.assertEqual(5, alloc.qty)

    def test_open_hold_reduces_what_can_be_allocated(self):
        # Three of the ten units are quarantined, so a five-unit line cannot be
        # covered even though the balance still reads ten.
        order = self._order('ALLOC-HOLD', qty=8)
        Hold.objects.create(
            site=self.site.code, sku=self.sku.sku_id, lot=self.lot.lot_id,
            container_from='BIN', container_ref=self.bin.location_id,
            qty=3, trigger_reason='Quality inspection',
            created_by='test',
        )
        with self.assertRaises(AllocationError):
            allocate_order(order)


class BinTransferTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = _site('DS-BINXFER-1')
        cls.other_site = _site('DS-BINXFER-2')
        cls.source = _bin(cls.site, 'BIN-XFER-01', 'BIN-XFER-01')
        cls.dest = _bin(cls.site, 'BIN-XFER-02', 'BIN-XFER-02')
        cls.foreign = _bin(cls.other_site, 'BIN-XFER-03', 'BIN-XFER-03')
        cls.sku = _sku('XFER-SKU-1')
        cls.lot = _lot(cls.site, cls.sku, 'LOT-XFER-1')
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.source.location_id,
            sku=cls.sku, lot=cls.lot, qty=4,
        )
        cls.admin = _user('xfer-admin@zippzo.in', 'SUPER_ADMIN')

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def test_cannot_transfer_between_sites(self):
        response = self.api.post(BIN_TRANSFERS, {
            'source_bin': self.source.location_id,
            'dest_bin': self.foreign.location_id,
            'status': 'CREATED',
        }, format='json')
        self.assertEqual(400, response.status_code, response.data)
        self.assertIn('dest_bin', response.data)

    def test_completing_a_transfer_moves_the_stock(self):
        created = self.api.post(BIN_TRANSFERS, {
            'source_bin': self.source.location_id,
            'dest_bin': self.dest.location_id,
            'status': 'CREATED',
        }, format='json')
        self.assertEqual(201, created.status_code, created.data)

        response = self.api.patch(
            f"{BIN_TRANSFERS}{created.data['transfer_id']}/",
            {'status': 'COMPLETED', 'scanned_items': {}}, format='json')
        self.assertEqual(400, response.status_code, response.data)
        self.assertEqual(4, StockBalance.objects.get(
            site=self.site, container='BIN', container_ref=self.source.location_id,
            sku=self.sku, lot=self.lot,
        ).qty)

        response = self.api.patch(
            f"{BIN_TRANSFERS}{created.data['transfer_id']}/",
            {
                'status': 'COMPLETED',
                'scanned_items': {str(self.sku.sku_id): 4},
            },
            format='json',
        )
        self.assertEqual(200, response.status_code, response.data)

        source = StockBalance.objects.filter(
            site=self.site, container='BIN', container_ref=self.source.location_id,
            sku=self.sku, lot=self.lot).first()
        dest = StockBalance.objects.filter(
            site=self.site, container='BIN', container_ref=self.dest.location_id,
            sku=self.sku, lot=self.lot).first()
        self.assertTrue(source is None or source.qty == 0)
        self.assertIsNotNone(dest)
        self.assertEqual(4, dest.qty)
        self.assertEqual(
            2, StockMovement.objects.filter(movement_ref='BIN_TRANSFER').count())
