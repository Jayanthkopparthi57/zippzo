"""Shared staff identity, OTP, sessions and the new physical-stock boundary."""

from django.contrib.auth.hashers import make_password
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.iam import staff_auth
from bounded.iam.models import LoginChallenge, User
from bounded.inventory.models import StockBalance, StockMovement
from bounded.inventory.stock import apply_stock
from bounded.network.models import EmployeeSiteAssignment, Site


def _site(code, site_type='MH'):
    return Site.objects.create(code=code, site_type=site_type, name=code, address='x', status='ACTIVE')


def _user(email, role='WAREHOUSE_STAFF'):
    return User.objects.create(
        email=email, password_hash=make_password('Pass123!'), role=role, status='ACTIVE')


def _assign(user, site, role_at_site='PICKER'):
    return EmployeeSiteAssignment.objects.create(
        employee=f'EMP-{user.email}'[:20], user=user, site=site,
        mode='DARKHOUSE', role_at_site=role_at_site, is_primary=True, is_active=True)


def _login(client, email, password='Pass123!', surface='web', app='WMS'):
    r = client.post('/api/iam/auth/login',
                    {'email': email, 'password': password, 'app': app, 'surface': surface},
                    format='json')
    return r


@override_settings(DEBUG=True, OTP_DEV_ECHO=True, IAM_OTP_SENDER=None)
class SingleSiteRoutingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = _site('MH-SINGLE')
        cls.user = _user('single@zippzo.in')
        _assign(cls.user, cls.site)

    def test_single_site_goes_straight_to_otp(self):
        client = APIClient()
        r = _login(client, 'single@zippzo.in')
        self.assertEqual(403, r.status_code)
        self.assertTrue(r.data.get('otp_required'))
        self.assertFalse(r.data.get('facility_required', False))
        self.assertEqual('MH-SINGLE', r.data['facility']['code'])

    def test_multi_site_returns_chooser(self):
        site2 = _site('MH-MULTI2')
        user = _user('multi@zippzo.in')
        _assign(user, self.site)
        _assign(user, site2)
        client = APIClient()
        r = _login(client, 'multi@zippzo.in')
        self.assertEqual(200, r.status_code)
        self.assertTrue(r.data.get('facility_required'))
        codes = {f['code'] for f in r.data['facilities']}
        self.assertEqual({'MH-SINGLE', 'MH-MULTI2'}, codes)

    def test_typed_unassigned_facility_is_rejected(self):
        other = _site('MH-OTHER')
        client = APIClient()
        r = _login(client, 'single@zippzo.in')
        challenge_id = r.data['challenge_id']
        token = r.data['challenge_token']
        r2 = client.post('/api/iam/auth/facility', {
            'challenge_id': challenge_id,
            'challenge_token': token,
            'facility_code': 'MH-OTHER',
        }, format='json')
        self.assertEqual(403, r2.status_code)


@override_settings(DEBUG=True, OTP_DEV_ECHO=True, IAM_OTP_SENDER=None)
class OtpTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = _site('MH-OTP')
        cls.user = _user('otp@zippzo.in')
        _assign(cls.user, cls.site)

    def _challenge(self, client):
        r = _login(client, 'otp@zippzo.in')
        return r.data

    def test_wrong_code_increments_attempts(self):
        client = APIClient()
        c = self._challenge(client)
        r = client.post('/api/iam/auth/otp/verify', {
            'challenge_id': c['challenge_id'],
            'challenge_token': c['challenge_token'],
            'otp': '000000',
        }, format='json')
        self.assertEqual(403, r.status_code)
        challenge = LoginChallenge.objects.get(challenge_id=c['challenge_id'])
        self.assertEqual(1, challenge.attempts)

    def test_replay_is_rejected(self):
        client = APIClient()
        c = self._challenge(client)
        code = c['dev_otp']
        r1 = client.post('/api/iam/auth/otp/verify', {
            'challenge_id': c['challenge_id'],
            'challenge_token': c['challenge_token'],
            'otp': code,
        }, format='json')
        self.assertEqual(200, r1.status_code)
        r2 = client.post('/api/iam/auth/otp/verify', {
            'challenge_id': c['challenge_id'],
            'challenge_token': c['challenge_token'],
            'otp': code,
        }, format='json')
        self.assertEqual(403, r2.status_code)

    def test_lockout_after_five_attempts(self):
        client = APIClient()
        c = self._challenge(client)
        for _ in range(5):
            client.post('/api/iam/auth/otp/verify', {
                'challenge_id': c['challenge_id'],
                'challenge_token': c['challenge_token'],
                'otp': '111111',
            }, format='json')
        r = client.post('/api/iam/auth/otp/verify', {
            'challenge_id': c['challenge_id'],
            'challenge_token': c['challenge_token'],
            'otp': '111111',
        }, format='json')
        self.assertEqual(403, r.status_code)

    def test_expired_code_is_rejected(self):
        client = APIClient()
        c = self._challenge(client)
        challenge = LoginChallenge.objects.get(challenge_id=c['challenge_id'])
        challenge.expires_at = timezone.now() - timezone.timedelta(minutes=1)
        challenge.save(update_fields=['expires_at'])
        r = client.post('/api/iam/auth/otp/verify', {
            'challenge_id': c['challenge_id'],
            'challenge_token': c['challenge_token'],
            'otp': c['dev_otp'],
        }, format='json')
        self.assertEqual(403, r.status_code)


@override_settings(DEBUG=True, OTP_DEV_ECHO=True, IAM_OTP_SENDER=None)
class SessionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = _site('MH-SESS')
        cls.user = _user('sess@zippzo.in')
        _assign(cls.user, cls.site)

    def _session(self, client):
        c = _login(client, 'sess@zippzo.in')
        code = c.data['dev_otp']
        r = client.post('/api/iam/auth/otp/verify', {
            'challenge_id': c.data['challenge_id'],
            'challenge_token': c.data['challenge_token'],
            'otp': code,
        }, format='json')
        return r.data

    def test_refresh_rotates_and_revokes_old_token(self):
        client = APIClient()
        data = self._session(client)
        token = data['token']
        refresh = data['refresh_token']
        r = client.post('/api/iam/auth/refresh', {'refresh_token': refresh}, format='json')
        self.assertEqual(200, r.status_code)
        new_token = r.data['token']
        self.assertNotEqual(token, new_token)
        # Old access token is superseded.
        r2 = client.get('/api/iam/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertIn(r2.status_code, (401, 403))

    def test_logout_revokes_session(self):
        client = APIClient()
        data = self._session(client)
        token = data['token']
        refresh = data['refresh_token']
        client.post('/api/iam/auth/logout', {'refresh_token': refresh}, format='json')
        r = client.get('/api/iam/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertIn(r.status_code, (401, 403))

    def test_assignment_removal_revokes_capability(self):
        client = APIClient()
        data = self._session(client)
        token = data['token']
        # Remove the assignment row.
        EmployeeSiteAssignment.objects.filter(user=self.user).update(is_active=False)
        r = client.get('/api/iam/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        # Session may still read but facility access is gone; physical endpoints fail.
        self.assertIn(r.status_code, (200, 401, 403))
        if r.status_code == 200:
            self.assertIsNone(r.data.get('facility'))


@override_settings(DEBUG=True, OTP_DEV_ECHO=True, IAM_OTP_SENDER=None)
class SurfaceBoundaryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = _site('MH-SURF')
        cls.user = _user('surf@zippzo.in')
        _assign(cls.user, cls.site)

    def _token(self, surface):
        client = APIClient()
        c = _login(client, 'surf@zippzo.in', surface=surface)
        code = c.data['dev_otp']
        r = client.post('/api/iam/auth/otp/verify', {
            'challenge_id': c.data['challenge_id'],
            'challenge_token': c.data['challenge_token'],
            'otp': code,
        }, format='json')
        return r.data['token'], client

    def test_web_token_cannot_call_physical_endpoint(self):
        token, client = self._token('web')
        r = client.post('/api/inventory/relocate', {}, format='json',
                        HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(403, r.status_code)
        self.assertIn('physical_execution_requires_mobile', str(r.data))

    def test_console_role_web_token_may_execute(self):
        """The WMS console is a web surface for SUPERVISOR/ADMIN roles.

        The floor stays mobile-only, but a warehouse supervisor runs dock,
        putaway and dispatch from the console. Without this the console's
        Inward/GRN, putaway and pack-bundle actions 403'd on every click.
        """
        admin = _user('console-surface@zippzo.in', role='OPS_MANAGER')
        _assign(admin, self.site)
        client = APIClient()
        c = _login(client, 'console-surface@zippzo.in', surface='web')
        if 'token' in c.data:
            token = c.data['token']
        else:
            r = client.post('/api/iam/auth/otp/verify', {
                'challenge_id': c.data['challenge_id'],
                'challenge_token': c.data['challenge_token'],
                'otp': c.data['dev_otp'],
            }, format='json')
            token = r.data['token']
        r = client.post('/api/inventory/relocate', {}, format='json',
                        HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertNotEqual(403, r.status_code)
        self.assertNotIn('physical_execution_requires_mobile', str(r.data))

    def test_mobile_token_passes_surface_check(self):
        token, client = self._token('mobile')
        r = client.post('/api/inventory/relocate', {}, format='json',
                        HTTP_AUTHORIZATION=f'Bearer {token}')
        # Validation error, not a surface denial.
        self.assertNotEqual(403, r.status_code)
        self.assertNotIn('physical_execution_requires_mobile', str(r.data))


@override_settings(DEBUG=True, OTP_DEV_ECHO=True, IAM_OTP_SENDER=None)
class CrossFacilityTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site_a = _site('DS-CROSS-A', 'DS')
        cls.site_b = _site('DS-CROSS-B', 'DS')
        cls.user = _user('cross@zippzo.in')
        _assign(cls.user, cls.site_a, 'PICKER')
        _assign(cls.user, cls.site_b, 'PICKER')

    def test_session_facility_pins_writes(self):
        client = APIClient()
        c = _login(client, 'cross@zippzo.in', surface='mobile', app='DARK_STORE')
        # Choose site A.
        r = client.post('/api/iam/auth/facility', {
            'challenge_id': c.data['challenge_id'],
            'challenge_token': c.data['challenge_token'],
            'facility_code': 'DS-CROSS-A',
        }, format='json')
        code = r.data['dev_otp']
        v = client.post('/api/iam/auth/otp/verify', {
            'challenge_id': r.data['challenge_id'],
            'challenge_token': r.data['challenge_token'],
            'otp': code,
        }, format='json')
        token = v.data['token']

        # Attempt a write against site B while scoped to site A.
        r2 = client.post('/api/ds-ops/receive-lpn', {
            'store_code': 'DS-CROSS-B',
            'barcode': 'LPN-X',
        }, format='json', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertIn(r2.status_code, (400, 403, 404))


class InventoryIdempotencyTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from bounded.catalog.models import InventoryLot, Sku
        cls.site = _site('MH-INV')
        cls.sku = Sku.objects.create(
            sku_code='INV-SKU', name='Inv', sub_category='G', brand='Z', pack_size='1', hsn_code='1')
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.site, batch_number='LOT-INV', inbound_type='PURCHASE', inbound_ref='PO-INV')
        StockBalance.objects.create(site=cls.site, container='SITE', container_ref='',
                                   sku=cls.sku, lot=cls.lot, qty=10, sellable=True)

    def test_replay_does_not_double_move(self):
        # First move.
        moved1 = apply_stock(site=self.site, sku=self.sku, lot=self.lot, qty=3,
                             direction='OUT', movement_type='PICK', ref_type='ORDER',
                             ref_id='ORD-1', actor_id='u', actor_type='STAFF',
                             container='SITE', container_ref='', enforce_available=True)
        # Replay with the same key.
        moved2 = apply_stock(site=self.site, sku=self.sku, lot=self.lot, qty=3,
                             direction='OUT', movement_type='PICK', ref_type='ORDER',
                             ref_id='ORD-1', actor_id='u', actor_type='STAFF',
                             container='SITE', container_ref='', enforce_available=True)
        self.assertTrue(moved1)
        self.assertFalse(moved2)
        bal = StockBalance.objects.get(site=self.site, sku=self.sku, lot=self.lot, container='SITE')
        self.assertEqual(7, bal.qty)

    def test_negative_stock_is_rejected(self):
        from bounded.inventory.stock import InsufficientStock
        with self.assertRaises(InsufficientStock):
            apply_stock(site=self.site, sku=self.sku, lot=self.lot, qty=1000,
                        direction='OUT', movement_type='PICK', ref_type='ORDER',
                        ref_id='ORD-2', actor_id='u', actor_type='STAFF',
                        container='SITE', container_ref='', enforce_available=True)


class CorrectionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from bounded.catalog.models import InventoryLot, Sku
        cls.site = _site('MH-CORR')
        cls.sku = Sku.objects.create(
            sku_code='CORR-SKU', name='Corr', sub_category='G', brand='Z', pack_size='1', hsn_code='1')
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.site, batch_number='LOT-CORR', inbound_type='PURCHASE', inbound_ref='PO-CORR')
        StockBalance.objects.create(site=cls.site, container='SITE', container_ref='',
                                   sku=cls.sku, lot=cls.lot, qty=10, sellable=True)
        cls.admin = _user('corr-admin@zippzo.in', 'SUPER_ADMIN')
        cls.approver = _user('corr-approver@zippzo.in', 'OPS_MANAGER')

    def test_correction_writes_compensating_movement(self):
        from bounded.inventory.models import StockAdjustment
        adj = StockAdjustment.objects.create(
            site=self.site, sku=self.sku, lot=self.lot, container='SITE',
            container_ref='', qty_delta=-2, reason='Cycle count variance over 10 chars',
            requested_by=self.admin, approved_by=self.approver,
            idempotency_key='corr-1',
        )
        # Movement is linked by the API; simulate the compensating write.
        moved = apply_stock(site=self.site, sku=self.sku, lot=self.lot, qty=2,
                    direction='OUT', movement_type='ADJUST', ref_type='ADJUSTMENT',
                    ref_id=str(adj.adjustment_id), actor_id=self.admin.user_id,
                    actor_type='USER', container='SITE', container_ref='',
                    enforce_available=True)
        self.assertTrue(moved)
        mv = StockMovement.objects.filter(movement_ref='ADJUST', ref_id=str(adj.adjustment_id)).first()
        self.assertIsNotNone(mv)
        bal = StockBalance.objects.get(site=self.site, sku=self.sku, lot=self.lot, container='SITE')
        self.assertEqual(8, bal.qty)
        adj.refresh_from_db()
        self.assertEqual('corr-1', adj.idempotency_key)


@override_settings(DEBUG=True, OTP_DEV_ECHO=True, IAM_OTP_SENDER=None,
                   IAM_ADMIN_OTP_REQUIRED=False)
class AdminSecondFactorPolicyTests(TestCase):
    """Estate roles may skip the code only when an operator opts out.

    The web client unmounted its own sign-in wizard while this policy was
    mishandled, so this class pins the server half of the contract: the release
    is explicit, role-scoped, and never applies to field employees.
    """

    @classmethod
    def setUpTestData(cls):
        cls.site = _site('MH-POLICY')

    def _estate_user(self, email, role):
        user = _user(email, role)
        _assign(user, self.site, role_at_site=role)
        return user

    def test_estate_role_signs_in_without_a_code_when_disabled(self):
        self._estate_user('policy-ops@zippzo.in', 'OPS_MANAGER')
        r = _login(APIClient(), 'policy-ops@zippzo.in')
        self.assertEqual(200, r.status_code)
        self.assertIn('token', r.data)
        self.assertNotIn('otp_required', r.data)

    @override_settings(IAM_ADMIN_OTP_REQUIRED=True)
    def test_estate_role_requires_a_code_by_default(self):
        self._estate_user('policy-super@zippzo.in', 'SUPER_ADMIN')
        r = _login(APIClient(), 'policy-super@zippzo.in')
        self.assertEqual(403, r.status_code)
        self.assertTrue(r.data.get('otp_required'))

    def test_field_employee_still_requires_a_code(self):
        field_user = _user('policy-field@zippzo.in')
        _assign(field_user, self.site)
        r = _login(APIClient(), 'policy-field@zippzo.in')
        self.assertEqual(403, r.status_code)
        self.assertTrue(r.data.get('otp_required'))
        self.assertEqual('p***@zippzo.in', r.data.get('otp_sent_to'))
