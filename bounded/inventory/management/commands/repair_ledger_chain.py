"""Rebuild a site's stock-movement hash chain after history was removed.

`verify_ledger` refuses to declare a store healthy when a movement is missing
from the middle of its `site_seq` run, or when a row's stored hash no longer
follows the row in front. That check is right: balances can still add up across
a hole, so the chain is the only thing that notices history being edited.

The repair is deliberately not part of `verify_ledger`, whose whole value is
that it writes nothing. Rebuilding a chain destroys the tamper evidence that
survived, so it is a separate, explicit act:

  * it is a dry run unless `--apply` is passed;
  * it refuses a site whose chain is already intact;
  * it records the old head and the breaks it found in `AuditLog` before it
    renumbers anything, so the fact that a rebuild happened is itself auditable;
  * it never deletes or edits a movement's content - only `site_seq`,
    `prev_hash`, `row_hash` and the chain head.

When to use it: test/verification data was pruned by deleting rows, or a site
was restored from a partial dump. It is not a way to "fix" a chain that a
review has not yet explained - investigate first, then rebuild.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from bounded.audit.models import AuditLog
from bounded.inventory.ledger import chain_breaks, movement_chain, row_hash
from bounded.inventory.models import StockMovementsChain


class Command(BaseCommand):
    help = (
        'Rebuild a stock-movement hash chain that no longer joins up. '
        'Dry run unless --apply.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Actually rewrite site_seq/hashes. Without this, nothing changes.',
        )
        parser.add_argument('--site', help='Only repair this site code.')

    def handle(self, *args, **options):
        # Streaming every movement on a pooled connection needs a client cursor;
        # see the same note in verify_ledger.
        connection.settings_dict['DISABLE_SERVER_SIDE_CURSORS'] = True
        apply = options['apply']

        chains = StockMovementsChain.objects.select_related('site').order_by('site__code')
        if options.get('site'):
            chains = chains.filter(site__code=options['site'])
            if not chains.exists():
                raise CommandError(f'No chain for site {options["site"]}')

        broken = 0
        for chain in chains:
            rows = movement_chain(chain.site)
            seq_breaks, hash_breaks, linked = chain_breaks(chain.site, rows)

            last_seq = rows[-1].site_seq if rows else 0
            last_hash = rows[-1].row_hash if rows else None
            # Binary fields come back as memoryview(format='c'); compare the
            # bytes, not the wrapper, or an intact head looks broken forever.
            head_wrong = (chain.head_seq != last_seq
                          or bytes(chain.head_hash or b'') != bytes(last_hash or b''))

            if not seq_breaks and not hash_breaks and not head_wrong:
                continue

            broken += 1
            self.stdout.write(self.style.WARNING(
                f'\n{chain.site.code}: {len(rows)} movements '
                f'({linked} linked), {len(seq_breaks)} seq break(s), '
                f'{len(hash_breaks)} hash break(s)'
                + (', head out of step' if head_wrong else '')))
            for brk in seq_breaks[:10]:
                self.stdout.write(
                    f'  seq: expected {brk["expected"]}, found {brk["found"]} '
                    f'at entry {brk["entry_id"]}')
            for brk in hash_breaks[:10]:
                self.stdout.write(f'  hash: entry {brk["entry_id"]} - {brk["reason"]}')

            if not apply:
                continue

            self._rebuild(chain, rows, seq_breaks, hash_breaks,
                          len(rows) - linked)
            self.stdout.write(self.style.SUCCESS(
                f'  rebuilt: {len(rows)} movements, head seq {len(rows)}'))

        if not broken:
            self.stdout.write(self.style.SUCCESS('All chains are intact. Nothing to do.'))
            return
        if not apply:
            self.stdout.write(self.style.WARNING(
                f'\n{broken} chain(s) need repair. Dry run - '
                f're-run with --apply to rewrite them.'))
            return
        self.stdout.write(self.style.SUCCESS(f'\nRepaired {broken} chain(s).'))

    def _rebuild(self, chain, rows, seq_breaks, hash_breaks, unlinked):
        """Renumber and rehash one site's rows, then move the head to the end."""
        before = {
            'head_seq': chain.head_seq,
            'head_hash': chain.head_hash.hex() if chain.head_hash else None,
            'movements': len(rows),
            'unlinked': unlinked,
            'seq_breaks': seq_breaks[:40],
            'hash_breaks': hash_breaks[:40],
        }

        with transaction.atomic():
            prev = None
            for position, movement in enumerate(rows, start=1):
                movement.site_seq = position
                movement.prev_hash = prev
                movement.row_hash = row_hash(movement, prev)
                movement.save(update_fields=['site_seq', 'prev_hash', 'row_hash'])
                prev = movement.row_hash

            chain.head_seq = len(rows)
            chain.head_hash = prev
            chain.save(update_fields=['head_seq', 'head_hash', 'updated_at'])

            AuditLog.objects.create(
                actor_type='SYSTEM',
                action='LEDGER_CHAIN_REBUILT',
                entity_type='SITE',
                entity_id=chain.site.site_id,
                before_json=before,
                after_json={'head_seq': chain.head_seq,
                            'head_hash': chain.head_hash.hex() if chain.head_hash else None},
                result='SUCCESS',
            )
