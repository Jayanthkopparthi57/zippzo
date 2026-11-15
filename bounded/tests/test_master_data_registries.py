"""Reason codes and cluster zones: master-data registries."""

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.masterdata.models import ClusterZone, ReasonCode
from bounded.network.models import Site, Zone


class MasterDataRegistryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email='registry-ops@zippzo.in',
            password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Registry Ops',
        )
        self.client.force_authenticate(user=self.user)
        self.site = Site.objects.create(
            code='MH-REGISTRY', site_type='MH', name='Registry MH',
            address='test', status='ACTIVE',
        )
        self.zone = Zone.objects.create(
            site=self.site, code='Z-REGISTRY', category='General',
            zone_type='GENERAL', status='ACTIVE',
        )

    def test_reason_code_create_and_read(self):
        response = self.client.post('/api/master/reason-codes/', {
            'code': 'VENDOR_SHORT',
            'category': 'DISCREPANCY',
            'description': 'Vendor delivered fewer units than ordered',
            'requires_remark': True,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        reason_code = ReasonCode.objects.get(code='VENDOR_SHORT')
        self.assertTrue(reason_code.requires_remark)
        self.assertEqual(reason_code.category, 'DISCREPANCY')

    def test_cluster_zone_create_with_site_and_zone(self):
        response = self.client.post('/api/master/cluster-zones/', {
            'code': 'CL-REGISTRY-1',
            'site': str(self.site.site_id),
            'name': 'Cold chain cluster',
            'zone': str(self.zone.zone_id),
            'slot_count': 12,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        cluster = ClusterZone.objects.get(code='CL-REGISTRY-1')
        self.assertEqual(cluster.site_id, self.site.site_id)
        self.assertEqual(cluster.zone_id, self.zone.zone_id)
        self.assertEqual(response.data['site_code'], 'MH-REGISTRY')
        self.assertEqual(response.data['zone_code'], 'Z-REGISTRY')
