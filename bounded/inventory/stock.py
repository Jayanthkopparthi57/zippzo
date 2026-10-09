"""Single authoritative stock ledger for the whole system.

Every quantity change in Zippzo must go through this module so that
StockBalance and StockMovement can never drift apart. All operations are
atomic (row-locked) and idempotent via a caller-supplied idempotency key.

Schema notes (bounded/inventory/models.py):
  StockMovement.movement_ref  -> what produced the movement (PICK, PUTAWAY, ...)
  StockMovement.ref_id        -> the source object's id
  StockMovement.idempotency_key-> unique guard so replays are no-ops
  StockMovement.from_/to_container + *_ref_id -> where the units came from / went to
"""
import hashlib

from django.db import transaction
from django.db.models import F, Sum

from .models import StockBalance, StockMovement, StockMovementsChain

SITE = 'SITE'
BIN = 'BIN'
LPN = 'LPN'

# Short, <=30 chars to fit StockMovement.movement_ref
PUTAWAY = 'PUTAWAY'
PICK = 'PICK'
TRANSFER = 'TRANSFER'
RETURN = 'RETURN'


class InsufficientStock(Exception):
    pass


def _row_hash(mv, prev_hash):
    """Tamper-evident link: hash of this row plus the previous row's hash."""
    parts = [
        str(mv.site_id), str(mv.site_seq), mv.movement_ref, mv.ref_id,
        str(mv.sku_id), str(mv.lot_id), str(mv.qty),
        mv.from_container, str(mv.from_ref_id or ''),
        mv.to_container, str(mv.to_ref_id or ''),
        str(mv.sellable_delta), str(mv.site_custody_delta),
        mv.idempotency_key or '',
        prev_hash.hex() if prev_hash else '',
    ]
    return hashlib.sha256('|'.join(parts).encode()).digest()


def _key(movement_type, ref_type, ref_id, sku, lot, site, direction, container,
         container_ref):
    """Identity of one ledger leg.

    The container and direction must be part of the key: a bin-to-bin relocation
    writes an OUT from bin A and an IN to bin B that share movement_type, ref and
    site, so without them the second leg would look like a replay of the first
    and silently do nothing.
    """
    raw = (f"{movement_type}|{ref_type}|{ref_id}|{sku}|{lot}|{site}"
           f"|{direction}|{container}|{container_ref}")
    return hashlib.sha256(raw.encode()).hexdigest()[:60]


def already_applied(*, site, sku, lot, movement_type, ref_type, ref_id,
                    direction='IN', container=SITE, container_ref=''):
    """True if this exact ledger leg is already committed.

    apply_stock() silently no-ops a replay, which is right for the ledger but
    wrong for an API response: a device that retries a scan after a timeout would
    get a success carrying numbers it can no longer reconcile, and a caller
    validating its request first would reject the retry for a reason that has
    nothing to do with the replay.

    So a caller that needs to answer a retried request has to be able to ask
    the question before it validates. The arguments are passed exactly as
    apply_stock() takes them and reduced through the same _key(), so the two can
    never drift.
    """
    return StockMovement.objects.filter(
        idempotency_key=_key(movement_type, ref_type, ref_id, sku, lot, site,
                             direction, container, container_ref)
    ).exists()


@transaction.atomic
def apply_stock(*, site, sku, lot, qty, movement_type, ref_type, ref_id,
                actor_id='', actor_type='SYSTEM', direction='IN',
                container=SITE, container_ref='', owner_type='ZIPZOO',
                owner_id='', sellable=True, custody=True,
                enforce_available=True, force=False, supply_from=None,
                supply_from_ref=None):
    """Move `qty` of (sku, lot) at `site` and write the matching movement.

    direction='IN'  -> balance increases (PUTAWAY, RECEIVE, RETURN)
    direction='OUT' -> balance decreases (PICK, ISSUE, SHIP)

    Idempotent: replaying the same (type, ref, sku, lot, site) is a no-op.

    `supply_from` relabels where an IN movement came from. It defaults to
    'SUPPLIER', which is right for receiving but wrong for the other half of a
    custody hand-off: packing picked goods into a tote is a move from the store's
    custody into the LPN, and recording it as SUPPLIER -> LPN would say the units
    were bought rather than moved, corrupting every shrinkage reading taken from
    these movements. It is an annotation only - the balance that moves and the
    idempotency key are unaffected, so a replay is still caught.
    """
    qty = int(qty)
    if qty <= 0:
        return False

    idem = _key(movement_type, ref_type, ref_id, sku, lot, site, direction,
                container, container_ref)
    if not force and StockMovement.objects.filter(idempotency_key=idem).exists():
        return False

    bal, _ = StockBalance.objects.select_for_update().get_or_create(
        site=site,
        container=container,
        container_ref=container_ref,
        sku=sku,
        lot=lot,
        owner_type=owner_type,
        owner_id=owner_id,
        defaults={'qty': 0, 'sellable': sellable,
                  'container_ref_type': 'NONE',
                  'counts_toward_site_custody': custody},
    )

    if direction == 'OUT':
        if enforce_available and bal.qty < qty:
            raise InsufficientStock(
                f"{sku.sku_code} @ {site.code} {container_ref or container}: "
                f"need {qty}, have {bal.qty}")
        bal.qty = F('qty') - qty
        cust_delta, sell_delta = (-1 if custody else 0), (-qty if sellable else 0)
        f_container, f_ref = container, container_ref
        t_container, t_ref = 'CUSTODY', str(ref_id)
    else:
        bal.qty = F('qty') + qty
        cust_delta, sell_delta = (1 if custody else 0), (qty if sellable else 0)
        f_container = supply_from or 'SUPPLIER'
        f_ref = supply_from_ref if supply_from_ref is not None else str(ref_id)
        t_container, t_ref = container, container_ref

    bal.save(update_fields=['qty', 'updated_at'])

    # Serialise the audit chain per site so two concurrent movements can never
    # be handed the same sequence number, and so the chain links properly.
    chain, _ = StockMovementsChain.objects.select_for_update().get_or_create(
        site=site, defaults={'head_seq': 0, 'head_hash': None})
    seq = chain.head_seq + 1

    mv = StockMovement(
        sku=sku, lot=lot, qty=qty, site=site,
        movement_ref=movement_type[:30], ref_id=str(ref_id)[:50],
        from_container=f_container, from_ref_id=str(f_ref)[:50] if f_ref else None,
        to_container=t_container, to_ref_id=str(t_ref)[:50] if t_ref else None,
        owner_type=owner_type, owner_id=str(owner_id)[:50] or None,
        actor_id=str(actor_id)[:64] or None, actor_type=actor_type,
        idempotency_key=idem,
        sellable_delta=sell_delta, site_custody_delta=cust_delta,
        site_seq=seq,
    )
    mv.prev_hash = chain.head_hash
    mv.row_hash = _row_hash(mv, chain.head_hash)
    mv.save()

    chain.head_seq = seq
    chain.head_hash = mv.row_hash
    chain.save(update_fields=['head_seq', 'head_hash', 'updated_at'])
    return True


@transaction.atomic
def transfer_stock(*, from_site, to_site, sku, lot, qty, movement_type, ref_type, ref_id,
                   from_container=SITE, to_container=SITE,
                   from_ref='', to_ref='', actor_id='', actor_type='SYSTEM',
                   enforce_available=True):
    """Move stock between two sites as one atomic OUT+IN pair."""
    out = apply_stock(
        site=from_site, sku=sku, lot=lot, qty=qty, direction='OUT',
        movement_type=movement_type, ref_type=ref_type, ref_id=ref_id,
        actor_id=actor_id, actor_type=actor_type,
        container=from_container, container_ref=from_ref,
        enforce_available=enforce_available,
    )
    if not out:
        return False
    apply_stock(
        site=to_site, sku=sku, lot=lot, qty=qty, direction='IN',
        movement_type=movement_type, ref_type=ref_type, ref_id=ref_id,
        actor_id=actor_id, actor_type=actor_type,
        container=to_container, container_ref=to_ref,
    )
    return True


def site_qty(site, sku=None, lot=None):
    qs = StockBalance.objects.filter(site=site, qty__gt=0)
    if sku is not None:
        qs = qs.filter(sku=sku)
    if lot is not None:
        qs = qs.filter(lot=lot)
    return qs.aggregate(t=Sum('qty'))['t'] or 0
