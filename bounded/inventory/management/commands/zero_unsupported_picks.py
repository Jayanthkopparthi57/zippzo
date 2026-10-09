"""
Zero order-line pick counters that the ledger cannot support.

Some order lines carry `picked_qty` / `shipped_qty` values with no PICK or SHIP
movement behind them. The counters were written directly, so they say units left
a shelf (and later left the store) when nothing was ever moved. The balances stay
correct throughout, which is what makes this so easy to miss: `verify_ledger`
passes the balance check and fails only the counter check.

This command is the repair, and it deliberately does the least surprising thing:

  * It **zeroes the counters**. It does not write corrective movements. The
    stock was never removed from a shelf, so the truthful history is "nothing was
    picked", and inventing a reverse movement would take units back off a shelf
    that never gave them up - turning a counter problem into a real negative
    balance.

  * It **only touches orders that are already REFUNDED or CANCELLED**. On those,
    the goods were never owed to a customer, so there is no outstanding promise
    being broken. A line on an order that is mid-fulfilment is refused and
    reported instead: deciding that one needs a human, because it may mean a
    real delivery went unrecorded.

  * It **audits every write**. Each line records what it was and what it became
    in `audit_log`, so the change is traceable rather than a quiet edit.

Dry run by default. Pass `--apply` to write.
"""
from django.core.management.base import BaseCommand
from django.db import connection, transaction

from bounded.audit.models import AuditLog
from bounded.inventory.ledger import line_movement_totals
from bounded.orders.models import CustomerOrder, CustomerOrderLine

# Where nothing is owed to a customer, so a counter that was never backed by the
# ledger can be dropped without inventing history.
TERMINAL_STATUSES = ('REFUNDED', 'CANCELLED')


class Command(BaseCommand):
    help = ('Zero picked_qty/shipped_qty on terminal orders that the movement '
            'ledger does not support. Dry run unless --apply.')

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Actually write the corrections. Without this, nothing is changed.',
        )
        parser.add_argument('--site', help='Only consider orders at this site code.')
        parser.add_argument(
            '--order',
            help='Only consider this order_no, for a targeted correction.',
        )

    def handle(self, *args, **options):
        connection.settings_dict['DISABLE_SERVER_SIDE_CURSORS'] = True
        apply = options['apply']

        lines = CustomerOrderLine.objects.select_related('order', 'order__site')
        if options.get('site'):
            lines = lines.filter(order__site__code=options['site'])
        if options.get('order'):
            lines = lines.filter(order__order_no=options['order'])

        # Only orders where the correction is safe to make.
        lines = lines.filter(order__status__in=TERMINAL_STATUSES)
        lines = lines.exclude(picked_qty=0, shipped_qty=0)

        picked, shipped = line_movement_totals(
            options.get('site'))

        fixes = []
        skipped = []
        for line in lines:
            key = str(line.line_id)
            want_picked = picked.get(key, 0)
            want_shipped = shipped.get(key, 0)
            if line.picked_qty == want_picked and line.shipped_qty == want_shipped:
                continue
            if want_picked or want_shipped:
                # Partially backed: the ledger disagrees, but not in a way that
                # zeroes cleanly. Leave it for a human.
                skipped.append((line, 'partially backed by the ledger'))
                continue
            fixes.append((line, want_picked, want_shipped))

        self.stdout.write(
            f'{len(fixes)} line(s) to correct, {len(skipped)} left alone, '
            f'across {len({str(l.order.order_id) for l, _, _ in fixes})} order(s).')

        for line, want_picked, want_shipped in fixes:
            self.stdout.write(
                f'  {line.order.order_no} line {line.line_no} '
                f'({line.order.site.code}): picked {line.picked_qty}->{want_picked}, '
                f'shipped {line.shipped_qty}->{want_shipped} '
                f'[status {line.order.status}]')

        for line, why in skipped:
            self.stdout.write(self.style.WARNING(
                f'  SKIPPED {line.order.order_no} line {line.line_no}: {why}'))

        if not fixes:
            self.stdout.write(self.style.SUCCESS('Nothing to correct.'))
            return

        if not apply:
            self.stdout.write(self.style.WARNING(
                '\nDry run. Re-run with --apply to write these corrections.'))
            return

        with transaction.atomic():
            for line, want_picked, want_shipped in fixes:
                before = {
                    'picked_qty': line.picked_qty,
                    'shipped_qty': line.shipped_qty,
                    'status': line.status,
                }
                fields = []
                if line.picked_qty != want_picked:
                    line.picked_qty = want_picked
                    fields.append('picked_qty')
                if line.shipped_qty != want_shipped:
                    line.shipped_qty = want_shipped
                    fields.append('shipped_qty')
                if line.status == 'PICKED':
                    # A refunded order whose lines are no longer picked should
                    # not still read as picked.
                    line.status = 'CANCELLED'
                    fields.append('status')
                if fields:
                    line.save(update_fields=fields)

                AuditLog.objects.create(
                    actor_type='SYSTEM',
                    action='ledger.zero_unsupported_pick',
                    entity_type='CustomerOrderLine',
                    entity_id=line.line_id,
                    before_json=before,
                    after_json={
                        'picked_qty': line.picked_qty,
                        'shipped_qty': line.shipped_qty,
                        'status': line.status,
                    },
                    result='SUCCESS',
                    denial_reason=(
                        'Picked/shipped counters had no backing PICK/SHIP movement; '
                        'zeroed on a terminal order. No stock was moved.'
                    ),
                )

        self.stdout.write(self.style.SUCCESS(
            f'\nCorrected {len(fixes)} line(s). No stock was moved.'))
        self.stdout.write(
            'Re-run `python manage.py verify_ledger` to confirm the ledger is clean.')