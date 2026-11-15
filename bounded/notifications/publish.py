"""
Turn outbox events into notifications.

The outbox exists so that "the order was packed" and "the rider has been told the
order was packed" cannot come apart: the event row is written inside the same
transaction as the stock move, and only a successful hand-off marks it published.
A crash between the two leaves a PENDING event, not a lost notification.

Notification.idempotency_key is unique, and the key is derived from the event id
plus the recipient, so re-running the publisher cannot send the same message
twice. That matters because the retry is the normal case, not the exception.

Scope: this creates the Notification rows and hands them to the notification
subsystem. The in-app row *is* delivery and is pushed over the WebSocket group;
PUSH and SMS rows are handed to ``notifications.channels`` after the row
commits, so a provider outage can never roll back the event. A channel with no
credentials stays unsent (``sent_at`` NULL) and can be replayed later.
Notification.retry_count / failed_at record provider refusals.
"""
from django.db import transaction
from django.utils import timezone


def _push_notification(user_id, notification):
    """Best-effort live delivery; the persisted inbox remains authoritative."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'user-events-{user_id}',
            {
                'type': 'notification.event',
                'notification': {
                    'notification_id': str(notification.notification_id),
                    'type': notification.type,
                    'payload_json': notification.payload_json,
                    'created_at': notification.created_at.isoformat(),
                },
            },
        )
    except Exception:  # noqa: BLE001 - inbox reads/polling are the fallback
        return


def _deliver_out_of_app(notification):
    """Hand one PUSH/SMS row to its provider. Never raises into the caller."""
    try:
        from bounded.notifications.channels import deliver

        deliver(notification.notification_id)
    except Exception:  # noqa: BLE001 - the row stays unsent and retryable
        pass

# event_type -> (notification type, channels, audience)
#
# `audience` decides who hears about it. Getting this wrong is the whole risk:
# a pack notification sent to the customer instead of the rider is noise, and one
# sent to neither is a rider standing in a dark store waiting for goods nobody
# told them about.
ROUTES = {
    # The durable in-app inbox is the customer-facing source for order state.
    'order.payment_pending': ('ORDER_UPDATE', [], 'none'),
    'payment.captured': ('ORDER_PLACED', ['PUSH', 'WS'], 'customer'),
    'order.placed': ('ORDER_PLACED', ['PUSH', 'WS'], 'customer'),
    'order.packed': ('ORDER_PACKED', ['SMS', 'PUSH', 'WS'], 'customer'),
    'order.picked_up': ('ORDER_ON_THE_WAY', ['PUSH', 'WS', 'SMS'], 'customer'),
    'order.delivered': ('ORDER_DELIVERED', ['PUSH', 'SMS'], 'customer'),
    'delivery_task.created': ('RIDER_JOB_OFFERED', ['PUSH', 'WS'], 'riders_at_site'),
    'delivery.rider_assigned': ('RIDER_ASSIGNED', ['WS'], 'customer_and_rider'),
    'delivery.out_for_delivery': ('ORDER_ON_THE_WAY', ['WS'], 'customer'),
    'delivery.arrived': ('RIDER_ARRIVED', ['WS'], 'customer'),
    'delivery.pod_requested': ('DELIVERY_OTP', ['SMS', 'PUSH'], 'otp_recipient'),
    'warehouse.task.assigned': ('WMS_TASK_ASSIGNED', ['WS'], 'user'),
    'warehouse.qc.assigned': ('QC_TASK_ASSIGNED', ['WS'], 'user'),
    'warehouse.qc.exception': ('QC_EXCEPTION', ['WS'], 'supervisors_at_site'),
    'warehouse.grn.completed': ('GRN_COMPLETED', ['WS'], 'supervisors_at_site'),
    'warehouse.inbound.discrepancy': ('INBOUND_DISCREPANCY', ['WS'], 'supervisors_at_site'),
    'warehouse.putaway.completed': ('PUTAWAY_COMPLETED', ['WS'], 'supervisors_at_site'),
    'warehouse.transfer.dispatched': ('TRANSFER_DISPATCHED', ['WS'], 'supervisors_at_site'),
    'warehouse.lpn.received': ('LPN_RECEIVED', ['WS'], 'supervisors_at_site'),
    'warehouse.shelf.putaway': ('SHELF_PUTAWAY_COMPLETED', ['WS'], 'supervisors_at_site'),
    'warehouse.pick.assigned': ('PICK_TASK_ASSIGNED', ['WS'], 'user'),
    'warehouse.delivery.offered': ('RIDER_JOB_OFFERED', ['PUSH', 'WS'], 'user'),
    'darkstore.pick.assigned': ('PICK_TASK_ASSIGNED', ['WS'], 'user'),
    'darkstore.pack.assigned': ('PACK_TASK_ASSIGNED', ['WS'], 'user'),
}

DEFAULT_ROUTE = ('ORDER_UPDATE', ['PUSH', 'WS'], 'customer')


def _recipients(event, audience, payload):
    """User ids for this event, or an empty list when nobody should be told."""
    from bounded.delivery.models import RiderProfile

    if audience == 'none':
        return []

    if audience == 'riders_at_site':
        assigned_rider = payload.get('rider_user_id')
        if assigned_rider:
            return [assigned_rider]
        site_code = payload.get('site_code')
        if not site_code:
            return []
        return list(
            RiderProfile.objects.filter(is_online=True, current_site__code=site_code)
            .values_list('user_id', flat=True)
        )

    if audience == 'otp_recipient':
        # The OTP is addressed to whoever placed the order, and the payload
        # carries the raw code: this is the only place it is ever stored in
        # plaintext, and it never touches the customer_orders row.
        uid = payload.get('customer_user_id')
        return [uid] if uid else []

    if audience == 'user':
        uid = payload.get('recipient_user_id')
        return [uid] if uid else []

    if audience == 'supervisors_at_site':
        # Ops managers and super admins always receive site exceptions.
        # Warehouse staff with a supervisory role at the named site are also
        # included so a shift lead at the dock gets the same alert.
        from bounded.iam.models import User
        from bounded.network.models import EmployeeSiteAssignment

        SUPERVISOR_ROLES = {'SUPER_ADMIN', 'OPS_MANAGER'}
        # EmployeeSiteAssignment.role_at_site values are stored uppercase
        # (for example SHIFT_LEAD, STORE_MANAGER and OPS_MANAGER).
        SUPERVISOR_SITE_ROLES = {
            'SHIFT_LEAD', 'OPS_MANAGER', 'SUPERVISOR', 'STORE_MANAGER',
            'STORE_SUPERVISOR', 'SITE_MANAGER', 'MANAGER',
        }
        site_code = payload.get('site_code', '')

        supervisor_ids = set(
            User.objects.filter(role__in=SUPERVISOR_ROLES, status='ACTIVE')
            .values_list('user_id', flat=True)
        )
        if site_code:
            site_staff_ids = set(
                EmployeeSiteAssignment.objects.filter(
                    site__code=site_code, is_active=True,
                    role_at_site__in=SUPERVISOR_SITE_ROLES,
                ).values_list('user_id', flat=True)
            )
            supervisor_ids |= {uid for uid in site_staff_ids if uid}
        return [str(uid) for uid in supervisor_ids if uid]

    if audience == 'customer_and_rider':
        from bounded.orders.models import CustomerOrder
        order = CustomerOrder.objects.filter(
            order_id=payload.get('order_id')).select_related('customer__user').first()
        recipients = []
        if order and order.customer_id and order.customer.user_id:
            recipients.append(order.customer.user_id)
        rider_uid = payload.get('rider_user_id')
        if rider_uid:
            recipients.append(rider_uid)
        return list(dict.fromkeys(recipients))

    # 'customer'
    from bounded.orders.models import CustomerOrder
    order = CustomerOrder.objects.filter(
        order_id=payload.get('order_id')).select_related('customer__user').first()
    if order is None or order.customer is None:
        return []
    return [order.customer.user_id] if order.customer.user_id else []


def publish_event(event):
    """Fan one event out to notifications. Returns the rows it created."""
    from bounded.notifications.models import Notification

    notif_type, channels, audience = ROUTES.get(
        event.event_type, DEFAULT_ROUTE)
    payload = event.payload_json or {}

    # The in-app inbox is not optional and is not one of the provider
    # channels: it is the only channel with a reader. Deduplicated so a
    # future route that already lists IN_APP does not double-write.
    deliverable = ['IN_APP'] + [
        c for c in channels if c not in ('IN_APP',)
    ]

    created = []
    for user_id in _recipients(event, audience, payload):
        if not user_id:
            continue
        for channel in deliverable:
            notification, was_created = Notification.objects.get_or_create(
                # Unique per (event, recipient, channel): a retried publish of
                # the same event cannot double-notify.
                idempotency_key=f'{event.event_id}:{user_id}:{channel}',
                defaults={
                    'user': str(user_id),
                    'type': notif_type,
                    'channel': channel,
                    'payload_json': payload,
                },
            )
            if was_created:
                created.append(notif_type)
                if channel == 'IN_APP':
                    # Never publish before the notification row is committed.
                    transaction.on_commit(
                        lambda uid=user_id, row=notification: _push_notification(uid, row)
                    )
                elif channel in ('PUSH', 'SMS'):
                    # Same rule for the provider edge: the row must exist before
                    # an SMS can reference it, and a provider failure must not
                    # abort the transaction that wrote it.
                    transaction.on_commit(
                        lambda row=notification: _deliver_out_of_app(row)
                    )
    return created


@transaction.atomic
def publish_batch(limit=100):
    """Publish up to `limit` pending events.

    skip_locked lets several publisher workers run at once without one blocking
    on the rows another has locked - the events are independent, so serialising
    them was pure latency.
    """
    from bounded.outbox.models import OutboxEvent

    events = list(
        OutboxEvent.objects.select_for_update(skip_locked=True)
        .filter(status='PENDING')
        .order_by('created_at')[:limit]
    )

    summary = {}
    for event in events:
        try:
            created = publish_event(event)
        except Exception as exc:  # noqa: BLE001 - one bad event must not stall the queue
            event.status = 'FAILED'
            event.attempts += 1
            event.save(update_fields=['status', 'attempts'])
            summary[event.event_type] = summary.get(event.event_type, 0) + 1
            summary.setdefault('_errors', []).append(
                f'{event.event_id}: {exc}')
            continue

        event.status = 'PUBLISHED'
        event.published_at = timezone.now()
        event.attempts += 1
        event.save(update_fields=['status', 'published_at', 'attempts'])
        summary[event.event_type] = summary.get(event.event_type, 0) + 1

    return len(events), summary
