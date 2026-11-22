from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.network.models import Site, Location


class ExportSmokeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(
            email='export-admin@zippzo.in', password_hash=make_password('Export123!'),
            role='SUPER_ADMIN', status='ACTIVE')
        cls.site = Site.objects.create(code='DS-EXP', site_type='DARK_STORE', name='Exp', address='1 Test Road')
        Location.objects.create(location_id='BIN-EXP-1', site=cls.site, location_type='BIN', barcode='BIN-EXP-1')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_list_available_resources(self):
        r = self.client.get('/api/export/', {'resource': 'nope'})
        self.assertEqual(r.status_code, 400)
        self.assertIn('available', r.data)

    def test_export_locations_returns_xlsx(self):
        r = self.client.get('/api/export/', {'resource': 'locations'})
        self.assertEqual(r.status_code, 200)
        self.assertIn('spreadsheetml', r['Content-Type'])
        self.assertTrue(r['Content-Disposition'].endswith('.xlsx"'))
        self.assertGreater(len(r.content), 100)

    def test_export_with_date_filter(self):
        r = self.client.get('/api/export/', {'resource': 'locations', 'from': '2099-01-01', 'to': '2099-12-31'})
        self.assertEqual(r.status_code, 200)
        # openpyxl can read it back
        import io
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(r.content))
        ws = wb.active
        self.assertEqual(ws.max_row, 1)  # header only

    def test_admin_only_resource_blocks_non_admin(self):
        from bounded.iam.models import User
        op = User.objects.create(email='op@zippzo.in', password_hash=make_password('Op123!'),
                                 role='WAREHOUSE_STAFF', status='ACTIVE')
        c = APIClient()
        c.force_authenticate(user=op)
        r = c.get('/api/export/', {'resource': 'users'})
        self.assertEqual(r.status_code, 403)
