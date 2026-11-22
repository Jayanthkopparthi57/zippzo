from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.network.models import Site


class UserCreateReproTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(
            email='admin@zippzo.in', password_hash=make_password('Admin123!'),
            role='SUPER_ADMIN', status='ACTIVE')
        cls.site = Site.objects.create(code='DS-001', site_type='DARK_STORE', name='DS', address='1 Test Road')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_create_user_minimal(self):
        r = self.client.post('/api/iam/users/', {
            'email': 'new@zippzo.in',
            'full_name': 'New User',
            'password': 'NewPass123!',
            'role': 'WAREHOUSE_STAFF',
            'status': 'ACTIVE',
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)

    def test_create_user_with_null_site(self):
        # The console sends site_id: null when no site is selected.
        r = self.client.post('/api/iam/users/', {
            'email': 'new2@zippzo.in',
            'full_name': 'New User 2',
            'password': 'NewPass123!',
            'role': 'WAREHOUSE_STAFF',
            'status': 'ACTIVE',
            'site_id': None,
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)

    def test_create_user_with_site(self):
        r = self.client.post('/api/iam/users/', {
            'email': 'new3@zippzo.in',
            'full_name': 'New User 3',
            'phone': '9876543210',
            'password': 'NewPass123!',
            'role': 'WAREHOUSE_STAFF',
            'status': 'ACTIVE',
            'site_id': str(self.site.site_id),
            'role_at_site': 'PICKER',
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['assigned_site']['code'], 'DS-001')
