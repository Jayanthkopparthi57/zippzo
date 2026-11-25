"""Idempotently promote the DJANGO_SUPERADMIN_* identity to Super Admin.

Render's bootstrap_admin deliberately skips when any Super Admin exists. This
command is the explicit override used for a temporary access account: it sets
the configured email/password on every deploy so the account can be used to
provision staff, then can be removed by clearing the env values.
"""
import os

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand

from bounded.iam.models import User


class Command(BaseCommand):
    help = 'Force the env-configured account to SUPER_ADMIN (temporary access).'

    def handle(self, *args, **options):
        email = (os.environ.get('DJANGO_SUPERADMIN_EMAIL') or '').strip().lower()
        password = os.environ.get('DJANGO_SUPERADMIN_PASSWORD') or ''
        if not email or '@' not in email or len(password) < 12:
            self.stdout.write('FORCE ADMIN skipped: env email/password not set.')
            return
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            user = User(email=email, full_name='Zippzo Admin')
        user.email = email
        user.role = 'SUPER_ADMIN'
        user.status = 'ACTIVE'
        user.password_hash = make_password(password)
        user.save()
        self.stdout.write(f'FORCE ADMIN ready for {email}')
