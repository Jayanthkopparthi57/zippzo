"""CRUD and scoping for the reference tables added to match the 36-table design.

These cover the four new bounded contexts (masterdata, transport, workforce,
counting) end to end: an administrator can create, read, patch and delete every
record, a field operator can read only their own sites and cannot write, and
the small amount of derived data (time minutes, count variance, productivity
rate) is computed by the server rather than trusted from the body.
"""
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import Sku
from bounded.iam.models import User
from bounded.network.models import (
    EmployeeSiteAssignment, Location, Site, VehicleType, Zone,
)


class ReferenceDataBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.site_a = Site.objects.create(
            code='DS-REF-A', site_type='DARK_STORE', name='Reference A')
        cls.site_b = Site.objects.create(
            code='DS-REF-B', site_type='DARK_STORE', name='Reference B')
        cls.admin = User.objects.create(
            email='ref-admin@zippzo.in', password_hash=make_password('Ref123!'),
            role='SUPER_ADMIN', status='ACTIVE', full_name='Ref Admin')
        cls.operator = User.objects.create(
            email='ref-op@zippzo.in', password_hash=make_password('Ref123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE', full_name='Ref Op')
        EmployeeSiteAssignment.objects.create(
            employee='REFOP', user=cls.operator, site=cls.site_a,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)
        cls.vehicle_type = VehicleType.objects.create(
            code='REF-14FT', capacity_lpns=24)
        cls.sku = Sku.objects.create(
            sku_code='REF-SKU-1', name='Reference Rice', sub_category='Grocery',
            brand='Zippzo', pack_size='1', hsn_code='1006')
        cls.zone = Zone.objects.create(
            site=cls.site_a, code='REF-ZONE-A', zone_type='GENERAL')
        cls.location = Location.objects.create(
            location_id='REF-BIN-A-01', site=cls.site_a, location_type='BIN',
            barcode='REF-BIN-A-01', zone=cls.zone)

    def api(self, user=None):
        client = APIClient()
        client.force_authenticate(user or self.admin)
        return client


class MasterDataCrudTests(ReferenceDataBase):

    def test_organization_store_carrier_vehicle_equipment_checkin(self):
        api = self.api()
        org = api.post('/api/master/organizations/', {
            'code': 'ORG-REF-1', 'name': 'Reference Org',
            'kind': 'PLATFORM', 'gstin': '29ABCDE1234F1Z5',
        }, format='json')
        self.assertEqual(org.status_code, 201, org.data)

        store = api.post('/api/master/stores/', {
            'code': 'STORE-REF-1', 'name': 'Reference Store',
            'organization': org.data['org_id'], 'site': str(self.site_a.site_id),
            'store_type': 'DARK_STORE', 'city': 'Bengaluru',
            'daily_cutoff_time': '23:30', 'status': 'ACTIVE',
        }, format='json')
        self.assertEqual(store.status_code, 201, store.data)
        self.assertEqual(store.data['site_code'], 'DS-REF-A')

        bad_cutoff = api.post('/api/master/stores/', {
            'code': 'STORE-REF-BAD', 'name': 'Bad Cutoff',
            'daily_cutoff_time': '25:99',
        }, format='json')
        self.assertEqual(bad_cutoff.status_code, 400)
        self.assertIn('daily_cutoff_time', bad_cutoff.data)

        carrier = api.post('/api/master/carriers/', {
            'code': 'CAR-REF-1', 'name': 'Reference Carrier',
            'mode': 'ROAD', 'organization': org.data['org_id'],
        }, format='json')
        self.assertEqual(carrier.status_code, 201, carrier.data)

        vehicle = api.post('/api/master/vehicles/', {
            'registration_no': 'ka01ab1234',
            'vehicle_type': str(self.vehicle_type.vt_id),
            'carrier': carrier.data['carrier_id'],
            'home_site': str(self.site_a.site_id),
            'ownership': 'OWNED', 'status': 'AVAILABLE',
        }, format='json')
        self.assertEqual(vehicle.status_code, 201, vehicle.data)
        self.assertEqual(vehicle.data['registration_no'], 'KA01AB1234')
        self.assertEqual(vehicle.data['home_site_code'], 'DS-REF-A')

        equipment = api.post('/api/master/equipment/', {
            'code': 'EQ-REF-1', 'name': 'Zebra Scanner',
            'equipment_type': 'SCANNER', 'site': str(self.site_a.site_id),
            'status': 'AVAILABLE',
        }, format='json')
        self.assertEqual(equipment.status_code, 201, equipment.data)

        checkin = api.post('/api/master/vehicle-checkins/', {
            'vehicle': vehicle.data['vehicle_id'],
            'site': str(self.site_a.site_id),
            'direction': 'IN', 'purpose': 'PICKUP',
            'driver_name': 'Ravi', 'seal_no': 'SEAL-1',
        }, format='json')
        self.assertEqual(checkin.status_code, 201, checkin.data)
        # The actor comes from the token, never the body.
        self.assertEqual(checkin.data['created_by'], str(self.admin.user_id))

        # PATCH + DELETE round trip.
        renamed = api.patch(
            f"/api/master/organizations/{org.data['org_id']}/",
            {'name': 'Reference Org Renamed'}, format='json')
        self.assertEqual(renamed.status_code, 200, renamed.data)
        self.assertEqual(renamed.data['name'], 'Reference Org Renamed')

        removed = api.delete(f"/api/master/equipment/{equipment.data['equipment_id']}/")
        self.assertEqual(removed.status_code, 204)

        listed = api.get('/api/master/equipment/')
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data['count'], 0)

    def test_store_cannot_link_two_rows_to_one_site(self):
        api = self.api()
        first = api.post('/api/master/stores/', {
            'code': 'STORE-ONE', 'name': 'One', 'site': str(self.site_a.site_id),
        }, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        second = api.post('/api/master/stores/', {
            'code': 'STORE-TWO', 'name': 'Two', 'site': str(self.site_a.site_id),
        }, format='json')
        self.assertEqual(second.status_code, 400)


class TransportCrudTests(ReferenceDataBase):

    def setUp(self):
        self.api_client = self.api()
        org = self.api_client.post('/api/master/organizations/', {
            'code': 'ORG-TR-1', 'name': 'Transport Org', 'kind': 'CARRIER',
        }, format='json')
        self.carrier = self.api_client.post('/api/master/carriers/', {
            'code': 'CAR-TR-1', 'name': 'Transport Carrier',
            'organization': org.data['org_id'],
        }, format='json').data
        self.vehicle = self.api_client.post('/api/master/vehicles/', {
            'registration_no': 'KA02CD5678',
            'vehicle_type': str(self.vehicle_type.vt_id),
            'carrier': self.carrier['carrier_id'],
        }, format='json').data

    def test_plan_shipment_trip_stop_scan_and_crossdock(self):
        api = self.api_client
        plan = api.post('/api/transport/dispatch-plans/', {
            'code': 'PLAN-1', 'site': str(self.site_a.site_id),
            'plan_date': '2026-11-06', 'wave_code': 'W1',
            'carrier': self.carrier['carrier_id'],
            'vehicle': self.vehicle['vehicle_id'], 'status': 'OPEN',
        }, format='json')
        self.assertEqual(plan.status_code, 201, plan.data)
        self.assertEqual(plan.data['created_by'], str(self.admin.user_id))

        shipment = api.post('/api/transport/shipments/', {
            'code': 'SHIP-1', 'dispatch_plan': plan.data['plan_id'],
            'carrier': self.carrier['carrier_id'],
            'vehicle': self.vehicle['vehicle_id'],
            'origin_site': str(self.site_a.site_id),
            'destination_site': str(self.site_b.site_id),
            'status': 'PLANNED', 'total_lpns': 4,
        }, format='json')
        self.assertEqual(shipment.status_code, 201, shipment.data)
        self.assertEqual(shipment.data['destination_site_code'], 'DS-REF-B')

        same_site = api.post('/api/transport/shipments/', {
            'code': 'SHIP-BAD',
            'origin_site': str(self.site_a.site_id),
            'destination_site': str(self.site_a.site_id),
        }, format='json')
        self.assertEqual(same_site.status_code, 400)
        self.assertIn('destination_site', same_site.data)

        trip = api.post('/api/transport/trips/', {
            'code': 'TRIP-1', 'shipment': shipment.data['shipment_id'],
            'vehicle': self.vehicle['vehicle_id'],
            'origin_site': str(self.site_a.site_id),
            'destination_site': str(self.site_b.site_id),
            'status': 'PLANNED', 'driver_name': 'Suresh',
        }, format='json')
        self.assertEqual(trip.status_code, 201, trip.data)

        stop = api.post('/api/transport/trip-stops/', {
            'trip': trip.data['trip_id'], 'sequence': 1,
            'site': str(self.site_b.site_id), 'stop_type': 'DELIVERY',
            'status': 'PENDING',
        }, format='json')
        self.assertEqual(stop.status_code, 201, stop.data)

        duplicate_stop = api.post('/api/transport/trip-stops/', {
            'trip': trip.data['trip_id'], 'sequence': 1,
            'stop_type': 'CHECKPOINT',
        }, format='json')
        self.assertEqual(duplicate_stop.status_code, 400)

        scan = api.post('/api/transport/shipping-scans/', {
            'shipment': shipment.data['shipment_id'],
            'site': str(self.site_a.site_id),
            'scan_type': 'DISPATCH', 'code': 'SHIP-1', 'result': 'OK',
        }, format='json')
        self.assertEqual(scan.status_code, 201, scan.data)
        self.assertEqual(str(scan.data['scanned_by']), str(self.admin.user_id))

        move = api.post('/api/transport/cross-dock/', {
            'code': 'XD-1', 'source_site': str(self.site_a.site_id),
            'destination_site': str(self.site_b.site_id),
            'shipment': shipment.data['shipment_id'],
            'sku': str(self.sku.sku_id), 'qty': 6, 'status': 'PENDING',
        }, format='json')
        self.assertEqual(move.status_code, 201, move.data)

        same_site_move = api.post('/api/transport/cross-dock/', {
            'code': 'XD-BAD', 'source_site': str(self.site_a.site_id),
            'destination_site': str(self.site_a.site_id), 'qty': 1,
        }, format='json')
        self.assertEqual(same_site_move.status_code, 400)

        zero_qty = api.post('/api/transport/cross-dock/', {
            'code': 'XD-ZERO', 'source_site': str(self.site_a.site_id),
            'destination_site': str(self.site_b.site_id), 'qty': 0,
        }, format='json')
        self.assertEqual(zero_qty.status_code, 400)

    def test_trip_arrival_cannot_precede_departure(self):
        api = self.api_client
        trip = api.post('/api/transport/trips/', {
            'code': 'TRIP-TIME', 'origin_site': str(self.site_a.site_id),
        }, format='json')
        self.assertEqual(trip.status_code, 201, trip.data)
        now = timezone.now()
        bad = api.patch(f"/api/transport/trips/{trip.data['trip_id']}/", {
            'actual_departure_at': now.isoformat(),
            'actual_arrival_at': (now - timedelta(hours=1)).isoformat(),
        }, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertIn('actual_arrival_at', bad.data)


class WorkforceCrudTests(ReferenceDataBase):

    def test_zone_mapping_assignment_time_log_activity_and_productivity(self):
        api = self.api()
        mapping = api.post('/api/workforce/picker-zones/', {
            'user': str(self.operator.user_id), 'site': str(self.site_a.site_id),
            'zone': str(self.zone.zone_id), 'priority': 1, 'is_active': True,
        }, format='json')
        self.assertEqual(mapping.status_code, 201, mapping.data)
        self.assertEqual(mapping.data['zone_code'], 'REF-ZONE-A')

        # A zone from another site is refused.
        other_zone = Zone.objects.create(
            site=self.site_b, code='REF-ZONE-B', zone_type='GENERAL')
        wrong = api.post('/api/workforce/picker-zones/', {
            'user': str(self.operator.user_id), 'site': str(self.site_a.site_id),
            'zone': str(other_zone.zone_id),
        }, format='json')
        self.assertEqual(wrong.status_code, 400)
        self.assertIn('zone', wrong.data)

        assignment = api.post('/api/workforce/work-assignments/', {
            'user': str(self.operator.user_id), 'site': str(self.site_a.site_id),
            'task_type': 'PICK', 'ref_type': 'PickTask',
            'ref_id': '00000000-0000-0000-0000-000000000001',
            'status': 'ASSIGNED',
        }, format='json')
        self.assertEqual(assignment.status_code, 201, assignment.data)
        # assigned_by defaults to the authenticated assigner.
        self.assertEqual(str(assignment.data['assigned_by']), str(self.admin.user_id))

        start = timezone.now() - timedelta(minutes=45)
        end = timezone.now()
        log = api.post('/api/workforce/time-logs/', {
            'user': str(self.operator.user_id), 'site': str(self.site_a.site_id),
            'assignment': assignment.data['assignment_id'],
            'activity': 'PICK', 'started_at': start.isoformat(),
            'ended_at': end.isoformat(),
        }, format='json')
        self.assertEqual(log.status_code, 201, log.data)
        self.assertGreaterEqual(log.data['minutes'], 44)
        self.assertLessEqual(log.data['minutes'], 45)

        bad_log = api.post('/api/workforce/time-logs/', {
            'user': str(self.operator.user_id), 'site': str(self.site_a.site_id),
            'activity': 'PICK', 'started_at': end.isoformat(),
            'ended_at': start.isoformat(),
        }, format='json')
        self.assertEqual(bad_log.status_code, 400)

        event = api.post('/api/workforce/activity-events/', {
            'user': str(self.operator.user_id), 'site': str(self.site_a.site_id),
            'event_type': 'PICK', 'ref_type': 'PickTask', 'ref_id': 'P1',
            'payload': {'qty': 3},
        }, format='json')
        self.assertEqual(event.status_code, 201, event.data)
        edited = api.patch(
            f"/api/workforce/activity-events/{event.data['event_id']}/",
            {'event_type': 'ERROR'}, format='json')
        self.assertEqual(edited.status_code, 405)

        rollup = api.post('/api/workforce/productivity/', {
            'user': str(self.operator.user_id), 'site': str(self.site_a.site_id),
            'work_date': '2026-11-06', 'tasks_completed': 12,
            'units_processed': 120, 'minutes_worked': 60,
        }, format='json')
        self.assertEqual(rollup.status_code, 201, rollup.data)
        self.assertEqual(float(rollup.data['units_per_hour']), 120.0)

        duplicate = api.post('/api/workforce/productivity/', {
            'user': str(self.operator.user_id), 'site': str(self.site_a.site_id),
            'work_date': '2026-11-06', 'units_processed': 1,
        }, format='json')
        self.assertEqual(duplicate.status_code, 400)


class CountingCrudTests(ReferenceDataBase):

    def test_count_line_variance_and_closed_count_guard(self):
        api = self.api()
        count = api.post('/api/counting/cycle-counts/', {
            'code': 'CC-1', 'site': str(self.site_a.site_id),
            'count_type': 'BIN', 'status': 'IN_PROGRESS',
            'scheduled_for': '2026-11-06',
        }, format='json')
        self.assertEqual(count.status_code, 201, count.data)
        self.assertIsNotNone(count.data['started_at'])
        self.assertEqual(str(count.data['created_by']), str(self.admin.user_id))

        line = api.post('/api/counting/cycle-count-lines/', {
            'count': count.data['count_id'],
            'location': self.location.location_id,
            'sku': str(self.sku.sku_id), 'system_qty': 10, 'counted_qty': 8,
        }, format='json')
        self.assertEqual(line.status_code, 201, line.data)
        self.assertEqual(line.data['variance'], -2)
        self.assertEqual(line.data['status'], 'VARIANCE')
        self.assertIsNotNone(line.data['counted_at'])
        self.assertEqual(str(line.data['counted_by']), str(self.admin.user_id))

        match = api.post('/api/counting/cycle-count-lines/', {
            'count': count.data['count_id'],
            'sku': str(self.sku.sku_id), 'system_qty': 5, 'counted_qty': 5,
        }, format='json')
        self.assertEqual(match.status_code, 201, match.data)
        self.assertEqual(match.data['status'], 'COUNTED')

        closed = api.patch(f"/api/counting/cycle-counts/{count.data['count_id']}/",
                           {'status': 'CLOSED'}, format='json')
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertIsNotNone(closed.data['closed_at'])

        anchored = api.post('/api/counting/cycle-count-lines/', {
            'count': count.data['count_id'],
            'sku': str(self.sku.sku_id), 'system_qty': 1, 'counted_qty': 1,
        }, format='json')
        self.assertEqual(anchored.status_code, 400)

    def test_lines_are_scoped_to_the_counts_site(self):
        api = self.api()
        count = api.post('/api/counting/cycle-counts/', {
            'code': 'CC-SCOPE', 'site': str(self.site_b.site_id),
        }, format='json')
        line = api.post('/api/counting/cycle-count-lines/', {
            'count': count.data['count_id'],
            'sku': str(self.sku.sku_id),
        }, format='json')
        self.assertEqual(line.status_code, 201, line.data)

        self.api(self.operator).get('/api/counting/cycle-count-lines/')
        scoped = self.api(self.operator).get('/api/counting/cycle-count-lines/')
        self.assertEqual(scoped.status_code, 200)
        self.assertEqual(scoped.data['count'], 0)


class ScopingAndPermissionTests(ReferenceDataBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # One scanner per site; the operator is assigned to A only.
        from bounded.masterdata.models import Equipment
        cls.equipment_a = Equipment.objects.create(
            code='EQ-SCOPE-A', equipment_type='SCANNER', site=cls.site_a)
        cls.equipment_b = Equipment.objects.create(
            code='EQ-SCOPE-B', equipment_type='SCANNER', site=cls.site_b)

    def test_operator_reads_only_own_site_and_cannot_write(self):
        api = self.api(self.operator)
        listing = api.get('/api/master/equipment/')
        self.assertEqual(listing.status_code, 200)
        codes = [row['code'] for row in listing.data['results']]
        self.assertIn('EQ-SCOPE-A', codes)
        self.assertNotIn('EQ-SCOPE-B', codes)

        denied = api.post('/api/master/equipment/', {
            'code': 'EQ-NOPE', 'equipment_type': 'SCANNER',
            'site': str(self.site_a.site_id),
        }, format='json')
        self.assertEqual(denied.status_code, 403)

    def test_wanderer_with_no_assignment_reads_nothing(self):
        wanderer = User.objects.create(
            email='ref-wanderer@zippzo.in', password_hash=make_password('Ref123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')
        listing = self.api(wanderer).get('/api/master/equipment/')
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.data['count'], 0)

    def test_anonymous_is_denied(self):
        response = APIClient().get('/api/master/organizations/')
        self.assertIn(response.status_code, (401, 403))
