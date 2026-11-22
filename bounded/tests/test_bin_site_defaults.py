"""A storage bin cannot be filed without a site.

The console's Add Storage Bins form once rendered the only site in a
<select> while leaving React state empty, so the browser *looked* like it had
a site and the API answered ``site: This field may not be null.``. The form is
fixed, but a stale bundle or a scripted client can still omit the field. These
tests pin the server-side behaviour: infer the site when there is exactly one
possible answer, and refuse with a field error rather than a 500 otherwise.
"""
from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.network.models import Location, Site, Zone

LOCATIONS = '/api/network/locations/'


class BinSiteDefaultTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(
            email='bin-admin@zippzo.in', password_hash=make_password('Bin123!'),
            role='SUPER_ADMIN', status='ACTIVE')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _create_site(self, code):
        return Site.objects.create(
            code=code, site_type='DARK_STORE', name=code, address='1 Test Road')

    def test_single_site_is_inferred_when_bin_omits_it(self):
        site = self._create_site('DS-BIN-ONLY')

        response = self.client.post(
            LOCATIONS,
            {'location_id': 'BIN-ONLY-1', 'category': 'Grocery'},
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        bin_row = Location.objects.get(location_id='BIN-ONLY-1')
        self.assertEqual(bin_row.site_id, site.site_id)
        self.assertEqual(bin_row.location_type, 'BIN')
        self.assertEqual(bin_row.category, 'Grocery')
        self.assertTrue(bin_row.barcode)

    def test_multiple_sites_require_an_explicit_site(self):
        self._create_site('DS-BIN-A')
        self._create_site('DS-BIN-B')

        response = self.client.post(
            LOCATIONS,
            {'location_id': 'BIN-AMBIGUOUS-1', 'location_type': 'BIN'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('site', response.data)
        self.assertFalse(Location.objects.filter(location_id='BIN-AMBIGUOUS-1').exists())

    def test_explicit_site_is_kept(self):
        self._create_site('DS-BIN-OTHER')
        chosen = self._create_site('DS-BIN-CHOSEN')

        response = self.client.post(
            LOCATIONS,
            {'location_id': 'BIN-CHOSEN-1', 'location_type': 'BIN', 'site': str(chosen.site_id)},
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            Location.objects.get(location_id='BIN-CHOSEN-1').site_id, chosen.site_id)

    def test_bin_takes_a_zone_from_its_own_site(self):
        site = self._create_site('DS-BIN-ZONED')
        zone = Zone.objects.create(site=site, code='COLD')

        response = self.client.post(
            LOCATIONS,
            {'location_id': 'BIN-ZONED-1', 'zone': str(zone.zone_id), 'category': 'Dairy'},
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        bin_row = Location.objects.get(location_id='BIN-ZONED-1')
        self.assertEqual(bin_row.zone_id, zone.zone_id)
        self.assertEqual(bin_row.location_type, 'BIN')

    def test_another_site_s_zone_is_rejected(self):
        site = self._create_site('DS-BIN-HOME')
        other = self._create_site('DS-BIN-FOREIGN')
        foreign_zone = Zone.objects.create(site=other, code='FROZEN')

        response = self.client.post(
            LOCATIONS,
            {'location_id': 'BIN-CROSS-1', 'site': str(site.site_id),
             'zone': str(foreign_zone.zone_id)},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('zone', response.data)
        self.assertFalse(Location.objects.filter(location_id='BIN-CROSS-1').exists())

    def test_a_bin_cannot_be_detached_from_its_site(self):
        site = self._create_site('DS-BIN-KEEP')
        bin_row = Location.objects.create(
            location_id='BIN-KEEP-1', site=site, location_type='BIN', barcode='BIN-KEEP-1')

        response = self.client.patch(
            f'{LOCATIONS}BIN-KEEP-1/',
            {'site': None},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('site', response.data)
        bin_row.refresh_from_db()
        self.assertEqual(bin_row.site_id, site.site_id)
