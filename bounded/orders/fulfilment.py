"""Assignment that must happen after an order is confirmed.

COD checkout and Cashfree payment confirmation ask the same question: who
picks this order, and which rider is offered the delivery? Keeping one answer is
what stops the two payment methods from diverging. Before this module the COD
path assigned a picker while the prepaid path only created an unassigned
delivery task, so a paid order could sit with no picker and no rider offer until
a manager noticed it.

Nothing here raises into the caller. An order that has been paid for must not be
rolled back because a notification or a rider lookup failed; the failure is
logged and the order stays in the pending queue, which the scheduler drains.
"""
import logging
from decimal import Decimal

from django.utils import timezone

logger = logging.getLogger(__name__)

#: Delivery states that mean a rider is already carrying (or is about to carry)
#: a job. Such a rider is skipped by the FIFO offer so nobody is double-booked.
ACTIVE_DELIVERY_STATUSES = (
    'UNASSIGNED', 'OFFERED', 'ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE',
    'ARRIVED', 'POD_PENDING',
)


def _order_weight_kg(order):
    total = Decimal('0')
    for line in order.lines.select_related('sku'):
        grams = getattr(line.sku, 'weight_g', None) or 0
        total += (Decimal(grams) / Decimal('1000')) * line.qty
    return total


def _fifo_key(profile, site):
    open_shifts = [
        shift for shift in profile.shifts.all()
        if shift.status == 'OPEN' and str(shift.site_id) == str(site.site_id)
    ]
    if open_shifts:
        return (0, min(shift.started_at for shift in open_shifts), profile.created_at)
    # No QR-activated shift: available only as a last resort, ordered by profile
    # age so newly created riders do not jump the queue.
    return (1, profile.created_at, profile.created_at)


def auto_assign_after_confirmation(order, actor=None):
    """Stamp the lowest-workload picker and offer the delivery to a FIFO rider.

    Returns ``(picker, delivery_task)``. Either may be ``None``: the order then
    remains in the pending pick queue or in the unassigned delivery queue, and
    ``recheck_pick_queue`` / the next rider coming online picks it up.
    """
    from bounded.delivery.models import DeliveryTask, RiderProfile
    from bounded.ds_ops.assignment import assign_order
    from bounded.outbox.services import enqueue_event

    site = order.site
    if site is None:
        return None, None

    picker = assign_order(order, actor=actor)

    task = (
        DeliveryTask.objects
        .filter(order=order)
        .exclude(status__in=('WITHDRAWN', 'RECALLED'))
        .order_by('-created_at')
        .first()
    )
    if task is not None and task.rider_id:
        return picker, task

    busy_rider_ids = set(
        DeliveryTask.objects
        .filter(status__in=ACTIVE_DELIVERY_STATUSES)
        .exclude(rider__isnull=True)
        .values_list('rider_id', flat=True)
    )
    candidates = list(
        RiderProfile.objects
        .filter(current_site=site, is_online=True, kyc_status='VERIFIED')
        .exclude(rider_id__in=busy_rider_ids)
        .prefetch_related('shifts')
        .order_by('-rating', 'created_at')
    )
    weight_kg = _order_weight_kg(order)
    # Vehicle capacity is a hard constraint: a bike rated for 8 kg does not get
    # a heavier delivery merely because it is next in the queue.
    candidates = [
        profile for profile in candidates
        if profile.vehicle_capacity_kg is None
        or Decimal(str(profile.vehicle_capacity_kg)) >= weight_kg
    ]
    candidates.sort(key=lambda profile: _fifo_key(profile, site))
    available_rider = candidates[0] if candidates else None

    if available_rider is None:
        if task is None:
            task = DeliveryTask.objects.create(
                order=order, site=site, status='UNASSIGNED')
        return picker, task

    if task is None:
        task = DeliveryTask.objects.create(
            order=order, site=site, rider=available_rider,
            status='ACCEPTED', offer_count=1, accepted_at=timezone.now(),
            offered_at=timezone.now(),
        )
    else:
        now = timezone.now()
        task.rider = available_rider
        task.status = 'ACCEPTED'
        task.offer_count = (task.offer_count or 0) + 1
        task.accepted_at = task.accepted_at or now
        task.offered_at = task.offered_at or now
        task.save(update_fields=['rider', 'status', 'offer_count', 'accepted_at', 'offered_at'])

    try:
        from bounded.delivery.views import _notify_delivery_transition
        _notify_delivery_transition('delivery.rider_assigned', task)
    except Exception:  # noqa: BLE001 - assignment must not undo the booking
        logger.exception(
            'Could not emit rider_assigned for order %s', order.order_no)
    return picker, task
