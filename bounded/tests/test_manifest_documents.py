"""Manifest documents: creation, lifecycle transitions and read payload."""

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.network.models import Site
from bounded.transport.models import DispatchPlan, ManifestDocument, Shipment


class ManifestDocumentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email='manifest-ops@zippzo.in',
            password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Manifest Ops',
        )
        self.client.force_authenticate(user=self.user)
        self.site = Site.objects.create(
            code='MH-MANIFEST', site_type='MH', name='Manifest MH',
            address='test', status='ACTIVE',
        )
        self.plan = DispatchPlan.objects.create(
            code='DP-MANIFEST-1', site=self.site, plan_date='2026-11-07',
        )
        self.shipment = Shipment.objects.create(
            code='SHIP-MANIFEST-1', dispatch_plan=self.plan,
            origin_site=self.site, total_lpns=2, total_units=24,
        )

    def _payload(self, **overrides):
        payload = {
            'code': 'MANIFEST-2026-0001',
            'shipment': str(self.shipment.shipment_id),
            'dispatch_plan': str(self.plan.plan_id),
            'site': str(self.site.site_id),
            'total_lpns': 2,
            'total_units': 24,
            'payload': {'lines': [{'lpn': 'LPN-1', 'qty': 24}]},
        }
        payload.update(overrides)
        return payload

    def test_create_generate_dispatch(self):
        response = self.client.post('/api/transport/manifests/', self._payload(), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        manifest = ManifestDocument.objects.get(manifest_id=response.data['manifest_id'])
        self.assertEqual(manifest.status, 'DRAFT')
        self.assertEqual(manifest.created_by, str(self.user.user_id))
        self.assertEqual(response.data['shipment_code'], 'SHIP-MANIFEST-1')
        self.assertEqual(response.data['site_code'], 'MH-MANIFEST')

        response = self.client.post(
            f'/api/transport/manifests/{manifest.manifest_id}/mark-dispatched/', {}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)

        response = self.client.post(
            f'/api/transport/manifests/{manifest.manifest_id}/generate/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        manifest.refresh_from_db()
        self.assertEqual(manifest.status, 'GENERATED')
        self.assertIsNotNone(manifest.generated_at)

        response = self.client.post(
            f'/api/transport/manifests/{manifest.manifest_id}/mark-dispatched/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        manifest.refresh_from_db()
        self.assertEqual(manifest.status, 'DISPATCHED')
