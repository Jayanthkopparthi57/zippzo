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
