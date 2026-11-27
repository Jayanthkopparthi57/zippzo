"""Packer drops the bag in a bin; rider scans that bin to collect it."""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.delivery.models import DeliveryTask, RiderProfile
from bounded.iam.models import User
from bounded.network.models import EmployeeSiteAssignment, Site
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder

BIN_DROP = '/api/ds-ops/bin-drop'
PICKUP = '/api/delivery/handoff/pickup'


class BinHandoffTests(TestCase):
    def setUp(self):
        self.site = Site.objects.create(
            code='DS-BIN-HAND', site_type='DARK_STORE', name='Bin Handoff DS',
            address='test')
        self.packer = User.objects.create(
            email='bin-packer@zippzo.in', password_hash=make_password('Pass123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        EmployeeSiteAssignment.objects.create(
            employee='BINPACK', user=self.packer, site=self.site,
            mode='DARKHOUSE', role_at_site='PACKER', is_primary=True)
        rider_user = User.objects.create(
            email='bin-rider@zippzo.in', password_hash=make_password('Pass123!'),
            role='RIDER', status='ACTIVE')
        self.rider = RiderProfile.objects.create(
            user=rider_user, name='Bin Rider', phone='9876543210',
            vehicle_type='BIKE', is_online=True, current_site=self.site)
        customer_user = User.objects.create(
            email='bin-customer@zippzo.in', password_hash=make_password('Pass123!'),
            role='CUSTOMER', status='ACTIVE')
        customer = Customer.objects.create(user=customer_user, name='Bin Customer')
        address = CustomerAddress.objects.create(
            customer=customer, label='Home', line1='1 Bin Road',
            pincode='560001', city='Bengaluru')
        order = CustomerOrder.objects.create(
            order_no='ORD-BIN-1', customer=customer, site=self.site,
            address=address, status='PACKED', payment_method='COD',
            payment_status='PENDING', subtotal=Decimal('50.00'),
            grand_total=Decimal('50.00'), placed_at=timezone.now())
        self.task = DeliveryTask.objects.create(
            order=order, site=self.site, rider=self.rider,
            status='ACCEPTED', staging_bin='STAGE-A1')
        self.packer_api = APIClient()
        self.packer_api.force_authenticate(self.packer)
        self.rider_api = APIClient()
        self.rider_api.force_authenticate(rider_user)

    def test_bin_drop_then_rider_collects_with_matching_code(self):
        r = self.packer_api.post(BIN_DROP, {
            'task_id': str(self.task.task_id), 'bin_code': 'BIN-7'}, format='json')
        self.assertEqual(200, r.status_code, r.data)
        self.task.refresh_from_db()
        self.assertEqual('BIN-7', self.task.bin_code)
        self.assertIsNotNone(self.task.bin_dropped_at)

        no_code = self.rider_api.post(PICKUP, {
            'task_id': str(self.task.task_id)}, format='json')
        self.assertEqual(409, no_code.status_code, no_code.data)
        self.assertEqual('bin_code_required', no_code.data.get('code'))

        wrong = self.rider_api.post(PICKUP, {
            'task_id': str(self.task.task_id), 'bin_code': 'BIN-8'}, format='json')
        self.assertEqual(409, wrong.status_code, wrong.data)
        self.assertEqual('wrong_bin', wrong.data.get('code'))

        ok = self.rider_api.post(PICKUP, {
            'task_id': str(self.task.task_id), 'bin_code': 'bin-7'}, format='json')
        self.assertEqual(200, ok.status_code, ok.data)
        self.task.refresh_from_db()
        self.assertEqual('PICKED_UP', self.task.status)
