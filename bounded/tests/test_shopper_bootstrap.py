"""The three gaps that stopped a real shopper from ever placing a real order.

Every one of these passed its own suite while the application was unusable,
because the fixtures were built to match the code rather than the estate:

  * A CUSTOMER login arrived with no `Customer` row, and nothing in the
    application could create one. `Customer.user` is read-only on the
    serializer, so `POST /api/orders/customers/` reached the NOT NULL on
    `customers.user_id` and came back as a 500. Checkout then refused the same
    login with "no customer account is linked to your login" - a shopper could
    see the shelf and buy nothing.

  * Checkout compared `site.site_type` against the literal `'DARK_STORE'`. No
    model enum declares that value and no row in the live estate holds it: the
    model spells a dark store `'DS'`, and all sixteen real stores read DS. The
    guard rejected every real store while accepting the `'DARK_STORE'` string
    every test fixture happened to use.

  * With neither fixed, the store queue, the rider's job offer and the
    customer's own notifications were unreachable - the order was never
    created, so nothing downstream could fire.
"""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Listing, Sku
from bounded.iam.models import User
from bounded.inventory.models import StockBalance
from bounded.network.models import Location, Site
from bounded.routing.models import DeliveryArea
from bounded.orders.models import Customer, CustomerAddress

CUSTOMERS = '/api/orders/customers/'
ADDRESSES = '/api/orders/addresses/'
CHECKOUT = '/api/orders/checkout'


def api_for(user):
    api = APIClient()
    api.force_authenticate(user)
    return api


class CustomerBootstrapTests(TestCase):
    """A fresh shopper login must be able to become a customer."""

    @classmethod
    def setUpTestData(cls):
        cls.fresh = User.objects.create(
            email='fresh@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        cls.existing = User.objects.create(
            email='already@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        cls.admin = User.objects.create(
            email='boss@zippzo.in', password_hash=make_password('Shop123!'),
            role='ADMIN', status='ACTIVE')
        Customer.objects.create(user=cls.existing, name='Already Set Up')

    def test_a_fresh_login_creates_its_own_profile(self):
        """The 500 that made onboarding impossible."""
        response = api_for(self.fresh).post(
            CUSTOMERS, {'name': 'New Shopper'}, format='json')

        self.assertEqual(201, response.status_code, response.data)
        # The owner is the login, taken from authentication and never from the
        # body: a payload naming somebody else must not be able to file a
        # profile into their drawer.
        self.assertEqual(str(self.fresh.user_id), str(response.data['user']))
        self.assertEqual('New Shopper', response.data['name'])
        # Trust tier is the platform's judgement, not the shopper's to set.
        self.assertEqual('T0', response.data['trust_tier'])

    def test_the_payload_cannot_name_another_login(self):
        """`user` is read-only, so an attempt to set it is ignored, not honoured."""
        response = api_for(self.fresh).post(
            CUSTOMERS, {'name': 'Sneaky', 'user': str(self.existing.user_id)},
            format='json')

        self.assertEqual(201, response.status_code, response.data)
        self.assertEqual(str(self.fresh.user_id), str(response.data['user']))

    def test_a_second_profile_for_one_login_is_refused(self):
        """`customers.user` is a OneToOne, so a duplicate would be a 500."""
        api_for(self.existing).post(CUSTOMERS, {'name': 'Dup'}, format='json')

        response = api_for(self.existing).post(
            CUSTOMERS, {'name': 'Dup again'}, format='json')

        self.assertEqual(400, response.status_code, response.data)
        self.assertIn('already has a shopper profile',
                      str(response.data.get('customer', '')))

    def test_staff_do_not_get_a_shopper_profile(self):
        """An operator ordering on a customer's behalf is not a thing here."""
        response = api_for(self.admin).post(
            CUSTOMERS, {'name': 'Boss'}, format='json')

        self.assertEqual(400, response.status_code, response.data)
        self.assertFalse(Customer.objects.filter(user=self.admin).exists())

    def test_a_shopper_sees_only_their_own_profile(self):
        """Onboarding must not leak the customer directory."""
        api_for(self.fresh).post(CUSTOMERS, {'name': 'Fresh'}, format='json')

        response = api_for(self.fresh).get(CUSTOMERS)

        self.assertEqual(200, response.status_code)
        rows = response.data['results']
        self.assertEqual(1, len(rows))
        self.assertEqual(str(self.fresh.user_id), str(rows[0]['user']))


class CheckoutSiteTypeTests(TestCase):
    """Checkout must accept the estate as it is actually stored."""

    @classmethod
    def setUpTestData(cls):
        cls.shopper = User.objects.create(
            email='buyer@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        cls.customer = Customer.objects.create(user=cls.shopper, name='Buyer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Basket Road',
            pincode='560001', city='Bengaluru', is_default=True)

        # `DS` is the value `Site.SITE_TYPE_CHOICES` declares and the only one
        # the live estate holds. It was the one checkout refused.
        cls.ds_estate = Site.objects.create(
            code='DS-ESTATE', site_type='DS', name='Estate Dark Store',
            address='estate road', status='ACTIVE', is_accepting_orders=True)
        # The legacy spelling every fixture used, which checkout did accept.
        cls.ds_legacy = Site.objects.create(
            code='DS-LEGACY', site_type='DARK_STORE', name='Legacy Dark Store',
            address='legacy road', status='ACTIVE', is_accepting_orders=True)
        cls.warehouse = Site.objects.create(
            code='WH-ESTATE', site_type='MH', name='Mother Hub',
            address='hub road')

        # A bin, a batch and a balance per orderable site, so the refusal being
        # tested is the site type and never a missing shelf.
        for site in (cls.ds_estate, cls.ds_legacy):
            cls._stock(site)
            DeliveryArea.objects.create(site=site, pincode='560001', band='CORE')
        cls._estate_listing = Listing.objects.get(site=cls.ds_estate)

    @classmethod
    def _stock(cls, site):
        bin_row = Location.objects.create(
            site=site, location_id=f'BIN-{site.code}', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode=f'BIN-{site.code}', is_sellable_bin=True, created_by='test')
        sku = Sku.objects.create(
            sku_code=f'SKU-{site.code}', name='Atta 5kg', status='ACTIVE',
            mrp=Decimal('120.00'))
        lot = InventoryLot.objects.create(
            sku=sku, site=site, batch_number=f'LOT-{site.code}',
            inbound_type='PURCHASE', inbound_ref='PO-1')
        StockBalance.objects.create(
            site=site, container='BIN', container_ref=bin_row.location_id,
            sku=sku, lot=lot, qty=10)
        Listing.objects.create(
            sku=sku, site=site, price=Decimal('100.00'),
            mrp=Decimal('120.00'), is_listed=True, is_available=True)

    def checkout(self, site_code, **extra):
        listing = Listing.objects.get(site__code=site_code)
        payload = {
            'site': site_code,
            'items': [{'sku_id': str(listing.sku_id), 'qty': 1}],
            'payment_method': 'COD',
        }
        payload.update(extra)
        return api_for(self.shopper).post(CHECKOUT, payload, format='json')

    def test_a_real_estate_dark_store_can_take_an_order(self):
        """The case that was broken: every live store was refused."""
        response = self.checkout('DS-ESTATE')

        self.assertEqual(201, response.status_code, response.data)
        self.assertEqual('CONFIRMED', response.data['status'])
        self.assertEqual('DS-ESTATE', response.data['site'])

    def test_the_legacy_fixture_spelling_still_works(self):
        """Existing fixtures say DARK_STORE; they must keep passing."""
        response = self.checkout('DS-LEGACY')

        self.assertEqual(201, response.status_code, response.data)

    def test_a_mother_hub_still_refuses_orders(self):
        """A warehouse holds stock, but no picker walks it for a shopper.

        The site type is checked before the shelf, so the payload can name a
        real SKU: what is being asserted is that MH is not orderable.
        """
        response = api_for(self.shopper).post(CHECKOUT, {
            'site': 'WH-ESTATE',
            'items': [{'sku_id': str(self._estate_listing.sku_id), 'qty': 1}],
            'payment_method': 'COD',
        }, format='json')

        self.assertEqual(409, response.status_code, response.data)
        self.assertIn('dark store', str(response.data.get('error', '')))
        self.assertEqual(0, Customer.objects.get(user=self.shopper)
                         .orders.count())

    def test_an_unknown_site_is_a_404_not_a_500(self):
        # No listing exists for a site that does not exist, so name the item
        # directly: the refusal being asserted is the site, not the shelf.
        response = api_for(self.shopper).post(CHECKOUT, {
            'site': 'DS-NOPE',
            'items': [{'sku_id': str(self._estate_listing.sku_id), 'qty': 1}],
            'payment_method': 'COD',
        }, format='json')

        self.assertEqual(404, response.status_code, response.data)


class OrderableSiteHelperTests(TestCase):
    """The predicate itself, so a future site type has a deliberate answer."""

    def test_both_dark_store_spellings_are_orderable(self):
        from bounded.orders.checkout import is_orderable_site

        for code in ('DS', 'DARK_STORE'):
            self.assertTrue(is_orderable_site(Site(code='X', site_type=code)),
                            code)

    def test_warehouses_and_unknown_types_are_not(self):
        from bounded.orders.checkout import is_orderable_site

        for code in ('MH', 'SS', 'XDOCK', '', None, 'dark_store'):
            self.assertFalse(is_orderable_site(Site(code='X', site_type=code)),
                             repr(code))
