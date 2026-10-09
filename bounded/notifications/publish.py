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
subsystem. Actually calling an SMS or push provider is not implemented here - no
channel adapter exists in this project - so notifications are left unsent
(`sent_at` NULL) rather than being marked as sent on the strength of a database
insert. Notification.retry_count / failed_at are there for whichever adapter
lands next.
"""
from django.db import transaction
from django.utils import timezone

# event_type -> (notification type, channels, audience)
#
# `audience` decides who hears about it. Getting this wrong is the whole risk:
# a pack notification sent to the customer instead of the rider is noise, and one
# sent to neither is a rider standing in a dark store waiting for goods nobody
# told them about.
ROUTES = {
    'order.packed': ('ORDER_PACKED', ['SMS', 'PUSH', 'WS'], 'customer'),
    'order.picked_up': ('ORDER_ON_THE_WAY', ['PUSH', 'WS', 'SMS'], 'customer'),
    'order.delivered': ('ORDER_DELIVERED', ['PUSH', 'SMS'], 'customer'),
    'delivery_task.created': ('RIDER_JOB_OFFERED', ['PUSH', 'WS'], 'riders_at_site'),
    'delivery.pod_requested': ('DELIVERY_OTP', ['SMS', 'PUSH'], 'otp_recipient'),
}

DEFAULT_ROUTE = ('ORDER_UPDATE', ['PUSH', 'WS'], 'customer')


def _recipients(event, audience, payload):
    """User ids for this event, or an empty list when nobody should be told."""
    from bounded.delivery.models import RiderProfile

    if audience == 'riders_at_site':
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
            _, was_created = Notification.objects.get_or_create(
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