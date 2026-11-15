"""Picker work assignment for the dark store.

The chart is explicit about how a confirmed order reaches a picker:

    order confirmed -> lowest-workload picker
                    -> if nobody is free, the order waits in a pending queue
                    -> when a picker frees up, the queue is re-checked

Before this module the only assignment rule was "the first active assignment
row at the site wins", which sent every order in the shift to the same person:
the queue never drained because the fastest picker was also the one holding
all the work, and there was no representation of an order waiting for a
picker at all.

Everything here is site-scoped and idempotent. Calling `assign_order` twice
does not move already-assigned tasks, and `assign_pending_orders` skips orders
whose tasks are being worked. The outbox event is only raised when a picker is
actually stamped onto the tasks.
"""
import logging

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

OPEN_TASK_STATUSES = ('NOT_STARTED', 'IN_PROGRESS')


def _department(user, site, role_at_site=None):
    from bounded.iam import staff_auth
    return staff_auth.department_for(user, site, role_at_site)


def picker_candidates(site):
    """Active associates at `site` whose department is picking.

    A candidate must be a real user (`EmployeeSiteAssignment.user` is the link
    the access layer uses) - the legacy bare `employee` code rows cannot sign
    in, so assigning work to them would strand the order.
    """
    from bounded.network.models import EmployeeSiteAssignment

    rows = (
        EmployeeSiteAssignment.objects
        .filter(site=site, is_active=True, user__isnull=False)
        .select_related('user')
        .order_by('created_at')
    )
    candidates = []
    seen = set()
    for row in rows:
        user = row.user
        if user is None or user.status != 'ACTIVE':
            continue
        if user.user_id in seen:
            continue
        if _department(user, site, row.role_at_site) != 'PICKER':
            continue
        seen.add(user.user_id)
        candidates.append(user)
    return candidates


def workload_by_user(site, candidates=None):
    """Open pick-task count per picker at one store."""
    from django.db.models import Count
    from .models import PickTask

    rows = (
        PickTask.objects
        .filter(order__site=site, status__in=OPEN_TASK_STATUSES,
                assigned_to__isnull=False)
        .values('assigned_to')
        .annotate(open_tasks=Count('picklist_id'))
    )
    counts = {row['assigned_to']: row['open_tasks'] for row in rows}
    if candidates is None:
        return counts
    return {user.user_id: counts.get(user.user_id, 0) for user in candidates}


def lowest_workload_picker(site, candidates=None):
    """The picker carrying the fewest open tasks, or None when nobody is free.

    Ties are broken by the oldest assignment row (the candidate list is already
    ordered that way), so the same person is not repeatedly chosen by a
    dictionary-ordering accident.
    """
    people = picker_candidates(site) if candidates is None else candidates
    if not people:
        return None
    counts = workload_by_user(site, people)
    # `enumerate` preserves assignment order for ties without an O(n) index
    # lookup inside the key function.
    ranked = sorted(
        ((counts.get(user.user_id, 0), index, user)
         for index, user in enumerate(people)),
        key=lambda row: (row[0], row[1]),
    )
    return ranked[0][2]


def assign_order(order, picker=None, actor=None, notify=True):
    """Stamp a picker onto every open PickTask of `order`.

    Returns the picker (`iam.User`) that owns the order, or None when the order
    has no open tasks / no picker is available. Already-worked orders are left
    untouched so a retry cannot steal an order mid-pick.
    """
    from bounded.outbox.services import enqueue_event
    from .models import PickTask

    with transaction.atomic():
        tasks = list(
            PickTask.objects.select_for_update()
            .filter(order=order, status__in=OPEN_TASK_STATUSES)
            .order_by('pick_seq', 'created_at')
        )
        if not tasks:
            return None
        assigned_ids = {task.assigned_to for task in tasks if task.assigned_to}
        if assigned_ids:
            from bounded.iam.models import User
            owner = User.objects.filter(user_id__in=assigned_ids).first()
            # A pick that has actually started belongs to whoever holds it:
            # reassigning it would send a second person to the same shelf and
            # lose track of units already in their hand. An untouched task whose
            # owner is wrong (legacy seed data, or an admin who placed the
            # order) can still be corrected by passing an explicit picker.
            started = any(
                task.status != 'NOT_STARTED' or (task.picked_qty or 0) > 0
                for task in tasks
            )
            if picker is None or started or (
                owner is not None and owner.user_id == picker.user_id
            ):
                return owner
            # Never steal from a colleague who is a valid picker at this store.
            # Reassignment is only for correcting an owner who cannot pick here
            # (an admin who placed the order, or seed data).
            from .assignment import picker_candidates as _candidates
            if owner is not None and owner.user_id in {
                c.user_id for c in _candidates(order.site)
            }:
                return owner

        if picker is None:
            picker = lowest_workload_picker(order.site)
        if picker is None:
            return None

        now = timezone.now()
        PickTask.objects.filter(
            id__in=[task.id for task in tasks],
        ).update(assigned_to=picker.user_id, status='IN_PROGRESS',
                 started_at=now)

    if notify:
        try:
            enqueue_event(
                aggregate_type='PickTask',
                aggregate_id=order.order_id,
                event_type='warehouse.pick.assigned',
                payload_json={
                    'recipient_user_id': str(picker.user_id),
                    'order_id': str(order.order_id),
                    'order_no': order.order_no,
                    'site_code': order.site.code,
                    'task_type': 'PICK',
                    'assigned_by': str(actor.user_id) if actor is not None else 'SYSTEM',
                },
            )
        except Exception:  # noqa: BLE001 - notification must not undo the assignment
            logger.exception('Could not enqueue pick assignment for %s', order.order_no)
    return picker


def pending_pick_orders(site):
    """Orders whose pick tasks nobody owns yet, oldest promise first."""
    from bounded.orders.models import CustomerOrder

    return (
        CustomerOrder.objects
        .filter(site=site, pick_tasks__status__in=OPEN_TASK_STATUSES,
                pick_tasks__assigned_to__isnull=True)
        .exclude(status__in=['CANCELLED', 'FAILED', 'CLOSED_RTO', 'REFUNDED'])
        .distinct()
        .order_by('promise_at', 'placed_at')
    )


def assign_pending_orders(site, actor=None, notify=True, limit=50):
    """Drain the pending queue into pickers that have capacity.

    Returns `(assigned, remaining)`. A picker is only given one new order per
    pass: the caller runs this again after a completion, which keeps the queue
    fair instead of dumping every waiting order onto the first free picker.
    """
    assigned = 0
    for order in list(pending_pick_orders(site)[:limit]):
        picker = lowest_workload_picker(site)
        if picker is None:
            break
        if assign_order(order, picker=picker, actor=actor, notify=notify):
            assigned += 1
            # One order per pass keeps the load balanced; a busy picker can be
            # handed the next order when they mark this one complete.
            break
    remaining = pending_pick_orders(site).count()
    return assigned, remaining
