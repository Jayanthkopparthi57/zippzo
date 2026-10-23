"""QR rider assignment — the counter scans, the rider gets the job.

P3 wires the two dormant seams (iam.QRCode with qr_type USER, and
RiderShift.qr_in's QRCode dependency) into the handoff counter:

  1. GET /delivery/rider-profiles/me/qr/ mints ONE stable RIDER:<id> code per
     profile — the image never changes between app opens, and the row
     doubles as the scan ledger.
  2. POST /delivery/delivery-tasks/assign-by-rider/ turns a physical scan at
     the counter into the same state the rider's own accept would reach
     (ACCEPTED + order history RIDER_ASSIGNED). The scan is the rider's
     consent, so an OFFLINE rider can still be scanned in — deliberately
     unlike accept, which the rider-side flow gates on is_online.
  3. Fencing rides on DeliveryTaskViewSet.get_queryset: an operator assigns
     only their own store's tasks, riders cannot run the counter flow at all
     (their path is accept/decline), and a superuser may scan anywhere.
  4. Re-scans are idempotent; a task already claimed by another rider is a
     409, not a silent takeover.
"""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.delivery.models import DeliveryTask, RiderProfile
from bounded.iam.models import QRCode, User
from bounded.network.models import EmployeeSiteAssignment, Site
from bounded.orders.models import (
    Customer, CustomerAddress, CustomerOrder, OrderStatusHistory,
)

QR_ENDPOINT = '/api/delivery/rider-profiles/me/qr/'
ASSIGN_ENDPOINT = '/api/delivery/delivery-tasks/assign-by-rider/'


class QrAssignmentBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(
            code='DS-QR', site_type='DARK_STORE', name='QR DS',
            address='1 Scan Road')
        cls.other_site = Site.objects.create(
            code='DS-QR2', site_type='DARK_STORE', name='Other QR DS',
            address='2 Scan Road')

        cls.rider = User.objects.create(
            email='qr-rider@zippzo.in', password_hash=make_password('Ride123!'),
            role='RIDER', status='ACTIVE', full_name='Ravi QR')
        cls.other_rider_user = User.objects.create(
            email='qr-rider2@zippzo.in', password_hash=make_password('Ride123!'),
            role='RIDER', status='ACTIVE', full_name='Rita QR')
        cls.ops = User.objects.create(
            email='qr-ops@zippzo.in', password_hash=make_password('Test123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE', full_name='Counter Cara')
        cls.admin = User.objects.create(
            email='qr-admin@zippzo.in', password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Admin Amy')

        cls.profile = RiderProfile.objects.create(
            user=cls.rider, name='Ravi QR', phone='9999999999',
            vehicle_type='BIKE', vehicle_number='KA-01', is_online=False,
            current_site=cls.site)
        cls.other_profile = RiderProfile.objects.create(
            user=cls.other_rider_user, name='Rita QR', phone='8888888888',
            vehicle_type='BIKE', vehicle_number='KA-02', is_online=True,
            current_site=cls.site)

        # The counter operator earns store access the way every operator does.
        EmployeeSiteAssignment.objects.create(
            employee='QR01', user=cls.ops, site=cls.site,
            mode='DARKHOUSE', role_at_site='HANDOFF', is_primary=True)

        cls.shopper = User.objects.create(
            email='qr-buyer@zippzo.in', password_hash=make_password('Test123!'),
            role='CUSTOMER', status='ACTIVE')
        cls.customer = Customer.objects.create(user=cls.shopper, name='Buyer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Basket Road',
            pincode='560001', city='Bengaluru', is_default=True)

    def api_for(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api

    def make_order(self, *, site=None, status='PACKED', suffix='X'):
        return CustomerOrder.objects.create(
            order_no=f'QR-{suffix}-{id(self)}', customer=self.customer,
            site=site or self.site, address=self.address, status=status,
            payment_method='COD', subtotal=Decimal('90.00'),
            grand_total=Decimal('110.00'))

    def make_task(self, *, site=None, status='UNASSIGNED', rider=None,
                  suffix='X'):
        return DeliveryTask.objects.create(
            order=self.make_order(site=site, suffix=suffix),
            site=site or self.site, rider=rider, status=status)

    def mint_qr(self):
        r = self.api_for(self.rider).get(QR_ENDPOINT)
        self.assertEqual(r.status_code, 200, r.data)
        return r.data['code']


class RiderQrTests(QrAssignmentBase):

    def test_rider_fetches_a_stable_code(self):
        first = self.api_for(self.rider).get(QR_ENDPOINT)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data['code'], f'RIDER:{self.profile.rider_id}')
        self.assertEqual(first.data['name'], 'Ravi QR')
        self.assertEqual(first.data['site'], 'DS-QR')
        self.assertFalse(first.data['is_online'])

        qr = QRCode.objects.get(code=first.data['code'])
        self.assertEqual(qr.qr_type, 'USER')
        self.assertEqual(qr.data.get('rider_id'), str(self.profile.rider_id))

        # Second fetch returns the same code — the image must not churn.
        second = self.api_for(self.rider).get(QR_ENDPOINT)
        self.assertEqual(second.data['code'], first.data['code'])
        self.assertEqual(QRCode.objects.filter(qr_type='USER').count(), 1)

    def test_accounts_without_a_profile_are_refused(self):
        self.assertEqual(self.api_for(self.ops).get(QR_ENDPOINT).status_code,
                         404)
        self.assertEqual(self.api_for(self.admin).get(QR_ENDPOINT).status_code,
                         404)


class AssignByRiderTests(QrAssignmentBase):

    def test_scan_assigns_a_staged_task(self):
        code = self.mint_qr()
        task = self.make_task(suffix='A1')

        r = self.api_for(self.ops).post(
            ASSIGN_ENDPOINT,
            {'qr_code': code, 'task_id': str(task.task_id)}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['assigned'], [str(task.task_id)])
        self.assertFalse(r.data['already_assigned'])

        task.refresh_from_db()
        self.assertEqual(task.rider_id, self.profile.rider_id)
        self.assertEqual(task.status, 'ACCEPTED')
        self.assertIsNotNone(task.accepted_at)
        self.assertIsNotNone(task.offered_at)
        self.assertTrue(OrderStatusHistory.objects.filter(
            order=task.order, to_status='RIDER_ASSIGNED').exists(),
            'the order records who it went to')

        qr = QRCode.objects.get(code=code)
        self.assertEqual(qr.scan_count, 1, 'the scan lands on the QR row')

    def test_offline_rider_can_still_be_scanned_in(self):
        # Deliberate divergence from accept: the rider is physically AT the
        # counter, which the scan proves. is_online gates the remote flow only.
        self.assertFalse(self.profile.is_online)
        code = self.mint_qr()
        task = self.make_task(suffix='A2')
        r = self.api_for(self.ops).post(
            ASSIGN_ENDPOINT,
            {'qr_code': f'zippzo:rider:{self.profile.rider_id}',
             'task_id': str(task.task_id)}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        task.refresh_from_db()
        self.assertEqual(task.status, 'ACCEPTED')

    def test_rescanning_the_same_rider_is_idempotent(self):
        code = self.mint_qr()
        task = self.make_task(suffix='A3')
        api = self.api_for(self.ops)
        api.post(ASSIGN_ENDPOINT,
                 {'qr_code': code, 'task_id': str(task.task_id)},
                 format='json')
        again = api.post(ASSIGN_ENDPOINT,
                         {'qr_code': code, 'task_id': str(task.task_id)},
                         format='json')
        self.assertEqual(again.status_code, 200, again.data)
        self.assertTrue(again.data['already_assigned'])
        self.assertEqual(QRCode.objects.get(code=code).scan_count, 2)

    def test_riders_cannot_run_the_counter_flow(self):
        task = self.make_task(suffix='A4')
        r = self.api_for(self.rider).post(
            ASSIGN_ENDPOINT,
            {'qr_code': f'RIDER:{self.profile.rider_id}',
             'task_id': str(task.task_id)}, format='json')
        self.assertEqual(r.status_code, 403)
        task.refresh_from_db()
        self.assertIsNone(task.rider_id)

    def test_task_at_another_store_is_invisible(self):
        code = self.mint_qr()
        foreign = self.make_task(site=self.other_site, suffix='A5')
        r = self.api_for(self.ops).post(
            ASSIGN_ENDPOINT,
            {'qr_code': code, 'task_id': str(foreign.task_id)}, format='json')
        self.assertEqual(r.status_code, 404)
        foreign.refresh_from_db()
        self.assertIsNone(foreign.rider_id)

    def test_admin_can_scan_across_stores(self):
        code = self.mint_qr()
        foreign = self.make_task(site=self.other_site, suffix='A6')
        r = self.api_for(self.admin).post(
            ASSIGN_ENDPOINT,
            {'qr_code': code, 'task_id': str(foreign.task_id)}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        foreign.refresh_from_db()
        self.assertEqual(foreign.rider_id, self.profile.rider_id)

    def test_a_task_claimed_by_another_rider_conflicts(self):
        code = self.mint_qr()
        task = self.make_task(suffix='A7', rider=self.other_profile,
                              status='ACCEPTED')
        r = self.api_for(self.ops).post(
            ASSIGN_ENDPOINT,
            {'qr_code': code, 'task_id': str(task.task_id)}, format='json')
        self.assertEqual(r.status_code, 409)
        task.refresh_from_db()
        self.assertEqual(task.rider_id, self.other_profile.rider_id,
                         'no silent takeover')

    def test_a_task_already_on_the_road_conflicts(self):
        code = self.mint_qr()
        task = self.make_task(suffix='A8', status='PICKED_UP')
        r = self.api_for(self.ops).post(
            ASSIGN_ENDPOINT,
            {'qr_code': code, 'task_id': str(task.task_id)}, format='json')
        self.assertEqual(r.status_code, 409)
        self.assertIn('PICKED_UP', r.data['error'])

    def test_bad_payloads_are_named(self):
        task = self.make_task(suffix='A9')
        api = self.api_for(self.ops)

        r = api.post(ASSIGN_ENDPOINT, {'task_id': str(task.task_id)},
                     format='json')
        self.assertEqual(r.status_code, 400)

        r = api.post(ASSIGN_ENDPOINT,
                     {'qr_code': 'not-a-qr',
                      'task_id': str(task.task_id)}, format='json')
        self.assertEqual(r.status_code, 404)
        self.assertIn('Not a rider QR', r.data['error'])

        r = api.post(ASSIGN_ENDPOINT,
                     {'qr_code': 'RIDER:11111111-1111-1111-1111-111111111111',
                      'task_id': str(task.task_id)}, format='json')
        self.assertEqual(r.status_code, 404)
        self.assertIn('No rider profile', r.data['error'])

        r = api.post(ASSIGN_ENDPOINT,
                     {'qr_code': 'RIDER:' + str(self.profile.rider_id)},
                     format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('task_id', r.data['error'])
