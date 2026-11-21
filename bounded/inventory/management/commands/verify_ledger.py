"""
Reconcile the stock ledger against itself, read-only.

Every stock change in this system is a row in `StockMovement` applied through
`apply_stock`, and `StockBalance` is supposed to be nothing more than a cached
total of those rows. That invariant is what makes the dark-store workflow
trustworthy: when a screen says six units left the shelf, it is because six
movements exist, and if a balance disagrees with the movements underneath it,
then some screen somewhere is about to lie to an operator.

This command exists because that invariant was previously only ever checked by
hand, in a shell, against whatever data happened to be there. It is a check,
not a repair tool: it writes nothing, so it is safe to point at production.

Three independent things are checked:

  1. balances vs movements
     For every (site, container, container_ref, sku, lot), the balance has to
     equal the sum of movements into that key minus the sum out of it. A
     balance with no movements behind it is stock that appeared from nowhere,
     which is the exact failure that let a live smoke-test order invent itself.

  2. order counters vs movements
     `CustomerOrderLine.picked_qty` and `.shipped_qty` have to equal the PICK
     and SHIP movements recorded against that line. These are the numbers the
     pick screen renders and the pack endpoint refuses on, so a counter that
     drifts from the ledger lets an order be packed while the units are still
     on the shelf.

  3. the per-site hash chain
     `StockMovementsChain` holds a rolling hash per site. A broken chain means a
     movement was inserted or removed behind the ledger's back, which is the one
     failure a totals check cannot see - the total can be perfectly balanced and
     the history still forged.

Exit status is non-zero when anything is wrong, so this can gate a deploy.
"""
from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from bounded.inventory.ledger import (
    BALANCE_CONTAINERS, actual_balances, balance_key, chain_breaks,
    expected_balances, line_movement_totals, movement_chain,
)
from bounded.inventory.models import StockBalance, StockMovement, StockMovementsChain


class Command(BaseCommand):
    help = 'Reconcile stock balances and order counters against the movement ledger.'

    # Re-exported so the balance check and its repair agree on what holds stock.
    BALANCE_CONTAINERS = BALANCE_CONTAINERS

    def add_arguments(self, parser):
        parser.add_argument('--site', help='Only check this site code.')
        parser.add_argument(
            '--skip-chain',
            action='store_true',
            help='Skip the hash-chain check (it reads every movement for the site).',
        )

    def handle(self, *args, **options):
        # `iterator()` uses a server-side cursor, which this deployment's pooled
        # connection closes mid-iteration ("cursor does not exist"). The check
        # reads every movement at least once, so it streams - it just has to do
        # so on a plain client cursor.
        connection.settings_dict['DISABLE_SERVER_SIDE_CURSORS'] = True

        site_code = options.get('site')
        problems = 0

        problems += self._check_balances(site_code)
        problems += self._check_order_counters(site_code)
        if not options.get('skip_chain'):
            problems += self._check_chain(site_code)

        if problems:
            self.stderr.write(
                self.style.ERROR(f'\n{problems} problem(s) found. Nothing was changed.'))
            raise CommandError(f'{problems} ledger problem(s)')
        self.stdout.write(self.style.SUCCESS('\nLedger is consistent. Nothing was changed.'))

    # -- helpers ---------------------------------------------------------
    def _movements(self, site_code):
        qs = StockMovement.objects.all()
        if site_code:
            qs = qs.filter(site__code=site_code)
        return qs

    def _key(self, site_id, container, ref, sku_id, lot_id):
        return (site_id, container, ref or '', str(sku_id), str(lot_id))

# -- 1. balances vs movements ---------------------------------------
    def _check_balances(self, site_code):
        self.stdout.write('Checking balances against movements...')
        expected = expected_balances(site_code)

        # Balances are summed per key rather than compared row by row: nothing
        # enforces a unique constraint on
        # (site, container, container_ref, sku, lot), and a duplicate pair of
        # zero rows would otherwise be scored against the full expected qty and
        # reported as corruption when it is only untidiness.
        actual, rows_per_key = actual_balances(site_code)
        total_moves = StockMovement.objects.count() if not site_code else \
            StockMovement.objects.filter(site__code=site_code).count()

        phantom = 0
        # A row with nothing in it is not stock that appeared from nowhere. The
        # pack leg writes a CUSTODY row per line and the ship leg takes it back
        # to zero, so every completed order leaves one behind; counting those
        # would fail this gate forever on a healthy store.
        for b in (StockBalance.objects.all() if not site_code
                  else StockBalance.objects.filter(site__code=site_code)
                  ).exclude(container__in=BALANCE_CONTAINERS).exclude(qty=0):
            phantom += 1
            if phantom <= 10:
                self.stdout.write(self.style.WARNING(
                    f'  balance row on {b.container}, which holds no stock: '
                    f'{b.site.code}/{b.container_ref} qty={b.qty}'))

        found = phantom
        # `StockBalance` has a unique constraint on
        # (site, container, container_ref, sku, lot, owner_type, owner_id), so
        # this cannot happen for identical rows. It can still fire if the two
        # tables ever disagree on how to spell ownership, which is why the key
        # normalises it rather than trusting either side.
        for key, count in rows_per_key.items():
            if count > 1:
                found += 1
                if found <= 40:
                    self.stdout.write(self.style.WARNING(
                        f'  {count} balance rows share one key: '
                        f'{key[1]}/{key[2]!r} sku={key[3]} lot={key[4]} '
                        f'owner {key[5]}/{key[6]!r} (summed {actual[key]})'))

        keys = set(actual) | {k for k, v in expected.items() if v}
        for key in keys:
            want = expected.get(key, 0)
            have = actual.get(key, 0)
            if have == want:
                continue
            found += 1
            if found <= 40:
                # Only mention ownership when it is not the ordinary case, so the
                # common output stays readable.
                owner = ''
                if key[5] != 'ZIPZOO' or key[6]:
                    owner = f' owner {key[5]}/{key[6]!r}'
                self.stdout.write(self.style.WARNING(
                    f'  site={key[0]} {key[1]}/{key[2]!r} '
                    f'sku={key[3]} lot={key[4]}{owner}: balance says {have}, '
                    f'movements say {want} (delta {have - want:+d})'))

        self.stdout.write(
            f'  {total_moves} movements, {len(actual)} balance keys -> '
            + (self.style.ERROR(f'{found} problem(s)')
               if found else self.style.SUCCESS('all balanced')))
        return found

    # -- 2. order counters vs movements ---------------------------------
    def _check_order_counters(self, site_code):
        from bounded.orders.models import CustomerOrder, CustomerOrderLine

        self.stdout.write('Checking order line counters against movements...')
        lines = CustomerOrderLine.objects.select_related('order')
        if site_code:
            lines = lines.filter(order__site__code=site_code)

        # ref_id on a pick/ship movement is the order line id, so the two can be
        # summed straight from the ledger instead of trusting the counter.
        picked, shipped = line_movement_totals(site_code)

        found = 0
        for line in lines.iterator(chunk_size=1000):
            key = str(line.line_id)
            want_picked = picked.get(key, 0)
            want_shipped = shipped.get(key, 0)
            # A dropped-out pick is written back as a negative PICK, so the sum
            # is already net. picked_qty must never exceed qty.
            if line.picked_qty != want_picked:
                found += 1
                if found <= 40:
                    self.stdout.write(self.style.WARNING(
                        f'  {line.order.order_no} line {line.line_no}: '
                        f'picked_qty={line.picked_qty}, PICK movements={want_picked}'))
            elif want_shipped and line.shipped_qty != want_shipped:
                found += 1
                if found <= 40:
                    self.stdout.write(self.style.WARNING(
                        f'  {line.order.order_no} line {line.line_no}: '
                        f'shipped_qty={line.shipped_qty}, SHIP movements={want_shipped}'))
            elif line.picked_qty > line.qty:
                found += 1
                if found <= 40:
                    self.stdout.write(self.style.ERROR(
                        f'  {line.order.order_no} line {line.line_no}: '
                        f'picked_qty {line.picked_qty} exceeds qty {line.qty}'))

        self.stdout.write(
            f'  {lines.count()} order lines -> '
            + (self.style.ERROR(f'{found} mismatch(es)')
               if found else self.style.SUCCESS('all agree')))
        return found

    # -- 3. hash chain ---------------------------------------------------
    def _check_chain(self, site_code):
        """Walk each site's chain and confirm it still reaches the recorded head.

        A gap in `site_seq` or a row whose stored hash does not follow the one
        before it means a movement was inserted or deleted out of band. The
        balances can still add up perfectly in that case, which is precisely why
        this check is separate rather than folded into the totals.
        """
        self.stdout.write('Checking the per-site hash chain...')
        found = 0
        chains = StockMovementsChain.objects.select_related('site')
        if site_code:
            chains = chains.filter(site__code=site_code)

        for chain in chains:
            rows = movement_chain(chain.site)
            seq_breaks, hash_breaks, _linked = chain_breaks(chain.site, rows)

            for brk in seq_breaks[:20]:
                found += 1
                self.stdout.write(self.style.ERROR(
                    f'  {chain.site.code}: site_seq {brk["expected"]} expected, '
                    f'found {brk["found"]} at entry {brk["entry_id"]}'))
            for brk in hash_breaks[:20]:
                found += 1
                self.stdout.write(self.style.ERROR(
                    f'  {chain.site.code}: entry {brk["entry_id"]} '
                    f'{brk["reason"]}'))

            last_seq = rows[-1].site_seq if rows else 0
            last_hash = rows[-1].row_hash if rows else None
            head = bytes(chain.head_hash or b'')
            tail = bytes(last_hash or b'')
            if chain.head_seq != last_seq or head != tail:
                found += 1
                head = head.hex()[:12] if head else 'none'
                tail = tail.hex()[:12] if tail else 'none'
                self.stdout.write(self.style.ERROR(
                    f'  {chain.site.code}: chain head is (seq '
                    f'{chain.head_seq}, hash {head}) but the last movement is '
                    f'(seq {last_seq}, hash {tail})'))

        self.stdout.write(
            f'  {chains.count()} site chain(s) -> '
            + (self.style.ERROR(f'{found} problem(s)')
               if found else self.style.SUCCESS('intact')))
        return found