"""Read models for the stock ledger and the bin-to-bin relocation action.

The raw StockMovement/StockBalance serializers expose bare UUIDs, which is
useless for a picking UI. These endpoints return joined, render-ready rows and
keep every quantity change inside bounded.inventory.stock.
"""
from django.db import transaction
from django.db.models import Q
from rest_framework.decorators import api_view
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import StockBalance, StockMovement
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

    sites = Site.objects.filter(locations__isnull=False).values_list('code', flat=True).distinct()
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

    permission_classes = [IsAuthenticated]

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
        actor_id = d.get('actor_id') or ''

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
