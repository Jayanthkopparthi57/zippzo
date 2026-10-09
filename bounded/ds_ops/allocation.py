"""
Allocate an order to bins, and keep the pick flow honest about what is shelved.

An allocation decides, once, which bin each order line is drawn from. Doing it
here rather than at scan time is what stops three classes of wrong behaviour:

  * the pick screen guessing the pick face by "whichever bin holds the most",
    so the answer shifts under the picker as stock drains;
  * a drop-out unable to say which bin to credit, because the first bin now
    reads zero;
  * a lot split across bins being unpickable, because one scan resolves to one
    bin and the rest of the units are stranded.

Everything runs in one transaction with SELECT ... FOR UPDATE on the balances
being allocated, so two operators allocating the same order cannot both believe
they own the same units.
"""
from django.db import transaction
from django.db.models import F

from bounded.ds_ops.models import OrderLineAllocation, PickTask


class AllocationError(Exception):
    """Raised when an order cannot be fully allocated. Carries detail rows."""


class _ShortLine:
    def __init__(self, line, needed, available, bins):
        self.line = line
        self.needed = needed
        self.available = available
        self.bins = bins

    def as_dict(self):
        return {
            'line_id': str(self.line.line_id),
            'line_no': self.line.line_no,
            'sku_code': self.line.sku.sku_code,
            'needed': self.needed,
            'available': self.available,
            'shelves': self.bins,
            'reason': 'not enough shelved stock at this store to cover the line',
        }


def _bin_label(loc):
    bits = [b for b in (loc.aisle, loc.rack, loc.level, loc.position) if b]
    return '-'.join(bits) if len(bits) == 4 else (loc.barcode or loc.location_id)


def reserved_qty(site, location_id, sku_id, lot_id, exclude_order=None):
    """Units on a shelf that other orders have already been promised.

    `StockBalance.qty` is what is physically present, so it still counts units
    that a confirmed order is holding. Only a pick takes a unit off the shelf;
    until then the promise exists as nothing but a row in this table, and a
    check that reads only the balance will sell the same unit twice.

    Sums the unpicked remainder, because a pick has already decremented the
    balance it drew from - counting the whole `qty` would charge for units that
    have physically moved.
    """
    rows = OrderLineAllocation.objects.filter(
        site=site, location_id=location_id,
        line__sku_id=sku_id, line__lot_id=lot_id,
    ).exclude(status='RELEASED')
    if exclude_order is not None:
        rows = rows.exclude(order=exclude_order)
    return sum(max(0, a.qty - a.picked_qty) for a in rows)


@transaction.atomic
def allocate_order(order, actor=None):
    """Allocate every outstanding unit of `order` to a bin at its own store.

    Idempotent: existing allocations for a line are kept when they can still be
    honoured and only topped up otherwise. Re-running allocation on an order
    that is already allocated changes nothing, which matters because the
    allocation endpoint may be retried.

    Raises AllocationError with per-line detail when stock cannot cover the
    order. Partial allocation is never committed: a half-allocated order would
    send a picker to a shelf for some lines and strand them on the others.
    """
    from bounded.inventory.models import StockBalance
    from bounded.network.models import Location
    from bounded.orders.models import CustomerOrderLine

    lines = list(
        CustomerOrderLine.objects
        .filter(order=order)
        .select_related('sku', 'lot')
        .order_by('line_no')
    )

    short = []
    # Lock the balances this order will draw from, in a deterministic order so
    # two concurrent allocations of overlapping orders cannot deadlock.
    locked = {}
    free_by_line = {}
    for line in lines:
        needed = max(0, line.qty - line.picked_qty)
        if needed == 0:
            continue
        balances = list(
            StockBalance.objects
            .select_for_update()
            .filter(site=order.site, container='BIN', sku_id=line.sku_id,
                    lot_id=line.lot_id, qty__gt=0)
            .order_by('container_ref')
        )
        locked[line.line_id] = balances
        # What this order can still be given: what is on the shelf less what
        # somebody else is holding. Our own allocations are excluded because the
        # reuse loop below re-uses them rather than opening them twice.
        free = {
            b.container_ref: max(
                0, b.qty - reserved_qty(
                    order.site, b.container_ref, line.sku_id, line.lot_id,
                    exclude_order=order))
            for b in balances
        }
        free_by_line[line.line_id] = free
        available = sum(free.values())
        if available < needed:
            short.append(_ShortLine(
                line, needed, available,
                [{'location_id': b.container_ref, 'available': free[b.container_ref]}
                 for b in balances],
            ))

    if short:
        raise AllocationError([s.as_dict() for s in short])

    labels = {
        loc.location_id: _bin_label(loc)
        for loc in Location.objects.filter(
            location_id__in={
                b.container_ref for balances in locked.values() for b in balances
            }
        )
    }

    created, kept = [], []
    for line in lines:
        needed = max(0, line.qty - line.picked_qty)
        if needed == 0:
            continue

        existing = {
            a.location_id: a
            for a in OrderLineAllocation.objects.select_for_update()
            .filter(line=line).exclude(status='RELEASED')
        }

        # Re-use whatever is still allocated and usable before opening new bins,
        # so a re-allocation does not move a picker who has already started.
        free = free_by_line.get(line.line_id, {})
        remaining = needed
        for location_id in sorted(existing):
            alloc = existing[location_id]
            still_needed = max(0, alloc.qty - alloc.picked_qty)
            if still_needed == 0:
                continue
            bal = next((b for b in locked[line.line_id]
                        if b.container_ref == location_id), None)
            if bal is None:
                alloc.status = 'RELEASED'
                alloc.save(update_fields=['status'])
                continue
            # What this bin can still hold for us is what nobody else has been
            # promised, less what we already claim on it and have not picked.
            headroom = max(0, free.get(location_id, 0) - still_needed)
            top_up = min(still_needed, headroom)
            if top_up:
                alloc.qty += top_up
                alloc.save(update_fields=['qty'])
            remaining -= max(0, alloc.qty - alloc.picked_qty)
            kept.append(alloc)

        # Top up from the best remaining bin, largest first, so a line is spread
        # over as few shelves as possible.
        spare = sorted(
            (b for b in locked[line.line_id]
             if b.container_ref not in existing or
                existing[b.container_ref].status == 'RELEASED'),
            key=lambda b: (-b.qty, b.container_ref),
        )
        seq = len(kept) + 1
        for bal in spare:
            if remaining <= 0:
                break
            take = min(remaining, free.get(bal.container_ref, 0))
            if take <= 0:
                continue
            alloc, _ = OrderLineAllocation.objects.get_or_create(
                line=line, location_id=bal.container_ref,
                defaults={
                    'order': order, 'site': order.site, 'seq': seq,
                    'qty': take, 'status': 'ALLOCATED',
                    'bin_label': labels.get(bal.container_ref),
                },
            )
            if alloc.status == 'RELEASED':
                alloc.status = 'ALLOCATED'
                alloc.qty = take
                alloc.save(update_fields=['status', 'qty'])
            created.append(alloc)
            remaining -= take
            seq += 1

        if remaining > 0:  # pragma: no cover - guarded by the check above
            raise AllocationError([_ShortLine(
                line, remaining, 0, []).as_dict()])

    # A PickTask per bin the picker has to visit, so the work list matches the
    # physical route and a completion can close exactly what was picked.
    OrderLineAllocation.objects.filter(order=order).select_for_update().iterator()
    for line in lines:
        for alloc in OrderLineAllocation.objects.filter(line=line).order_by('seq'):
            PickTask.objects.filter(order=order, sku=line.sku_id,
                                     lot=line.lot_id, bin=alloc.location_id
                                     ).update(
                qty=alloc.qty,
                picked_qty=alloc.picked_qty,
                status=('COMPLETED' if alloc.outstanding == 0
                        else ('IN_PROGRESS' if alloc.picked_qty else 'NOT_STARTED')),
            )
            PickTask.objects.get_or_create(
                picklist_id=order.order_id,
                batch=order.order_id,
                order=order,
                sku=line.sku_id,
                lot=line.lot_id,
                bin=alloc.location_id,
                defaults={
                    'zone': None,
                    'qty': alloc.qty,
                    'picked_qty': alloc.picked_qty,
                    'pick_seq': alloc.seq,
                    'status': ('COMPLETED' if alloc.outstanding == 0
                               else ('IN_PROGRESS' if alloc.picked_qty
                                     else 'NOT_STARTED')),
                },
            )

    order.refresh_from_db()
    return {
        'order_id': str(order.order_id),
        'order_no': order.order_no,
        'site': order.site.code,
        'created': len(created),
        'kept': len(kept),
        'allocations': [
            {
                'allocation_id': str(a.allocation_id),
                'line_id': str(a.line_id),
                'location_id': a.location_id,
                'bin_label': a.bin_label,
                'seq': a.seq,
                'qty': a.qty,
                'picked_qty': a.picked_qty,
                'outstanding': a.outstanding,
                'status': a.status,
            }
            for a in OrderLineAllocation.objects.filter(order=order).order_by('line_id', 'seq')
        ],
    }


def release_order_allocations(order):
    """Drop an order's allocations. Used when the order is cancelled or refunded."""
    from django.utils import timezone

    OrderLineAllocation.objects.filter(order=order).exclude(
        status__in=['RELEASED', 'COMPLETED']
    ).update(status='RELEASED')
    PickTask.objects.filter(order=order).exclude(status='COMPLETED').update(
        status='CANCELLED', completed_at=timezone.now(),
    )


def allocations_for_order(order):
    """Allocations grouped by line, each in pick order."""
    from collections import OrderedDict

    out = OrderedDict()
    for a in (OrderLineAllocation.objects
              .filter(order=order)
              .select_related('line')
              .order_by('line__line_no', 'seq')):
        out.setdefault(str(a.line_id), []).append(a)
    return out