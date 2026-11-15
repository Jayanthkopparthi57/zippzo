"""Realtime and offline recovery test suite.

Simulates and verifies:
  1. WebSocket drop & disconnect: events persist durably in OutboxEvent.
  2. Reconnect & inbox catch-up: GET /notifications/notifications/ and
     /notifications/notifications/unread_count/ trigger _drain_outbox(), delivering
     all missed updates across WMS staff, rider, and customer surfaces.
  3. Duplicate event delivery protection: re-running publish_batch() or draining
     the outbox repeatedly NEVER creates duplicate Notification rows (guaranteed by
     idempotency_key = {event_id}:{user_id}:{channel}).
  4. Marking read & batch mark read: idempotent updates with read_at timestamp.
  5. Offline scan queue replay across surfaces:
     - WMS / Dark Store: pick scan retry with identical scan_id returns
       already_applied: True without double-decrementing stock; tote pack scan
       retry returns 200 without duplicating LPN custody.
     - Rider handoff: task accept, tote pickup, and OTP POD submission are
       all strictly idempotent on network retry without duplicating COD settlement.
  6. Atomic rollback on conflict: rejected scans (wrong bin, overpick)
     leave inventory intact and return clean 409 errors for offline queue conflict resolution.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Sku
from bounded.delivery.models import DeliveryTask, RiderProfile
from bounded.ds_ops.models import OrderLineAllocation, PickTask
from bounded.iam.models import User
from bounded.inventory.models import LpnContent, LpnMaster, StockBalance
from bounded.inventory.stock import apply_stock
from bounded.network.models import EmployeeSiteAssignment, Location, Site
from bounded.notifications.models import Notification
from bounded.notifications.publish import publish_batch, publish_event
from bounded.notifications.views import _drain_outbox
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder, CustomerOrderLine
from bounded.outbox.models import OutboxEvent

API = '/api'


def _user(email, role='OPERATOR'):
    return User.objects.create(
        email=email,
        password_hash=make_password('Test123!'),
        role=role,
        status='ACTIVE',
        full_name=f'User {email}',
    )


def _site(code='DS-REC-01', site_type='DARK_STORE'):
    return Site.objects.create(code=code, site_type=site_type, name=code, address='123 Test St')


def _sku(code='SKU-REC-1', ean='7777777777771'):
    return Sku.objects.create(
        sku_code=code, name=f'Product {code}', ean=ean,
        mrp=Decimal('25.00'), weight_g=200, status='ACTIVE',
    )


def _lot(sku, site, batch='BATCH-REC-1'):
    return InventoryLot.objects.create(
        sku=sku, site=site, batch_number=batch,
        inbound_type='PURCHASE', inbound_ref='PO-REC-1', status='AVAILABLE',
    )


def _bin(site, location_id='BIN-REC-01'):
    return Location.objects.create(
        site=site, location_id=location_id, location_type='BIN',
        aisle='R1', rack='K1', level='L1', position='P1',
        barcode=location_id, is_sellable_bin=True, created_by='test',
    )


class RealtimeAndOfflineRecoveryTests(TestCase):
    """Test realtime reconnection, missed update recovery, and scan retry idempotency."""

    def setUp(self):
        self.client = APIClient()

        # Facilities
        self.ds = _site('DS-REC-NORTH', 'DARK_STORE')
        self.bin = _bin(self.ds, 'SHELF-REC-A1')
        self.other_bin = _bin(self.ds, 'SHELF-REC-OTHER')

        # Staff, Customer, and Rider users
        self.supervisor = _user('supervisor-rec@zippzo.in', role='STORE_MANAGER')
        EmployeeSiteAssignment.objects.create(
            employee=f'EMP-{self.supervisor.user_id.hex[:8]}',
            user=self.supervisor, site=self.ds, role_at_site='STORE_MANAGER', is_active=True,
            mode='DARKHOUSE', is_primary=True,
        )

        self.picker = _user('picker-rec@zippzo.in', role='OPERATOR')
        EmployeeSiteAssignment.objects.create(
            employee=f'EMP-{self.picker.user_id.hex[:8]}',
            user=self.picker, site=self.ds, role_at_site='PICKER', is_active=True,
            mode='DARKHOUSE', is_primary=True,
        )

        self.customer_user = _user('shopper-rec@zippzo.in', role='SHOPPER')
        self.customer = Customer.objects.create(
            user=self.customer_user, name='Shopper Rec', trust_tier='T1',
        )
        self.address = CustomerAddress.objects.create(
            customer=self.customer, label='Home', line1='100 Test St',
            city='Bangalore', pincode='560001', is_default=True,
        )

        self.rider_user = _user('rider-rec@zippzo.in', role='RIDER')
        self.rider = RiderProfile.objects.create(
            user=self.rider_user, name='Rider Rec', phone='9123456789',
            vehicle_type='BIKE', current_site=self.ds, is_online=True, kyc_status='VERIFIED',
        )

        # SKU, Lot, and initial stock
        self.sku = _sku('SKU-REC-ITEM', '7777777777772')
        self.lot = _lot(self.sku, self.ds, 'BATCH-REC-100')

        apply_stock(
            site=self.ds, sku=self.sku, lot=self.lot, qty=20,
            direction='IN', movement_type='PUTAWAY', ref_type='FIXTURE', ref_id='SETUP',
            container='BIN', container_ref=self.bin.location_id,
        )

    def test_missed_updates_accumulate_in_outbox_and_drain_on_reconnect(self):
        """When client is disconnected, events queue in outbox and drain on inbox poll/open."""
        # 1. Customer order placed while everyone is offline
        order = CustomerOrder.objects.create(
            order_no=f'ORD-REC-{uuid.uuid4().hex[:6].upper()}',
            customer=self.customer,
            site=self.ds,
            address=self.address,
            payment_method='COD',
            subtotal=Decimal('50.00'),
            grand_total=Decimal('50.00'),
            status='CONFIRMED',
        )
        CustomerOrderLine.objects.create(
            order=order, line_no=1, sku=self.sku, lot=self.lot, qty=2, unit_price=Decimal('25.00'),
            line_total=Decimal('50.00'), status='PENDING',
        )

        # Generate outbox events representing lifecycle steps that occurred while offline
        ev_placed = OutboxEvent.objects.create(
            event_type='order.placed',
            aggregate_type='ORDER',
            aggregate_id=str(order.order_id),
            payload_json={'order_id': str(order.order_id), 'customer_user_id': str(self.customer_user.user_id)},
            status='PENDING',
        )
        ev_qc = OutboxEvent.objects.create(
            event_type='warehouse.qc.exception',
            aggregate_type='SITE',
            aggregate_id=str(self.ds.site_id),
            payload_json={'site_code': self.ds.code, 'sku_code': self.sku.sku_code, 'reason': 'Damaged seal'},
            status='PENDING',
        )
        ev_job = OutboxEvent.objects.create(
            event_type='delivery_task.created',
            aggregate_type='DELIVERY_TASK',
            aggregate_id=str(uuid.uuid4()),
            payload_json={'site_code': self.ds.code, 'order_id': str(order.order_id)},
            status='PENDING',
        )

        # Confirm all 3 events are pending in outbox
        self.assertEqual(OutboxEvent.objects.filter(status='PENDING').count(), 3)
        self.assertEqual(Notification.objects.count(), 0)

        # 2. Customer reconnects and opens Notifications View: GET /api/notifications/notifications/
        self.client.force_authenticate(user=self.customer_user)
        r_cust = self.client.get(f'{API}/notifications/notifications/')
        self.assertEqual(r_cust.status_code, 200)

        # Outbox was drained automatically on read
        cust_notifs = r_cust.data.get('results', r_cust.data)
        self.assertEqual(len(cust_notifs), 1)
        self.assertEqual(cust_notifs[0]['type'], 'ORDER_PLACED')
        self.assertIsNone(cust_notifs[0]['read_at'])

        # Check unread count endpoint
        r_unread = self.client.get(f'{API}/notifications/notifications/unread_count/')
        self.assertEqual(r_unread.status_code, 200)
        self.assertEqual(r_unread.data['unread'], 1)

        # 3. Store Supervisor reconnects: gets QC exception notification
        self.client.force_authenticate(user=self.supervisor)
        r_sup = self.client.get(f'{API}/notifications/notifications/')
        self.assertEqual(r_sup.status_code, 200)
        sup_notifs = r_sup.data.get('results', r_sup.data)
        self.assertTrue(any(n['type'] == 'QC_EXCEPTION' for n in sup_notifs))

        # 4. Rider reconnects: gets RIDER_JOB_OFFERED
        self.client.force_authenticate(user=self.rider_user)
        r_rider = self.client.get(f'{API}/notifications/notifications/')
        self.assertEqual(r_rider.status_code, 200)
        rider_notifs = r_rider.data.get('results', r_rider.data)
        self.assertTrue(any(n['type'] == 'RIDER_JOB_OFFERED' for n in rider_notifs))

        # All events now PUBLISHED in outbox
        self.assertEqual(OutboxEvent.objects.filter(status='PENDING').count(), 0)

    def test_duplicate_event_delivery_is_strictly_idempotent(self):
        """Repeatedly publishing the same event or draining outbox produces 0 duplicate notifications."""
        order = CustomerOrder.objects.create(
            order_no=f'ORD-REC-{uuid.uuid4().hex[:6].upper()}',
            customer=self.customer, site=self.ds, address=self.address,
            payment_method='COD', subtotal=Decimal('50.00'), grand_total=Decimal('50.00'),
            status='CONFIRMED',
        )
        event = OutboxEvent.objects.create(
            event_type='order.placed',
            aggregate_type='ORDER',
            aggregate_id=str(order.order_id),
            payload_json={'order_id': str(order.order_id), 'customer_user_id': str(self.customer_user.user_id)},
            status='PENDING',
        )

        # Publish 1st time (creates IN_APP, PUSH, WS channels)
        count1, _ = publish_batch(10)
        self.assertEqual(count1, 1)
        notif_count_1 = Notification.objects.filter(user=self.customer_user.user_id).count()
        self.assertEqual(notif_count_1, 3)

        # Manually reset event to PENDING to simulate duplicate queue/publisher retry
        event.status = 'PENDING'
        event.save(update_fields=['status'])

        # Publish 2nd time: idempotency_key prevents duplicate insert
        count2, _ = publish_batch(10)
        self.assertEqual(count2, 1)
        notif_count_2 = Notification.objects.filter(user=self.customer_user.user_id).count()
        self.assertEqual(notif_count_2, 3)  # EXACTLY 3, ZERO DUPLICATES!

        # Repeatedly trigger _drain_outbox()
        _drain_outbox()
        _drain_outbox()
        self.assertEqual(Notification.objects.filter(user=self.customer_user.user_id).count(), 3)

    def test_notification_mark_read_and_mark_all_read_idempotent(self):
        """Marking read and mark-all-read update timestamps cleanly and idempotently."""
        self.client.force_authenticate(user=self.customer_user)
        n1 = Notification.objects.create(
            user=str(self.customer_user.user_id), type='ORDER_PLACED', channel='IN_APP',
            idempotency_key='test-key-1', payload_json={'info': '1'},
        )
        n2 = Notification.objects.create(
            user=str(self.customer_user.user_id), type='ORDER_PACKED', channel='IN_APP',
            idempotency_key='test-key-2', payload_json={'info': '2'},
        )

        # Mark single notification read
        r1 = self.client.post(f'{API}/notifications/notifications/{n1.notification_id}/mark_read/')
        self.assertEqual(r1.status_code, 200)
        self.assertIsNotNone(r1.data['read_at'])

        # Re-mark read (idempotent retry)
        r1_retry = self.client.post(f'{API}/notifications/notifications/{n1.notification_id}/mark_read/')
        self.assertEqual(r1_retry.status_code, 200)

        # Mark all read
        r_all = self.client.post(f'{API}/notifications/notifications/mark_all_read/')
        self.assertEqual(r_all.status_code, 200)
        self.assertEqual(r_all.data['updated'], 1)  # Only n2 was unread

        # Re-mark all read (returns 0 updated without error)
        r_all_retry = self.client.post(f'{API}/notifications/notifications/mark_all_read/')
        self.assertEqual(r_all_retry.status_code, 200)
        self.assertEqual(r_all_retry.data['updated'], 0)

        # Unread count is now 0
        r_unread = self.client.get(f'{API}/notifications/notifications/unread_count/')
        self.assertEqual(r_unread.data['unread'], 0)

    def test_offline_scan_queue_pick_scan_retry_idempotency_and_ledger_safety(self):
        """Simulate offline pick scan replay: retry with same scan_id returns already_applied without moving stock twice."""
        self.client.force_authenticate(user=self.picker)

        order = CustomerOrder.objects.create(
            order_no=f'ORD-REC-{uuid.uuid4().hex[:6].upper()}',
            customer=self.customer, site=self.ds, address=self.address,
            payment_method='COD', subtotal=Decimal('50.00'), grand_total=Decimal('50.00'),
            status='CONFIRMED',
        )
        line = CustomerOrderLine.objects.create(
            order=order, line_no=1, sku=self.sku, lot=self.lot, qty=2, unit_price=Decimal('25.00'),
            line_total=Decimal('50.00'), status='PENDING',
        )

        OrderLineAllocation.objects.create(
            order=order, line=line, site=self.ds,
            location_id=self.bin.location_id, bin_label=self.bin.location_id,
            qty=2, picked_qty=0, status='ALLOCATED',
        )

        task = PickTask.objects.create(
            picklist_id=uuid.uuid4(),
            batch=uuid.uuid4(),
            order=order,
            sku=self.sku.sku_id,
            lot=self.lot.lot_id,
            bin=self.bin.location_id,
            qty=2,
            picked_qty=0,
            status='IN_PROGRESS',
        )

        # Initial shelf balance is 20
        shelf_bal_before = StockBalance.objects.filter(
            site=self.ds, container='BIN', container_ref=self.bin.location_id, sku=self.sku,
        ).values_list('qty', flat=True).first()
        self.assertEqual(shelf_bal_before, 20)

        client_scan_id = f'SCN-OFFLINE-{uuid.uuid4().hex[:8]}'

        # 1. First scan lands successfully: 1 unit picked
        r1 = self.client.post(f'{API}/ds-ops/pick-line', {
            'order_id': str(order.order_id),
            'line_id': str(line.line_id),
            'bin_location_id': self.bin.location_id,
            'qty': 1,
            'scan_id': client_scan_id,
        }, format='json')
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.data['picked_qty'], 1)
        self.assertEqual(r1.data['outstanding'], 1)

        # Shelf decremented to 19
        shelf_bal_after = StockBalance.objects.filter(
            site=self.ds, container='BIN', container_ref=self.bin.location_id, sku=self.sku,
        ).values_list('qty', flat=True).first()
        self.assertEqual(shelf_bal_after, 19)

        # 2. Simulated offline queue flush / network retry: client replays the exact same scan_id
        r2 = self.client.post(f'{API}/ds-ops/pick-line', {
            'order_id': str(order.order_id),
            'line_id': str(line.line_id),
            'bin_location_id': self.bin.location_id,
            'qty': 1,
            'scan_id': client_scan_id,
        }, format='json')
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.data.get('already_applied'))
        self.assertEqual(r2.data['picked_qty'], 1)
        self.assertEqual(r2.data['outstanding'], 1)

        # CRITICAL LEDGER CHECK: Shelf is STILL 19, zero duplicate stock deduction!
        shelf_bal_retry = StockBalance.objects.filter(
            site=self.ds, container='BIN', container_ref=self.bin.location_id, sku=self.sku,
        ).values_list('qty', flat=True).first()
        self.assertEqual(shelf_bal_retry, 19)

    def test_offline_scan_queue_pack_scan_retry_idempotency(self):
        """Simulate offline pack scan replay: retrying LpnContent create with same payload returns 200 without double counting."""
        self.client.force_authenticate(user=self.picker)

        # Picked tote created in store
        tote = LpnMaster.objects.create(
            lpn_id='TOTE-REC-PACK', barcode='LPN-TOTE-REC-PACK', lpn_type='TOTE',
            current_site=self.ds, source_site=self.ds, dest_site=self.ds, status='CREATED',
        )

        # 1. First pack scan
        r1 = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': tote.lpn_id,
            'sku': str(self.sku.sku_id),
            'lot': str(self.lot.lot_id),
            'qty': 2,
        }, format='json')
        self.assertEqual(r1.status_code, 201)

        # 2. Replay with identical payload (from offline queue sync)
        r2 = self.client.post(f'{API}/inventory/lpn-contents/', {
            'lpn': tote.lpn_id,
            'sku': str(self.sku.sku_id),
            'lot': str(self.lot.lot_id),
            'qty': 2,
        }, format='json')
        self.assertEqual(r2.status_code, 200)

        # Verify only 1 LpnContent row exists with qty=2 (not 4)
        contents = LpnContent.objects.filter(lpn=tote, sku=self.sku)
        self.assertEqual(contents.count(), 1)
        self.assertEqual(contents.first().qty, 2)

    def test_rider_offline_recovery_and_action_replay(self):
        """Rider polling fallback, idempotent accept, tote pickup, and OTP POD replay."""
        order = CustomerOrder.objects.create(
            order_no=f'ORD-REC-{uuid.uuid4().hex[:6].upper()}',
            customer=self.customer, site=self.ds, address=self.address,
            payment_method='COD', subtotal=Decimal('50.00'), grand_total=Decimal('50.00'),
            status='PACKED',
        )
        line = CustomerOrderLine.objects.create(
            order=order, line_no=1, sku=self.sku, lot=self.lot, qty=2, picked_qty=2, packed_qty=2,
            unit_price=Decimal('25.00'), line_total=Decimal('50.00'), status='PACKED',
        )

        tote = LpnMaster.objects.create(
            lpn_id='TOTE-RIDER-REC', barcode='LPN-TOTE-RIDER-REC', lpn_type='TOTE',
            current_site=self.ds, source_site=self.ds, dest_site=self.ds, status='STAGED',
            current_ref_id=str(order.order_id),
        )
        apply_stock(
            site=self.ds, sku=self.sku, lot=self.lot, qty=2,
            direction='IN', movement_type='PACK', ref_type='ORDER', ref_id=order.order_id,
            container='LPN', container_ref=tote.lpn_id,
        )
        LpnContent.objects.create(
            lpn=tote, sku=self.sku, lot=self.lot, qty=2,
        )

        task = DeliveryTask.objects.create(
            order=order, site=self.ds, status='UNASSIGNED', bin=tote.lpn_id,
        )

        self.client.force_authenticate(user=self.rider_user)

        # 1. Polling fallback: rider recovers open tasks when WebSocket is down
        r_poll = self.client.get(f'{API}/delivery/delivery-tasks/')
        self.assertEqual(r_poll.status_code, 200)
        available = r_poll.data.get('results', r_poll.data)
        self.assertTrue(any(str(t['task_id']) == str(task.task_id) for t in available))

        # 2. Rider accepts task: first time
        r_acc1 = self.client.post(f'{API}/delivery/delivery-tasks/{task.task_id}/accept/')
        self.assertEqual(r_acc1.status_code, 200)

        # Replayed accept (e.g. offline queue or double-tap) returns 200 idempotently
        r_acc2 = self.client.post(f'{API}/delivery/delivery-tasks/{task.task_id}/accept/')
        self.assertEqual(r_acc2.status_code, 200)

        # 3. Rider picks up tote: first time
        r_pick1 = self.client.post(f'{API}/delivery/handoff/pickup', {
            'task_id': str(task.task_id),
            'lpn_barcode': tote.barcode,
        }, format='json')
        self.assertEqual(r_pick1.status_code, 200)
        self.assertEqual(r_pick1.data['status'], 'PICKED_UP')

        # Replayed pickup on already PICKED_UP task is refused (409), preventing duplicate stock moves
        r_pick2 = self.client.post(f'{API}/delivery/handoff/pickup', {
            'task_id': str(task.task_id),
            'lpn_barcode': tote.barcode,
        }, format='json')
        self.assertEqual(r_pick2.status_code, 409)

        # 4. Advance to EN_ROUTE and ARRIVED (with idempotent replays)
        r_adv1 = self.client.post(
            f'{API}/delivery/delivery-tasks/{task.task_id}/advance/',
            {'to': 'EN_ROUTE'}, format='json')
        self.assertEqual(r_adv1.status_code, 200)
        r_adv1_rep = self.client.post(
            f'{API}/delivery/delivery-tasks/{task.task_id}/advance/',
            {'to': 'EN_ROUTE'}, format='json')
        self.assertEqual(r_adv1_rep.status_code, 200)

        r_adv2 = self.client.post(
            f'{API}/delivery/delivery-tasks/{task.task_id}/advance/',
            {'to': 'ARRIVED'}, format='json')
        self.assertEqual(r_adv2.status_code, 200)

        # 5. Delivery POD flow: first call requests OTP
        r_pod_req = self.client.post(f'{API}/delivery/handoff/pod', {
            'task_id': str(task.task_id),
        }, format='json')
        self.assertEqual(r_pod_req.status_code, 409)
        self.assertTrue(r_pod_req.data.get('otp_required'))

        # Customer reads OTP code from their interface
        self.client.force_authenticate(user=self.customer_user)
        r_code = self.client.get(f'{API}/orders/orders/{order.order_id}/delivery-code/')
        self.assertEqual(r_code.status_code, 200)
        otp = r_code.data['code']
        self.assertIsNotNone(otp)

        # Rider submits customer OTP with COD collected: first time
        self.client.force_authenticate(user=self.rider_user)
        r_pod1 = self.client.post(f'{API}/delivery/handoff/pod', {
            'task_id': str(task.task_id),
            'otp': otp,
            'cod_amount': '50.00',
        }, format='json')
        self.assertEqual(r_pod1.status_code, 200)
        self.assertEqual(r_pod1.data['status'], 'DELIVERED')

        # Replayed POD submit on already DELIVERED task is refused (409), preventing duplicate COD collection
        r_pod2 = self.client.post(f'{API}/delivery/handoff/pod', {
            'task_id': str(task.task_id),
            'otp': otp,
            'cod_amount': '50.00',
        }, format='json')
        self.assertEqual(r_pod2.status_code, 409)

    def test_conflict_and_rejected_scans_atomic_rollback_and_error_preservation(self):
        """Simulate rejected scans from offline queue: atomic rollback preserves stock and returns clear 409 conflict."""
        self.client.force_authenticate(user=self.picker)

        order = CustomerOrder.objects.create(
            order_no=f'ORD-REC-{uuid.uuid4().hex[:6].upper()}',
            customer=self.customer, site=self.ds, address=self.address,
            payment_method='COD', subtotal=Decimal('50.00'), grand_total=Decimal('50.00'),
            status='CONFIRMED',
        )
        line = CustomerOrderLine.objects.create(
            order=order, line_no=1, sku=self.sku, lot=self.lot, qty=2, unit_price=Decimal('25.00'),
            line_total=Decimal('50.00'), status='PENDING',
        )
        OrderLineAllocation.objects.create(
            order=order, line=line, site=self.ds,
            location_id=self.bin.location_id, bin_label=self.bin.location_id,
            qty=2, picked_qty=0, status='ALLOCATED',
        )

        # 1. Reject wrong bin scan
        r_wrong_bin = self.client.post(f'{API}/ds-ops/pick-line', {
            'order_id': str(order.order_id),
            'line_id': str(line.line_id),
            'bin_location_id': self.other_bin.location_id,
            'qty': 1,
            'scan_id': 'scan-wrong-bin',
        }, format='json')
        self.assertEqual(r_wrong_bin.status_code, 409)
        self.assertIn('Wrong bin', r_wrong_bin.data['error'])

        # Shelf balance completely untouched
        bal = StockBalance.objects.get(site=self.ds, container='BIN', container_ref=self.bin.location_id, sku=self.sku)
        self.assertEqual(bal.qty, 20)

        # 2. Reject over-pick quantity (requested 5 when only 2 needed)
        r_overpick = self.client.post(f'{API}/ds-ops/pick-line', {
            'order_id': str(order.order_id),
            'line_id': str(line.line_id),
            'bin_location_id': self.bin.location_id,
            'qty': 5,
            'scan_id': 'scan-overpick',
        }, format='json')
        self.assertEqual(r_overpick.status_code, 409)
        self.assertIn('more unit(s)', r_overpick.data['error'])

        # Stock balance still completely untouched at 20
        bal.refresh_from_db()
        self.assertEqual(bal.qty, 20)
