"""Catalog administration: who may change master data, and product photos.

The catalog and supplier viewsets used to inherit the global IsAuthenticated
default, so any signed-in account -- including a shopper -- could create or
delete vendors, SKUs, categories and store listings. These tests pin the new
contract:

  * reads stay open to every authenticated operator (the picker needs the SKU
    list, the receiving clerk needs the vendor list),
  * writes require SUPER_ADMIN or OPS_MANAGER,
  * vendors round-trip their PAN,
  * an admin can upload a product photo, which is stored under MEDIA_ROOT and
    served back over /media/.
"""
import base64
import shutil
import tempfile

from django.contrib.auth.hashers import make_password
from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.network.models import Site
from bounded.catalog.models import Sku, SkuCategory, Listing
from bounded.supply.models import Vendor

API = '/api'

# A 1x1 transparent PNG.
PNG_1X1 = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ'
    'DwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
)


def _mk_user(email, role):
    return User.objects.create(
        email=email, password_hash=make_password('Admin123!'),
        role=role, status='ACTIVE')


class CatalogPermissionTests(TestCase):
    def setUp(self):
        self.api = APIClient()
        self.admin = _mk_user('cat-admin@zippzo.in', 'SUPER_ADMIN')
        self.ops = _mk_user('cat-ops@zippzo.in', 'OPS_MANAGER')
        self.staff = _mk_user('cat-staff@zippzo.in', 'WAREHOUSE_STAFF')
        self.shopper = _mk_user('cat-shopper@zippzo.in', 'CUSTOMER')
        self.site = Site.objects.create(
            code='DS-CAT', site_type='DARK_STORE', name='Catalog DS',
            address='test')
        self.category = SkuCategory.objects.create(name='Dairy')

    def _as(self, user):
        self.api.force_authenticate(user=user)
        return self.api

    def test_admin_can_create_vendor_with_pan(self):
        r = self._as(self.admin).post(f'{API}/supply/vendors/', {
            'code': 'V-PAN1', 'name': 'Pan Supplier', 'gstin': '27AABCU9603R1ZM',
            'pan': 'AABCU9603R', 'contact_name': 'Ravi', 'contact_phone': '9876543210',
            'status': 'ACTIVE',
        }, format='json')
        self.assertEqual(201, r.status_code, r.data)
        self.assertEqual('AABCU9603R', r.data['pan'])
        self.assertEqual('AABCU9603R',
                         Vendor.objects.get(code='V-PAN1').pan)

    def test_admin_can_patch_vendor(self):
        vendor = Vendor.objects.create(code='V-PATCH', name='Patch Me')
        r = self._as(self.admin).patch(
            f'{API}/supply/vendors/{vendor.vendor_id}/',
            {'pan': 'XYZAB1234C', 'status': 'BLOCKED'}, format='json')
        self.assertEqual(200, r.status_code, r.data)
        vendor.refresh_from_db()
        self.assertEqual('XYZAB1234C', vendor.pan)
        self.assertEqual('BLOCKED', vendor.status)

    def test_staff_can_read_but_not_write_vendors(self):
        Vendor.objects.create(code='V-READ', name='Readable Vendor')
        staff = self._as(self.staff)
        self.assertEqual(200, staff.get(f'{API}/supply/vendors/').status_code)
        r = staff.post(f'{API}/supply/vendors/', {
            'code': 'V-NOPE', 'name': 'Not Allowed'}, format='json')
        self.assertEqual(403, r.status_code)
        self.assertFalse(Vendor.objects.filter(code='V-NOPE').exists())

    def test_shopper_cannot_create_vendor(self):
        r = self._as(self.shopper).post(f'{API}/supply/vendors/', {
            'code': 'V-SHOP', 'name': 'Shopper Vendor'}, format='json')
        self.assertEqual(403, r.status_code)

    def test_staff_can_read_skus_but_not_create(self):
        Sku.objects.create(sku_code='READ-1', name='Readable', mrp=10)
        staff = self._as(self.staff)
        self.assertEqual(200, staff.get(f'{API}/catalog/skus/').status_code)
        r = staff.post(f'{API}/catalog/skus/', {
            'sku_code': 'STAFF-1', 'name': 'Staff SKU', 'mrp': '5.00',
            'status': 'ACTIVE'}, format='json')
        self.assertEqual(403, r.status_code)
        self.assertFalse(Sku.objects.filter(sku_code='STAFF-1').exists())

    def test_ops_manager_can_create_sku_with_category_name(self):
        r = self._as(self.ops).post(f'{API}/catalog/skus/', {
            'sku_code': 'OPS-1', 'name': 'Ops SKU', 'mrp': '99.50',
            'category': str(self.category.category_id), 'status': 'ACTIVE',
        }, format='json')
        self.assertEqual(201, r.status_code, r.data)
        self.assertEqual('Dairy', r.data['category_name'])
        self.assertEqual(200, self._as(self.staff).get(
            f'{API}/catalog/skus/{r.data["sku_id"]}/').status_code)

    def test_category_and_listing_writes_are_admin_only(self):
        staff = self._as(self.staff)
        r = staff.post(f'{API}/catalog/categories/', {'name': 'Snacks'},
                       format='json')
        self.assertEqual(403, r.status_code)

        sku = Sku.objects.create(sku_code='LIST-1', name='Listed', mrp=20)
        payload = {
            'sku': str(sku.sku_id), 'site': str(self.site.site_id),
            'price': '18.00', 'mrp': '20.00', 'is_listed': True,
            'is_available': True,
        }
        r = staff.post(f'{API}/catalog/listings/', payload, format='json')
        self.assertEqual(403, r.status_code)
        self.assertFalse(Listing.objects.filter(sku=sku).exists())

        r = self._as(self.admin).post(f'{API}/catalog/listings/', payload,
                                      format='json')
        self.assertEqual(201, r.status_code, r.data)
        self.assertTrue(Listing.objects.filter(sku=sku, site=self.site).exists())

        # Reads stay open to operators.
        self.assertEqual(200, self._as(self.staff).get(
            f'{API}/catalog/listings/').status_code)

    def test_anonymous_cannot_write(self):
        api = APIClient()
        self.assertIn(api.post(f'{API}/catalog/skus/', {}, format='json').status_code,
                      (401, 403))
        self.assertIn(api.post(f'{API}/supply/vendors/', {}, format='json').status_code,
                      (401, 403))


class ProductImageUploadTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls._media_dir = tempfile.mkdtemp(prefix='zippzo-media-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_dir)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_dir, ignore_errors=True)

    def setUp(self):
        self.api = APIClient()
        self.admin = _mk_user('img-admin@zippzo.in', 'SUPER_ADMIN')
        self.staff = _mk_user('img-staff@zippzo.in', 'WAREHOUSE_STAFF')

    def _as(self, user):
        self.api.force_authenticate(user=user)
        return self.api

    def _upload(self, client, name='photo.png', content=PNG_1X1,
                content_type='image/png'):
        return client.post(
            f'{API}/catalog/skus/image-upload/',
            {'file': SimpleUploadedFile(name, content, content_type=content_type)},
            format='multipart')

    def test_admin_upload_returns_media_url_and_stores_file(self):
        r = self._upload(self._as(self.admin))
        self.assertEqual(201, r.status_code, r.data)
        url = r.data['image_url']
        self.assertTrue(url.startswith('/media/sku_images/'), url)
        self.assertTrue(url.endswith('.png'), url)
        rel = url[len('/media/'):]
        import os
        from django.conf import settings
        self.assertTrue(os.path.exists(os.path.join(settings.MEDIA_ROOT, rel)),
                        f'{rel} was not written under MEDIA_ROOT')
        # The uploaded URL is reachable over the public media route.
        self.assertEqual(200, self.api.get(url).status_code)

    def test_upload_accepts_jpeg_and_webp(self):
        client = self._as(self.admin)
        self.assertEqual(201, self._upload(
            client, 'a.jpg', b'\xff\xd8\xff', 'image/jpeg').status_code)
        self.assertEqual(201, self._upload(
            client, 'b.webp', b'RIFF0000WEBP', 'image/webp').status_code)

    def test_upload_rejects_non_image(self):
        r = self._upload(self._as(self.admin), 'notes.txt', b'hello',
                         'text/plain')
        self.assertEqual(400, r.status_code)

    def test_upload_rejects_svg(self):
        r = self._upload(self._as(self.admin), 'x.svg',
                         b'<svg onload="alert(1)"></svg>', 'image/svg+xml')
        self.assertEqual(400, r.status_code)

    def test_upload_rejects_oversized_file(self):
        big = b'\x89PNG\r\n\x1a\n' + b'\x00' * (2 * 1024 * 1024 + 10)
        r = self._upload(self._as(self.admin), 'big.png', big, 'image/png')
        self.assertEqual(400, r.status_code)

    def test_upload_requires_admin(self):
        self.assertEqual(403, self._upload(self._as(self.staff)).status_code)
        self.assertIn(self._upload(APIClient()).status_code, (401, 403))
