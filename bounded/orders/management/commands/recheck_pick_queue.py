"""Drain the dark-store pending pick queue.

Run from cron every minute (and after a picker marks an order complete). The
checkout path already assigns a confirmed order to the lowest-workload picker;
this command is what handles the case the checkout path cannot: nobody was free
at that moment, so the order waited in the queue.

    python manage.py recheck_pick_queue
    python manage.py recheck_pick_queue --site DS-BLR-01
"""
from django.core.management.base import BaseCommand

from bounded.ds_ops.assignment import assign_pending_orders, pending_pick_orders
from bounded.network.models import Site


class Command(BaseCommand):
    help = 'Assign pending dark-store pick orders to the least-loaded picker.'

    def add_arguments(self, parser):
        parser.add_argument('--site', dest='site', default='',
                            help='Only this store code (default: every dark store).')

    def handle(self, *args, **options):
        sites = Site.objects.filter(site_type='DS', status='ACTIVE')
        if options.get('site'):
            sites = sites.filter(code=options['site'].strip().upper())

        total_assigned = 0
        for site in sites.order_by('code'):
            queued = pending_pick_orders(site).count()
            if not queued:
                continue
            assigned, remaining = assign_pending_orders(site)
            total_assigned += assigned
            self.stdout.write(
                f'{site.code}: queued {queued}, assigned {assigned}, '
                f'remaining {remaining}'
            )
        self.stdout.write(self.style.SUCCESS(
            f'Assigned {total_assigned} order(s) across {sites.count()} dark store(s).'
        ))
