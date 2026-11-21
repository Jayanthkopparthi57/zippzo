import os
from unittest import mock

from django.contrib.auth.hashers import check_password, make_password
from django.core.management import call_command
from django.test import TestCase

from bounded.iam.models import User


class BootstrapAdminTests(TestCase):
    def test_promotes_existing_shopper_account_in_env_mode(self):
        User.objects.create(
            email='jayanthkopparthi595@gmail.com',
            full_name='Jayanth Kopparthi',
            role='CUSTOMER',
            status='ACTIVE',
            password_hash=make_password('older-password'),
        )

        with mock.patch.dict(os.environ, {'DJANGO_SUPERADMIN_PASSWORD': 'password@123'}):
            call_command(
                'bootstrap_admin',
                email='jayanthkopparthi595@gmail.com',
                name='Jayanth Kopparthi',
                password_from_env='DJANGO_SUPERADMIN_PASSWORD',
            )

        user = User.objects.get(email='jayanthkopparthi595@gmail.com')
        self.assertEqual(user.role, 'SUPER_ADMIN')
        self.assertEqual(user.status, 'ACTIVE')
        self.assertTrue(check_password('password@123', user.password_hash))
        self.assertEqual(User.objects.filter(role='SUPER_ADMIN').count(), 1)

    def test_skips_when_super_admin_already_exists(self):
        User.objects.create(
            email='existing-admin@zippzo.in',
            role='SUPER_ADMIN',
            status='ACTIVE',
            password_hash=make_password('unchanged-password-123'),
        )
        User.objects.create(
            email='jayanthkopparthi595@gmail.com',
            role='CUSTOMER',
            status='ACTIVE',
            password_hash=make_password('older-password'),
        )

        with mock.patch.dict(os.environ, {'DJANGO_SUPERADMIN_PASSWORD': 'password@123'}):
            call_command(
                'bootstrap_admin',
                email='jayanthkopparthi595@gmail.com',
                name='Jayanth Kopparthi',
                password_from_env='DJANGO_SUPERADMIN_PASSWORD',
            )

        shopper = User.objects.get(email='jayanthkopparthi595@gmail.com')
        self.assertEqual(shopper.role, 'CUSTOMER')
        self.assertTrue(check_password('older-password', shopper.password_hash))
