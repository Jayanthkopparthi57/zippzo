"""Droplists: creation rules and completion attribution."""

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.ds_ops.models import Droplist
from bounded.iam.models import User
from bounded.network.models import Location, Site


class DroplistTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email='droplist-ops@zippzo.in',
            password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Droplist Ops',
        )
        self.client.force_authenticate(user=self.user)
        self.site = Site.objects.create(
            code='DS-DROPLIST', site_type='DS', name='Droplist DS',
            address='test', status='ACTIVE',
        )
        self.source = Location.objects.create(
            location_id='DROP-SOURCE-1', site=self.site, location_type='BIN',
            barcode='DROP-SOURCE-1', created_by='test',
        )
        self.dest = Location.objects.create(
            location_id='DROP-DEST-1', site=self.site, location_type='BIN',
            barcode='DROP-DEST-1', created_by='test',
        )

    def _payload(self, **overrides):
        payload = {
            'code': 'DROP-2026-0001',
            'site': str(self.site.site_id),
            'source_bin': self.source.location_id,
            'dest_bin': self.dest.location_id,
            'tote_count': 8,
            'dropped_count': 0,
            'status': 'CREATED',
            'notes': 'Tote drop from receiving',
        }
        payload.update(overrides)
        return payload

    def test_create_and_complete_records_attribution(self):
        response = self.client.post('/api/ds-ops/droplists/', self._payload(), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        droplist = Droplist.objects.get(droplist_id=response.data['droplist_id'])
        self.assertEqual(droplist.status, 'CREATED')
        self.assertEqual(droplist.created_by, self.user.user_id)
        self.assertEqual(response.data['site_code'], 'DS-DROPLIST')
        self.assertEqual(response.data['created_by_name'], 'Droplist Ops')

        response = self.client.patch(
            f'/api/ds-ops/droplists/{droplist.droplist_id}/',
            {'status': 'COMPLETED', 'dropped_count': 8}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        droplist.refresh_from_db()
        self.assertEqual(droplist.status, 'COMPLETED')
        self.assertEqual(droplist.completed_by, self.user.user_id)

    def test_dropped_count_cannot_exceed_tote_count(self):
        response = self.client.post(
            '/api/ds-ops/droplists/', self._payload(dropped_count=9), format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('dropped_count', response.data)
