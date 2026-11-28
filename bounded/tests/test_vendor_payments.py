"""Vendor master + payment ledger shared by the MH and DS consoles.

Reads are available to every authenticated operator; writes are restricted to
SUPER_ADMIN / OPS_MANAGER, matching the existing supplier master contract.
"""
from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.supply.models import Vendor, VendorPayment


def _user(email, role):
    return User.objects.create(
        email=email, password_hash=make_password('Admin123!'),
        role=role, status='ACTIVE')


class VendorPaymentTests(TestCase):
    def setUp(self):
        self.admin = _user('vendor-admin@zippzo.in', 'OPS_MANAGER')
        self.staff = _user('vendor-staff@zippzo.in', 'WAREHOUSE_STAFF')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_admin_creates_vendor_with_bank_details(self):
        response = self.client.post('/api/supply/vendors/', {
            'code': 'V-PAY-1', 'name': 'Sree Ram Company', 'org_entity': 'ITC',
            'gstin': 'GSTIN123456', 'bank_name': 'HDFC Bank',
            'bank_account_number': '123456789012', 'ifsc': 'HDFC0005678',
            'account_holder_name': 'Sree Ram Company', 'payment_status': 'PENDING',
        }, format='json')
        self.assertEqual(201, response.status_code, response.data)
        vendor = Vendor.objects.get(code='V-PAY-1')
        self.assertEqual('HDFC0005678', vendor.ifsc)
        self.assertEqual('PENDING', vendor.payment_status)

    def test_payment_record_round_trip_and_stamping(self):
        vendor = Vendor.objects.create(code='V-PAY-2', name='ABC Traders')
        response = self.client.post('/api/supply/vendor-payments/', {
            'vendor': str(vendor.vendor_id), 'amount': '50000.00',
            'status': 'COMPLETE', 'payment_date': '2026-11-25',
            'bank_name': 'SBI Bank', 'ifsc': 'SBIN0001234', 'reference': 'UTR-1',
        }, format='json')
        self.assertEqual(201, response.status_code, response.data)
        payment = VendorPayment.objects.get(reference='UTR-1')
        self.assertEqual(self.admin.user_id, payment.created_by)
        listed = self.client.get('/api/supply/vendor-payments/')
        self.assertEqual(200, listed.status_code)
        self.assertEqual('ABC Traders', listed.data['results'][0]['vendor_name'])

    def test_staff_can_read_but_not_write(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(200, self.client.get('/api/supply/vendors/').status_code)
        self.assertEqual(200, self.client.get('/api/supply/vendor-payments/').status_code)
        denied = self.client.post('/api/supply/vendor-payments/', {
            'vendor': str(Vendor.objects.create(code='V-PAY-3', name='X').vendor_id),
            'amount': '10', 'payment_date': '2026-11-25',
        }, format='json')
        self.assertEqual(403, denied.status_code, denied.data)
