from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.network.models import Site, EmployeeSiteAssignment


class UserEditRoleTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(
            email='admin@zippzo.in', password_hash=make_password('Admin123!'),
            role='SUPER_ADMIN', status='ACTIVE')
        cls.site = Site.objects.create(code='DS-001', site_type='DARK_STORE', name='DS', address='1 Test Road')
        cls.emp = User.objects.create(
            email='emp@zippzo.in', password_hash=make_password('Emp123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        EmployeeSiteAssignment.objects.create(
            user=cls.emp, site=cls.site, employee='EMP', mode='DARKHOUSE',
            role_at_site='PICKER', is_primary=True, is_active=True)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_change_role_at_site_without_changing_site(self):
        r = self.client.patch(f'/api/iam/users/{self.emp.user_id}/', {
            'role': 'OPS_MANAGER',
            'role_at_site': 'INVENTORY_ASSOCIATE',
        }, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.role, 'OPS_MANAGER')
        asgn = EmployeeSiteAssignment.objects.get(user=self.emp)
        self.assertEqual(asgn.role_at_site, 'INVENTORY_ASSOCIATE')
        self.assertEqual(asgn.site_id, self.site.site_id)

    def test_change_password(self):
        r = self.client.patch(f'/api/iam/users/{self.emp.user_id}/', {
            'password': 'NewPass456!',
        }, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.emp.refresh_from_db()
        from django.contrib.auth.hashers import check_password
        self.assertTrue(check_password('NewPass456!', self.emp.password_hash))


class CleanupTestAccountsTests(TestCase):
    def test_only_obvious_test_accounts_are_disabled(self):
        from io import StringIO
        from django.core.management import call_command

        test_user = User.objects.create(
            email='shopper-test-123@example.com',
            password_hash=make_password('Pass123!'), role='CUSTOMER', status='ACTIVE')
        admin = User.objects.create(
            email='verify-admin@zippzo.in',
            password_hash=make_password('Pass123!'), role='SUPER_ADMIN', status='ACTIVE')
        real = User.objects.create(
            email='real.worker@zippzo.in',
            password_hash=make_password('Pass123!'), role='WAREHOUSE_STAFF', status='ACTIVE')

        out = StringIO()
        call_command('cleanup_test_accounts', stdout=out)
        test_user.refresh_from_db()
        self.assertEqual('ACTIVE', test_user.status)

        call_command('cleanup_test_accounts', '--apply', stdout=out)
        test_user.refresh_from_db(); admin.refresh_from_db(); real.refresh_from_db()
        self.assertEqual('BLOCKED', test_user.status)
        self.assertEqual('ACTIVE', admin.status)
        self.assertEqual('ACTIVE', real.status)
        self.assertTrue(User.objects.filter(pk=test_user.pk).exists())


class DedupeEmailCommandTests(TestCase):
    def test_dry_run_then_apply_keeps_one_lowercase_email(self):
        from io import StringIO
        from django.core.management import call_command

        User.objects.create(email='dup@gmail.com', password_hash=make_password('Pass123!'),
                            role='CUSTOMER', status='ACTIVE')
        staff = User.objects.create(email='DUP@gmail.com', password_hash=make_password('Pass123!'),
                                    role='WAREHOUSE_STAFF', status='ACTIVE')

        out = StringIO()
        call_command('dedupe_user_emails', stdout=out)
        self.assertEqual(2, User.objects.count())

        call_command('dedupe_user_emails', '--apply', stdout=out)
        keeper = User.objects.get(email='dup@gmail.com')
        self.assertEqual(staff.user_id, keeper.user_id)
        other = User.objects.exclude(pk=keeper.pk).first()
        self.assertEqual('BLOCKED', other.status)
        self.assertIn('+dup', other.email)


class DuplicateEmailLoginTests(TestCase):
    """Case-different duplicate emails must not 500 the sign-in endpoint."""

    def test_login_with_duplicate_case_emails(self):
        password = 'StrongPass123!'
        User.objects.create(email='dup@gmail.com', password_hash=make_password(password),
                            role='CUSTOMER', status='ACTIVE')
        User.objects.create(email='DUP@gmail.com', password_hash=make_password(password),
                            role='WAREHOUSE_STAFF', status='ACTIVE')
        r = APIClient().post('/api/iam/auth/login', {
            'email': 'dup@gmail.com', 'password': password,
            'app': 'DARK_STORE', 'surface': 'web',
        }, format='json')
        self.assertNotEqual(500, r.status_code, r.data)
        self.assertIn(r.status_code, (200, 403), r.data)


class EmployeeLifecycleTests(TestCase):
    """Registering staff with an existing shopper email, and removing staff."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(
            email='lifecycle-admin@zippzo.in', password_hash=make_password('Admin123!'),
            role='SUPER_ADMIN', status='ACTIVE')
        cls.manager = User.objects.create(
            email='lifecycle-manager@zippzo.in', password_hash=make_password('Manager123!'),
            role='OPS_MANAGER', status='ACTIVE')
        cls.site = Site.objects.create(
            code='DS-LIFE', site_type='DARK_STORE', name='Lifecycle DS', address='1 Test Road')
        cls.shopper = User.objects.create(
            email='shared@gmail.com', password_hash=make_password('Shopper123!'),
            role='CUSTOMER', status='ACTIVE')

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def _staff_payload(self, email):
        return {
            'email': email, 'full_name': 'Store Picker', 'phone': '9876543210',
            'role': 'PICKER', 'password': 'StrongPass123!',
            'site_id': str(self.site.site_id), 'role_at_site': 'PICKER',
        }

    def test_register_existing_shopper_promotes_the_account(self):
        r = self.api.post('/api/iam/users/', self._staff_payload('shared@gmail.com'),
                          format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.shopper.refresh_from_db()
        self.assertEqual('PICKER', self.shopper.role)
        self.assertEqual('ACTIVE', self.shopper.status)
        asgn = EmployeeSiteAssignment.objects.get(user=self.shopper)
        self.assertEqual('PICKER', asgn.role_at_site)
        self.assertTrue(asgn.is_active)

    def test_super_admin_can_remove_employee_without_deleting_history(self):
        created = self.api.post('/api/iam/users/',
                                self._staff_payload(' removable@zippzo.in '), format='json')
        self.assertEqual(created.status_code, 201, created.data)
        target = User.objects.get(user_id=created.data['user_id'])
        r = self.api.post(f'/api/iam/users/{target.user_id}/remove/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        target.refresh_from_db()
        self.assertEqual('BLOCKED', target.status)
        self.assertFalse(EmployeeSiteAssignment.objects.filter(
            user=target, is_active=True).exists())
        self.assertTrue(User.objects.filter(pk=target.pk).exists())

    def test_register_survives_an_employee_code_collision(self):
        owner = User.objects.create(
            email='other.person@zippzo.in', password_hash=make_password('Other123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        EmployeeSiteAssignment.objects.create(
            user=owner, site=self.site, employee='COLLIDE', mode='DARKHOUSE',
            role_at_site='PICKER', is_primary=True, is_active=True)
        payload = self._staff_payload('collide@zippzo.in')
        r = self.api.post('/api/iam/users/', payload, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(EmployeeSiteAssignment.objects.filter(
            user_id=r.data['user_id'], site=self.site, is_active=True).exists())

    def test_only_super_admin_can_remove(self):
        self.api.force_authenticate(self.manager)
        r = self.api.post(f'/api/iam/users/{self.shopper.user_id}/remove/', {}, format='json')
        self.assertEqual(r.status_code, 403, r.data)
