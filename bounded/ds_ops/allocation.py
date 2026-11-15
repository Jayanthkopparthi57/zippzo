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


HOLD_BLOCKING_STATUSES = ('OPEN', 'UNDER_REVIEW', 'ESCALATED')


def held_qty_by_bin(site, sku_id, lot_id):
    """Units an open stock hold has taken out of circulation.

    A hold is a quality/investigation stop: the stock is physically on the
    shelf but must not be promised to a customer. Ignoring it here is what let
    `allocate_order` route an order to a shelf whose units were quarantined.

    Returns ``(per_bin, unassigned)``. Holds that name a container are pinned
    to that bin; holds without one are a site-level reserve and are subtracted
    from the line's total capacity once, not from every bin.
    """
    from bounded.holds.models import Hold

    rows = Hold.objects.filter(
        site__in=(site.code, str(site.site_id)),
        sku=sku_id, lot=lot_id,
        status__in=HOLD_BLOCKING_STATUSES,
    )
    per_bin = {}
    unassigned = 0
    for hold in rows:
        if hold.container_ref:
            per_bin[hold.container_ref] = (
                per_bin.get(hold.container_ref, 0) + hold.qty)
        else:
            unassigned += hold.qty
    return per_bin, unassigned


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
        # somebody else is holding and less anything under an open stock hold.
        # Our own allocations are excluded because the reuse loop below re-uses
        # them rather than opening them twice.
        held, hold_pool = held_qty_by_bin(
            order.site, line.sku_id, line.lot_id)
        free = {
            b.container_ref: max(
                0, b.qty - reserved_qty(
                    order.site, b.container_ref, line.sku_id, line.lot_id,
                    exclude_order=order) - held.get(b.container_ref, 0))
            for b in balances
        }
        # A hold with no container is a site-level reserve. Deduct it from the
        # bins in a stable order so the same inputs always produce the same
        # route.
        pool = hold_pool
        for bin_ref in sorted(free):
            if pool <= 0:
                break
            take = min(free[bin_ref], pool)
            free[bin_ref] -= take
            pool -= take
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
        kept_here = []
        claimed = 0
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
            kept_here.append(alloc)
            claimed += still_needed

        # Only look for more if the surviving promises do not already cover the
        # line. The old loop topped up every claim by its own size whenever its
        # bin had spare units, so re-running allocation — which the endpoint is
        # documented to allow — doubled the quantity on a fully allocated order.
        remaining = max(0, needed - claimed)
        for alloc in kept_here:
            if remaining <= 0:
                break
            still_needed = max(0, alloc.qty - alloc.picked_qty)
            capacity = max(0, free.get(alloc.location_id, 0) - still_needed)
            extra = min(remaining, capacity)
            if extra:
                alloc.qty += extra
                alloc.save(update_fields=['qty'])
                remaining -= extra

        for alloc in kept_here:
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