"""Automatic assignment of delivery tasks to online riders.

A delivery task is born inside the pack transaction. Rather than wait for a
rider to claim it, the first online rider at the store with capacity is
assigned to it the moment the task exists — the same state the rider's own
The checkout's auto-assign after confirmation (or the rider's own accept in
the app, which goes through the same door) reaches ACCEPTED.

If nobody is online at that moment, the task waits and the sweep runs again
whenever a rider flips online or a delivery closes (the freed capacity is
handed to the next waiting task at that store).

Capacity is one active task per rider: this is a single-batch quick-commerce
operation, and stacking orders onto one rider is a product decision, not
something to smuggle in here.

The actor is always the human behind the call (the staff member who packed,
the rider who came online, the rider who delivered) so every automatic
transition carries an auditable, real-shaped actor in the order history.
"""
from django.db import transaction
from django.utils import timezone

from bounded.delivery.models import DeliveryTask, RiderProfile

# Task states where the rider is still holding the order. Once they hit
# DELIVERED / FAILED / RETURNED the rider has free capacity again.
ACTIVE_RIDER_STATES = {
    'OFFERED', 'ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED',
    'POD_PENDING',
}


def rider_active_count(profile):
    return DeliveryTask.objects.filter(
        rider=profile, status__in=ACTIVE_RIDER_STATES,
    ).count()


def _waiting_free_riders(site):
    candidates = list(
        RiderProfile.objects.filter(
            is_online=True, current_site=site,
        ).select_related('current_site')
    )
    return [p for p in candidates if rider_active_count(p) == 0]


def _assign(task, rider, now, actor):
    """Flip one task to ACCEPTED for this rider and notify them."""
    from bounded.delivery.views import _notify_delivery_transition

    task.rider = rider
    task.status = 'ACCEPTED'
    task.accepted_at = task.accepted_at or now
    task.offered_at = task.offered_at or now
    task.save(update_fields=['rider', 'status', 'accepted_at', 'offered_at'])
    _notify_delivery_transition('delivery.rider_assigned', task)


@transaction.atomic
def auto_assign_task(task, actor):
    """Assign one waiting task to the freest online rider at its store.

    Returns the RiderProfile assigned, or None when nobody qualifies. The
    caller supplies the human actor for the audit trail.
    """
    locked = (
        DeliveryTask.objects.select_for_update()
        .filter(pk=task.pk, status='UNASSIGNED')
        .select_related('order', 'order__customer', 'site')
        .first()
    )
    if locked is None:
        return None
    riders = _waiting_free_riders(locked.site)
    if not riders:
        return None
    # Deterministic tie-break: freest rider, then stable by rider id.
    riders.sort(key=lambda p: str(p.rider_id))
    _assign(locked, riders[0], timezone.now(), actor)
    return riders[0]


@transaction.atomic
def assign_pending_at(site, actor):
    """Sweep every waiting task at one store, oldest first, until no rider has
    capacity left or the queue is empty. Returns the tasks assigned."""
    if site is None:
        return []
    assigned = []
    waiting = list(
        DeliveryTask.objects.select_for_update()
        .filter(site=site, status='UNASSIGNED')
        .order_by('created_at')
    )
    for task in waiting:
        rider = auto_assign_task(task, actor)
        if rider is not None:
            assigned.append((task, rider))
    return assigned
