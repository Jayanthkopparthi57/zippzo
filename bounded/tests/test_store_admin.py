"""Dark-store admin: delivery areas, delivery pricing, and the rider roster.

These are the levers a store manager actually pulls:
  * which pincodes the store promises to serve - and checkout refusing the ones
    it does not;
  * what delivery costs, including free delivery above a basket threshold;
  * who of the fleet is verified, on shift, and delivering today.

The gate matters as much as the feature: a warehouse operator may read the
areas, but withdrawing one (or changing a fee) is an admin decision.
"""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Listing, Sku
from bounded.delivery.models import RiderProfile
from bounded.iam.models import User
from bounded.inventory.models import StockBalance
from bounded.money.models import DeliveryPricingRule
from bounded.network.models import Location, Site
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder
from bounded.routing.models import DeliveryArea

AREAS = '/api/routing/delivery-areas/'
COVERAGE = '/api/routing/coverage'
RIDERS = '/api/delivery/admin/riders'
CHECKOUT = '/api/orders/checkout'
STOREFRONT = '/api/orders/storefront'


def make_user(email, role='WAREHOUSE_STAFF', password='Admin123!'):
    return User.objects.create(
        email=email, password_hash=make_password(password),
        role=role, status='ACTIVE')


class StoreAdminBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = make_user('store-admin@zippzo.in', 'SUPER_ADMIN')
        cls.ops = make_user('store-ops@zippzo.in', 'OPS_MANAGER')
        cls.staff = make_user('store-staff@zippzo.in', 'WAREHOUSE_STAFF')
        cls.shopper = make_user('store-shopper@zippzo.in', 'CUSTOMER')

        cls.site = Site.objects.create(
            code='DS-ADMIN', site_type='DARK_STORE', name='Admin Dark Store',
            address='admin road')
        cls.other_site = Site.objects.create(
            code='DS-ADMIN-2', site_type='DARK_STORE', name='Second Store',
            address='second road')


class DeliveryAreaPermissionTests(StoreAdminBase):

    def test_anonymous_cannot_read_areas(self):
        response = APIClient().get(AREAS)
        self.assertIn(response.status_code, (401, 403))

    def test_signed_in_operators_can_read_but_not_write(self):
        for account in (self.staff, self.shopper):
            with self.subTest(role=account.role):
                api = APIClient()
                api.force_authenticate(account)
                self.assertEqual(200, api.get(AREAS).status_code)
                response = api.post(
                    AREAS, {'site': str(self.site.site_id),
                            'pincode': '560001', 'band': 'CORE'},
                    format='json')
                self.assertEqual(403, response.status_code)

    def test_admin_and_ops_manager_can_publish_an_area(self):
        for account, pincode in ((self.admin, '560010'), (self.ops, '560011')):
            with self.subTest(role=account.role):
                api = APIClient()
                api.force_authenticate(account)
                response = api.post(
                    AREAS, {'site': str(self.site.site_id),
                            'pincode': pincode, 'band': 'CORE'},
                    format='json')
                self.assertEqual(201, response.status_code, response.data)
                self.assertEqual('DS-ADMIN', response.data['site_code'])


class DeliveryAreaTests(StoreAdminBase):

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def test_a_pincode_must_be_six_digits(self):
        for bad in ('56001', 'abcdef', '5600 1'):
            with self.subTest(pincode=bad):
                response = self.api.post(
                    AREAS, {'site': str(self.site.site_id), 'pincode': bad},
                    format='json')
                self.assertEqual(400, response.status_code)

    def test_the_same_pincode_cannot_be_added_twice_to_one_store(self):
        payload = {'site': str(self.site.site_id), 'pincode': '560001'}
        self.assertEqual(201, self.api.post(AREAS, payload, format='json').status_code)
        self.assertEqual(400, self.api.post(AREAS, payload, format='json').status_code)

    def test_the_same_pincode_can_belong_to_two_stores(self):
        for site in (self.site, self.other_site):
            with self.subTest(site=site.code):
                response = self.api.post(
                    AREAS, {'site': str(site.site_id), 'pincode': '560002',
                            'band': 'CORE'}, format='json')
                self.assertEqual(201, response.status_code)

    def test_an_unconfigured_store_covers_anything(self):
        self.assertTrue(DeliveryArea.covers(self.site, '999999'))

    def test_a_configured_store_covers_only_its_list(self):
        DeliveryArea.objects.create(site=self.site, pincode='560001')
        self.assertTrue(DeliveryArea.covers(self.site, '560001'))
        self.assertFalse(DeliveryArea.covers(self.site, '560099'))
        self.assertFalse(DeliveryArea.covers(self.site, ''))

    def test_a_withdrawn_area_stops_counting(self):
        area = DeliveryArea.objects.create(site=self.site, pincode='560001')
        area.is_active = False
        area.save(update_fields=['is_active'])
        self.assertTrue(DeliveryArea.covers(self.site, '560099'))

    def test_coverage_lists_the_stores_for_a_pincode(self):
        DeliveryArea.objects.create(site=self.site, pincode='560001', band='CORE')
        DeliveryArea.objects.create(site=self.other_site, pincode='560001',
                                    band='EXTENDED')

        response = APIClient().get(COVERAGE, {'pincode': '560001'})
        self.assertIn(response.status_code, (401, 403))

        self.api_response = self.api.get(COVERAGE, {'pincode': '560001'})
        self.assertEqual(200, self.api_response.status_code)
        body = self.api_response.data
        self.assertTrue(body['configured'])
        self.assertEqual(['DS-ADMIN', 'DS-ADMIN-2'],
                         [s['code'] for s in body['sites']])

        empty = self.api.get(COVERAGE, {'pincode': '560099'})
        self.assertEqual(200, empty.status_code)
        self.assertEqual([], empty.data['sites'])
        self.assertTrue(empty.data['configured'])

    def test_coverage_rejects_a_bad_pincode(self):
        self.assertEqual(400, self.api.get(COVERAGE, {'pincode': '12'}).status_code)
        self.assertEqual(400, self.api.get(COVERAGE).status_code)

    def test_filter_by_site_code(self):
        DeliveryArea.objects.create(site=self.site, pincode='560001')
        DeliveryArea.objects.create(site=self.other_site, pincode='560002')
        response = self.api.get(AREAS, {'site_code': 'DS-ADMIN'})
        self.assertEqual(200, response.status_code)
        self.assertEqual(['560001'],
                         [row['pincode'] for row in response.data['results']])


class DeliveryAreaCheckoutTests(StoreAdminBase):
    """Publishing a pincode list is only real if checkout honours it."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.bin = Location.objects.create(
            site=cls.site, location_id='BIN-ADMIN-1', location_type='BIN',
            barcode='BIN-ADMIN-1', is_sellable_bin=True, created_by='test')
        cls.sku = Sku.objects.create(
            sku_code='ADMIN-SKU', name='Admin Test Atta', brand='Zippzo',
            status='ACTIVE', mrp=Decimal('35.00'))
        cls.lot = InventoryLot.objects.create(
            sku=cls.sku, site=cls.site, batch_number='ADMIN-LOT-1',
            inbound_type='PURCHASE', inbound_ref='PO-ADMIN')
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin.location_id,
            sku=cls.sku, lot=cls.lot, qty=50)
        Listing.objects.create(sku=cls.sku, site=cls.site, price=Decimal('30.00'),
                               mrp=Decimal('35.00'), is_listed=True,
                               is_available=True)
        customer = Customer.objects.create(user=cls.shopper, name='Admin Shopper')
        cls.address = CustomerAddress.objects.create(
            customer=customer, label='Home', line1='1 Area Road',
            pincode='560001', city='Bengaluru', is_default=True)

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.shopper)

    def checkout(self, qty=1):
        return self.api.post(CHECKOUT, {
            'site': self.site.code,
            'address_id': str(self.address.address_id),
            'items': [{'sku_id': str(self.sku.sku_id), 'qty': qty}],
            'payment_method': 'COD',
        }, format='json')

    def test_an_order_inside_the_published_area_is_accepted(self):
        DeliveryArea.objects.create(site=self.site, pincode='560001')
        response = self.checkout()
        self.assertEqual(201, response.status_code, response.data)

    def test_an_order_outside_the_published_area_is_refused_before_stock(self):
        DeliveryArea.objects.create(site=self.site, pincode='560010')
        response = self.checkout()
        self.assertEqual(400, response.status_code, response.data)
        self.assertEqual('OUT_OF_DELIVERY_AREA', response.data.get('reason'))
        self.assertFalse(CustomerOrder.objects.exists())

    def test_an_unconfigured_store_keeps_accepting_every_pincode(self):
        self.assertEqual(201, self.checkout().status_code)

    def test_free_delivery_above_the_threshold_is_waived(self):
        DeliveryPricingRule.objects.create(
            site=self.site, base_fee=Decimal('25.00'),
            free_above=Decimal('100.00'))
        # 4 x 30 = 120, above the threshold.
        response = self.checkout(qty=4)
        self.assertEqual(201, response.status_code, response.data)
        self.assertEqual('0.00', response.data['delivery_fee'])
        order = CustomerOrder.objects.get(order_no=response.data['order_no'])
        self.assertEqual(Decimal('120.00'), order.grand_total)

    def test_below_the_threshold_the_base_fee_is_charged(self):
        DeliveryPricingRule.objects.create(
            site=self.site, base_fee=Decimal('25.00'),
            free_above=Decimal('100.00'))
        response = self.checkout(qty=1)
        self.assertEqual(201, response.status_code, response.data)
        self.assertEqual('25.00', response.data['delivery_fee'])

    def test_the_storefront_publishes_the_rule_and_the_area_answer(self):
        DeliveryPricingRule.objects.create(
            site=self.site, base_fee=Decimal('35.00'),
            free_above=Decimal('499.00'))
        DeliveryArea.objects.create(site=self.site, pincode='560001')

        inside = self.api.get(STOREFRONT, {'site': self.site.code,
                                           'pincode': '560001'})
        self.assertEqual(200, inside.status_code)
        self.assertEqual('35.00', inside.data['delivery_fee'])
        self.assertEqual('499.00', inside.data['free_above'])
        self.assertTrue(inside.data['delivery_configured'])
        self.assertTrue(inside.data['serviceable'])

        outside = self.api.get(STOREFRONT, {'site': self.site.code,
                                            'pincode': '560099'})
        self.assertFalse(outside.data['serviceable'])

    def test_an_absurd_free_delivery_threshold_is_rejected(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        response = api.post('/api/money/pricing-rules/', {
            'site': str(self.site.site_id), 'base_fee': '20.00',
            'free_above': '10.00',
        }, format='json')
        self.assertEqual(400, response.status_code)


class RiderRosterTests(StoreAdminBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.rider_user = make_user('admin-rider@zippzo.in', 'RIDER')
        cls.rider = RiderProfile.objects.create(
            user=cls.rider_user, name='Admin Rider', phone='9000000001',
            vehicle_type='BIKE', kyc_status='PENDING', current_site=cls.site)

    def test_only_admins_can_read_the_roster(self):
        self.assertIn(APIClient().get(RIDERS).status_code, (401, 403))
        staff = APIClient()
        staff.force_authenticate(self.staff)
        self.assertEqual(403, staff.get(RIDERS).status_code)

    def test_the_roster_reports_the_fleet_with_today_counters(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        response = api.get(RIDERS, {'site': self.site.code})
        self.assertEqual(200, response.status_code)
        self.assertEqual(1, response.data['count'])
        row = response.data['results'][0]
        self.assertEqual('Admin Rider', row['name'])
        self.assertEqual('PENDING', row['kyc_status'])
        self.assertEqual(0, row['delivered_today'])
        self.assertFalse(row['on_shift'])

    def test_an_admin_can_verify_kyc(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        response = api.post(RIDERS, {
            'rider_id': str(self.rider.rider_id), 'kyc_status': 'VERIFIED',
        }, format='json')
        self.assertEqual(200, response.status_code, response.data)
        self.rider.refresh_from_db()
        self.assertEqual('VERIFIED', self.rider.kyc_status)

    def test_a_bad_kyc_value_is_refused(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        response = api.post(RIDERS, {
            'rider_id': str(self.rider.rider_id), 'kyc_status': 'MAYBE',
        }, format='json')
        self.assertEqual(400, response.status_code)

    def test_a_staff_account_cannot_change_kyc(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        response = api.post(RIDERS, {
            'rider_id': str(self.rider.rider_id), 'kyc_status': 'VERIFIED',
        }, format='json')
        self.assertEqual(403, response.status_code)
        self.rider.refresh_from_db()
        self.assertEqual('PENDING', self.rider.kyc_status)
