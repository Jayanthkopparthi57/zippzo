"""Shopper-side live delivery tracking.

A customer may see where their parcel is while a rider is carrying it, and
nothing else: not another customer's order, not the rider's identity once the
door has closed, and not the rider's exact phone number.

The interesting cases are the gates and the honest empties:
  * another shopper and a rider get 404, not "no rider yet";
  * an order nobody is carrying answers `live: false` rather than a blank slug;
  * a delivered order keeps the endpoint working but drops the position, so a
    bookmarked URL cannot replay where somebody went;
  * the ETA is derived from the last ping and the shopper's own address.
"""
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.delivery.models import DeliveryTask, RiderProfile
from bounded.iam.models import User
from bounded.network.models import Site
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder


def make_user(email, role='CUSTOMER', password='Admin123!'):
    return User.objects.create(
        email=email, password_hash=make_password(password),
        role=role, status='ACTIVE')


class TrackingBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = make_user('track-admin@zippzo.in', 'SUPER_ADMIN')
        cls.shopper_user = make_user('track-shopper@zippzo.in')
        cls.other_user = make_user('track-other@zippzo.in')
        cls.rider_user = make_user('track-rider@zippzo.in', 'RIDER')

        cls.site = Site.objects.create(
            code='DS-TRACK', site_type='DARK_STORE', name='Tracking Store',
            address='track road')
        cls.shopper = Customer.objects.create(
            user=cls.shopper_user, name='Asha Rao')
        cls.other = Customer.objects.create(
            user=cls.other_user, name='Other Person')
        cls.address = CustomerAddress.objects.create(
            customer=cls.shopper, label='Home', line1='12 Mango Street',
            city='Bhimavaram', pincode='560001',
            geo_lat=16.5448930, geo_lng=81.5212400, is_default=True)
        cls.rider = RiderProfile.objects.create(
            user=cls.rider_user, name='Ravi Kumar', phone='9876543210',
            vehicle_type='BIKE', kyc_status='VERIFIED', is_online=True,
            current_site=cls.site,
            last_lat=16.5200000, last_lng=81.5000000,
            last_seen_at=timezone.now())
        cls.order = CustomerOrder.objects.create(
            order_no='ORD-TRACK-1', customer=cls.shopper, site=cls.site,
            address=cls.address, status='OUT_FOR_DELIVERY',
            payment_method='COD', payment_status='PENDING',
            subtotal='100.00', grand_total='100.00',
            placed_at=timezone.now())
        cls.task = DeliveryTask.objects.create(
            order=cls.order, site=cls.site, rider=cls.rider,
            status='EN_ROUTE')

    def url(self, order=None):
        order = order or self.order
        return f'/api/orders/orders/{order.order_id}/tracking/'

    def as_user(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api


class TrackingAccessTests(TrackingBase):

    def test_anonymous_cannot_read_tracking(self):
        response = APIClient().get(self.url())
        self.assertIn(response.status_code, (401, 403))

    def test_another_customer_gets_404_not_a_different_message(self):
        response = self.as_user(self.other_user).get(self.url())
        self.assertEqual(404, response.status_code)

    def test_the_rider_carrying_the_parcel_cannot_read_the_tracking_screen(self):
        # The rider console reads the order, not the customer's view of it.
        response = self.as_user(self.rider_user).get(self.url())
        self.assertEqual(404, response.status_code)

    def test_an_admin_may_read_it(self):
        response = self.as_user(self.admin).get(self.url())
        self.assertEqual(200, response.status_code)


class TrackingPayloadTests(TrackingBase):

    def test_a_live_order_names_the_rider_and_masks_the_phone(self):
        response = self.as_user(self.shopper_user).get(self.url())
        self.assertEqual(200, response.status_code)
        data = response.data
        self.assertTrue(data['live'])
        self.assertEqual('Ravi', data['rider']['name'])
        self.assertEqual('BIKE', data['rider']['vehicle_type'])
        self.assertEqual('•••••3210', data['rider']['phone_masked'])
        self.assertNotIn('9876543210', str(data))
        self.assertEqual(16.52, round(data['location']['lat'], 2))
        self.assertFalse(data['stale'])

    def test_the_eta_is_derived_from_the_ping_and_the_address(self):
        data = self.as_user(self.shopper_user).get(self.url()).data
        # ~3 km apart at 20 km/h, rounded up, never zero.
        self.assertIsNotNone(data['distance_km'])
        self.assertGreater(data['distance_km'], 1)
        self.assertGreaterEqual(data['eta_minutes'], 1)
        self.assertLessEqual(data['eta_minutes'], 60)
        self.assertEqual(16.5448930, round(data['destination']['lat'], 7))

    def test_an_old_ping_is_labelled_stale_but_still_reported(self):
        self.rider.last_seen_at = timezone.now() - timedelta(minutes=30)
        self.rider.save(update_fields=['last_seen_at'])
        data = self.as_user(self.shopper_user).get(self.url()).data
        self.assertTrue(data['stale'])
        self.assertIsNotNone(data['location'])
        self.assertIsNotNone(data['updated_at'])

    def test_a_rider_who_never_shared_has_no_location_and_no_eta(self):
        self.rider.last_lat = None
        self.rider.last_lng = None
        self.rider.last_seen_at = None
        self.rider.save(update_fields=['last_lat', 'last_lng', 'last_seen_at'])
        data = self.as_user(self.shopper_user).get(self.url()).data
        self.assertTrue(data['live'])
        self.assertIsNone(data['location'])
        self.assertIsNone(data['eta_minutes'])
        self.assertTrue(data['stale'])

    def test_an_address_without_coordinates_yields_no_eta(self):
        self.address.geo_lat = None
        self.address.geo_lng = None
        self.address.save(update_fields=['geo_lat', 'geo_lng'])
        data = self.as_user(self.shopper_user).get(self.url()).data
        self.assertIsNone(data['destination'])
        self.assertIsNone(data['eta_minutes'])

    def test_an_order_nobody_is_carrying_is_not_live(self):
        self.task.delete()
        data = self.as_user(self.shopper_user).get(self.url()).data
        self.assertFalse(data['live'])
        self.assertIsNone(data['rider'])
        self.assertIsNone(data['location'])

    def test_a_delivered_order_keeps_the_endpoint_but_drops_the_position(self):
        self.order.status = 'DELIVERED'
        self.order.delivered_at = timezone.now()
        self.order.save(update_fields=['status', 'delivered_at'])
        data = self.as_user(self.shopper_user).get(self.url()).data
        self.assertEqual(200, self.as_user(self.shopper_user).get(self.url()).status_code)
        self.assertFalse(data['live'])
        self.assertIsNone(data['location'])
        self.assertIsNone(data['rider'])

    def test_a_withdrawn_task_is_ignored(self):
        DeliveryTask.objects.create(
            order=self.order, site=self.site, rider=self.rider,
            status='WITHDRAWN')
        self.task.status = 'EN_ROUTE'
        self.task.save(update_fields=['status'])
        data = self.as_user(self.shopper_user).get(self.url()).data
        self.assertTrue(data['live'])
        self.assertIsNotNone(data['rider'])


class AddressPinTests(TrackingBase):
    """The device GPS pin a shopper adds to their own delivery address.

    This is the pin the shopper app (and the web storefront) write when the
    customer taps "Use my current location". The fields already exist on the
    model; the contract worth protecting is that a shopper may set them on
    their own row, get them back, and never see another shopper's.
    """

    URL = '/api/orders/addresses/'

    def test_shopper_can_save_and_read_a_gps_pin(self):
        api = self.as_user(self.shopper_user)
        created = api.post(self.URL, {
            'label': 'Work', 'line1': '9 Canal Road', 'city': 'Palakollu',
            'pincode': '534260', 'geo_lat': 16.5123456, 'geo_lng': 81.7891234,
            'geocode_confidence': 'GPS',
        }, format='json')
        self.assertEqual(201, created.status_code, created.data)

        address = CustomerAddress.objects.get(address_id=created.data['address_id'])
        self.assertEqual(self.shopper, address.customer)
        self.assertAlmostEqual(16.5123456, float(address.geo_lat), places=6)
        self.assertAlmostEqual(81.7891234, float(address.geo_lng), places=6)
        self.assertEqual('GPS', address.geocode_confidence)

        read = api.get(f'{self.URL}{address.address_id}/')
        self.assertEqual(200, read.status_code, read.data)
        self.assertAlmostEqual(16.5123456, float(read.data['geo_lat']), places=6)
        self.assertAlmostEqual(81.7891234, float(read.data['geo_lng']), places=6)

    def test_another_shopper_cannot_read_the_pin(self):
        api = self.as_user(self.other_user)
        read = api.get(f'{self.URL}{self.address.address_id}/')
        self.assertEqual(404, read.status_code, read.data)
