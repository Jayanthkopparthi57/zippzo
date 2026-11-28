"""Rider rate-card API and pay estimate."""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.network.models import Site
from bounded.delivery.models import RiderPaymentRule


class RiderPaymentRuleTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(
            email='rate-admin@zippzo.in', password_hash=make_password('Admin123!'),
            role='OPS_MANAGER', status='ACTIVE')
        self.staff = User.objects.create(
            email='rate-staff@zippzo.in', password_hash=make_password('Admin123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        self.site = Site.objects.create(code='DS-RATE', name='Rate Store', site_type='DS')
        self.rule = RiderPaymentRule.objects.create(site=self.site)
        self.rule.refresh_from_db()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_defaults_match_the_published_rate_card(self):
        self.assertEqual(Decimal('7.00'), self.rule.base_per_km)
        self.assertEqual(Decimal('5.00'), self.rule.delivery_radius_km)
        self.assertEqual(Decimal('5.00'), self.rule.busy_bonus)
        self.assertEqual(Decimal('5.00'), self.rule.rain_bonus)
        self.assertEqual(Decimal('10.00'), self.rule.busy_rain_bonus)
        self.assertEqual(15, self.rule.incentive_orders)
        self.assertEqual(Decimal('100.00'), self.rule.incentive_amount)

    def test_preview_adds_bonus_and_incentive(self):
        response = self.client.post(
            f'/api/delivery/rider-payment-rules/{self.rule.rule_id}/preview/',
            {'distance_km': 5, 'busy': True, 'rain': True, 'completed_orders': 15},
            format='json')
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual({'base': 35.0, 'bonus': 10.0, 'incentive': 100.0, 'total': 145.0}, response.data)

    def test_operator_can_read_but_not_edit(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(200, self.client.get('/api/delivery/rider-payment-rules/').status_code)
        denied = self.client.patch(
            f'/api/delivery/rider-payment-rules/{self.rule.rule_id}/',
            {'base_per_km': '99.00'}, format='json')
        self.assertEqual(403, denied.status_code, denied.data)
