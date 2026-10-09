"""Drain the outbox into notifications.

Run from a scheduler (or `--loop` under a worker). Safe to run concurrently with
itself: rows are claimed with SKIP LOCKED and every notification is keyed so a
retry cannot duplicate.
"""
import time

from django.core.management.base import BaseCommand

from bounded.notifications.publish import publish_batch


class Command(BaseCommand):
    help = 'Publish PENDING outbox events into notifications.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100,
                            help='Max events per pass (default 100).')
        parser.add_argument('--loop', action='store_true',
                            help='Keep polling instead of draining once.')
        parser.add_argument('--interval', type=float, default=5.0,
                            help='Seconds between passes when --loop.')

    def handle(self, *args, **options):
        limit = options['limit']
        while True:
            published, summary = publish_batch(limit=limit)
            errors = summary.pop('_errors', [])
            if published:
                self.stdout.write(
                    f'published {published} event(s): {summary}')
            for err in errors:
                self.stderr.write(f'  FAILED {err}')
            if not options['loop']:
                break
            if published == 0:
                time.sleep(options['interval'])