"""Merge case-insensitive duplicate User emails without deleting any account.

User.email is case-sensitive in the database, so two rows can hold the same
address with different casing. Login resolves by email__iexact and used to
500 when it found two. This command keeps the best row (active, highest role,
oldest) with the lowercase address and gives the others unique, blocked
addresses so their order history and audit trail survive untouched.

Usage:
    python manage.py dedupe_user_emails          # report only
    python manage.py dedupe_user_emails --apply  # perform the merge
"""
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from bounded.iam.models import User

ROLE_PRIORITY = {
    'SUPER_ADMIN': 0, 'ADMIN': 0, 'OPS_MANAGER': 1,
    'WAREHOUSE_STAFF': 2, 'PICKER': 3, 'INVENTORY_ASSOCIATE': 3,
    'INBOUND_ASSOCIATE': 3, 'PUTAWAY_ASSOCIATE': 3, 'RIDER': 4,
    'CUSTOMER': 5, 'SENDER': 5,
}


class Command(BaseCommand):
    help = 'Merge duplicate User emails that differ only by case.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Actually rename/block duplicates (default: dry run).')

    def handle(self, *args, **options):
        from bounded.iam.models import Session

        groups = defaultdict(list)
        for user in User.objects.all().order_by('created_at'):
            groups[user.email.strip().lower()].append(user)

        duplicates = {key: rows for key, rows in groups.items() if len(rows) > 1}
        if not duplicates:
            self.stdout.write(self.style.SUCCESS('No duplicate emails found.'))
            return

        for key, rows in duplicates.items():
            ordered = sorted(rows, key=lambda u: (
                0 if u.status == 'ACTIVE' else 1,
                ROLE_PRIORITY.get(u.role, 9),
                str(u.created_at),
            ))
            keeper = ordered[0]
            other_ids = [str(u.user_id) for u in ordered[1:]]
            self.stdout.write(
                f'{key}: keep {keeper.user_id} ({keeper.role}/{keeper.status}); '
                f'separate {", ".join(other_ids)}'
            )
            if not options['apply']:
                continue
            with transaction.atomic():
                now = timezone.now()
                for index, duplicate in enumerate(ordered[1:], 1):
                    local, _, domain = duplicate.email.partition('@')
                    unique = f'{local}+dup{index}.{duplicate.user_id.hex[:6]}@{domain}'
                    duplicate.email = unique
                    duplicate.status = 'BLOCKED'
                    duplicate.save(update_fields=['email', 'status'])
                    Session.objects.filter(user=duplicate).update(
                        is_active=False, revoked_at=now)
                if keeper.email != key:
                    keeper.email = key
                    keeper.save(update_fields=['email'])

        if options['apply']:
            self.stdout.write(self.style.SUCCESS('Duplicate emails merged.'))
        else:
            self.stdout.write(self.style.WARNING(
                'Dry run only. Re-run with --apply to merge.'))
