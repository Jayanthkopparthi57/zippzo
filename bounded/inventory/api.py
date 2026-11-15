"""Read models for the stock ledger and the bin-to-bin relocation action.

The raw StockMovement/StockBalance serializers expose bare UUIDs, which is
useless for a picking UI. These endpoints return joined, render-ready rows and
keep every quantity change inside bounded.inventory.stock.
"""
import json

from django.db import transaction
from django.db.models import Q, Sum
from rest_framework.decorators import api_view
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bounded.iam.permissions import IsFieldSurface

from .models import StockBalance, StockMovement, StockAdjustment
from .stock import apply_stock, InsufficientStock


def _location(loc):
    if loc is None:
        return None
    zone = getattr(loc, 'zone', None)
    return {
        'id': loc.location_id,
        'barcode': loc.barcode,
        'type': loc.location_type,
        'site': loc.site.code if loc.site_id else None,
        'zone': zone.code if zone else None,
        'zone_type': zone.zone_type if zone else None,
        'aisle': loc.aisle or None,
        'rack': loc.rack or None,
        'level': loc.level or None,
        'position': loc.position or None,
        'is_active': loc.is_active,
    }


def _row(b, loc):
    lot = b.lot
    return {
        'id': b.pk,
        'site': b.site.code,
        'container': b.container,
        'container_ref': b.container_ref,
        'location': _location(loc) if b.container == 'BIN' else None,
        'sku': str(b.sku_id),
        'sku_code': b.sku.sku_code,
        'sku_name': b.sku.name,
        'lot': str(b.lot_id),
        'batch_number': lot.batch_number,
        'expiry_date': str(lot.expiry_date) if lot.expiry_date else None,
        'mrp': float(lot.mrp) if lot.mrp else 0,
        'qty': b.qty,
        'sellable': b.sellable,
        'counts_toward_site_custody': b.counts_toward_site_custody,
        'owner_type': b.owner_type,
        'owner_id': b.owner_id or None,
        'updated_at': b.updated_at,
    }


@api_view(['GET'])
@transaction.atomic
def StockPositionsView(request):
    """Where the stock physically is, joined to SKU/lot/bin detail."""
    from bounded.network.models import Location, Site

    qs = StockBalance.objects.select_related('sku', 'lot', 'site').filter(qty__gt=0)
    from .views import _ledger_scope
    allowed_codes = _ledger_scope(request.user)
    if allowed_codes is not None:
        qs = qs.filter(site__code__in=allowed_codes)

    site_code = request.query_params.get('site_code')
    if site_code:
        qs = qs.filter(site__code=site_code)
    container = request.query_params.get('container')
    if container:
        qs = qs.filter(container=container)
    location_id = request.query_params.get('location_id')
    if location_id:
        qs = qs.filter(container='BIN', container_ref=location_id)

    # One query per balance row made this endpoint take ~64s against the remote
    # dev database (hundreds of round trips). Resolve every referenced bin in a
    # single query instead; Location has no FK from StockBalance to join on.
    balances = list(qs)
    refs = {b.container_ref for b in balances if b.container == 'BIN' and b.container_ref}
    locs = {
        l.location_id: l
        for l in Location.objects.filter(location_id__in=refs).select_related('site', 'zone')
    } if refs else {}

    rows = []
    for b in balances:
        loc = locs.get(b.container_ref) if b.container == 'BIN' and b.container_ref else None
        rows.append(_row(b, loc))

    sites = Site.objects.filter(locations__isnull=False)
    if allowed_codes is not None:
        sites = sites.filter(code__in=allowed_codes)
    sites = sites.values_list('code', flat=True).distinct()
    return Response({
        'count': len(rows),
        'results': rows,
        'site_codes': sorted(sites),
    })


@api_view(['GET'])
@transaction.atomic
def StockMovementFeedView(request):
    """Movement history, joined so the UI can label sku/batch/containers."""
    from bounded.network.models import Location, Site

    qs = StockMovement.objects.select_related('sku', 'lot', 'site').all()
    from .views import _ledger_scope
    allowed_codes = _ledger_scope(request.user)
    if allowed_codes is not None:
        qs = qs.filter(site__code__in=allowed_codes)

    site_code = request.query_params.get('site_code')
    if site_code:
        qs = qs.filter(site__code=site_code)
    sku = request.query_params.get('sku')
    if sku:
        qs = qs.filter(sku_id=sku)
    ref = request.query_params.get('ref_id')
    if ref:
        qs = qs.filter(ref_id=ref)
    try:
        limit = min(int(request.query_params.get('limit', 200)), 1000)
    except (TypeError, ValueError):
        limit = 200

    locs = {
        l.location_id: l
        for l in Location.objects.select_related('site', 'zone')
    }

    rows = []
    for m in qs[:limit]:
        src = locs.get(m.from_ref_id) if m.from_container == 'BIN' else None
        dst = locs.get(m.to_ref_id) if m.to_container == 'BIN' else None
        rows.append({
            'id': m.entry_id,
            'movement_ref': m.movement_ref,
            'movement_type': m.movement_type,
            'ref_id': m.ref_id,
            'site': m.site.code,
            'sku': str(m.sku_id),
            'sku_code': m.sku.sku_code,
            'sku_name': m.sku.name,
            'lot': str(m.lot_id),
            'batch_number': m.lot.batch_number,
            'qty': m.qty,
            'from_container': m.from_container,
            'from_ref_id': m.from_ref_id,
            'to_container': m.to_container,
            'to_ref_id': m.to_ref_id,
            'from_location': _location(src),
            'to_location': _location(dst),
            'actor_id': m.actor_id,
            'actor_type': m.actor_type,
            'sellable_delta': m.sellable_delta,
            'site_custody_delta': m.site_custody_delta,
            'idempotency_key': m.idempotency_key,
            'created_at': m.created_at,
        })

    return Response({'count': len(rows), 'results': rows})


class RelocateStockView(APIView):
    """Move stock between two bins of the same site.

    Both legs go through the shared ledger inside one transaction, so a failure
    on the second leg cannot leave the units lost.
    """

    permission_classes = [IsAuthenticated, IsFieldSurface]

    @transaction.atomic
    def post(self, request):
        from bounded.catalog.models import InventoryLot, Sku
        from bounded.network.models import Location

        d = request.data
        from_bin = d.get('from_location_id') or d.get('from_bin')
        to_bin = d.get('to_location_id') or d.get('to_bin')
        sku_id = d.get('sku')
        lot_id = d.get('lot')
        qty = int(d.get('qty') or 0)
        # The ledger's actor comes from the token. Clients also send actor_id
        # (they did, and still do), but a body value must never be able to
        # pin a move on somebody else — same rule as pick scan.
        from bounded.iam.names import acting_user_id
        actor_id = str(acting_user_id(request) or '') or (d.get('actor_id') or '')

        if not from_bin or not to_bin:
            return Response({'detail': 'from_location_id and to_location_id are required'},
                            status=400)
        if from_bin == to_bin:
            return Response({'detail': 'source and target bins must differ'}, status=400)
        if qty <= 0:
            return Response({'detail': 'qty must be greater than 0'}, status=400)

        src = Location.objects.filter(location_id=from_bin).select_related('site').first()
        dst = Location.objects.filter(location_id=to_bin).select_related('site').first()
        if src is None:
            return Response({'detail': f'Source bin {from_bin} not found'}, status=400)
        if dst is None:
            return Response({'detail': f'Target bin {to_bin} not found'}, status=400)
        if src.site_id != dst.site_id:
            return Response({'detail': 'bins belong to different sites; use a transfer order'},
                            status=400)
        from bounded.ds_ops.access import require_site_access, require_session_facility
        require_site_access(request.user, src.site.code)
        require_session_facility(request.user, src.site.code)

        sku = Sku.objects.filter(sku_id=sku_id).first()
        if sku is None:
            return Response({'detail': f'SKU {sku_id} not found'}, status=400)
        lot = InventoryLot.objects.filter(lot_id=lot_id).first() if lot_id else None
        if lot is None:
            return Response({'detail': f'Lot {lot_id} not found'}, status=400)

        ref = d.get('movement_ref') or 'RELOCATION'
        ref_id = d.get('ref_id') or f"RELOC:{from_bin}->{to_bin}:{lot.lot_id}"

        try:
            out = apply_stock(
                site=src.site, sku=sku, lot=lot, qty=qty, direction='OUT',
                movement_type=ref, ref_type='RELOCATION', ref_id=ref_id,
                actor_id=actor_id, actor_type='STAFF',
                container='BIN', container_ref=src.location_id,
                enforce_available=True,
            )
        except InsufficientStock as e:
            return Response({'detail': str(e)}, status=400)
        if not out:
            return Response({'detail': 'stock already relocated for this reference'},
                            status=200)

        apply_stock(
            site=dst.site, sku=sku, lot=lot, qty=qty, direction='IN',
            movement_type=ref, ref_type='RELOCATION', ref_id=ref_id,
            actor_id=actor_id, actor_type='STAFF',
            container='BIN', container_ref=dst.location_id,
        )
        return Response({
            'success': True,
            'sku': sku.sku_code,
            'lot': str(lot.lot_id),
            'qty': qty,
            'from_bin': src.location_id,
            'to_bin': dst.location_id,
        })


class BinSortView(APIView):
    """Commit a whole bin-to-bin sort in one transaction.

    The operator scans every unit out of the source bin and every unit into the
    target bin before pressing Sort. Nothing may move before that press, and a
    failure on the fourth line must not leave the first three already moved —
    which is exactly what the old per-line loop did. This endpoint validates
    every line first, then applies both legs of every line inside one atomic
    block, and marks the transaction for rollback if the ledger refuses any leg.
    """

    permission_classes = [IsAuthenticated, IsFieldSurface]

    @transaction.atomic
    def post(self, request):
        from bounded.catalog.models import InventoryLot, Sku
        from bounded.iam.names import acting_user_id
        from bounded.network.models import Location

        d = request.data
        from_bin = d.get('from_location_id') or d.get('from_bin')
        to_bin = d.get('to_location_id') or d.get('to_bin')
        raw_items = d.get('items') or []
        actor_id = str(acting_user_id(request) or '') or (d.get('actor_id') or '')

        if not from_bin or not to_bin:
            return Response({'detail': 'from_location_id and to_location_id are required'},
                            status=400)
        if from_bin == to_bin:
            return Response({'detail': 'source and target bins must differ'}, status=400)
        if not isinstance(raw_items, list) or not raw_items:
            return Response({'detail': 'items must be a non-empty list'}, status=400)

        src = Location.objects.filter(location_id=from_bin).select_related('site').first()
        dst = Location.objects.filter(location_id=to_bin).select_related('site').first()
        if src is None:
            return Response({'detail': f'Source bin {from_bin} not found'}, status=400)
        if dst is None:
            return Response({'detail': f'Target bin {to_bin} not found'}, status=400)
        if src.site_id != dst.site_id:
            return Response({'detail': 'bins belong to different sites; use a transfer order'},
                            status=400)
        from bounded.ds_ops.access import require_site_access, require_session_facility
        require_site_access(request.user, src.site.code)
        require_session_facility(request.user, src.site.code)

        # ---- validate every line before a single unit moves ----
        picked = []
        seen = set()
        total_qty = 0
        for idx, item in enumerate(raw_items):
            sku = Sku.objects.filter(sku_id=item.get('sku')).first()
            if sku is None:
                return Response({'detail': f'line {idx + 1}: SKU {item.get("sku")} not found'},
                                status=400)
            lot = InventoryLot.objects.filter(lot_id=item.get('lot')).first() if item.get('lot') else None
            if lot is None:
                return Response({'detail': f'line {idx + 1}: lot {item.get("lot")} not found'},
                                status=400)
            try:
                qty = int(item.get('qty') or 0)
            except (TypeError, ValueError):
                return Response({'detail': f'line {idx + 1}: qty must be an integer'}, status=400)
            if qty <= 0:
                return Response({'detail': f'line {idx + 1}: qty must be greater than 0'},
                                status=400)
            key = (str(sku.sku_id), str(lot.lot_id))
            if key in seen:
                return Response({'detail': f'line {idx + 1}: duplicate sku/lot pair'},
                                status=400)
            seen.add(key)

            balance = (StockBalance.objects
                       .filter(site=src.site, container='BIN', container_ref=src.location_id,
                               sku=sku, lot=lot)
                       .aggregate(t=Sum('qty'))['t'] or 0)
            if int(balance) < qty:
                return Response({
                    'detail': (f'line {idx + 1}: {sku.sku_code} has {balance} in '
                               f'{src.barcode}, cannot move {qty}'),
                    'line': idx + 1,
                }, status=400)
            picked.append((sku, lot, qty))
            total_qty += qty

        # Capacity of the target is checked as one batch, not per line, because
        # several lines can land in the same bin in the same sort.
        if dst.capacity_qty is not None:
            occupied = (StockBalance.objects
                        .filter(container='BIN', container_ref=dst.location_id)
                        .aggregate(t=Sum('qty'))['t'] or 0)
            if int(occupied) + total_qty > int(dst.capacity_qty):
                return Response({
                    'detail': (f'{dst.barcode} is full: capacity {dst.capacity_qty}, '
                               f'holding {occupied}, cannot take {total_qty}'),
                    'capacity_qty': int(dst.capacity_qty),
                    'occupied_qty': int(occupied),
                }, status=400)

        sort_ref = str(d.get('ref_id') or '')[:40]
        if not sort_ref:
            from uuid import uuid4
            sort_ref = f'SORT:{uuid4().hex[:12]}'
        ref = d.get('movement_ref') or 'RELOCATION'

        moved = []
        try:
            for sku, lot, qty in picked:
                line_ref = f'{sort_ref}:{str(sku.sku_id)[:8]}:{str(lot.lot_id)[:8]}'
                apply_stock(
                    site=src.site, sku=sku, lot=lot, qty=qty, direction='OUT',
                    movement_type=ref, ref_type='RELOCATION', ref_id=line_ref,
                    actor_id=actor_id, actor_type='STAFF',
                    container='BIN', container_ref=src.location_id,
                    enforce_available=True,
                )
                apply_stock(
                    site=dst.site, sku=sku, lot=lot, qty=qty, direction='IN',
                    movement_type=ref, ref_type='RELOCATION', ref_id=line_ref,
                    actor_id=actor_id, actor_type='STAFF',
                    container='BIN', container_ref=dst.location_id,
                )
                moved.append({'sku': sku.sku_code, 'lot': str(lot.lot_id), 'qty': qty})
        except InsufficientStock as e:
            # Undo every leg already written in this request.
            transaction.set_rollback(True)
            return Response({'detail': str(e)}, status=400)

        # One audit row for the committed sort.
        try:
            from bounded.ds_ops.models import BinTransfer
            BinTransfer.objects.create(
                source_bin=src.location_id,
                dest_bin=dst.location_id,
                status='COMPLETED',
                created_by=acting_user_id(request),
                completed_by=acting_user_id(request),
            )
        except Exception:  # pragma: no cover - audit must never break the move
            pass

        return Response({
            'success': True,
            'ref_id': sort_ref,
            'from_bin': src.location_id,
            'to_bin': dst.location_id,
            'lines': moved,
            'total_qty': total_qty,
        })


class PackLpnView(APIView):
    """Build a mother-hub LPN from scanned units, in one transaction.

    Packing is where a tote stops being "some stock in a bin" and becomes a
    labelled, movable unit. That means three things have to happen together:

      * the tote master exists with a frozen manifest (contents *and*
        destination) so a scan of its label answers both questions anywhere;
      * the LPN contents ledger matches that manifest;
      * the stock actually leaves the source bins and moves into the LPN
        container, so a bin never keeps showing units that are physically in
        the tote.

    Doing that as three client calls (create LPN, post contents, relocate) is
    how a half-built tote ends up in circulation when the third call fails.
    Here every line is validated first and then written under one
    `transaction.atomic`; any refusal rolls the whole pack back.
    """

    permission_classes = [IsAuthenticated, IsFieldSurface]

    @transaction.atomic
    def post(self, request):
        from bounded.catalog.models import InventoryLot, Sku
        from bounded.fulfilment.models import Batch
        from bounded.iam.names import acting_user_id
        from bounded.network.models import Location, Site

        from .models import LpnContent, LpnMaster

        d = request.data
        lpn_id = str(d.get('lpn_id') or '').strip()
        barcode = str(d.get('barcode') or '').strip()
        lpn_type = str(d.get('lpn_type') or 'TOTE').strip().upper()
        dest_id = str(d.get('dest_site') or '').strip()
        raw_items = d.get('items') or []
        batch_no = str(d.get('batch_no') or '').strip()
        actor_id = str(acting_user_id(request) or '') or str(d.get('actor_id') or '')
        transfer_id = str(d.get('transfer') or d.get('transfer_id') or '').strip()
        transfer = None
        if transfer_id:
            from bounded.ds_ops.models import TransferOrder
            transfer = TransferOrder.objects.filter(pk=transfer_id).first()
            if transfer is None:
                return Response({'detail': f'transfer {transfer_id} not found'}, status=404)

        if not lpn_id or not barcode:
            return Response({'detail': 'lpn_id and barcode are required'}, status=400)
        if lpn_type not in {choice[0] for choice in LpnMaster.TYPE_CHOICES}:
            return Response({'detail': f'unknown lpn_type "{lpn_type}"'}, status=400)
        if LpnMaster.objects.filter(lpn_id=lpn_id).exists():
            return Response({'detail': f'LPN {lpn_id} already exists'}, status=400)
        if LpnMaster.objects.filter(barcode=barcode).exists():
            return Response({'detail': f'barcode {barcode} is already on another LPN'}, status=400)

        dest = Site.objects.filter(site_id=dest_id).first() if dest_id else None
        if dest is None:
            return Response({'detail': 'a destination site is required'}, status=400)
        # A bundle can travel on any internal lane: mother hub -> dark store
        # (the common replenishment leg) or mother hub -> mother hub. Other
        # site types (super store, cross dock) are not bundle destinations yet.
        if dest.site_type not in ('DS', 'MH'):
            return Response({
                'detail': f'{dest.code} cannot receive a bundle (must be a dark store or mother hub)'
            }, status=400)

        if not isinstance(raw_items, list) or not raw_items:
            return Response({'detail': 'items must be a non-empty list of scanned units'}, status=400)

        source_site = None
        picked = []
        total_qty = 0
        seen = set()
        for idx, item in enumerate(raw_items):
            sku = Sku.objects.filter(sku_id=item.get('sku')).first()
            if sku is None:
                return Response({'detail': f'line {idx + 1}: SKU {item.get("sku")} not found'}, status=400)
            lot = InventoryLot.objects.filter(lot_id=item.get('lot')).first() if item.get('lot') else None
            if lot is None:
                return Response({'detail': f'line {idx + 1}: lot {item.get("lot")} not found'}, status=400)

            bin_id = str(item.get('bin_location_id') or '').strip()
            loc = Location.objects.filter(location_id=bin_id, location_type='BIN').select_related('site').first()
            if loc is None:
                return Response({'detail': f'line {idx + 1}: bin {bin_id} not found'}, status=400)
            if source_site is None:
                source_site = loc.site
            elif loc.site_id != source_site.site_id:
                return Response({'detail': 'all scanned units must come from one site'}, status=400)

            try:
                qty = int(item.get('qty') or 0)
            except (TypeError, ValueError):
                return Response({'detail': f'line {idx + 1}: qty must be an integer'}, status=400)
            if qty <= 0:
                return Response({'detail': f'line {idx + 1}: qty must be greater than 0'}, status=400)

            key = (str(sku.sku_id), str(lot.lot_id), loc.location_id)
            if key in seen:
                return Response({'detail': f'line {idx + 1}: duplicate sku/lot/bin'}, status=400)
            seen.add(key)

            balance = (StockBalance.objects
                       .filter(site=source_site, container='BIN', container_ref=loc.location_id,
                               sku=sku, lot=lot)
                       .aggregate(t=Sum('qty'))['t'] or 0)
            if int(balance) < qty:
                return Response({
                    'detail': (f'line {idx + 1}: {sku.sku_code} has {balance} in '
                               f'{loc.barcode}, cannot pack {qty}'),
                    'line': idx + 1,
                }, status=400)

            picked.append({
                'sku': sku, 'sku_code': sku.sku_code, 'sku_name': sku.name,
                'lot': lot, 'batch_number': lot.batch_number or '',
                'qty': qty, 'location': loc.barcode or loc.location_id,
                'bin_location_id': loc.location_id, 'bin_site': loc.site,
            })
            total_qty += qty

        if source_site is None:
            return Response({'detail': 'could not resolve a source site'}, status=400)
        from bounded.ds_ops.access import require_site_access, require_session_facility
        require_site_access(request.user, source_site.code)
        require_session_facility(request.user, source_site.code)
        if transfer and (
            transfer.source_site_id != source_site.site_id or
            transfer.dest_site_id != dest.site_id
        ):
            return Response({'detail': 'Transfer source or destination does not match the scanned stock.'}, status=400)

        # A batch is paperwork for the pack; reuse the operator's reference if
        # it already exists rather than failing a legitimate retry.
        batch = Batch.objects.filter(batch_no=batch_no).first() if batch_no else None
        if batch is not None and batch.site_id != source_site.site_id:
            return Response({'detail': f'batch {batch_no} belongs to another site'}, status=400)
        if batch is None and batch_no:
            batch = Batch.objects.create(
                batch_no=batch_no, site=source_site, type='MANUAL',
                processing_type='LPN_BASED', destinations=dest.code,
                ordered_qty=total_qty, ordered_skus=len(picked),
                status='UPLOADED')

        from django.utils import timezone
        manifest = {
            'lpn_id': lpn_id,
            'barcode': barcode,
            'destination': {
                'site_id': str(dest.site_id), 'code': dest.code, 'name': dest.name,
            },
            'source': {
                'site_id': str(source_site.site_id), 'code': source_site.code,
                'name': source_site.name,
            },
            'items': [
                {
                    'sku': str(p['sku'].sku_id), 'sku_code': p['sku_code'],
                    'sku_name': p['sku_name'], 'lot': str(p['lot'].lot_id),
                    'batch_number': p['batch_number'], 'qty': p['qty'],
                    'location': p['location'],
                }
                for p in picked
            ],
            'total_qty': total_qty,
            'packed_by': actor_id,
            'packed_at': timezone.now().isoformat(),
        }

        lpn = LpnMaster.objects.create(
            lpn_id=lpn_id, barcode=barcode, lpn_type=lpn_type,
            current_site=source_site, source_site=source_site, dest_site=dest,
            transfer=transfer,
            current_container='LPN',
            current_ref_id=str(transfer.transfer_id) if transfer else (str(batch.batch_id) if batch else None),
            status='PACKED', manifest=manifest, created_by=actor_id,
        )
        if transfer and transfer.status in ('APPROVED', 'ALLOCATED', 'PICKING', 'PICKED', 'SORTED', 'PACKING'):
            transfer.status = 'PACKED'
            transfer.save(update_fields=['status'])

        try:
            for p in picked:
                LpnContent.objects.create(
                    lpn=lpn, sku=p['sku'], lot=p['lot'], qty=p['qty'])
                if transfer:
                    from django.db.models import F, Max
                    from bounded.ds_ops.models import TransferOrderLine

                    line = (TransferOrderLine.objects.select_for_update()
                            .filter(transfer=transfer, sku=p['sku'], lot=p['lot'])
                            .first())
                    if line is not None:
                        line.ordered_qty = F('ordered_qty') + p['qty']
                        line.picked_qty = F('picked_qty') + p['qty']
                        line.save(update_fields=['ordered_qty', 'picked_qty', 'updated_at'])
                    else:
                        next_line_no = (TransferOrderLine.objects.filter(transfer=transfer)
                                        .aggregate(m=Max('line_no'))['m'] or 0) + 1
                        TransferOrderLine.objects.create(
                            transfer=transfer, line_no=next_line_no,
                            sku=p['sku'], lot=p['lot'],
                            ordered_qty=p['qty'], picked_qty=p['qty'],
                        )
                line_ref = f'PACK:{lpn_id}:{str(p["sku"].sku_id)[:8]}:{str(p["lot"].lot_id)[:8]}'
                apply_stock(
                    site=p['bin_site'], sku=p['sku'], lot=p['lot'], qty=p['qty'],
                    direction='OUT', movement_type='PACK', ref_type='LPN', ref_id=line_ref,
                    actor_id=actor_id, actor_type='STAFF',
                    container='BIN', container_ref=p['bin_location_id'],
                    enforce_available=True,
                )
                apply_stock(
                    site=source_site, sku=p['sku'], lot=p['lot'], qty=p['qty'],
                    direction='IN', movement_type='PACK', ref_type='LPN', ref_id=line_ref,
                    actor_id=actor_id, actor_type='STAFF',
                    container='LPN', container_ref=str(lpn_id),
                )
        except InsufficientStock as e:
            transaction.set_rollback(True)
            return Response({'detail': str(e)}, status=400)

        return Response({
            'success': True,
            'lpn_id': lpn.lpn_id,
            'barcode': lpn.barcode,
            'lpn_type': lpn.lpn_type,
            'status': lpn.status,
            'batch_id': str(batch.batch_id) if batch else None,
            'batch_no': batch.batch_no if batch else None,
            'manifest': manifest,
            'total_qty': total_qty,
        })

# ---------------------------------------------------------------------------
# Stock corrections
#
# Movements are append-only and are never edited or deleted. A correction is a
# new, attributed, two-person record that writes a compensating movement, so the
# original entry and the hash chain stay intact and the reason survives.
# ---------------------------------------------------------------------------

import uuid as _uuid

from rest_framework import status as _status

from bounded.iam.permissions import IsEstateRole


def _adjustment_row(adj):
    return {
        'adjustment_id': str(adj.adjustment_id),
        'site': adj.site.code,
        'sku': str(adj.sku_id),
        'sku_code': adj.sku.sku_code,
        'lot': str(adj.lot_id),
        'batch_number': adj.lot.batch_number,
        'container': adj.container,
        'container_ref': adj.container_ref,
        'qty_delta': adj.qty_delta,
        'reason': adj.reason,
        'status': adj.status,
        'requested_by': str(adj.requested_by_id),
        'approved_by': str(adj.approved_by_id),
        'movement_id': adj.movement.entry_id if adj.movement_id else None,
        'created_at': adj.created_at.isoformat(),
    }


class StockAdjustmentView(APIView):
    """List and append stock corrections.

    Read is facility-scoped. Writing requires an estate role, a reason and a
    second, different approver. The movement goes through `apply_stock` with a
    deterministic reference and a unique replay key, so a retried POST cannot
    move stock twice.
    """

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsEstateRole()]

    def get(self, request):
        from bounded.ds_ops.access import is_estate_role, operator_site_codes

        qs = StockAdjustment.objects.select_related('site', 'sku', 'lot', 'movement')
        if not is_estate_role(request.user):
            qs = qs.filter(site__code__in=operator_site_codes(request.user))
        site_code = request.query_params.get('site_code')
        if site_code:
            qs = qs.filter(site__code=site_code)
        return Response({'results': [_adjustment_row(a) for a in qs[:200]]})

    @transaction.atomic
    def post(self, request):
        from bounded.catalog.models import InventoryLot, Sku
        from bounded.ds_ops.access import require_session_facility, require_site_access
        from bounded.network.models import Site

        data = request.data
        site_code = str(data.get('site_code') or '').strip().upper()
        sku_ref = data.get('sku_id') or data.get('sku_code')
        lot_ref = data.get('lot_id')
        container = str(data.get('container') or 'SITE').strip().upper()
        container_ref = str(data.get('container_ref') or '').strip()
        reason = str(data.get('reason') or '').strip()
        idempotency_key = str(data.get('idempotency_key') or '').strip() or None

        try:
            qty_delta = int(data.get('qty_delta'))
        except (TypeError, ValueError):
            return Response({'detail': 'qty_delta must be a non-zero integer.'},
                            status=_status.HTTP_400_BAD_REQUEST)
        if qty_delta == 0:
            return Response({'detail': 'qty_delta must be non-zero.'},
                            status=_status.HTTP_400_BAD_REQUEST)
        if len(reason) < 10:
            return Response({'detail': 'A reason of at least 10 characters is required.'},
                            status=_status.HTTP_400_BAD_REQUEST)

        site = Site.objects.filter(code=site_code).first()
        if site is None:
            return Response({'detail': 'Unknown site.'}, status=_status.HTTP_404_NOT_FOUND)
        require_site_access(request.user, site.code)
        require_session_facility(request.user, site.code)

        sku = None
        if sku_ref:
            sku = Sku.objects.filter(sku_id=sku_ref).first() if len(str(sku_ref)) == 36 \
                else Sku.objects.filter(sku_code=sku_ref).first()
        if sku is None:
            return Response({'detail': 'Unknown SKU.'}, status=_status.HTTP_400_BAD_REQUEST)
        lot = InventoryLot.objects.filter(lot_id=lot_ref).first() if lot_ref else None
        if lot is None:
            return Response({'detail': 'A lot is required for a stock correction.'},
                            status=_status.HTTP_400_BAD_REQUEST)
        if lot.sku_id != sku.sku_id:
            return Response({'detail': 'The lot does not belong to that SKU.'},
                            status=_status.HTTP_400_BAD_REQUEST)

        approved_by_id = data.get('approved_by')
        from bounded.iam.models import User as _User
        import uuid
        approver = None
        if approved_by_id:
            raw = str(approved_by_id).strip()
            try:
                approver = _User.objects.filter(user_id=uuid.UUID(raw)).first()
            except (ValueError, TypeError):
                approver = None
            if approver is None:
                approver = _User.objects.filter(email__iexact=raw).first()
        if approver is None or approver.role not in ('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER'):
            return Response({
                'detail': 'A second, different estate-role approver is required.',
            }, status=_status.HTTP_400_BAD_REQUEST)
        if approver.user_id == request.user.user_id:
            return Response({
                'detail': 'The approver must be a different person from the requester.',
            }, status=_status.HTTP_400_BAD_REQUEST)

        if idempotency_key:
            existing = StockAdjustment.objects.filter(
                idempotency_key=idempotency_key,
            ).select_related('site', 'sku', 'lot', 'movement').first()
            if existing is not None:
                return Response(_adjustment_row(existing), status=_status.HTTP_200_OK)

        adjustment = StockAdjustment.objects.create(
            site=site, sku=sku, lot=lot, container=container,
            container_ref=container_ref, qty_delta=qty_delta, reason=reason,
            requested_by=request.user, approved_by=approver,
            idempotency_key=idempotency_key,
        )
        direction = 'IN' if qty_delta > 0 else 'OUT'
        try:
            moved = apply_stock(
                site=site, sku=sku, lot=lot, qty=abs(qty_delta),
                direction=direction, movement_type='ADJUST',
                ref_type='ADJUSTMENT', ref_id=str(adjustment.adjustment_id),
                actor_id=request.user.user_id, actor_type='USER',
                container=container, container_ref=container_ref,
                enforce_available=True,
            )
        except InsufficientStock as exc:
            transaction.set_rollback(True)
            return Response({'detail': str(exc)}, status=_status.HTTP_409_CONFLICT)

        # StockMovement has no `ref_type` column: apply_stock folds the movement
        # type into `movement_ref` and keeps the owning record in `ref_id`. The
        # old filter named a column that does not exist, so every adjustment
        # POST raised FieldError *after* the stock had already moved.
        movement = StockMovement.objects.filter(
            movement_ref='ADJUST', ref_id=str(adjustment.adjustment_id),
        ).order_by('-entry_id').first()
        if movement is not None and moved:
            adjustment.movement = movement
            adjustment.save(update_fields=['movement'])

        try:
            from bounded.iam.staff_auth import audit as _audit
            _audit('INVENTORY_STOCK_ADJUSTED', actor_id=request.user.user_id,
                   entity_type='StockAdjustment', entity_id=adjustment.adjustment_id,
                   request=request,
                   after={'site': site.code, 'sku': sku.sku_code,
                          'lot': lot.batch_number, 'qty_delta': qty_delta,
                          'approved_by': str(approver.user_id)})
        except Exception:
            pass

        return Response(_adjustment_row(adjustment), status=_status.HTTP_201_CREATED)
