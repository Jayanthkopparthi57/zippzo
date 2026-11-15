import re

from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from bounded.iam.models import Session, User


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    DEFAULT_FROM_EMAIL='test@zippzo.invalid',
)
class ShopperAccountFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.email = 'new-shopper@example.test'

    def code_from_email(self):
        self.assertEqual(len(mail.outbox), 1)
        match = re.search(r'\b(\d{6})\b', mail.outbox[-1].body)
        self.assertIsNotNone(match)
        return match.group(1)

    def test_register_creates_active_account_without_mail(self):
        # Email verification is removed for launch: registration must not
        # depend on (or attempt) mail delivery.
        response = self.client.post('/api/iam/auth/shopper/register', {
            'email': self.email, 'name': 'Asha Rao', 'phone': '9876543210',
            'password': 'Shopper!Account2026',
        }, format='json')
        self.assertEqual(response.status_code, 202)
        self.assertNotIn('code', response.data)
        self.assertEqual(len(mail.outbox), 0)
        user = User.objects.get(email=self.email)
        self.assertEqual(user.status, 'ACTIVE')
        logged_in = self.client.post('/api/iam/auth/login', {
            'email': self.email, 'password': 'Shopper!Account2026',
            'app': 'SHOPPER', 'surface': 'mobile',
        }, format='json')
        self.assertEqual(logged_in.status_code, 200)
        self.assertEqual(logged_in.data['user']['role'], 'CUSTOMER')

    def test_reset_is_generic_and_revokes_existing_sessions(self):
        user = User.objects.create(
            email=self.email, full_name='Asha', phone='9876543210',
            role='CUSTOMER', status='ACTIVE',
            password_hash='pbkdf2_sha256$720000$RANDOM$RANDOM',
        )
        # Use the configured hasher; only the account flow's actual login matters.
        from django.contrib.auth.hashers import make_password
        user.password_hash = make_password('Shopper!Account2026')
        user.save(update_fields=['password_hash'])
        login = self.client.post('/api/iam/auth/login', {
            'email': self.email, 'password': 'Shopper!Account2026',
            'app': 'SHOPPER', 'surface': 'mobile',
        }, format='json')
        self.assertEqual(login.status_code, 200)
        self.assertEqual(Session.objects.filter(user=user, is_active=True).count(), 1)
        requested = self.client.post('/api/iam/auth/shopper/password-reset', {
            'email': self.email,
        }, format='json')
        unknown = self.client.post('/api/iam/auth/shopper/password-reset', {
            'email': 'missing@example.test',
        }, format='json')
        self.assertEqual(requested.status_code, unknown.status_code)
        self.assertEqual(requested.data, unknown.data)
        changed = self.client.post('/api/iam/auth/shopper/password-reset/confirm', {
            'email': self.email, 'code': self.code_from_email(),
            'new_password': 'NewShopper!Password2026',
        }, format='json')
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(Session.objects.filter(user=user, is_active=True).count(), 0)
        self.assertEqual(self.client.post('/api/iam/auth/login', {
            'email': self.email, 'password': 'NewShopper!Password2026',
            'app': 'SHOPPER',
        }, format='json').status_code, 200)

    def test_verify_email_endpoint_accepts_any_code_for_launch(self):
        # Compatibility shim: email verification is removed for launch, so
        # the endpoint accepts any code (keeps installed shopper builds usable).
        self.client.post('/api/iam/auth/shopper/register', {
            'email': self.email, 'name': 'Asha Rao', 'phone': '9876543210',
            'password': 'Shopper!Account2026',
        }, format='json')
        response = self.client.post('/api/iam/auth/shopper/verify-email', {
            'email': self.email, 'code': '000000',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('code', response.data)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend')
    def test_registration_does_not_depend_on_mail(self):
        response = self.client.post('/api/iam/auth/shopper/register', {
            'email': self.email, 'name': 'Asha Rao', 'phone': '9876543210',
            'password': 'Shopper!Account2026',
        }, format='json')
        self.assertEqual(response.status_code, 202)
        self.assertEqual(User.objects.get(email=self.email).status, 'ACTIVE')
