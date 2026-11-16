"""
Packing: units that left the shelf now go into a tote the rider will collect.

Before this existed, `COMPLETE_PICK` set the order straight to PACKED. "Packed"
then meant two unrelated things - stock had been scanned off a shelf, and stock
was sitting in an LPN with a staging slot - and there was no operation that told
the truth about the second one. The order was declared PACKED while the goods
were still on the floor, so a rider could be dispatched to collect from a bin
that had nothing in it.

Packing is where those two facts are separated:

  1. every picked unit is moved from the store's custody into the LPN's balance,
     so the tote holds real stock rather than being a label;
  2. LpnContent records what is inside, so a wrong tote is detectable;
  3. a PackTask per line closes the picking side out;
  4. the LPN is sealed and staged, and the staging slot is recorded on the order
     side of the record rather than only on the tote;
  5. the DeliveryTask is created - this is the moment a rider job comes into
     existence, so it must not happen earlier;
  6. order.packed and delivery_task.created go to the outbox inside the same
     transaction. If the pack rolls back, so does the promise to notify.

Re-running is safe. The movements are idempotent on (PACK, order line, LPN), and
an existing open DeliveryTask is reused rather than duplicated, so a retry after
a dropped response does not put two riders on one order.
"""
from django.db import transaction
from django.db.models import Sum
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
# duplicated. Once a rider has touched the task, re-packing is a dispute, not a
# retry, so the pack endpoint refuses rather than rewinding it.
TASK_IN_FLIGHT = {'ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED',
                  'POD_PENDING', 'DELIVERED'}


def _barcode_value(raw):
    return str(raw or '').strip().upper()


@transaction.atomic
def pack_order(*, order, actor, lpn_barcode=None, lpn_id=None, staging_bin=None):
    from bounded.delivery.models import DeliveryTask
    from bounded.inventory.models import LpnContent, LpnMaster, StockBalance
    from bounded.inventory.stock import already_applied, apply_stock
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
    if existing is not None and existing.status in TASK_IN_FLIGHT:
        raise PackError(
            f'Order {order.order_no} already has a delivery task that is '
            f'{existing.status}. It cannot be re-packed.', status=409,
            delivery_task_id=str(existing.task_id),
            delivery_task_status=existing.status)

    # -- resolve the tote ------------------------------------------------
    lpn = None
    if lpn_barcode:
        lpn = LpnMaster.objects.select_for_update().filter(
            barcode__iexact=_barcode_value(lpn_barcode)).first()
        if lpn is None:
            raise PackError(f'No LPN with barcode {lpn_barcode!r}.', status=404)
    elif lpn_id:
        lpn = LpnMaster.objects.select_for_update().filter(pk=_barcode_value(lpn_id)).first()
        if lpn is None:
            raise PackError(f'No LPN with id {lpn_id!r}.', status=404)
    else:
        raise PackError(
            'A tote is required: send lpn_barcode (what the operator scanned) or '
            'lpn_id (an allocated tote).', status=400)

    if lpn.current_site_id and lpn.current_site_id != order.site_id and \
            lpn.status in {'PACKED', 'STAGED', 'IN_TRANSIT', 'SEALED'}:
        raise PackError(
            f'Tote {lpn.barcode} is at {lpn.current_site.code} and already holds '
            f'goods; it cannot be filled for {order.site.code}.',
            status=409, lpn_status=lpn.status)

    # Only a tote with nothing in it can be filled. The check above only
    # catches a busy tote belonging to *another* store, so a STAGED or
    # IN_TRANSIT tote sitting at this one - sealed onto a different order by
    # this store, or still out with a rider - walked straight through and a
    # second order's units were added to a tote that already carried somebody
    # else's goods under a different delivery task.
    #
    # Packing the *same* order again stays allowed: that is a retry after a
    # dropped response, the goods are already in there, and `already_applied`
    # below is what stops them being credited twice.
    carrying_this_order = (
        lpn.current_ref_id is not None
        and str(lpn.current_ref_id) == str(order.order_id))
    if lpn.status not in {'EMPTY', 'CREATED'} and not carrying_this_order:
        raise PackError(
            f'Tote {lpn.barcode} is {lpn.status} and is not empty, so it '
            f'cannot be filled for {order.site.code}.',
            status=409, lpn_status=lpn.status)

    staging_bin = str(staging_bin or '').strip()
    if not staging_bin:
        raise PackError(
            'staging_bin is required: the rider has to be told which slot to '
            'collect the tote from.', status=400)

    # -- move the units into the tote ------------------------------------
    packed, skipped = [], []
    for line in lines:
        if line.lot_id is None:
            skipped.append({'line_id': str(line.line_id),
                            'sku_code': line.sku.sku_code,
                            'reason': 'line has no lot allocated'})
            continue

        already = already_applied(
            site=order.site, sku=line.sku, lot=line.lot,
            movement_type='PACK', ref_type='ORDERLINE', ref_id=line.line_id,
            direction='IN', container='LPN', container_ref=lpn.lpn_id)
        if not already:
            apply_stock(
                site=order.site, sku=line.sku, lot=line.lot, qty=line.picked_qty,
                direction='IN', movement_type='PACK',
                ref_type='ORDERLINE', ref_id=line.line_id,
                actor_id=str(actor.user_id), actor_type=actor.role,
                container='LPN', container_ref=lpn.lpn_id,
                # The units are already out of sellable stock; this is a custody
                # move into the tote, not new sellable inventory.
                sellable=False,
                # It is a hand-off, not a purchase. SUPPLIER would say these
                # units were bought here, which would then read as negative
                # shrinkage against the store.
                supply_from='CUSTODY', supply_from_ref=str(line.line_id),
            )

        line.packed_qty = line.picked_qty
        line.status = 'PICKED'
        line.save(update_fields=['packed_qty', 'status'])

        LpnContent.objects.update_or_create(
            lpn=lpn, sku=line.sku, lot=line.lot,
            defaults={'qty': line.packed_qty})

        PackTask.objects.update_or_create(
            packlist_id=order.order_id, sku=line.sku_id,
            defaults={
                'order': order, 'lpn': lpn.lpn_id, 'qty': line.qty,
                'packed_qty': line.packed_qty, 'staging_bin': staging_bin,
                'status': 'COMPLETED',
                'assigned_to': str(actor.user_id),
                'completed_by': actor.user_id,
            },
        )
        packed.append({'line_id': str(line.line_id),
                       'sku_code': line.sku.sku_code,
                       'qty': line.packed_qty})

    # -- seal and stage the tote -----------------------------------------
    lpn.status = 'STAGED'
    lpn.current_site = order.site
    lpn.current_container = 'LPN'
    lpn.current_ref_id = str(order.order_id)
    lpn.sealed_at = lpn.sealed_at or timezone.now()
    lpn.save(update_fields=['status', 'current_site', 'current_container',
                            'current_ref_id', 'sealed_at'])

    # -- rider job is born here ------------------------------------------
    now = timezone.now()
    if existing is None:
        task = DeliveryTask.objects.create(
            order=order, site=order.site, bin=lpn.lpn_id, status='UNASSIGNED',
            staging_bin=staging_bin, packed_at=now,
            order_weight_kg=_order_weight_kg(order, lines),
        )
    else:
        # A previous pack attempt got as far as creating the task and then the
        # transaction rolled back, or the task exists from an earlier pack of a
        # cancelled order. Reuse it rather than dispatching a second rider.
        task = existing
        task.bin = lpn.lpn_id
        task.staging_bin = staging_bin
        task.packed_at = task.packed_at or now
        task.save(update_fields=['bin', 'staging_bin', 'packed_at'])

    # Assign an online rider at the store immediately: no accept handshake,
    # no jobs sitting unclaimed. Nobody online → the task waits and the
    # set_online sweep picks it up then.
    from bounded.delivery.dispatch import auto_assign_task
    auto_assign_task(task)

    previous_status = order.status
    order.status = 'PACKED'
    order.save(update_fields=['status'])

    OrderStatusHistory.objects.create(
        order=order, from_status=previous_status, to_status='PACKED',
        actor_type=actor.role, actor_id=str(actor.user_id),
    )

    correlation_id = getattr(order, 'order_id', None)
    enqueue_event(
        aggregate_type='CustomerOrder', aggregate_id=order.order_id,
        event_type='order.packed',
        correlation_id=correlation_id,
        payload_json={
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'site_code': order.site.code,
            'lpn_id': lpn.lpn_id,
            'lpn_barcode': lpn.barcode,
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
            'lpn_barcode': lpn.barcode,
            'staging_bin': staging_bin,
            'status': task.status,
        },
    )

    tote_qty = StockBalance.objects.filter(
        site=order.site, container='LPN', container_ref=lpn.lpn_id
    ).aggregate(total=Sum('qty'))['total'] or 0

    return {
        'order_id': str(order.order_id),
        'order_no': order.order_no,
        'status': order.status,
        'previous_status': previous_status,
        'lpn': {'lpn_id': lpn.lpn_id, 'barcode': lpn.barcode, 'status': lpn.status},
        'staging_bin': staging_bin,
        'lines': packed,
        'skipped': skipped,
        'delivery_task': {
            'task_id': str(task.task_id),
            'status': task.status,
            'bin': task.bin,
            'staging_bin': task.staging_bin,
        },
        'tote_qty': tote_qty,
    }


def _order_weight_kg(order, lines):
    """Best-effort tote weight, for rider acceptance decisions.

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
