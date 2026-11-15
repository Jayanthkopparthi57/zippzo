"""
Scan-first picking for the dark store.

Three pieces, all server-authoritative:

  DSPickLinesView  GET  /ds-ops/pick-lines?order_id=
      For every order line: which bin each unit is allocated to, how many are
      actually in that bin, and how many the line still needs. This is what lets
      a picker walk straight to the shelf instead of hunting.

  DSPickLineView   POST /ds-ops/pick-line
      One scanned unit-batch against one line. Verifies the operator scanned the
      bin the allocation says the lot is in, then moves stock through
      apply_stock and writes picked_qty + the allocation + the PickTask tally in
      the same transaction.

  DSPickAbandonView POST /ds-ops/pick-abandon
      "Drop out". Reverses every pick made against the order back into the bin
      it came from. An abort means nothing physically left the store, so leaving
      the units out of stock would report phantom shrinkage on the shelf view.
      The reversal is written as its own movement, not a silent rollback, so the
      ledger stays auditable.

WHY THE IDEMPOTENCY KEY CARRIES A SCAN TOKEN
--------------------------------------------
apply_stock() derives its replay guard from
(movement_type, ref_type, ref_id, sku, lot, site, direction, container,
container_ref). Note that `qty` is NOT part of that key. Keying a pick on the
order line alone therefore means the ledger can hold exactly one PICK per line
per bin: a picker scanning 1, then 1 again would have the second scan treated
as a replay and silently keep picked_qty at 1. Scanning one unit at a time is
the normal thing a hand scanner does, so this is not a corner case.

The fix rides on `ref_type`, which apply_stock() consumes for the key but does
not persist as a column. Carrying a per-scan token there makes every physical
scan distinct while `ref_id` stays the order line, so the ledger still answers
"which line did this come out of?".

  * DSPickLineView takes a client-supplied `scan_id` (a UUID the device mints
    once per scan event). Retrying the same scan with the same scan_id is a
    no-op, so a flaky network cannot double-pick.
  * DSPickAbandonView uses a token derived from the newest ledger row it is
    reversing, which makes a retried drop-out idempotent while still allowing a
    later, genuinely new round of picks to be abandoned.
"""
import uuid
from collections import defaultdict

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bounded.iam.permissions import IsFieldSurface
from .access import (
    require_department, require_order_access, require_site_access,
    require_session_facility,
)

# An order may only have stock lifted off the shelf while it is still being
# picked. Once it is PACKED the units are in a tote, and after REFUNDED or
# DELIVERED they are long gone - scanning then would move stock that belongs to
# somebody else's order.
PICKABLE_STATUSES = {'CONFIRMED', 'PICKING', 'INTERRUPTED', 'PARTIALLY_FULFILLED'}

OPEN_TASK_STATUSES = ['NOT_STARTED', 'IN_PROGRESS']


def _bin_label(loc):
    """Human bin label: coordinates when present, else barcode, else the id."""
    bits = [loc.aisle, loc.rack, loc.level, loc.position]
    bits = [b for b in bits if b]
    if len(bits) == 4:
        return '-'.join(bits)
    return loc.barcode or loc.location_id


def _resolve_line_bin(site, sku_id, lot_id):
    """Fallback pick face for an order that has never been allocated.

    Ordered by `container_ref`, NOT by quantity. Ordering by quantity looked
    tidier but made the answer move under the picker's feet: the expected bin
    flips to whichever bin happens to hold more, so draining the current bin half
    way through a line would silently re-target the remaining units at a
    different shelf.

    This is a compatibility path only. Orders go through
    `allocation.allocate_order()` and are picked from OrderLineAllocation rows;
    reaching this function means the order was never allocated, and the pick
    screen says so.
    """
    from bounded.inventory.models import StockBalance
    from bounded.network.models import Location

    bal = (
        StockBalance.objects
        .filter(site=site, container='BIN', sku_id=sku_id,
                lot_id=lot_id, qty__gt=0)
        .order_by('container_ref')
        .first()
    )
    if bal is None:
        return None
    loc = (
        Location.objects.filter(location_id=bal.container_ref)
        .select_related('site').first()
    )
    return {
        'location_id': bal.container_ref,
        'label': _bin_label(loc) if loc else bal.container_ref,
        'available_qty': bal.qty,
        'lot_id': str(bal.lot_id),
    }


def _units_out_by_bin(site, line):
    """Net units of this line that are still out of the store, keyed by bin.

    Read from the ledger, never from StockBalance. This is the fix for the
    worst bug a drop-out can have: once the last unit of a lot leaves a bin the
    balance row reads 0, so asking the balance "which bin did line 7 come
    from?" answers "nowhere" precisely when the answer matters most, and the
    units stay out of stock forever. PICK rows record from_ref_id and
    PICK_ABANDON rows record to_ref_id, so netting the two gives the true
    source bin per bin even at zero balance.

    Returns (net_by_bin, newest_reverted_seq).
    """
    from bounded.inventory.models import StockMovement

    net = defaultdict(int)
    newest = 0
    rows = (
        StockMovement.objects
        .filter(site=site, sku_id=line.sku_id, lot_id=line.lot_id,
                ref_id=str(line.line_id),
                movement_ref__in=['PICK', 'PICK_ABANDON'])
        .order_by('site_seq')
    )
    for m in rows:
        newest = max(newest, m.site_seq)
        if m.movement_ref == 'PICK':
            net[m.from_ref_id] += m.qty
        else:
            net[m.to_ref_id] -= m.qty
    return {k: v for k, v in net.items() if v > 0}, newest


def _order_pick_gate(order):
    """None when the order may be picked, else the reason it may not."""
    if order.status in PICKABLE_STATUSES:
        return None
    if order.status in {'PACKED', 'STAGED', 'RIDER_ASSIGNED', 'OUT_FOR_DELIVERY',
                        'PICKED_UP', 'ARRIVED', 'DELIVERED'}:
        return (f'{order.order_no} is already {order.status}; its units are in a '
                f'tote, not on a shelf. Nothing left to scan.')
    return (f'{order.order_no} is {order.status}; it can only be picked in one '
            f'of {", ".join(sorted(PICKABLE_STATUSES))}.')


def _line_bins(line, site):
    """Every shelf holding this line's lot, with live quantities.

    Allocations first (that is the decision the picker is meant to follow), then
    any other bin with sellable stock so the screen can say "2 more over there"
    rather than pretending the units do not exist.
    """
    from bounded.inventory.models import StockBalance
    from bounded.network.models import Location
    from .models import OrderLineAllocation

    balances = {
        b.container_ref: b.qty
        for b in StockBalance.objects.filter(
            site=site, container='BIN', sku_id=line.sku_id,
            lot_id=line.lot_id, qty__gt=0)
    }
    locations = {
        loc.location_id: loc
        for loc in Location.objects.filter(location_id__in=balances)
    }

    rows, allocated_locations = [], set()
    for a in (OrderLineAllocation.objects
              .filter(line=line)
              .exclude(status='RELEASED')
              .order_by('seq')):
        allocated_locations.add(a.location_id)
        loc = locations.get(a.location_id)
        rows.append({
            'allocation_id': str(a.allocation_id),
            'location_id': a.location_id,
            'label': a.bin_label or (_bin_label(loc) if loc else a.location_id),
            'seq': a.seq,
            'qty': a.qty,
            'picked_qty': a.picked_qty,
            'outstanding': a.outstanding,
            'available_qty': balances.get(a.location_id, 0),
            'status': a.status,
            'allocated': True,
        })

    for location_id in sorted(set(balances) - allocated_locations):
        loc = locations.get(location_id)
        rows.append({
            'allocation_id': None,
            'location_id': location_id,
            'label': _bin_label(loc) if loc else location_id,
            'seq': len(rows) + 1,
            'qty': balances[location_id],
            'picked_qty': 0,
            'outstanding': balances[location_id],
            'available_qty': balances[location_id],
            'status': 'UNALLOCATED',
            'allocated': False,
        })
    return rows


def _next_bin(bin_rows):
    """The shelf the picker should be standing at: first with units owing."""
    for row in bin_rows:
        if row['outstanding'] > 0 and row['available_qty'] > 0:
            return row
    return next((r for r in bin_rows if r['outstanding'] > 0), None)


class DSResolveBinView(APIView):
    """Resolve a scanned bin label to a Location.location_id, for one store.

    Nearly every stock endpoint keys stock by `container_ref`, which stores the
    bin's Location.location_id â€” not the barcode or the "A-01-02-03" printed on
    the shelf â€” so a physical scan has to be translated before it means anything.

    The generic /network/locations search cannot be used for this: that viewset
    is admin-only, and loosening it would publish the whole network's shelf
    layout to any logged-in operator. This endpoint is fenced to one store the
    caller is assigned to, and returns only the id and a label.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.network.models import Location, Site

        store_code = str(request.query_params.get('store_code') or '').strip()
        raw = str(request.query_params.get('q') or '').strip()
        if not store_code:
            return Response({'error': 'store_code is required'}, status=400)
        if not raw:
            return Response({'error': 'q is required'}, status=400)
        require_site_access(request.user, store_code)
        require_session_facility(request.user, store_code)

        site = Site.objects.filter(code=store_code).first()
        if site is None:
            return Response({'error': f'Store {store_code} not found'}, status=404)

        value = raw.upper()

        def coords_of(loc):
            bits = [loc.aisle, loc.rack, loc.level, loc.position]
            bits = [b for b in bits if b]
            return '-'.join(bits).upper() if len(bits) == 4 else ''

        matches = [
            loc for loc in Location.objects.filter(site=site, is_active=True)
            if (str(loc.barcode or '').upper() == value
                or str(loc.location_id or '').upper() == value
                or str(loc.qr_payload or '').upper() == value
                or coords_of(loc) == value)
        ]

        if not matches:
            return Response(
                {'error': f'"{raw}" is not a bin at {store_code}.',
                 'scanned': raw, 'matches': []},
                status=404,
            )

        return Response({
            'store_code': store_code,
            'scanned': raw,
            'matches': [
                {
                    'location_id': m.location_id,
                    'label': _bin_label(m),
                    # The pack station must put a sealed tote on a STAGING slot,
                    # not back onto a pick face. The client cannot tell those
                    # apart from a label alone, so the kind travels with the
                    # match and the scan endpoint validates it server-side too.
                    'location_type': m.location_type,
                    'container': m.container,
                }
                for m in matches
            ],
        })


class DSAllocateOrderView(APIView):
    """Allocate an order to bins and create its PickTasks.

    Separate from the scan endpoints on purpose: allocation is a planning step
    that reserves nothing (this build has no reservation ledger), it only fixes
    the route and the shelves. It is idempotent, so a retry after a dropped
    response is safe.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        from bounded.orders.models import CustomerOrder
        from .allocation import AllocationError, allocate_order

        order_id = request.data.get('order_id')
        if not order_id:
            return Response({'error': 'order_id is required'}, status=400)
        try:
            order = CustomerOrder.objects.select_related('site').get(order_id=order_id)
        except (CustomerOrder.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Order not found'}, status=404)

        require_order_access(request.user, order)
        require_session_facility(request.user, order.site.code)

        blocked = _order_pick_gate(order)
        if blocked:
            return Response({'error': blocked, 'status': order.status}, status=409)

        try:
            result = allocate_order(order, actor=request.user)
        except AllocationError as e:
            return Response({
                'error': 'This order cannot be fully allocated at this store.',
                'short_lines': e.args[0],
            }, status=409)
        return Response({'success': True, **result})


class DSPickLinesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.orders.models import CustomerOrder, CustomerOrderLine
        from .allocation import allocations_for_order

        order_id = request.query_params.get('order_id', '')
        if not order_id:
            return Response({'error': 'order_id is required'}, status=400)
        try:
            order = CustomerOrder.objects.select_related('site').get(order_id=order_id)
        except (CustomerOrder.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Order not found'}, status=404)

        require_order_access(request.user, order)
        require_session_facility(request.user, order.site.code)

        by_line = allocations_for_order(order)
        blocked = _order_pick_gate(order)
        # The picking screen shows the picker everything they need to identify
        # the unit in their hand without walking back to a terminal: barcode,
        # weight, MRP, the price the customer paid and the lot expiry. Fetch the
        # lots in one query rather than one per line.
        from bounded.catalog.models import InventoryLot
        line_rows = list(
            CustomerOrderLine.objects.filter(order=order).select_related('sku')
        )
        lot_ids = [row.lot_id for row in line_rows if row.lot_id]
        lots = {
            lot.lot_id: lot
            for lot in InventoryLot.objects.filter(lot_id__in=lot_ids)
        }
        lines = []
        for line in line_rows:
            outstanding = max(0, line.qty - line.picked_qty)
            bins = _line_bins(line, order.site)
            target = _next_bin(bins) if outstanding else None
            allocated = any(b['allocated'] for b in bins)
            if outstanding and not bins:
                located = None
            else:
                located = target or _resolve_line_bin(order.site, line.sku_id, line.lot_id)
            lot = lots.get(line.lot_id) if line.lot_id else None
            # MRP belongs to the physical lot when there is one (the shelf price
            # can differ from the master), otherwise to the SKU master.
            mrp = lot.mrp if lot is not None and lot.mrp is not None else line.sku.mrp
            lines.append({
                'line_id': str(line.line_id),
                'line_no': line.line_no,
                'sku': str(line.sku_id),
                'sku_code': line.sku.sku_code,
                'product_name': line.sku.name,
                'image_url': line.sku.image_url or '',
                'brand': line.sku.brand,
                'pack_size': line.sku.pack_size,
                'base_uom': line.sku.base_uom,
                'weight_g': line.sku.weight_g,
                'mrp': str(mrp) if mrp is not None else None,
                'barcode': line.sku.ean or line.sku.sku_code,
                'expiry_date': (lot.expiry_date.isoformat()
                                if lot is not None and lot.expiry_date else None),
                'batch_number': lot.batch_number if lot is not None else None,
                'lot': str(line.lot_id) if line.lot_id else None,
                'qty': line.qty,
                'picked_qty': line.picked_qty,
                'packed_qty': line.packed_qty,
                'shipped_qty': line.shipped_qty,
                'unit_price': str(line.unit_price),
                'line_total': str(line.line_total),
                'outstanding': outstanding,
                'status': line.status,
                # The bin the picker should walk to next, or None when the lot
                # is not on any shelf. The UI says so instead of sending the
                # picker to a bin that does not exist.
                'bin': located['label'] if located else None,
                'bin_location_id': located['location_id'] if located else None,
                'available_qty': located['available_qty'] if located else 0,
                'allocated': allocated,
                # Every shelf holding this lot, in pick order. `allocated: false`
                # means the units exist but were never allocated to this order.
                'bins': bins,
            })

        # PickTask.sku / .lot are plain UUIDFields, not relations, so the column
        # names are `sku` and `lot` (no _id suffix).
        tasks = list(
            order.pick_tasks.values('sku', 'lot', 'bin', 'qty', 'picked_qty', 'status')
        )
        return Response({
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'status': order.status,
            'site': order.site.code,
            'pickable': blocked is None,
            'blocked_reason': blocked,
            'lines': lines,
            'pick_tasks': tasks,
            'outstanding_total': sum(l['outstanding'] for l in lines),
        })


class DSPickLineView(APIView):
    permission_classes = [IsAuthenticated, IsFieldSurface]

    @transaction.atomic
    def post(self, request):
        from bounded.inventory.stock import already_applied, apply_stock, InsufficientStock
        from bounded.orders.models import CustomerOrder, CustomerOrderLine
        from .models import OrderLineAllocation, PickTask

        data = request.data
        order_id = data.get('order_id')
        line_id = data.get('line_id')
        bin_location_id = str(data.get('bin_location_id') or '').strip()
        product_barcode = str(data.get('product_barcode') or '').strip()
        scan_id = str(data.get('scan_id') or '').strip() or str(uuid.uuid4())
        try:
            qty = int(data.get('qty', 1))
        except (TypeError, ValueError):
            return Response({'error': 'qty must be a whole number'}, status=400)
        # The actor is always the authenticated caller. It used to be accepted
        # from the request body, which let any client write someone else's name
        # into the audit chain.
        actor_id = str(request.user.user_id)

        if not order_id or not line_id:
            return Response({'error': 'order_id and line_id are required'}, status=400)
        if qty <= 0:
            return Response({'error': 'qty must be greater than zero'}, status=400)
        if not bin_location_id:
            return Response({'error': 'bin_location_id is required'}, status=400)

        try:
            order = CustomerOrder.objects.select_related('site').get(order_id=order_id)
        except (CustomerOrder.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Order not found'}, status=404)

        require_order_access(request.user, order)
        require_session_facility(request.user, order.site.code)
        require_department(request.user, order.site, 'PICK')

        blocked = _order_pick_gate(order)
        if blocked:
            return Response({'error': blocked, 'status': order.status}, status=409)

        # Lock the line for the duration: two scanners on the same order would
        # otherwise both read the same picked_qty and lose one scan.
        try:
            line = CustomerOrderLine.objects.select_for_update().select_related('sku').get(
                line_id=line_id, order=order
            )
        except (CustomerOrderLine.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Order line not found on this order'}, status=404)

        if product_barcode:
            matches_sku = (
                product_barcode == line.sku.sku_code
                or product_barcode == (line.sku.ean or '')
                or line.sku.barcodes.filter(
                    barcode=product_barcode, is_active=True,
                ).exists()
            )
            if not matches_sku:
                return Response({
                    'error': 'Scanned product does not match the order line.',
                    'expected_sku_code': line.sku.sku_code,
                }, status=409)

        if line.lot_id is None:
            return Response(
                {'error': f'{line.sku.sku_code} has no lot allocated, so it cannot '
                          f'be picked against a bin.'},
                status=409,
            )

        outstanding = line.qty - line.picked_qty

        # Replay has to be answered BEFORE the quantity and bin checks.
        #
        # A device retrying its last scan - which is exactly what happens when the
        # response is lost or times out - committed the ledger and incremented
        # picked_qty on the server. If outstanding <= 0 or the bin check ran first,
        # the replay would be refused with 409 "already fully picked" or "wrong bin",
        # instead of returning the successful already_applied response.
        if already_applied(
            site=order.site, sku=line.sku, lot=line.lot,
            movement_type='PICK', ref_type=f'ORDERLINE:{scan_id}',
            ref_id=line.line_id, direction='OUT', container='BIN',
            container_ref=bin_location_id,
        ):
            return Response({
                'success': True, 'already_applied': True, 'scan_id': scan_id,
                'line_id': str(line.line_id),
                'sku_code': line.sku.sku_code,
                # Committed numbers, not the in-memory copy: another scan may
                # have landed between the original response and this retry.
                'picked_qty': line.picked_qty,
                'outstanding': outstanding,
                'line_status': line.status,
            })

        if outstanding <= 0:
            return Response(
                {'error': f'{line.sku.sku_code} is already fully picked on this order.',
                 'picked_qty': line.picked_qty, 'qty': line.qty},
                status=409,
            )
        if qty > outstanding:
            return Response(
                {'error': f'Only {outstanding} more unit(s) of {line.sku.sku_code} are needed.',
                 'outstanding': outstanding, 'requested': qty},
                status=409,
            )

        # The operator must be standing at a bin that is allocated to this line
        # and still owes units. resolveBin() on the client turns a scanned
        # barcode into a location_id; this check is what makes that scan mean
        # something, and it is checked again inside the ledger's own row locks.
        bins = _line_bins(line, order.site)
        target = next(
            (b for b in bins
             if b['location_id'] == bin_location_id and b['allocated'] and b['outstanding'] > 0),
            None,
        )
        if target is None:
            expected = _next_bin(bins)
            known = next(
                (b for b in bins if b['location_id'] == bin_location_id), None)
            if known and not known['allocated']:
                return Response(
                    {'error': f'Bin {known["label"]} holds {line.sku.sku_code} but was '
                              f'never allocated to this order. Allocate the order first.',
                     'needs_allocation': True},
                    status=409,
                )
            return Response(
                {
                    'error': 'Wrong bin. Scan the bin the work list points at.',
                    'expected_bin': expected['label'] if expected else None,
                    'expected_bin_location_id': expected['location_id'] if expected else None,
                    'scanned_bin_location_id': bin_location_id,
                },
                status=409,
            )

        try:
            moved = apply_stock(
                site=order.site, sku=line.sku, lot=line.lot, qty=qty,
                direction='OUT', movement_type='PICK',
                ref_type=f'ORDERLINE:{scan_id}', ref_id=line.line_id,
                actor_id=actor_id, actor_type=request.user.role,
                container='BIN', container_ref=bin_location_id,
                enforce_available=True,
            )
        except InsufficientStock as e:
            return Response({'error': str(e)}, status=409)

        if not moved:
            # Replay: this scan_id already moved stock. Report the real
            # committed numbers rather than the in-memory ones, because the
            # in-memory copy of `line` still shows the pre-scan quantity.
            line.refresh_from_db()
            return Response({
                'success': True, 'already_applied': True, 'scan_id': scan_id,
                'line_id': str(line.line_id), 'picked_qty': line.picked_qty,
                'outstanding': max(0, line.qty - line.picked_qty),
                'line_status': line.status,
            })

        line.picked_qty += qty
        line.status = 'PICKED' if line.picked_qty >= line.qty else 'PENDING'
        line.save(update_fields=['picked_qty', 'status'])

        allocation = OrderLineAllocation.objects.select_for_update().filter(
            line=line, location_id=bin_location_id,
        ).exclude(status='RELEASED').first()
        if allocation is not None:
            allocation.picked_qty += qty
            allocation.status = ('COMPLETED' if allocation.outstanding == 0
                                 else 'IN_PROGRESS')
            allocation.save(update_fields=['picked_qty', 'status'])

        # Keep the PickTask tally in step when the task row exists.
        #
        # Only open tasks are touched. Without `status__in` a scan against a
        # CANCELLED or COMPLETED task would silently drag it back into
        # IN_PROGRESS and re-add the units to its tally.
        task_filter = {
            'order': order, 'sku': line.sku_id, 'lot': line.lot_id,
            'bin': bin_location_id, 'status__in': OPEN_TASK_STATUSES,
        }
        if line.status == 'PICKED':
            PickTask.objects.filter(**task_filter).update(
                picked_qty=F('picked_qty') + qty,
                status='COMPLETED',
                completed_at=timezone.now(),
            )
        else:
            PickTask.objects.filter(**task_filter).update(
                picked_qty=F('picked_qty') + qty,
                status='IN_PROGRESS',
            )

        remaining = max(0, line.qty - line.picked_qty)
        after = _line_bins(line, order.site)
        return Response({
            'success': True, 'scan_id': scan_id,
            'line_id': str(line.line_id),
            'sku_code': line.sku.sku_code,
            'picked_qty': line.picked_qty,
            'qty': line.qty,
            'outstanding': remaining,
            'line_status': line.status,
            'available_in_bin': next(
                (b['available_qty'] for b in after
                 if b['location_id'] == bin_location_id), 0),
            'next_bin': (_next_bin(after) or {}).get('label'),
        })


class DSPickAbandonView(APIView):
    permission_classes = [IsAuthenticated, IsFieldSurface]

    @transaction.atomic
    def post(self, request):
        """Drop out of a pick: put every unit already taken back on its shelf."""
        from bounded.inventory.stock import apply_stock
        from bounded.orders.models import CustomerOrder, CustomerOrderLine
        from .models import OrderLineAllocation, PickTask

        data = request.data
        order_id = data.get('order_id')
        reason = str(data.get('reason') or '').strip()
        actor_id = str(request.user.user_id)
        if not order_id:
            return Response({'error': 'order_id is required'}, status=400)

        try:
            order = CustomerOrder.objects.select_for_update().select_related('site').get(order_id=order_id)
        except (CustomerOrder.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Order not found'}, status=404)

        require_order_access(request.user, order)
        require_session_facility(request.user, order.site.code)
        require_department(request.user, order.site, 'PICK')

        blocked = _order_pick_gate(order)
        if blocked:
            return Response({'error': blocked, 'status': order.status}, status=409)

        reverted, skipped = [], []
        returned_total = 0
        for line in CustomerOrderLine.objects.select_for_update().select_related('sku').filter(order=order):
            if line.lot_id is None:
                if line.picked_qty > 0:
                    skipped.append({
                        'line_id': str(line.line_id),
                        'sku_code': line.sku.sku_code,
                        'reason': 'line has no lot allocated, so no bin can be credited',
                    })
                continue

            # Where the units actually came from, per the ledger. The ledger is
            # consulted even when picked_qty is already 0, because that is the
            # state left behind when a previous drop-out could not finish: the
            # column was reset but the stock never came back.
            net_by_bin, newest_seq = _units_out_by_bin(order.site, line)
            if not net_by_bin:
                if line.picked_qty > 0:
                    skipped.append({
                        'line_id': str(line.line_id),
                        'sku_code': line.sku.sku_code,
                        'reason': 'picked_qty is set but the ledger holds no unreverted pick for this line',
                    })
                continue

            returned = 0
            for bin_id, bin_qty in sorted(net_by_bin.items()):
                # The token is the newest ledger row being reversed. A retried
                # drop-out computes the same token and is swallowed by
                # apply_stock, while a fresh round of picks moves the head and
                # gets its own movement.
                if not apply_stock(
                    site=order.site, sku=line.sku, lot=line.lot, qty=bin_qty,
                    direction='IN', movement_type='PICK_ABANDON',
                    ref_type=f'ORDERLINE:ABANDON-{newest_seq}', ref_id=line.line_id,
                    actor_id=actor_id, actor_type=request.user.role,
                    container='BIN', container_ref=bin_id,
                    enforce_available=False,
                ):
                    # A previous drop-out already wrote this exact reversal. The
                    # units are back on the shelf; do not report them twice.
                    continue
                returned += bin_qty
                reverted.append({
                    'line_id': str(line.line_id),
                    'sku_code': line.sku.sku_code,
                    'qty_returned': bin_qty,
                    'bin_location_id': bin_id,
                })

            # picked_qty is re-derived from the ledger rather than decremented.
            # The ledger is the record of what physically left the shelf, so
            # recomputing from it means the column can never end up disagreeing
            # with the movements - including on the legacy orders where seed
            # data set picked_qty without writing any matching movement.
            still_out, _ = _units_out_by_bin(order.site, line)
            returned_total += returned
            line.picked_qty = min(line.qty, sum(still_out.values()))
            line.status = 'PICKED' if line.picked_qty >= line.qty else 'PENDING'
            line.save(update_fields=['picked_qty', 'status'])

            OrderLineAllocation.objects.select_for_update().filter(
                line=line,
                # Only allocations for bins that actually gave units up.
                location_id__in=list(net_by_bin),
            ).update(picked_qty=0, status='ALLOCATED')

        # Only open tasks are reset, and only after the movements are written:
        # a CANCELLED or COMPLETED task keeps the tally it was closed with.
        if returned_total:
            PickTask.objects.filter(order=order, status__in=OPEN_TASK_STATUSES).update(
                picked_qty=0, status='NOT_STARTED',
            )
            OrderLineAllocation.objects.filter(
                order=order, status='IN_PROGRESS',
            ).update(status='ALLOCATED')

        if not reverted and not skipped:
            return Response({
                'success': True, 'nothing_to_revert': True,
                'order_id': str(order.order_id),
                'order_no': order.order_no,
                'units_returned': 0,
                'reverted': [],
                'skipped': [],
                'message': f'No units had been picked on {order.order_no}.',
            })

        return Response({
            'success': True,
            'order_id': str(order.order_id),
            'order_no': order.order_no,
            'reason': reason or None,
            'units_returned': returned_total,
            'reverted': reverted,
            'skipped': skipped,
            'message': (
                f'Returned {len(reverted)} bin(s) of stock on {order.order_no}.'
                + (f' {len(skipped)} line(s) could not be located and need a recount.'
                   if skipped else '')
            ),
        })
