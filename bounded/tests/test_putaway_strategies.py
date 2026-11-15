"""Putaway strategies: registry payload and ranked bin suggestion."""

from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.iam.models import User
from bounded.inventory.stock import apply_stock
from bounded.network.models import Location, Site, Zone
from bounded.supply.models import PutawayStrategy
from bounded.supply.views import suggest_putaway_bin


class PutawayStrategyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email='putaway-strategy-ops@zippzo.in',
            password_hash=make_password('Test123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Putaway Ops',
        )
        self.client.force_authenticate(user=self.user)
        self.site = Site.objects.create(
            code='MH-PUTAWAY-STRATEGY', site_type='MH', name='Putaway Strategy MH',
            address='test', status='ACTIVE',
        )
        self.zone = Zone.objects.create(
            site=self.site, code='Z-PUTAWAY', category='General',
            zone_type='GENERAL', status='ACTIVE',
        )
        self.other_zone = Zone.objects.create(
            site=self.site, code='Z-OTHER', category='General',
            zone_type='GENERAL', status='ACTIVE',
        )
        self.sku = Sku.objects.create(
            sku_code='SKU-PUTAWAY-STRATEGY-1', name='Putaway Strategy Rice',
            ean='9999999999971', mrp=Decimal('10.00'), status='ACTIVE',
            storage_zone='DRY',
        )
        self.lot = InventoryLot.objects.create(
            sku=self.sku, site=self.site, batch_number='BATCH-PUTAWAY-STRATEGY-1',
            inbound_type='PURCHASE', inbound_ref='PO-PUTAWAY-STRATEGY-1',
        )
        self.preferred = Location.objects.create(
            location_id='BIN-PUTAWAY-PREFERRED', site=self.site,
            location_type='BIN', zone=self.zone, container='PICK_FACE',
            barcode='BIN-PUTAWAY-PREFERRED', capacity_qty=50, created_by='test',
        )
        self.fallback = Location.objects.create(
            location_id='BIN-PUTAWAY-FALLBACK', site=self.site,
            location_type='BIN', zone=self.other_zone, container='PICK_FACE',
            barcode='BIN-PUTAWAY-FALLBACK', capacity_qty=50, created_by='test',
        )
        apply_stock(
            site=self.site, sku=self.sku, lot=self.lot, qty=10,
            movement_type='PUTAWAY', ref_type='TEST', ref_id='seed-putaway-strategy',
            direction='IN', container='BIN', container_ref=self.preferred.location_id,
        )

    def test_strategy_create_and_read(self):
        response = self.client.post('/api/supply/putaway-strategies/', {
            'code': 'PUT-DRY-PICKFACE',
            'name': 'Dry pick-face putaway',
            'site': str(self.site.site_id),
            'zone': str(self.zone.zone_id),
            'storage_zone': 'DRY',
            'container': 'PICK_FACE',
            'priority': 10,
            'max_commingled': 2,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        strategy = PutawayStrategy.objects.get(code='PUT-DRY-PICKFACE')
        self.assertEqual(strategy.priority, 10)
        self.assertEqual(response.data['site_code'], 'MH-PUTAWAY-STRATEGY')
        self.assertEqual(response.data['zone_code'], 'Z-PUTAWAY')

    def test_suggestion_prefers_same_sku_bin_in_strategy_zone(self):
        PutawayStrategy.objects.create(
            code='PUT-DRY-PICKFACE', name='Dry pick-face putaway',
            site=self.site, zone=self.zone, storage_zone='DRY',
            container='PICK_FACE', priority=10, max_commingled=2,
        )
        suggested = suggest_putaway_bin(self.site, self.sku, self.lot, 5)
        self.assertIsNotNone(suggested)
        self.assertEqual(suggested.location_id, self.preferred.location_id)
