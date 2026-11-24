"""Disable obvious test/demo accounts in production without deleting data.

This is intentionally conservative: it never removes a User row (that would
cascade into Customer, orders, shifts and payouts) and never touches estate
administrators. Matching accounts are blocked, their store assignments are
deactivated, and their sessions are revoked. All order history stays intact.

Usage:
    python manage.py cleanup_test_accounts          # report only
    python manage.py cleanup_test_accounts --apply  # disable matches
"""
import re

from django.core.management.base import BaseCommand
from django.utils import timezone

from bounded.iam.models import User

# Narrow, well-known test identities. Real store staff use personal or
# role-prefixed zippzo.in addresses and are deliberately not matched here.
TEST_PATTERNS = [
    r'^shopper-test-\d+@',
    r'^ui-test-\d+@',
    r'^(audit|verify)-(customer|rider|admin|ds|wms)@',
    r'@example\.(com|org|in)$',
    r'@test\.(com|in)$',
    r'^(test|demo|sample)[._+-]',
    r'[-+_]test@',
    r'^repro',
    r'^flow\.',
    r'^role\.',
    r'^new\.(employee|login)\.',
]

ADMIN_ROLES = ('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER')


def is_test_email(email):
    value = str(email or '').strip().lower()
    return any(re.search(pattern, value) for pattern in TEST_PATTERNS)


class Command(BaseCommand):
    help = 'Block test-pattern accounts without deleting any records.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Actually disable matches (default: dry run).')

    def handle(self, *args, **options):
        from bounded.delivery.models import RiderProfile
        from bounded.iam.models import Session
        from bounded.network.models import EmployeeSiteAssignment

        matches = [u for u in User.objects.all().order_by('email')
                   if is_test_email(u.email)
                   and u.role not in ADMIN_ROLES
                   and u.status != 'BLOCKED']
        if not matches:
            self.stdout.write(self.style.SUCCESS('No test accounts to clean.'))
            return

        for user in matches:
            self.stdout.write(
                f'DISABLE {user.email} | role={user.role} | status={user.status}')
            if not options['apply']:
                continue
            now = timezone.now()
            user.status = 'BLOCKED'
            user.save(update_fields=['status'])
            EmployeeSiteAssignment.objects.filter(user=user).update(is_active=False)
            Session.objects.filter(user=user).update(
                is_active=False, revoked_at=now)
            RiderProfile.objects.filter(user=user).update(is_online=False)

        if options['apply']:
            self.stdout.write(self.style.SUCCESS(
                f'Disabled {len(matches)} test account(s); data preserved.'))
        else:
            self.stdout.write(self.style.WARNING(
                'Dry run only. Re-run with --apply to disable them.'))
