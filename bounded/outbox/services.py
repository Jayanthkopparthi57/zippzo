"""Transactional outbox helpers shared by business workflows."""
import logging
import uuid

from django.db import transaction

logger = logging.getLogger(__name__)


def _to_uuid(val):
    if val is None:
        return None
    if isinstance(val, uuid.UUID):
        return val
    try:
        return uuid.UUID(str(val))
    except (ValueError, AttributeError, TypeError):
        return uuid.uuid5(uuid.NAMESPACE_DNS, str(val))


def enqueue_event(**fields):
    """Persist an event with the business change, then publish after commit.

    The row remains the recovery source if the process exits before the
    callback, or if notification delivery is temporarily unavailable. Inbox
    reads and the management command can drain those pending rows later.
    """
    from .models import OutboxEvent

    if 'aggregate_id' in fields and fields['aggregate_id'] is not None:
        fields['aggregate_id'] = _to_uuid(fields['aggregate_id'])
    if 'correlation_id' in fields and fields['correlation_id'] is not None:
        fields['correlation_id'] = _to_uuid(fields['correlation_id'])

    event = OutboxEvent.objects.create(**fields)

    def publish_committed_event():
        try:
            from bounded.notifications.publish import publish_batch
            publish_batch(limit=100)
        except Exception:  # noqa: BLE001 - pending outbox rows are retryable
            logger.exception('Could not publish outbox event %s', event.event_id)

    transaction.on_commit(publish_committed_event)
    return event
