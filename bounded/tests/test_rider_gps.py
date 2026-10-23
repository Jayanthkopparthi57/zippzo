"""Rider GPS: the device is the only source, and the fleet board reads it.

A rider pushes their own position while online; the store's Rider Fleet
screen reads it back. Nothing here lets an operator type a pin in for
somebody else, and a payload that is not a location on earth is refused
rather than stored.
"""
from django.utils import timezone
from rest_framework.test import APITestCase

from bounded.delivery.models import RiderProfile
from bounded.iam.models import User
from bounded.network.models import Site, EmployeeSiteAssignment
from django.contrib.auth.hashers import make_password


def _mk_user(email, role):
    return User.objects.create(
        email=email, password_hash=make_password('x'), role=role, status='ACTIVE')


class RiderGpsTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(
            code='DS-GPS-01', name='GPS Test Store', site_type='DARK_STORE',
            address='1 MG Road', geo_lat=17.385, geo_lng=78.4867)
        cls.rider_user = _mk_user('gps.rider@zippzo.in', 'RIDER')
        cls.profile = RiderProfile.objects.create(
            user=cls.rider_user, name='Ganesh Rider', phone='9000000001',
            vehicle_type='BIKE', current_site=cls.site)
        cls.other_user = _mk_user('gps.other@zippzo.in', 'RIDER')
        cls.other_profile = RiderProfile.objects.create(
            user=cls.other_user, name='Other Rider', phone='9000000002',
            vehicle_type='BIKE', current_site=cls.site)
        cls.ops = _mk_user('gps.ops@zippzo.in', 'WAREHOUSE_STAFF')
        EmployeeSiteAssignment.objects.create(
            employee='GPS-OPS', user=cls.ops, site=cls.site, mode='DARKHOUSE',
            role_at_site='OPS', is_primary=True)
        cls.admin = _mk_user('gps.admin@zippzo.in', 'ADMIN')

    def _login(self, user):
        self.client.force_authenticate(user=user)

    def test_rider_pushes_location_and_it_lands_on_their_profile(self):
        self._login(self.rider_user)
        res = self.client.post(
            '/api/delivery/rider-profiles/me/location/',
            {'lat': 17.4012, 'lng': 78.4790}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.profile.refresh_from_db()
        self.assertAlmostEqual(self.profile.last_lat, 17.4012, places=4)
        self.assertAlmostEqual(self.profile.last_lng, 78.4790, places=4)
        self.assertIsNotNone(self.profile.last_seen_at)
        # Stamped fresh, not some stored constant.
        delta = timezone.now() - self.profile.last_seen_at
        self.assertLess(delta.total_seconds(), 10)

    def test_another_rider_cannot_move_your_pin(self):
        self._login(self.other_user)
        before = (self.profile.last_lat, self.profile.last_lng)
        # The endpoint is "me/location": it has no rider id to aim at, so the
        # only way to try is on your own profile - and that leaves the other
        # rider's row untouched.
        res = self.client.post(
            '/api/delivery/rider-profiles/me/location/',
            {'lat': 1.0, 'lng': 2.0}, format='json')
        self.assertEqual(res.status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual((self.profile.last_lat, self.profile.last_lng), before)

    def test_coordinates_that_are_not_on_earth_are_refused(self):
        self._login(self.rider_user)
        for payload in ({'lat': 91, 'lng': 0}, {'lat': 0, 'lng': 181},
                        {'lat': 'left', 'lng': 1}, {}):
            res = self.client.post(
                '/api/delivery/rider-profiles/me/location/', payload,
                format='json')
            self.assertEqual(res.status_code, 400, payload)
        self.profile.refresh_from_db()
        self.assertIsNone(self.profile.last_lat)

    def test_profile_without_rider_cannot_push(self):
        self._login(self.ops)
        res = self.client.post(
            '/api/delivery/rider-profiles/me/location/',
            {'lat': 1, 'lng': 1}, format='json')
        self.assertEqual(res.status_code, 404)

    def test_operator_reads_the_fleet_but_cannot_edit_it(self):
        self._login(self.ops)
        listed = self.client.get('/api/delivery/rider-profiles/')
        self.assertEqual(listed.status_code, 200)
        rows = listed.data['results'] if isinstance(listed.data, dict) else listed.data
        ids = {str(r['rider_id']) for r in rows}
        self.assertIn(str(self.profile.rider_id), ids)
        self.assertIn(str(self.other_profile.rider_id), ids)

        res = self.client.patch(
            f'/api/delivery/rider-profiles/{self.profile.rider_id}/',
            {'phone': '9111111111'}, format='json')
        self.assertEqual(res.status_code, 403)

        res = self.client.post(
            '/api/delivery/rider-profiles/', {'name': 'Fake'}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_a_rider_still_only_sees_themselves(self):
        self._login(self.rider_user)
        listed = self.client.get('/api/delivery/rider-profiles/')
        rows = listed.data['results'] if isinstance(listed.data, dict) else listed.data
        ids = {str(r['rider_id']) for r in rows}
        self.assertEqual(ids, {str(self.profile.rider_id)})

    def test_admin_reads_every_fleet_and_may_edit(self):
        self._login(self.admin)
        listed = self.client.get('/api/delivery/rider-profiles/')
        rows = listed.data['results'] if isinstance(listed.data, dict) else listed.data
        self.assertGreaterEqual(len(rows), 2)
        res = self.client.patch(
            f'/api/delivery/rider-profiles/{self.profile.rider_id}/',
            {'phone': '9222222222'}, format='json')
        self.assertEqual(res.status_code, 200)
