"""Permanently delete duplicate accounts that own no business data.

Only users created by `dedupe_user_emails` (email contains ``+dup`` and status
BLOCKED) are considered. A duplicate is deleted only when it has no related
business records — orders, payouts, shifts, stock adjustments, etc. Sessions,
devices and site assignments are part of the account itself and are ignored.
All other rows are left alone.

Usage:
    python manage.py delete_empty_duplicate_users          # dry run
    python manage.py delete_empty_duplicate_users --apply  # delete
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from bounded.iam.models import User

MARKER = '+dup'
# Rows that belong to the account record itself, not to business history.
IGNORABLE_RELATIONS = {
    'sessions', 'devices', 'login_challenges', 'shopper_account_challenges',
    'site_assignments',
}


def blocking_relation(user):
    for rel in User._meta.related_objects:
        if rel.name in IGNORABLE_RELATIONS:
            continue
        count = rel.related_model._default_manager.filter(
            **{rel.field.name: user}).count()
        if count:
            return f'{rel.name}({count})'
    return None


class Command(BaseCommand):
    help = 'Delete blocked duplicate users that have no business data.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Actually delete (default: dry run).')

    def handle(self, *args, **options):
        candidates = [u for u in User.objects.filter(status='BLOCKED')
                      if MARKER in u.email.lower()]
        if not candidates:
            self.stdout.write(self.style.SUCCESS('No empty duplicate accounts found.'))
            return

        for user in candidates:
            reason = blocking_relation(user)
            if reason:
                self.stdout.write(f'KEEP {user.email} | owns {reason}')
                continue
            self.stdout.write(f'DELETE {user.email} | role={user.role}')
            if options['apply']:
                with transaction.atomic():
                    user.delete()

        if options['apply']:
            self.stdout.write(self.style.SUCCESS('Empty duplicates removed.'))
        else:
            self.stdout.write(self.style.WARNING(
                'Dry run only. Re-run with --apply to delete.'))
