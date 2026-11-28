"""Cashfree Payouts for vendor payments and staff salaries.

The provider HTTP layer is mocked: these tests pin the local contract (who may
pay, which beneficiary/reference ids are sent, and how the result is stored)
without calling Cashfree.
"""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.money.models import EmployeeBankDetail, SalaryPayment
from bounded.network.models import Site
from bounded.supply.models import Vendor, VendorPayment


@override_settings(
    CASHFREE_PAYOUT_APP_ID='payout-app', CASHFREE_PAYOUT_SECRET_KEY='payout-secret',
    CASHFREE_ENV='sandbox')
class CashfreePayoutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create(
            email='payout-admin@zippzo.in', password_hash=make_password('Admin123!'),
            role='OPS_MANAGER', status='ACTIVE')
        self.staff = User.objects.create(
            email='payout-staff@zippzo.in', password_hash=make_password('Admin123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        self.site = Site.objects.create(code='DS-PAY', name='Pay Store', site_type='DS')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.responses = [
            {'status': 'SUCCESS', 'data': {'token': 'payout-token'}},
            {'status': 'SUCCESS', 'data': {'beneficiary_id': 'VEN_1'}},
            {'status': 'SUCCESS', 'data': {'transfer_id': 'CFTR_1', 'status': 'SUCCESS'}},
        ]

    def _provider(self):
        return patch('bounded.money.cashfree_payouts._request',
                     side_effect=lambda *a, **kw: self.responses.pop(0))

    def test_vendor_payment_is_sent_through_cashfree(self):
        vendor = Vendor.objects.create(
            code='V-PAY-CF', name='Sree Ram Company', bank_account_number='1234567890',
            ifsc='HDFC0005678', email='vendor@example.com')
        payment = VendorPayment.objects.create(
            vendor=vendor, amount=Decimal('70000'), status='PENDING',
            payment_date='2026-11-25', bank_account_number='1234567890', ifsc='HDFC0005678')
        with self._provider():
            response = self.client.post(f'/api/supply/vendor-payments/{payment.payment_id}/pay/')
        self.assertEqual(200, response.status_code, response.data)
        payment.refresh_from_db()
        self.assertEqual('CASHFREE', payment.payout_channel)
        self.assertEqual('SUCCESS', payment.payout_status)
        self.assertEqual('CFTR_1', payment.transfer_id)
        self.assertEqual('COMPLETE', payment.status)
        self.assertEqual(f'VP{str(payment.payment_id).replace("-", "")[:20]}', payment.payout_reference)

    def test_vendor_payment_requires_bank_details(self):
        vendor = Vendor.objects.create(code='V-PAY-NOBANK', name='No Bank')
        payment = VendorPayment.objects.create(
            vendor=vendor, amount=Decimal('10'), payment_date='2026-11-25')
        response = self.client.post(f'/api/supply/vendor-payments/{payment.payment_id}/pay/')
        self.assertEqual(400, response.status_code, response.data)

    def test_salary_is_sent_through_cashfree(self):
        EmployeeBankDetail.objects.create(
            user=self.staff, bank_name='HDFC Bank', bank_account_number='9876543210',
            ifsc='HDFC0001111', account_holder_name='Payout Staff')
        salary = SalaryPayment.objects.create(
            user=self.staff, site=self.site, amount=Decimal('12500'),
            period_start='2026-11-01', period_end='2026-11-30')
        with self._provider():
            response = self.client.post(f'/api/money/salary-payments/{salary.payment_id}/pay/')
        self.assertEqual(200, response.status_code, response.data)
        salary.refresh_from_db()
        self.assertEqual('SUCCESS', salary.payout_status)
        self.assertEqual('PAID', salary.status)
        self.assertTrue(salary.beneficiary_id.startswith('EMP_'))

    def test_operator_cannot_send_a_payout(self):
        vendor = Vendor.objects.create(
            code='V-PAY-DENY', name='Denied', bank_account_number='1', ifsc='IFSC1')
        payment = VendorPayment.objects.create(
            vendor=vendor, amount=Decimal('10'), payment_date='2026-11-25')
        self.client.force_authenticate(self.staff)
        response = self.client.post(f'/api/supply/vendor-payments/{payment.payment_id}/pay/')
        self.assertEqual(403, response.status_code, response.data)
