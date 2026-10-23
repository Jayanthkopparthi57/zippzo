"""Rider and in-app notification coverage.

Two things were missing and are now load-bearing:

  * a rider's account could never reach the rider console - `target_app` collapsed
    every non-WMS role into DARK_STORE, and once there, the rider had no way to
    take a job, walk its status to the door, or even exist as a profile;
  * notifications were written only to channels nobody reads, by a publisher
    that nothing invoked, on an endpoint that handed the whole table to any
    caller.

Both halves get exercised here: routing, the rider's own job lifecycle, and an
inbox that is scoped to one user and drains the outbox on read.
"""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.delivery.handoff import _settle_delivery, issue_pickup_otp
from bounded.delivery.models import DeliveryTask, RiderProfile, RiderShift
from bounded.iam.models import User
from bounded.lastmile.models import PODEvidence
from bounded.money.models import CashMovement, RiderCustodyState, RiderEarnings
from bounded.network.models import Site
from bounded.notifications.models import Notification
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder, OrderStatusHistory
from bounded.outbox.models import OutboxEvent

LOGIN = '/api/iam/auth/login'
NOTIFICATIONS = '/api/notifications/notifications/'
RIDERS = '/api/delivery/rider-profiles/'
SHIFTS = '/api/delivery/rider-shifts/'
TASKS = '/api/delivery/delivery-tasks/'
PICKUP = '/api/delivery/handoff/pickup'
POD = '/api/delivery/handoff/pod'
EARNINGS = '/api/money/rider-earnings/'
CUSTODY = '/api/money/rider-custody/'
POD_EVIDENCE = '/api/lastmile/pod/'


class RiderAppBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(
            code='DS-RIDER-APP', site_type='DARK_STORE', name='Rider App DS',
            address='1 App Road')
        cls.other_site = Site.objects.create(
            code='DS-RIDER-ELSE', site_type='DARK_STORE', name='Other DS',
            address='2 Else Road')

        cls.rider = User.objects.create(
            email='rider-app@zippzo.in', password_hash=make_password('Ride123!'),
            role='RIDER', status='ACTIVE')
        cls.new_rider = User.objects.create(
            email='new-rider@zippzo.in', password_hash=make_password('Ride123!'),
            role='RIDER', status='ACTIVE')
        cls.shopper = User.objects.create(
            email='buyer-rider@zippzo.in', password_hash=make_password('Ride123!'),
            role='CUSTOMER', status='ACTIVE')
        cls.ops = User.objects.create(
            email='ops-rider@zippzo.in', password_hash=make_password('Ride123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')

        cls.customer = Customer.objects.create(user=cls.shopper, name='Buyer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Basket Road',
            pincode='560001', city='Bengaluru', is_default=True)

        cls.profile = RiderProfile.objects.create(
            user=cls.rider, name='Ravi', phone='9999999999',
            vehicle_type='BIKE', vehicle_number='KA-01', is_online=True,
            current_site=cls.site)

    def api_for(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api

    def make_order(self, *, status='PACKED', order_no='RA-1001'):
        return CustomerOrder.objects.create(
            order_no=order_no, customer=self.customer, site=self.site,
            address=self.address, status=status, payment_method='COD',
            subtotal=Decimal('90.00'), grand_total=Decimal('110.00'))

    def make_task(self, order, *, status='UNASSIGNED', rider=None):
        return DeliveryTask.objects.create(
            order=order, site=self.site, rider=rider, status=status)


class LoginRoutingTests(RiderAppBase):
    """Each role gets the console it is actually meant to open."""

    def login(self, email, password):
        return APIClient().post(
            LOGIN, {'email': email, 'password': password}, format='json')

    def test_a_rider_lands_in_the_rider_console(self):
        response = self.login('rider-app@zippzo.in', 'Ride123!')
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('RIDER', response.data['target_app'])

    def test_a_shopper_lands_in_the_shopper_console(self):
        response = self.login('buyer-rider@zippzo.in', 'Ride123!')
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('SHOPPER', response.data['target_app'])

    def test_a_warehouse_operator_keeps_the_wms_console(self):
        response = self.login('ops-rider@zippzo.in', 'Ride123!')
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('WMS', response.data['target_app'])


class RiderProfileTests(RiderAppBase):
    """A rider account opens with no delivery rows at all."""

    def test_a_fresh_account_creates_its_own_profile(self):
        response = self.api_for(self.new_rider).post(
            f'{RIDERS}bootstrap/', {
                'name': 'New Rider', 'phone': '9888888888',
                'vehicle_type': 'SCOOTER', 'site_code': 'DS-RIDER-APP',
            }, format='json')
        self.assertEqual(201, response.status_code, response.data)
        self.assertEqual(self.new_rider.user_id, response.data['user'],
                         'bootstrap must pin the profile to the caller')
        self.assertEqual(self.site.site_id, response.data['current_site'],
                         'the store they said they work at')

    def test_bootstrap_cannot_be_run_twice(self):
        first = self.api_for(self.rider).post(f'{RIDERS}bootstrap/', {
            'name': 'Ravi', 'phone': '9999999999', 'vehicle_type': 'BIKE',
        }, format='json')
        self.assertEqual(409, first.status_code, first.data)

    def test_an_unknown_store_is_refused(self):
        response = self.api_for(self.new_rider).post(
            f'{RIDERS}bootstrap/', {
                'name': 'New Rider', 'phone': '9888888888',
                'vehicle_type': 'BIKE', 'site_code': 'NOPE-000',
            }, format='json')
        self.assertEqual(404, response.status_code, response.data)

    def test_the_me_endpoint_reports_a_missing_profile(self):
        response = self.api_for(self.new_rider).get(f'{RIDERS}me/')
        self.assertEqual(200, response.status_code, response.data)
        self.assertFalse(response.data['has_profile'])

    def test_a_rider_only_reads_their_own_profile(self):
        listing = self.api_for(self.new_rider).get(RIDERS)
        self.assertEqual(200, listing.status_code, listing.data)
        rows = listing.data if isinstance(listing.data, list) else listing.data['results']
        self.assertNotIn(str(self.profile.rider_id),
                         [row['rider_id'] for row in rows])

    def test_another_rider_cannot_flip_my_online_flag(self):
        response = self.api_for(self.new_rider).post(
            f'{RIDERS}{self.profile.rider_id}/set_online/',
            {'is_online': False}, format='json')
        self.assertEqual(404, response.status_code, response.data)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_online)

    def test_going_online_requires_a_store(self):
        homeless = RiderProfile.objects.create(
            user=self.new_rider, name='No Store', phone='9777777777',
            vehicle_type='BIKE')
        response = self.api_for(self.new_rider).post(
            f'{RIDERS}{homeless.rider_id}/set_online/',
            {'is_online': True}, format='json')
        self.assertEqual(400, response.status_code, response.data)


class RiderJobTests(RiderAppBase):
    """Taking a job, walking it to the door, and handing it back."""

    def test_accepting_moves_the_order_to_rider_assigned(self):
        order = self.make_order()
        task = self.make_task(order)
        response = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/accept/', {}, format='json')
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('ACCEPTED', response.data['status'])
        order.refresh_from_db()
        self.assertEqual('RIDER_ASSIGNED', order.status)
        self.assertTrue(OrderStatusHistory.objects.filter(
            order=order, from_status='PACKED',
            to_status='RIDER_ASSIGNED').exists(),
            'the shopper cannot see the assignment in their timeline')

    def test_an_offline_rider_cannot_take_a_job(self):
        self.profile.is_online = False
        self.profile.save(update_fields=['is_online'])
        order = self.make_order()
        task = self.make_task(order)
        response = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/accept/', {}, format='json')
        self.assertEqual(409, response.status_code, response.data)
        order.refresh_from_db()
        self.assertEqual('PACKED', order.status)

    def test_decline_hands_the_job_back_without_touching_the_order(self):
        order = self.make_order()
        task = self.make_task(order, status='ACCEPTED', rider=self.profile)
        response = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/decline/', {}, format='json')
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('UNASSIGNED', response.data['status'])
        self.assertEqual(1, response.data['offer_count'])
        task.refresh_from_db()
        self.assertIsNone(task.rider_id)
        order.refresh_from_db()
        self.assertEqual('PACKED', order.status)

    def test_an_unassigned_job_cannot_be_walked_to_the_door(self):
        order = self.make_order()
        task = self.make_task(order)
        response = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/advance/', {'to': 'EN_ROUTE'},
            format='json')
        self.assertEqual(409, response.status_code, response.data)

    def test_the_status_walks_to_the_door_in_order(self):
        order = self.make_order()
        task = self.make_task(order)
        rider = self.api_for(self.rider)

        taken = rider.post(f'{TASKS}{task.task_id}/accept/', {}, format='json')
        self.assertEqual(200, taken.status_code, taken.data)

        at_store = rider.post(f'{TASKS}{task.task_id}/advance/',
                              {'to': 'AT_DS'}, format='json')
        self.assertEqual(200, at_store.status_code, at_store.data)
        order.refresh_from_db()
        self.assertEqual('RIDER_ASSIGNED', order.status,
                         'standing at the store is not movement to the customer')

        en_route = rider.post(f'{TASKS}{task.task_id}/advance/',
                              {'to': 'EN_ROUTE'}, format='json')
        self.assertEqual(200, en_route.status_code, en_route.data)
        order.refresh_from_db()
        self.assertEqual('OUT_FOR_DELIVERY', order.status)

        arrived = rider.post(f'{TASKS}{task.task_id}/advance/',
                             {'to': 'ARRIVED'}, format='json')
        self.assertEqual(200, arrived.status_code, arrived.data)
        order.refresh_from_db()
        self.assertEqual('ARRIVED', order.status)

        # The shopper's timeline, newest first (OrderStatusHistory.Meta).
        steps = [h.to_status for h in order.status_history.all()]
        self.assertEqual(['ARRIVED', 'OUT_FOR_DELIVERY', 'RIDER_ASSIGNED'],
                         steps)

    def test_a_task_cannot_skip_straight_to_arrived(self):
        order = self.make_order()
        task = self.make_task(order, status='ACCEPTED', rider=self.profile)
        response = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/advance/', {'to': 'ARRIVED'},
            format='json')
        self.assertEqual(409, response.status_code, response.data)
        task.refresh_from_db()
        self.assertEqual('ACCEPTED', task.status)

    def test_an_unknown_target_is_a_bad_request(self):
        order = self.make_order()
        task = self.make_task(order, status='ACCEPTED', rider=self.profile)
        response = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/advance/', {'to': 'DELIVERED'},
            format='json')
        self.assertEqual(400, response.status_code, response.data)

    def test_a_task_nobody_claims_cannot_be_walked_by_me(self):
        order = self.make_order()
        task = self.make_task(order)
        response = self.api_for(self.rider).post(
            f'{TASKS}{task.task_id}/advance/', {'to': 'AT_DS'},
            format='json')
        self.assertEqual(409, response.status_code, response.data)

    def test_lifecycle_fields_are_still_not_patchable(self):
        order = self.make_order()
        task = self.make_task(order, status='ACCEPTED', rider=self.profile)
        response = self.api_for(self.rider).patch(
            f'{TASKS}{task.task_id}/', {'status': 'DELIVERED'}, format='json')
        self.assertEqual(400, response.status_code, response.data)
        task.refresh_from_db()
        self.assertEqual('ACCEPTED', task.status)

    def test_a_rider_reads_only_their_own_jobs(self):
        order = self.make_order()
        mine = self.make_task(order, status='ACCEPTED', rider=self.profile)
        other_user = User.objects.create(
            email='other-rider@zippzo.in', password_hash=make_password('Ride123!'),
            role='RIDER', status='ACTIVE')
        other_profile = RiderProfile.objects.create(
            user=other_user, name='Other', phone='9666666666',
            vehicle_type='BIKE', current_site=self.site)
        other_order = self.make_order(order_no='RA-1002')
        theirs = self.make_task(other_order, status='ACCEPTED',
                                rider=other_profile)

        listing = self.api_for(self.rider).get(TASKS)
        self.assertEqual(200, listing.status_code, listing.data)
        rows = listing.data if isinstance(listing.data, list) else listing.data['results']
        ids = {row['task_id'] for row in rows}
        self.assertIn(str(mine.task_id), ids)
        self.assertNotIn(str(theirs.task_id), ids)


class RiderShiftTests(RiderAppBase):

    def test_a_shift_opens_once_and_closes(self):
        rider = self.api_for(self.rider)
        opened = rider.post(f'{SHIFTS}open/', {'site_code': 'DS-RIDER-APP'},
                            format='json')
        self.assertEqual(201, opened.status_code, opened.data)

        again = rider.post(f'{SHIFTS}open/', {'site_code': 'DS-RIDER-APP'},
                           format='json')
        self.assertEqual(200, again.status_code, again.data)
        self.assertEqual(opened.data['shift_id'], again.data['shift_id'],
                         'a second open shift would double-count a delivery day')

        closed = rider.post(f'{SHIFTS}{opened.data["shift_id"]}/close/',
                            {'reason': 'MANUAL'}, format='json')
        self.assertEqual(200, closed.status_code, closed.data)
        self.assertEqual('CLOSED', closed.data['status'])
        self.assertIsNotNone(closed.data['ended_at'])

    def test_a_rider_reads_only_their_own_shifts(self):
        shift = RiderShift.objects.create(
            rider=self.profile, site=self.site)
        stranger = User.objects.create(
            email='shift-nosy@zippzo.in', password_hash=make_password('Ride123!'),
            role='RIDER', status='ACTIVE')
        RiderProfile.objects.create(
            user=stranger, name='Nosy', phone='9555555555',
            vehicle_type='BIKE', current_site=self.site)

        listing = self.api_for(stranger).get(SHIFTS)
        self.assertEqual(200, listing.status_code, listing.data)
        rows = listing.data if isinstance(listing.data, list) else listing.data['results']
        self.assertNotIn(str(shift.shift_id),
                         [row['shift_id'] for row in rows])


class InAppNotificationTests(RiderAppBase):

    def event(self, *, event_type, payload, user=None):
        return OutboxEvent.objects.create(
            aggregate_type='CustomerOrder',
            aggregate_id=user or self.customer.user_id,
            event_type=event_type, correlation_id=None,
            payload_json=payload)

    def test_reading_the_inbox_drains_the_outbox(self):
        order = self.make_order()
        self.event(event_type='order.packed', payload={
            'order_id': str(order.order_id), 'order_no': order.order_no})

        response = self.api_for(self.shopper).get(NOTIFICATIONS)
        self.assertEqual(200, response.status_code, response.data)
        rows = response.data if isinstance(response.data, list) else response.data['results']
        packed = [r for r in rows if r['type'] == 'ORDER_PACKED']
        self.assertEqual(1, len(packed),
                         'a committed event never became an inbox row')
        self.assertEqual('IN_APP', packed[0]['channel'])
        self.assertIsNone(packed[0]['read_at'])

        # Draining is idempotent: the same inbox on a second read.
        again = self.api_for(self.shopper).get(NOTIFICATIONS)
        rows = again.data if isinstance(again.data, list) else again.data['results']
        self.assertEqual(len(rows), len([r for r in rows if r['type'] == 'ORDER_PACKED']),
                         'the outbox was republished')

    def test_only_the_recipient_reads_their_inbox(self):
        order = self.make_order()
        self.event(event_type='order.packed', payload={
            'order_id': str(order.order_id), 'order_no': order.order_no})
        Notification.objects.create(
            user=str(self.rider.user_id), type='RIDER_JOB_OFFERED',
            channel='IN_APP', idempotency_key='someone-elses',
            payload_json={'order_no': 'NOT-YOURS'})

        mine = self.api_for(self.shopper).get(NOTIFICATIONS)
        rows = mine.data if isinstance(mine.data, list) else mine.data['results']
        self.assertNotIn('someone-elses',
                         [r['idempotency_key'] for r in rows])

        theirs = self.api_for(self.rider).get(NOTIFICATIONS)
        rows = theirs.data if isinstance(theirs.data, list) else theirs.data['results']
        self.assertNotIn(str(order.order_no),
                         [r['payload_json'].get('order_no') for r in rows])

    def test_the_pickup_code_reaches_the_shopper_inbox(self):
        order = self.make_order(status='ARRIVED')
        self.event(event_type='delivery.pod_requested', payload={
            'order_id': str(order.order_id), 'order_no': order.order_no,
            'otp': '123456', 'customer_user_id': str(self.shopper.user_id)})

        response = self.api_for(self.shopper).get(NOTIFICATIONS)
        rows = response.data if isinstance(response.data, list) else response.data['results']
        otp = [r for r in rows if r['type'] == 'DELIVERY_OTP']
        self.assertEqual(1, len(otp), 'the customer never got an in-app code')
        self.assertEqual('123456', otp[0]['payload_json']['otp'])

    def test_the_inbox_is_read_only(self):
        created = self.api_for(self.shopper).post(NOTIFICATIONS, {
            'type': 'FORGED', 'channel': 'IN_APP',
            'idempotency_key': 'forged-1', 'payload_json': {}}, format='json')
        self.assertEqual(405, created.status_code, created.data)

    def test_a_stranger_cannot_mark_my_notification_read(self):
        order = self.make_order()
        self.event(event_type='order.packed', payload={
            'order_id': str(order.order_id), 'order_no': order.order_no})
        self.api_for(self.shopper).get(NOTIFICATIONS)
        mine = Notification.objects.get(
            user=str(self.shopper.user_id), type='ORDER_PACKED',
            channel='IN_APP')

        stranger = self.api_for(self.rider)
        response = stranger.post(f'{NOTIFICATIONS}{mine.notification_id}/mark_read/',
                                 {}, format='json')
        self.assertEqual(404, response.status_code, response.data)
        mine.refresh_from_db()
        self.assertIsNone(mine.read_at)

    def test_unread_count_and_mark_all_are_scoped(self):
        for i in range(2):
            Notification.objects.create(
                user=str(self.shopper.user_id), type='ORDER_PACKED',
                channel='IN_APP', idempotency_key=f'k-{i}',
                payload_json={'n': i})
        Notification.objects.create(
            user=str(self.rider.user_id), type='ORDER_PACKED',
            channel='IN_APP', idempotency_key='rider-k',
            payload_json={'n': 99})

        mine = self.api_for(self.shopper)
        count = mine.get(f'{NOTIFICATIONS}unread_count/')
        self.assertEqual(200, count.status_code, count.data)
        self.assertEqual(2, count.data['unread'])

        read = mine.post(f'{NOTIFICATIONS}mark_all_read/', {}, format='json')
        self.assertEqual(200, read.status_code, read.data)
        self.assertEqual(2, read.data['updated'])
        self.assertEqual(0, mine.get(f'{NOTIFICATIONS}unread_count/').data['unread'])

        # The rider's unread row is untouched by someone else's bulk action.
        self.assertTrue(Notification.objects.filter(
            user=str(self.rider.user_id), read_at__isnull=True).exists())

    def test_the_inbox_requires_a_login(self):
        response = APIClient().get(NOTIFICATIONS)
        self.assertIn(response.status_code, (401, 403))


class DeliverySettlementTests(RiderAppBase):
    """The four tables that close a delivery and were never written.

    CashMovement, RiderCustodyState, RiderEarnings and PODEvidence all existed
    with serializers and routes, and no code path in the platform ever put a
    row into any of them - so a COD delivery was captured on the order and then
    vanished from the money side of the system.
    """

    def walk_to_the_door(self, *, signature=None, cod=None):
        order = self.make_order()
        task = self.make_task(order, status='ACCEPTED', rider=self.profile)
        rider = self.api_for(self.rider)

        at_store = rider.post(f'{TASKS}{task.task_id}/advance/',
                              {'to': 'AT_DS'}, format='json')
        self.assertEqual(200, at_store.status_code, at_store.data)

        picked_up = rider.post(PICKUP, {'task_id': str(task.task_id)},
                               format='json')
        self.assertEqual(200, picked_up.status_code, picked_up.data)

        otp = issue_pickup_otp(order)
        delivered = rider.post(POD, {
            'task_id': str(task.task_id),
            'otp': otp,
            'cod_amount': cod if cod is not None else str(order.grand_total),
            'signature': signature,
        }, format='json')
        self.assertEqual(200, delivered.status_code, delivered.data)
        return order, task, delivered.data

    def test_collecting_a_tote_puts_it_in_the_riders_custody(self):
        order = self.make_order()
        task = self.make_task(order, status='ACCEPTED', rider=self.profile)
        rider = self.api_for(self.rider)

        rider.post(f'{TASKS}{task.task_id}/advance/', {'to': 'AT_DS'},
                   format='json')
        picked_up = rider.post(PICKUP, {'task_id': str(task.task_id)},
                               format='json')
        self.assertEqual(200, picked_up.status_code, picked_up.data)

        state = RiderCustodyState.objects.get(rider_id=self.profile.rider_id)
        self.assertEqual(1, state.bags_in_custody,
                         'a tote picked up is a tote the rider owes back')

    def test_closing_a_cod_delivery_moves_the_cash_to_the_rider(self):
        order, task, body = self.walk_to_the_door(signature='Ravi')

        self.assertEqual('DELIVERED', body['status'])
        self.assertEqual('CAPTURED', body['payment_status'])

        cash = CashMovement.objects.get(
            idempotency_key=f'COD_COLLECT:{order.order_id}')
        self.assertEqual('COD_COLLECT', cash.movement_type)
        self.assertEqual(Decimal('110.00'), cash.amount)
        self.assertEqual('DS-RIDER-APP', cash.site)
        self.assertEqual(str(self.profile.rider_id), cash.to_ref_id,
                         'the cash ends up with the person holding it')

        state = RiderCustodyState.objects.get(rider_id=self.profile.rider_id)
        self.assertEqual(Decimal('110.00'), state.current_cash)
        self.assertEqual(0, state.bags_in_custody,
                         'the bag was handed over, so it is no longer carried')

        earning = RiderEarnings.objects.get(order=order, rider=self.profile)
        self.assertEqual(order.delivery_fee, earning.delivery_fee)
        self.assertEqual('PENDING', earning.status)

        pod = PODEvidence.objects.get(task=task)
        self.assertEqual('Ravi', pod.signature)
        self.assertEqual('SIGNATURE', pod.method)
        self.assertTrue(pod.otp_verified)
        self.assertEqual(str(self.profile.rider_id), str(pod.rider_id))

    def test_the_cash_is_counted_once_when_the_call_is_retried(self):
        order, task, _ = self.walk_to_the_door()

        # A flaky connection replays the same settlement. The ledger and the
        # balance must not move a second time.
        _settle_delivery(order=order, task=task, actor=self.rider,
                         cod=Decimal('110.00'),
                         delivered_at=order.delivered_at)

        self.assertEqual(1, CashMovement.objects.filter(
            movement_type='COD_COLLECT').count())
        state = RiderCustodyState.objects.get(rider_id=self.profile.rider_id)
        self.assertEqual(Decimal('110.00'), state.current_cash)
        self.assertEqual(1, RiderEarnings.objects.filter(order=order).count())
        self.assertEqual(1, PODEvidence.objects.filter(task=task).count())

    def test_an_overage_is_reported_instead_of_refused(self):
        order, _, body = self.walk_to_the_door(cod='150.00')
        self.assertEqual('40.00', body['cod_variance'])
        state = RiderCustodyState.objects.get(rider_id=self.profile.rider_id)
        self.assertEqual(Decimal('150.00'), state.current_cash)

    def test_a_rider_reads_only_their_own_money(self):
        other = User.objects.create(
            email='rider-two@zippzo.in', password_hash=make_password('Ride123!'),
            role='RIDER', status='ACTIVE')
        other_profile = RiderProfile.objects.create(
            user=other, name='Second Rider', phone='9888000000',
            vehicle_type='BIKE', vehicle_number='KA-02', is_online=True,
            current_site=self.site)
        order = self.make_order()
        RiderEarnings.objects.create(
            rider=other_profile, order=order, amount=Decimal('5.00'),
            delivery_fee=Decimal('5.00'))

        mine = self.api_for(self.rider)
        listing = mine.get(EARNINGS)
        self.assertEqual(200, listing.status_code, listing.data)
        rows = listing.data if isinstance(listing.data, list) else listing.data['results']
        self.assertEqual([], rows,
                         'another rider\'s payout must not be readable from here')

        # And a rider with no profile at all sees nothing rather than everything.
        stranger = self.api_for(self.shopper).get(EARNINGS)
        self.assertEqual(200, stranger.status_code, stranger.data)
        rows = stranger.data if isinstance(stranger.data, list) else stranger.data['results']
        self.assertEqual([], rows)

    def test_proof_of_delivery_cannot_be_forged_over_the_api(self):
        order = self.make_order()
        task = self.make_task(order, status='ACCEPTED', rider=self.profile)

        forged = self.api_for(self.rider).post(POD_EVIDENCE, {
            'task': str(task.task_id),
            'rider': str(self.profile.rider_id),
            'signature': 'Anyone I Like',
            'method': 'SIGNATURE',
            'otp_verified': True,
            'delivered_at': '2026-01-01T10:00:00Z',
        }, format='json')
        self.assertEqual(403, forged.status_code, forged.data)
        self.assertFalse(PODEvidence.objects.filter(task=task).exists())

    def test_money_records_are_read_only_for_everyone_but_admin(self):
        self.walk_to_the_door()

        mine = self.api_for(self.rider)
        listing = mine.get(EARNINGS)
        self.assertEqual(200, listing.status_code, listing.data)
        rows = listing.data if isinstance(listing.data, list) else listing.data['results']
        self.assertEqual(1, len(rows))

        patched = mine.patch(f'{EARNINGS}{rows[0]["earning_id"]}/', {
            'amount': '9999.00',
        }, format='json')
        self.assertEqual(403, patched.status_code, patched.data)
        row = RiderEarnings.objects.get(pk=rows[0]['earning_id'])
        self.assertNotEqual(Decimal('9999.00'), row.amount)

        listing = self.api_for(self.shopper).get(
            f'/api/money/payments/?status=CAPTURED')
        self.assertEqual(200, listing.status_code, listing.data)
        rows = listing.data if isinstance(listing.data, list) else listing.data['results']
        self.assertEqual(1, len(rows),
                         'the customer can read the capture on their own order')
        self.assertEqual('COD_CASH', rows[0]['method'])

        # A stranger with no orders of their own still reads nothing.
        stranger = self.api_for(self.ops).get(
            f'/api/money/payments/?status=CAPTURED')
        self.assertEqual(200, stranger.status_code, stranger.data)
        rows = stranger.data if isinstance(stranger.data, list) else stranger.data['results']
        self.assertEqual([], rows, 'no stranger reads the payment table')
