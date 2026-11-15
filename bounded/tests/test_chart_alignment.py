"""Chart-alignment flows: picker queue, rack drop, reassignment and floor counts.

These cover the seams a UI walkthrough cannot: the read models the mobile
screens poll, the hand-off that turns a picked order into a rack drop, and the
rule that a manager may correct a stale assignment but never steal a pick that
has already started.
"""
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.ds_ops.assignment import assign_order
from bounded.ds_ops.models import PickTask
from bounded.iam.models import User
from bounded.network.models import EmployeeSiteAssignment, Site
from bounded.orders.models import (
    Customer, CustomerAddress, CustomerOrder, CustomerOrderLine,
)

from .test_ds_console import ConsoleBase

TRACK = '/api/ds-ops/order-tracking'
MY_PICKS = '/api/ds-ops/my-picks'
ASSIGN = '/api/ds-ops/assign-order'
RACK_DROP = '/api/ds-ops/rack-drop'
COUNTS = '/api/counting/cycle-counts/'

_seq = 0


def _next_order_no(prefix='ORD-CHART'):
    global _seq
    _seq += 1
    return f'{prefix}-{timezone.now().strftime("%H%M%S")}-{_seq}'


class ChartBase(ConsoleBase):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.manager = User.objects.create(
            email='chart-manager@zippzo.in', role='OPS_MANAGER', status='ACTIVE')

    def second_order(self, **overrides):
        order = CustomerOrder.objects.create(
            order_no=_next_order_no(),
            customer=self.customer,
            site=self.store,
            address=self.address,
            status='CONFIRMED',
            payment_method='COD',
            payment_status='PENDING',
            subtotal='20.00',
            grand_total='20.00',
            placed_at=timezone.now(),
            **overrides,
        )
        line = CustomerOrderLine.objects.create(
            order=order, line_no=1, sku=self.sku, lot=self.lot, qty=1,
            picked_qty=0, unit_price='20.00', line_total='20.00',
        )
        return order, line

    def task_for(self, order, **overrides):
        defaults = dict(
            picklist_id=order.order_id,
            batch=order.order_id,
            order=order,
            sku=self.sku.sku_id,
            lot=self.lot.lot_id,
            bin=self.bin.location_id,
            qty=1,
            status='NOT_STARTED',
        )
        defaults.update(overrides)
        return PickTask.objects.create(**defaults)


class PickerQueueTests(ChartBase):

    def test_tracking_and_my_picks_name_the_customer(self):
        """Regression: Customer has `name`, not `full_name`."""
        order, _line = self.second_order()
        self.task_for(order)

        tracking = self.api.get(TRACK, {'site_code': self.store.code})
        self.assertEqual(200, tracking.status_code, tracking.data)
        row = next(o for o in tracking.data['orders']
                   if o['order_id'] == str(order.order_id))
        self.assertEqual('Console Customer', row['customer_name'])

        owner = assign_order(order, picker=self.operator)
        self.assertIsNotNone(owner)

        mine = self.api.get(MY_PICKS, {'site_code': self.store.code})
        self.assertEqual(200, mine.status_code, mine.data)
        self.assertIn(str(order.order_id),
                      [o['order_id'] for o in mine.data['mine']])

    def test_assign_refuses_a_user_who_does_not_pick_here(self):
        order, _line = self.second_order()
        self.task_for(order)

        response = self.api.post(ASSIGN, {
            'order_id': str(order.order_id),
            'picker_id': str(self.manager.user_id),
        }, format='json')

        self.assertEqual(400, response.status_code, response.data)


class ReassignmentTests(ChartBase):

    def test_manager_corrects_a_stale_assignment_before_work_starts(self):
        order, _line = self.second_order()
        task = self.task_for(order, assigned_to=self.manager.user_id)

        owner = assign_order(order, picker=self.operator)

        self.assertEqual(self.operator.user_id, owner.user_id)
        task.refresh_from_db()
        self.assertEqual(self.operator.user_id, task.assigned_to)

    def test_a_pick_that_has_started_cannot_be_stolen(self):
        order, _line = self.second_order()
        self.task_for(order)
        assign_order(order, picker=self.operator)

        other = User.objects.create(
            email='chart-picker-2@zippzo.in', role='WAREHOUSE_STAFF',
            status='ACTIVE')
        EmployeeSiteAssignment.objects.create(
            employee='OP-CHART-2', user=other, site=self.store,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=False)

        owner = assign_order(order, picker=other)

        self.assertEqual(self.operator.user_id, owner.user_id)
        self.assertEqual(
            self.operator.user_id,
            PickTask.objects.get(order=order).assigned_to)


class RackDropTests(ChartBase):

    def test_fully_picked_order_drops_at_the_rack_and_is_idempotent(self):
        order, line = self.second_order()
        order.status = 'PICKED'
        order.save(update_fields=['status'])
        line.picked_qty = line.qty
        line.save(update_fields=['picked_qty'])

        response = self.api.post(RACK_DROP, {
            'order_id': str(order.order_id), 'rack_location': 'RACK-9',
        }, format='json')
        self.assertEqual(200, response.status_code, response.data)
        order.refresh_from_db()
        self.assertEqual('RACK_DROPPED', order.status)
        self.assertEqual('RACK-9', order.rack_location)
        self.assertIsNotNone(order.rack_dropped_at)

        again = self.api.post(RACK_DROP, {
            'order_id': str(order.order_id), 'rack_location': 'RACK-9',
        }, format='json')
        self.assertEqual(200, again.status_code, again.data)
        self.assertTrue(again.data['already_dropped'])

    def test_short_order_is_refused(self):
        order, _line = self.second_order()
        order.status = 'PICKED'
        order.save(update_fields=['status'])

        response = self.api.post(RACK_DROP, {
            'order_id': str(order.order_id), 'rack_location': 'RACK-1',
        }, format='json')

        self.assertEqual(409, response.status_code, response.data)
        order.refresh_from_db()
        self.assertEqual('PICKED', order.status)


class FloorCountTests(ChartBase):

    def test_associate_can_open_a_spot_count_at_their_store(self):
        response = self.api.post(COUNTS, {
            'site': self.store.site_id,
            'code': 'SPOT-CHART-1',
            'count_type': 'SPOT',
            'status': 'IN_PROGRESS',
            'scope': {'sku': str(self.sku.sku_id), 'bin': self.bin.location_id},
            'notes': 'chart smoke',
        }, format='json')

        self.assertEqual(201, response.status_code, response.data)

    def test_associate_cannot_open_a_count_at_another_store(self):
        foreign = Site.objects.create(
            code='DS-NO-ASSIGN', site_type='DARK_STORE',
            name='Unassigned DS', address='test')

        response = self.api.post(COUNTS, {
            'site': foreign.site_id,
            'code': 'SPOT-CHART-FOREIGN',
            'count_type': 'SPOT',
            'status': 'IN_PROGRESS',
        }, format='json')

        self.assertEqual(400, response.status_code, response.data)


class DepartmentGatingTests(ChartBase):
    """A store assignment is not the same thing as a department."""

    def inbound_client(self):
        inbound = User.objects.create(
            email='chart-inbound@zippzo.in', role='WAREHOUSE_STAFF',
            status='ACTIVE')
        EmployeeSiteAssignment.objects.create(
            employee='OP-CHART-INBOUND', user=inbound, site=self.store,
            mode='DARKHOUSE', role_at_site='INBOUND_ASSOCIATE', is_primary=True)
        client = APIClient()
        client.force_authenticate(inbound)
        return inbound, client

    def test_inbound_associate_cannot_complete_a_rack_drop(self):
        _inbound, client = self.inbound_client()
        order, line = self.second_order()
        order.status = 'PICKED'
        order.save(update_fields=['status'])
        line.picked_qty = line.qty
        line.save(update_fields=['picked_qty'])

        denied = client.post(RACK_DROP, {
            'order_id': str(order.order_id), 'rack_location': 'RACK-9',
        }, format='json')

        self.assertEqual(403, denied.status_code, denied.data)
        order.refresh_from_db()
        self.assertEqual('PICKED', order.status)

        # The same call works for the picker assigned to this store, so the
        # refusal is the department gate and not a broken endpoint.
        allowed = self.api.post(RACK_DROP, {
            'order_id': str(order.order_id), 'rack_location': 'RACK-9',
        }, format='json')
        self.assertEqual(200, allowed.status_code, allowed.data)

    def test_capabilities_are_limited_by_department_on_mobile(self):
        from bounded.iam import staff_auth

        inbound, _client = self.inbound_client()
        inbound_caps = staff_auth.capabilities_for(inbound, self.store, 'mobile')
        picker_caps = staff_auth.capabilities_for(self.operator, self.store, 'mobile')

        self.assertFalse(inbound_caps['can_pick'])
        self.assertTrue(inbound_caps['can_receive'])
        self.assertTrue(picker_caps['can_pick'])
        self.assertFalse(picker_caps['can_receive'])
