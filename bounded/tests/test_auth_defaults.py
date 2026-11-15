"""Deny-by-default guard for the whole DRF surface.

`REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES']` is set to IsAuthenticated because
without it every viewset that omits `permission_classes` silently falls back to
AllowAny. That regression previously exposed customer PII, orders, payments,
refunds, rider earnings and the OpenAPI schema to anonymous callers, and a green
build plus a passing HTTP pipeline test did not catch it.

These tests walk the resolved URLconf so a newly added view is covered without
anyone remembering to extend a hand-written list.
"""
from types import SimpleNamespace
from unittest.mock import Mock

from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import URLPattern, URLResolver, get_resolver, reverse
from rest_framework.test import APIClient

from bounded.iam import staff_auth

_REGEX_CHARS = set('^$?()[]<>+\\')


def _is_literal(pattern):
    return not any(c in _REGEX_CHARS for c in pattern)


def _iter_api_endpoints(prefix='', resolver=None, acc=None):
    """Yield (concrete_path, methods) for every route under /api/.

    Router-generated patterns are regexes, so list routes are recovered with
    reverse() on the pattern name; detail routes need a pk and are skipped —
    their viewset's list route exercises the same permission classes.
    """
    resolver = resolver or get_resolver()
    acc = acc if acc is not None else []

    for pattern in resolver.url_patterns:
        if isinstance(pattern, URLResolver):
            _iter_api_endpoints(prefix + str(pattern.pattern), pattern, acc)
        elif isinstance(pattern, URLPattern):
            raw = str(pattern.pattern)
            full = prefix + raw
            if not full.startswith('api/'):
                continue

            if _is_literal(raw):
                path = full
            elif pattern.name and pattern.name.endswith('-list'):
                try:
                    path = reverse(pattern.name).lstrip('/')
                except Exception:
                    continue
            else:
                continue

            if path.rstrip('/').endswith(('format', 'api-root')):
                continue

            callback = pattern.callback
            cls = getattr(callback, 'cls', None)
            actions = getattr(callback, 'actions', None) or getattr(cls, 'actions', None)
            methods = set()
            if actions:
                methods = {verb.upper() for verb in actions}
            elif hasattr(callback, 'http_method_names'):
                methods = {m.upper() for m in callback.http_method_names
                           if m not in ('options', 'head')}
            elif hasattr(callback, 'methods'):
                methods = {m.upper() for m in callback.methods
                           if m not in ('options', 'head')}
            acc.append((path, methods or {'GET'}))
    return acc


# The only paths an anonymous client is allowed to reach.
# `api/health/` is Render's liveness probe: it has no token, which is exactly
# why it is a plain Django view rather than a DRF one. It reports 503 rather
# than 200 inside this DB-free test, so it must be skipped like login.
PUBLIC_PREFIXES = (
    'api/iam/auth/login',
    'api/iam/auth/shopper/register',
    'api/iam/auth/shopper/verify-email',
    'api/iam/auth/shopper/password-reset',
    'api/iam/auth/shopper/password-reset/confirm',
    'api/health/',
)


class AnonymousAccessIsDeniedTests(SimpleTestCase):
    """An anonymous client must get 401/403 from every non-auth endpoint.

    Deliberately DB-free (SimpleTestCase): DRF rejects before the view body
    runs, so this stays runnable even when the shared Neon instance is down.
    """

    def setUp(self):
        self.client = APIClient()
        self.endpoints = _iter_api_endpoints()

    def test_endpoints_were_discovered(self):
        # Guard against the walker silently matching nothing, which would make
        # the rest of this class vacuously pass.
        self.assertGreater(len(self.endpoints), 40,
                           'URL walker found too few endpoints to be meaningful')

    def test_anonymous_client_is_denied_every_non_auth_endpoint(self):
        leaks = []

        for path, methods in self.endpoints:
            if any(path.startswith(p) for p in PUBLIC_PREFIXES):
                continue

            for method in sorted(methods):
                with self.subTest(endpoint=path, method=method):
                    handler = getattr(self.client, method.lower())
                    response = handler('/' + path.lstrip('/'))
                    if response.status_code not in (401, 403, 405, 410):
                        leaks.append(
                            f'{method} /{path} -> {response.status_code}')

        self.assertEqual(
            [], leaks,
            'Anonymous access is still granted on these endpoints:\n  '
            + '\n  '.join(leaks))

    def test_login_endpoint_is_not_in_the_deny_list(self):
        self.assertTrue(
            any(p == 'api/iam/auth/login' for p, _ in self.endpoints),
            'login endpoint disappeared from the URLconf')


class AdminOnlyEndpointTests(TestCase):
    """IsAdminUser must gate reads as well as writes.

    It used to return True for every SAFE_METHOD, so any authenticated
    operator could read /api/iam/users/ — the full user table with emails and
    roles — even though the class is documented as admin-only.
    """

    @classmethod
    def setUpTestData(cls):
        from django.contrib.auth.hashers import make_password

        from bounded.iam.models import User

        # Custom User model: no create_user(), and the password lives in
        # password_hash rather than Django's `password` field.
        cls.admin = User.objects.create(
            email='auth-guard-admin@zippzo.in',
            password_hash=make_password('GuardTest123!'),
            role='SUPER_ADMIN',
            status='ACTIVE',
        )
        cls.operator = User.objects.create(
            email='auth-guard-operator@zippzo.in',
            password_hash=make_password('GuardTest123!'),
            role='WAREHOUSE_STAFF',
            status='ACTIVE',
        )

    def setUp(self):
        # force_authenticate lives on DRF's APIClient, not Django's test Client.
        self.api = APIClient()

    def test_non_admin_cannot_read_the_user_list(self):
        self.api.force_authenticate(self.operator)
        response = self.api.get('/api/iam/users/')
        self.assertEqual(403, response.status_code,
                         'a non-admin can read /api/iam/users/')

    def test_non_admin_cannot_write_the_user_list(self):
        self.api.force_authenticate(self.operator)
        response = self.api.post('/api/iam/users/', {}, format='json')
        self.assertEqual(403, response.status_code,
                         'a non-admin can write /api/iam/users/')

    def test_admin_can_read_the_user_list(self):
        self.api.force_authenticate(self.admin)
        response = self.api.get('/api/iam/users/')
        self.assertEqual(200, response.status_code,
                         'IsAdminUser now blocks SUPER_ADMIN as well')


class CurrentUserEndpointTests(TestCase):
    """`/iam/auth/me` lets every role validate its own session on boot.

    Session restore used to call /iam/users/, which is admin-only, so a
    shopper, rider or warehouse operator was logged out on reload.
    """

    @classmethod
    def setUpTestData(cls):
        from django.contrib.auth.hashers import make_password

        from bounded.iam.models import User

        cls.staff = User.objects.create(
            email='me-staff@zippzo.in',
            password_hash=make_password('MeTest123!'),
            role='WAREHOUSE_STAFF',
            status='ACTIVE',
        )
        cls.shopper = User.objects.create(
            email='me-shopper@zippzo.in',
            password_hash=make_password('MeTest123!'),
            role='CUSTOMER',
            status='ACTIVE',
        )

    def test_anonymous_is_rejected(self):
        response = APIClient().get('/api/iam/auth/me')
        self.assertIn(response.status_code, (401, 403))

    def test_any_authenticated_role_gets_its_own_record(self):
        for user in (self.staff, self.shopper):
            with self.subTest(role=user.role):
                from bounded.iam import staff_auth
                session, _, _ = staff_auth.create_session(user, None, 'web', None)
                user.session = session
                user.active_facility = None
                api = APIClient()
                api.force_authenticate(user=user)
                response = api.get('/api/iam/auth/me')
                self.assertEqual(200, response.status_code)
                self.assertEqual(user.email, response.data['user']['email'])
                self.assertEqual(user.role, response.data['user']['role'])
                self.assertEqual('WMS' if user.role == 'WAREHOUSE_STAFF' else 'SHOPPER',
                                 response.data['target_app'])


class LoginEndpointPublicTests(TestCase):
    """Needs the DB: it proves the one deliberate public endpoint still works."""

    def test_login_endpoint_is_public(self):
        response = self.client.post(
            '/api/iam/auth/login',
            {'email': 'nobody@example.invalid', 'password': 'wrong'},
            format='json')
        self.assertEqual(401, response.status_code)
        # 401 (not 403) means the view actually ran and rejected the credentials
        # rather than being blocked by a permission class.


class PermissionDefaultsTests(SimpleTestCase):
    databases = []

    def test_default_permission_classes_require_authentication(self):
        from rest_framework.permissions import IsAuthenticated
        from rest_framework.settings import api_settings

        defaults = api_settings.DEFAULT_PERMISSION_CLASSES
        self.assertTrue(defaults, 'DEFAULT_PERMISSION_CLASSES is unset (AllowAny fallback)')
        self.assertIn(IsAuthenticated, defaults)

    def test_known_sensitive_endpoints_deny_anonymous(self):
        """Spot-check the endpoints that were confirmed open in the audit."""
        client = APIClient()
        for path in (
            '/api/orders/orders/',
            '/api/orders/customers/',
            '/api/supply/putaway-tasks/',
            '/api/inventory/positions',
            '/api/catalog/skus/',
            '/api/money/payments/',
            '/api/money/refunds/',
            '/api/ds-ops/pick-tasks/',
            '/api/network/overview',
            '/api/schema/',
        ):
            with self.subTest(endpoint=path):
                response = client.get(path)
                self.assertIn(response.status_code, (401, 403),
                              f'{path} is reachable anonymously ({response.status_code})')


class OtpDeliveryBoundaryTests(SimpleTestCase):
    databases = []

    def setUp(self):
        self.challenge = SimpleNamespace(
            user=SimpleNamespace(email='operator@example.test'),
            facility_id=None,
            facility=None,
            challenge_id='challenge-test-id',
        )

    @override_settings(DEBUG=False, OTP_DEV_ECHO=False, IAM_OTP_SENDER=None)
    def test_missing_production_sender_fails_without_logging_code(self):
        with self.assertLogs('bounded.iam.staff_auth', level='ERROR') as logs:
            with self.assertRaises(staff_auth.OtpDeliveryUnavailable):
                staff_auth._deliver_otp(self.challenge, '123456')
        self.assertNotIn('123456', '\n'.join(logs.output))

    @override_settings(DEBUG=True, OTP_DEV_ECHO=True, IAM_OTP_SENDER=None)
    def test_development_echo_does_not_log_code(self):
        with self.assertLogs('bounded.iam.staff_auth', level='INFO') as logs:
            staff_auth._deliver_otp(self.challenge, '123456')
        self.assertNotIn('123456', '\n'.join(logs.output))

    @override_settings(DEBUG=True, OTP_DEV_ECHO=True)
    def test_configured_sender_receives_the_code(self):
        sender = Mock()
        with override_settings(IAM_OTP_SENDER=sender):
            staff_auth._deliver_otp(self.challenge, '123456')
            self.assertFalse(staff_auth.dev_echo_allowed())
        sender.assert_called_once_with(self.challenge.user, '123456', self.challenge)
