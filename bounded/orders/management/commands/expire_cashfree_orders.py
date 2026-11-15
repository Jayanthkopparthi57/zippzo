"""Verify expired Cashfree attempts and release their held inventory.

Run from cron every 5 minutes. The provider remains authoritative: if an order
was paid just before expiry, `sync_attempt` confirms it instead of releasing it.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from bounded.orders.models import PaymentAttempt
from bounded.orders.payments import CashfreeError, sync_attempt


class Command(BaseCommand):
    help = 'Reconcile and release expired pending Cashfree orders.'

    def handle(self, *args, **options):
        pending = PaymentAttempt.objects.filter(
            status='PENDING', expires_at__lte=timezone.now(),
            order__status='PAYMENT_PENDING',
        ).select_related('order')
        checked = expired = paid = errors = 0
        for attempt in pending.iterator(chunk_size=100):
            try:
                order = sync_attempt(attempt)
                checked += 1
                if order.payment_status == 'CAPTURED':
                    paid += 1
                elif order.status == 'PAYMENT_FAILED':
                    expired += 1
            except CashfreeError:
                errors += 1
        self.stdout.write(self.style.SUCCESS(
            f'Checked {checked}; expired {expired}; paid {paid}; provider errors {errors}.'
        ))
