"""
Shared ledger arithmetic, so a check and its repair can never disagree.

Both `verify_ledger` (the read-only check) and `zero_unsupported_picks` (the
repair) have to answer "what does the movement ledger say happened to this
line". When that question is written down twice it will eventually be written
down two different ways, and the repair starts "correcting" rows the check
considered fine.

Three things about the ledger are easy to get wrong, and all three produced
false results before this was extracted:

  * The movement type lives in `movement_ref`, not `movement_type`.
    `apply_stock` writes `movement_ref=movement_type[:30]` and leaves the
    `movement_type` column blank on every row it creates. Filtering on
    `movement_type` finds nothing and reports every order as unbacked.

  * `CUSTODY` and `SUPPLIER` hold no stock. `apply_stock` rewrites every
    movement into a `CUSTODY:<ref_id>` hop, so custody is a virtual transit
    bucket keyed by whatever reference moved the goods, and SUPPLIER is the
    outside world. Only `SITE`, `BIN` and `LPN` have balance rows.

  * Ownership is part of the balance key, and the two tables disagree on how to
    spell "no owner". `StockBalance` stores `owner_id=''`, while every movement
    `apply_stock` writes stores `owner_id=NULL`. The unique constraint on
    `StockBalance` includes owner, so two rows differing only by owner are two
    real balances, not a duplicate - but keying on raw values would split the
    same stock in two and report every balance as missing. Owner is therefore
    normalised before it goes into a key.

`StockBalance` does have a unique constraint on
(site, container, container_ref, sku, lot, owner_type, owner_id), so an exact
duplicate row cannot exist; `balance_key` mirrors that constraint exactly, which
is why balances are summed per key rather than compared one row at a time.
"""

from collections import defaultdict

from bounded.inventory.models import StockBalance, StockMovement

# Containers that physically hold stock, and therefore have a balance row.
BALANCE_CONTAINERS = ('SITE', 'BIN', 'LPN')

# Movement refs that mean "a unit left a shelf for an order line" and
# "a unit left the store in a rider's tote".
PICK_REF = 'PICK'
SHIP_REF = 'SHIP'

# Spellings of "nobody owns this", which the two tables disagree on.
DEFAULT_OWNER_TYPE = 'ZIPZOO'
NO_OWNER = ''


def _owner(owner_type, owner_id):
    """Normalise ownership so a balance and the movements behind it agree."""
    return (owner_type or DEFAULT_OWNER_TYPE, owner_id or NO_OWNER)


def balance_key(site_id, container, container_ref, sku_id, lot_id,
                owner_type=None, owner_id=None):
    """
    The identity of a stored quantity, matching StockBalance's unique constraint.

    Owner is last so callers that only care about location can keep reading the
    leading fields.
    """
    return (site_id, container, container_ref or '', str(sku_id), str(lot_id),
            *_owner(owner_type, owner_id))


def _movements(site_code=None):
    qs = StockMovement.objects.all()
    if site_code:
        qs = qs.filter(site__code=site_code)
    return qs


def expected_balances(site_code=None):
    """
    What every real storage key should hold, according to the movements.

    Each movement is both an outflow from one container and an inflow to
    another, so it is folded in twice - which is how `apply_stock` writes it.
    CUSTODY and SUPPLIER hops are skipped because they are not balance keys.
    """
    expected = defaultdict(int)
    rows = _movements(site_code).values_list(
        'site_id', 'sku_id', 'lot_id', 'qty', 'owner_type', 'owner_id',
        'from_container', 'from_ref_id', 'to_container', 'to_ref_id')
    for (site_id, sku_id, lot_id, qty, owner_type, owner_id,
         from_c, from_ref, to_c, to_ref) in rows.iterator(chunk_size=5000):
        if to_c in BALANCE_CONTAINERS:
            expected[balance_key(
                site_id, to_c, to_ref, sku_id, lot_id, owner_type, owner_id)] += qty
        if from_c in BALANCE_CONTAINERS:
            expected[balance_key(
                site_id, from_c, from_ref, sku_id, lot_id, owner_type, owner_id)] -= qty
    return expected


def actual_balances(site_code=None):
    """Balances summed per key, plus the row count per key for duplicate checks."""
    balances = StockBalance.objects.all()
    if site_code:
        balances = balances.filter(site__code=site_code)

    totals = defaultdict(int)
    rows_per_key = defaultdict(int)
    for (site_id, container, container_ref, sku_id, lot_id,
         owner_type, owner_id, qty) in balances.values_list(
            'site_id', 'container', 'container_ref', 'sku_id', 'lot_id',
            'owner_type', 'owner_id', 'qty'
    ).iterator(chunk_size=5000):
        if container not in BALANCE_CONTAINERS:
            continue
        key = balance_key(
            site_id, container, container_ref, sku_id, lot_id,
            owner_type, owner_id)
        totals[key] += qty
        rows_per_key[key] += 1
    return totals, rows_per_key


def line_movement_totals(site_code=None):
    """
    Units the ledger records as picked and shipped, keyed by order line id.

    Only counts against a real `CustomerOrderLine.line_id`. Historical rows
    carry all sorts of other references in `ref_id` - LPN ids, relocation
    tokens, putaway uuids - so those deliberately contribute nothing rather
    than being guessed at.
    """
    picked = defaultdict(int)
    shipped = defaultdict(int)
    rows = _movements(site_code).filter(
        movement_ref__in=(PICK_REF, SHIP_REF)).values_list(
            'movement_ref', 'ref_id', 'qty')
    for movement_ref, ref_id, qty in rows.iterator(chunk_size=5000):
        if not ref_id:
            continue
        (picked if movement_ref == PICK_REF else shipped)[ref_id] += qty
    return picked, shipped