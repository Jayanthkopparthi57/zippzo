"""Read scoping for the ledgers that had none.

`/inventory/movements`, `/inventory/balances`, `/inventory/chain`,
`/ds-ops/staged-aging` and `/audit/log` were plain ReadOnlyModelViews over the
whole table. Any authenticated account could read every store's stock levels,
every stock movement in the network, how long each store's staging point was
backed up, and the audit log of every change made anywhere - with before/after
JSON attached.

None of them has a screen yet, which is exactly why they were missed: a
leak nobody clicks is still a leak. These tests pin the scoping so a later
view cannot quietly widen it again.
"""
from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.audit.models import AuditLog
from bounded.catalog.models import InventoryLot, Sku
from bounded.ds_ops.models import StagedAging
from bounded.iam.models import User
from bounded.inventory.models import StockBalance, StockMovement
from bounded.network.models import EmployeeSiteAssignment, Site

MOVEMENTS = '/api/inventory/movements/'
BALANCES = '/api/inventory/balances/'
STAGED = '/api/ds-ops/staged-aging/'
AUDIT = '/api/audit/log/'


class ReadScopingBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.site_a = Site.objects.create(
            code='DS-SCOPE-A', site_type='DARK_STORE', name='Scope A',
            address='1 A Road')
        cls.site_b = Site.objects.create(
            code='DS-SCOPE-B', site_type='DARK_STORE', name='Scope B',
            address='2 B Road')

        cls.operator = User.objects.create(
            email='scope-op@zippzo.in', password_hash=make_password('Scope123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        cls.admin = User.objects.create(
            email='scope-admin@zippzo.in', password_hash=make_password('Scope123!'),
            role='ADMIN', status='ACTIVE')
        cls.wanderer = User.objects.create(
            email='scope-wanderer@zippzo.in', password_hash=make_password('Scope123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')

        EmployeeSiteAssignment.objects.create(
            employee='SCOPEOP', user=cls.operator, site=cls.site_a,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)

        cls.sku = Sku.objects.create(
            sku_code='SCOPE-SKU-1', name='Scoped Cereal', sub_category='Grocery',
            brand='Zippzo', pack_size='1', hsn_code='1904')

        for site, tag, order_id in (
            (cls.site_a, 'A', '00000000-0000-0000-0000-000000000001'),
            (cls.site_b, 'B', '00000000-0000-0000-0000-000000000002'),
        ):
            lot = InventoryLot.objects.create(
                sku=cls.sku, site=site, batch_number=f'LOT-SCOPE-{tag}',
                inbound_type='PURCHASE', inbound_ref=f'PO-SCOPE-{tag}')
            StockBalance.objects.create(
                site=site, container='BIN', container_ref=f'BIN-SCOPE-{tag}-1',
                sku=cls.sku, lot=lot, qty=10 if tag == 'A' else 40)
            StockMovement.objects.create(
                movement_ref=f'RECEIPT-{tag}', ref_id=f'R-{tag}',
                movement_type='RECEIPT', sku=cls.sku, lot=lot,
                qty=10 if tag == 'A' else 40, site=site,
                from_container='SUPPLIER', to_container='BIN',
                to_ref_id=f'BIN-SCOPE-{tag}-1', sellable_delta=10 if tag == 'A' else 40)
            StagedAging.objects.create(
                order_id=order_id, site=site.code,
                staged_at='2026-01-01T10:00:00Z', current_stage='OVER_20_MIN')

        AuditLog.objects.create(
            actor_type='USER', actor_id='SCOPEOP', action='pick.scan',
            entity_type='CustomerOrder', result='SUCCESS')
        AuditLog.objects.create(
            actor_type='USER', actor_id='ELSEWHERE', action='pick.scan',
            entity_type='CustomerOrder', result='SUCCESS')

    def api_for(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api

    @staticmethod
    def rows(response):
        return response.data if isinstance(response.data, list) else response.data['results']


class StockLedgerScopingTests(ReadScopingBase):

    def test_an_operator_reads_their_own_stores_movements_only(self):
        response = self.api_for(self.operator).get(MOVEMENTS)
        self.assertEqual(200, response.status_code, response.data)
        sites = {row['site'] for row in self.rows(response)}
        self.assertEqual({self.site_a.site_id}, sites)

    def test_a_superuser_reads_the_network(self):
        response = self.api_for(self.admin).get(MOVEMENTS)
        self.assertEqual(200, response.status_code, response.data)
        sites = {row['site'] for row in self.rows(response)}
        self.assertEqual(2, len(sites), 'an administrator keeps the network view')

    def test_an_operator_with_no_assignment_reads_nothing(self):
        response = self.api_for(self.wanderer).get(MOVEMENTS)
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual([], self.rows(response),
                         'no assignment means no store, not every store')

    def test_balances_are_scoped_the_same_way(self):
        mine = self.api_for(self.operator).get(BALANCES)
        self.assertEqual(200, mine.status_code, mine.data)
        sites = {row['site'] for row in self.rows(mine)}
        self.assertEqual({self.site_a.site_id}, sites)

        everywhere = self.api_for(self.admin).get(BALANCES)
        self.assertEqual({self.site_a.site_id, self.site_b.site_id},
                         {row['site'] for row in self.rows(everywhere)})

    def test_staged_ageing_is_scoped_by_store_code(self):
        mine = self.api_for(self.operator).get(STAGED)
        self.assertEqual(200, mine.status_code, mine.data)
        sites = {row['site'] for row in self.rows(mine)}
        self.assertEqual({'DS-SCOPE-A'}, sites)

        everywhere = self.api_for(self.admin).get(STAGED)
        self.assertEqual({'DS-SCOPE-A', 'DS-SCOPE-B'},
                         {row['site'] for row in self.rows(everywhere)})

    def test_the_anonymous_caller_is_still_refused(self):
        for path in (MOVEMENTS, BALANCES, STAGED, AUDIT):
            with self.subTest(path=path):
                response = APIClient().get(path)
                self.assertIn(response.status_code, (401, 403))


class AuditLogScopingTests(ReadScopingBase):

    def test_a_store_operator_cannot_read_the_audit_log(self):
        response = self.api_for(self.operator).get(AUDIT)
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual([], self.rows(response),
                         'the audit log has no site column, so it is not narrowed - '
                         'it is withheld')

    def test_an_administrator_can(self):
        response = self.api_for(self.admin).get(AUDIT)
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(2, len(self.rows(response)))

    def test_the_log_is_read_only_for_everyone(self):
        response = self.api_for(self.admin).post(
            AUDIT, {'action': 'made.up', 'result': 'SUCCESS'}, format='json')
        self.assertEqual(405, response.status_code, response.data)
