"""
Packing: units that left the shelf are staged and handed to a rider.

Before this existed, `COMPLETE_PICK` set the order straight to PACKED. "Packed"
then meant two unrelated things - stock had been scanned off a shelf, and stock
was waiting at a staging slot - and there was no operation that told the truth
about the second one. The order was declared PACKED while the goods were still
on the floor, so a rider could be dispatched to collect from a bin that had
nothing in it.

Packing is where those two facts are separated:

  1. every picked unit stays in the store's custody (it never joined an LPN),
     recorded as staged and awaiting the rider;
  2. a PackTask per line closes the picking side out;
  3. the staging slot is recorded on the record;
  4. the DeliveryTask is created - this is the moment a rider job comes into
     existence, so it must not happen earlier;
  5. order.packed and delivery_task.created go to the outbox inside the same
     transaction. If the pack rolls back, so does the promise to notify.

Loose bags are the only outbound container: the store bags groceries straight
onto the shelf for the rider to carry. Totes/LPNs remain in the inbound side of
the warehouse (receiving transfers into the store) - they are not part of the
customer delivery flow at all.

Re-running is safe. An existing open DeliveryTask is reused rather than
duplicated, so a retry after a dropped response does not put two riders on one
order.
"""
from django.db import transaction
from django.utils import timezone


class PackError(Exception):
    """Pack cannot proceed. `detail` is returned to the client verbatim."""

    def __init__(self, message, *, status=409, **detail):
        super().__init__(message)
        self.message = message
        self.status = status
        self.detail = detail


PACKABLE_STATUSES = {'PICKED', 'RACK_DROPPED'}

# Statuses an order can be in where a DeliveryTask must not be replaced or
# duplicated. Once a rider has physically taken the goods — or the task is
# past the pickup checkpoint — re-packing is a dispute, not a retry. An
# assignment handed out at checkout, not yet picked, is still packable.
TASK_IN_FLIGHT = {'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED',
                  'POD_PENDING', 'DELIVERED'}


def _barcode_value(raw):
    return str(raw or '').strip().upper()


@transaction.atomic
def pack_order(*, order, actor, lpn_barcode=None, lpn_id=None, staging_bin=None):
    # ``lpn_barcode``/``lpn_id`` are accepted and ignored: the outbound flow carries no
    # tote. Kept so older callers do not 500; they simply pack loose.
    from bounded.delivery.models import DeliveryTask
    from bounded.orders.models import CustomerOrderLine, OrderStatusHistory
    from bounded.outbox.services import enqueue_event
    from .models import PackTask

    order.site  # ensure the site is loaded before the query below

    if order.status not in PACKABLE_STATUSES:
        raise PackError(
            f'Order {order.order_no} is {order.status}; only a PICKED order can '
            f'be packed. Finish the pick first.')

# select_related('lot') is an outer join because lot is nullable, and
    # Postgres will not lock the nullable side of one, so the lock is pinned to
    # this table.
    lines = list(CustomerOrderLine.objects.select_for_update(of=('self',))
                 .select_related('sku', 'lot')
                 .filter(order=order).order_by('line_no'))

    short = [
        {'line_id': str(l.line_id), 'line_no': l.line_no,
         'sku_code': l.sku.sku_code, 'qty': l.qty, 'picked_qty': l.picked_qty,
         'outstanding': l.qty - l.picked_qty}
        for l in lines if l.picked_qty < l.qty
    ]
    if short:
        raise PackError(
            f'Order {order.order_no} is not fully picked: {len(short)} line(s) '
            f'still short.', short_lines=short)

    # An open DeliveryTask may already exist from an earlier pack attempt that
    # succeeded but whose response was lost. Re-packing onto a live rider job
    # would move goods out from under them.
    existing = DeliveryTask.objects.select_for_update().filter(order=order).first()
    if existing is not None and (
            existing.status in TASK_IN_FLIGHT or existing.pickup_at is not None):
        raise PackError(
            f'Order {order.order_no} already has a delivery task that is '
            f'{existing.status}. It cannot be re-packed.', status=409,
            delivery_task_id=str(existing.task_id),
            delivery_task_status=existing.status)

    staging_bin = str(staging_bin or '').strip()
    if not staging_bin:
        raise PackError(
            'staging_bin is required: the rider has to be told which slot to '
            'collect from.', status=400)

    # -- record the pack per line --------------------------------------
    # The units go from the picker's custody into the staged bag. This creates
    # the per-line CUSTODY balance the pickup leg ships back out of; without
    # it the ship leg has nothing to decrement and the units exist nowhere in
    # the ledger. No LPN is involved - the bag itself is the container, keyed
    # by line id.
    from bounded.inventory.stock import already_applied, apply_stock
    packed = []
    for line in lines:
        line.packed_qty = line.picked_qty
        line.status = 'PICKED'
        line.save(update_fields=['packed_qty', 'status'])

        if line.lot_id is not None and line.packed_qty > 0:
            already = already_applied(
                site=order.site, sku=line.sku, lot=line.lot,
                movement_type='PACK', ref_type='ORDERLINE', ref_id=line.line_id,
                direction='IN', container='CUSTODY',
                container_ref=str(line.line_id))
            if not already:
                apply_stock(
                    site=order.site, sku=line.sku, lot=line.lot,
                    qty=line.packed_qty, direction='IN',
                    movement_type='PACK',
                    ref_type='ORDERLINE', ref_id=line.line_id,
                    actor_id=str(actor.user_id), actor_type=actor.role,
                    container='CUSTODY', container_ref=str(line.line_id),
                    # Out of sellable stock; a custody move, not new inventory.
                    sellable=False,
                    supply_from='CUSTODY', supply_from_ref=str(line.line_id),
                )

        PackTask.objects.update_or_create(
            packlist_id=order.order_id, sku=line.sku_id,
            defaults={
                'order': order, 'lpn': '', 'qty': line.qty,
                'packed_qty': line.packed_qty, 'staging_bin': staging_bin,
                'status': 'COMPLETED',
                'assigned_to': str(actor.user_id),
                'completed_by': actor.user_id,
            },
        )
        packed.append({'line_id': str(line.line_id),
                       'sku_code': line.sku.sku_code,
                       'qty': line.packed_qty})

    # -- rider job is born here ------------------------------------------
    now = timezone.now()
    if existing is None:
        task = DeliveryTask.objects.create(
            order=order, site=order.site, bin=None, status='UNASSIGNED',
            staging_bin=staging_bin, packed_at=now,
            order_weight_kg=_order_weight_kg(order, lines),
        )
    else:
        # A previous pack attempt got as far as creating the task and then the
        # transaction rolled back, or the task exists from an earlier pack of a
        # cancelled order. Reuse it rather than dispatching a second rider.
        task = existing
        task.bin = None
        task.staging_bin = staging_bin
        task.packed_at = task.packed_at or now
        task.save(update_fields=['bin', 'staging_bin', 'packed_at'])

    previous_status = order.status
    order.status = 'PACKED'
    order.save(update_fields=['status'])

    OrderStatusHistory.objects.create(
        order=order, from_status=previous_status, to_status='PACKED',
        actor_type=actor.role, actor_id=str(actor.user_id),
    )

    # Assign an online rider at the store immediately: no accept handshake,
    # no jobs sitting unclaimed. Nobody online → the task waits and the
    # set_online / delivery-completion sweep picks it up then.
    from bounded.delivery.dispatch import auto_assign_task
    auto_assign_task(task, actor)

    correlation_id = getattr(order, 'order_id', None)
    enqueue_event(
        aggregate_type='CustomerOrder', aggregate_id=order.order_id,
        event_type='order.packed',
        correlation_id=correlation_id,
        payload_json={
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'site_code': order.site.code,
            'staging_bin': staging_bin,
            'lines': packed,
            'packed_by': str(actor.user_id),
        },
    )
    enqueue_event(
        aggregate_type='DeliveryTask', aggregate_id=task.task_id,
        event_type='delivery_task.created',
        correlation_id=correlation_id,
        payload_json={
            'task_id': str(task.task_id),
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'site_code': order.site.code,
            'staging_bin': staging_bin,
            'status': task.status,
        },
    )

    return {
        'order_id': str(order.order_id),
        'order_no': order.order_no,
        'status': order.status,
        'previous_status': previous_status,
        'staging_bin': staging_bin,
        'lines': packed,
        'skipped': [{'line_id': str(l.line_id),
                      'sku_code': l.sku.sku_code,
                      'qty': l.qty,
                      'picked_qty': l.picked_qty,
                      'outstanding': l.qty - l.picked_qty}
                     for l in lines if l.lot_id is None],
        'delivery_task': {
            'task_id': str(task.task_id),
            'status': task.status,
            'bin': None,
            'staging_bin': task.staging_bin,
        },
    }


def _order_weight_kg(order, lines):
    """Best-effort bag weight, for rider acceptance decisions.

    Sku.weight_g is optional in the catalogue, so this stays None rather than
    guessing: a rider accepting a job on a fabricated weight is worse than a
    missing weight.
    """
    total = 0
    for line in lines:
        weight = line.sku.weight_g
        if weight:
            total += int(weight) * line.packed_qty
    return round(total / 1000.0, 3) if total else None
