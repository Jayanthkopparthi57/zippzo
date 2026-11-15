from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import ComboOffer, ComboOfferItem, Coupon, Listing
from bounded.iam.models import User
from bounded.tests.test_checkout import CheckoutBase, STOREFRONT


class StorePromotionCheckoutTests(CheckoutBase):

    def create_combo(self, price=Decimal('80.00')):
        now = timezone.now()
        offer = ComboOffer.objects.create(
            site=self.site,
            title='Breakfast bundle',
            description='Cereal and milk together',
            fixed_price=price,
            valid_from=now - timezone.timedelta(minutes=1),
            valid_until=now + timezone.timedelta(days=1),
        )
        ComboOfferItem.objects.create(offer=offer, sku=self.cereal, quantity=1)
        ComboOfferItem.objects.create(offer=offer, sku=self.milk, quantity=1)
        return offer

    def test_storefront_returns_active_combo_with_store_prices(self):
        self.create_combo()

        response = self.api.get(f'{STOREFRONT}?site={self.site.code}&pincode=560001')

        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(1, len(response.data['combo_offers']))
        offer = response.data['combo_offers'][0]
        self.assertEqual('90.00', offer['regular_price'])
        self.assertEqual('80.00', offer['fixed_price'])
        self.assertEqual('10.00', offer['savings'])

    def test_checkout_applies_combo_discount_and_records_provenance(self):
        self.create_combo()

        response = self.checkout()

        self.assertEqual(201, response.status_code, response.data)
        self.assertEqual('10.00', response.data['combo_discount'])
        self.assertEqual('0.00', response.data['coupon_discount'])
        self.assertEqual('10.00', response.data['discount'])
        order = self.customer.orders.get(order_no=response.data['order_no'])
        self.assertEqual(Decimal('10.00'), order.combo_discount)
        self.assertEqual(Decimal('100.00'), order.grand_total)
        self.assertEqual('Breakfast bundle', order.combo_offer_details[0]['title'])

    def test_coupon_and_combo_stack_without_exceeding_subtotal(self):
        self.create_combo()
        now = timezone.now()
        Coupon.objects.create(
            code='SAVE10',
            title='Ten percent off',
            discount_type='PERCENT',
            discount_value=Decimal('10.00'),
            valid_from=now - timezone.timedelta(minutes=1),
            valid_until=now + timezone.timedelta(days=1),
            site=self.site,
        )

        response = self.checkout(coupon_code='SAVE10')

        self.assertEqual(201, response.status_code, response.data)
        self.assertEqual('9.00', response.data['coupon_discount'])
        self.assertEqual('10.00', response.data['combo_discount'])
        self.assertEqual('19.00', response.data['discount'])
        self.assertEqual('91.00', response.data['grand_total'])

    def test_coupon_is_not_valid_at_another_store(self):
        other_site = type(self.site).objects.create(
            code='DS-OTHER-PROMO', site_type='DARK_STORE',
            name='Other dark store',
        )
        now = timezone.now()
        Coupon.objects.create(
            code='OTHERONLY',
            title='Other store only',
            discount_type='FLAT',
            discount_value=Decimal('5.00'),
            valid_from=now - timezone.timedelta(minutes=1),
            valid_until=now + timezone.timedelta(days=1),
            site=other_site,
        )

        response = self.checkout(coupon_code='OTHERONLY')

        self.assertEqual(400, response.status_code)
        self.assertFalse(self.customer.orders.exists())

    def test_admin_can_create_store_coupon_and_combo_offer(self):
        admin = User.objects.create(
            email='promotion-admin@zippzo.in',
            password_hash=make_password('Admin123!'),
            role='SUPER_ADMIN',
            status='ACTIVE',
        )
        api = APIClient()
        api.force_authenticate(admin)
        now = timezone.now()
        coupon_response = api.post('/api/catalog/coupons/', {
            'code': 'STORE10',
            'title': 'Store ten percent',
            'discount_type': 'PERCENT',
            'discount_value': '10.00',
            'min_order': '0.00',
            'valid_from': (now - timezone.timedelta(minutes=1)).isoformat(),
            'valid_until': (now + timezone.timedelta(days=1)).isoformat(),
            'site': str(self.site.site_id),
            'is_active': True,
        }, format='json')
        self.assertEqual(201, coupon_response.status_code, coupon_response.data)

        combo_response = api.post('/api/catalog/combo-offers/', {
            'title': 'Breakfast bundle',
            'description': 'Cereal and milk together',
            'fixed_price': '80.00',
            'valid_from': (now - timezone.timedelta(minutes=1)).isoformat(),
            'valid_until': (now + timezone.timedelta(days=1)).isoformat(),
            'site': str(self.site.site_id),
            'is_active': True,
            'items': [
                {'sku': str(self.cereal.sku_id), 'quantity': 1},
                {'sku': str(self.milk.sku_id), 'quantity': 1},
            ],
        }, format='json')
        self.assertEqual(201, combo_response.status_code, combo_response.data)
        self.assertEqual(2, len(combo_response.data['items']))

        api.force_authenticate(self.shopper)
        active = api.get(f'/api/catalog/coupons/?site={self.site.code}')
        self.assertEqual(200, active.status_code, active.data)
        self.assertEqual(['STORE10'], [coupon['code'] for coupon in active.data['results']])

    def test_admin_price_update_recomputes_store_discount(self):
        admin = User.objects.create(
            email='price-admin@zippzo.in',
            password_hash=make_password('Admin123!'),
            role='SUPER_ADMIN',
            status='ACTIVE',
        )
        api = APIClient()
        api.force_authenticate(admin)
        listing = Listing.objects.get(site=self.site, sku=self.cereal)

        response = api.patch(
            f'/api/catalog/listings/{listing.listing_id}/',
            {'price': '28.00', 'mrp': '35.00'},
            format='json',
        )

        self.assertEqual(200, response.status_code, response.data)
        listing.refresh_from_db()
        self.assertEqual(Decimal('28.00'), listing.price)
        self.assertEqual(Decimal('20.00'), listing.discount_pct)
