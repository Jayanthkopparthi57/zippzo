from getpass import getpass

from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction
from django.contrib.auth.hashers import make_password

from bounded.iam.models import User


class Command(BaseCommand):
    help = "Create the first Zippzo Super Admin account (one time only)."

    def add_arguments(self, parser):
        parser.add_argument("--email", help="Admin email address")
        parser.add_argument("--name", help="Admin full name")
        parser.add_argument("--phone", default="", help="Optional phone number")

    def handle(self, *args, **options):
        email = (options["email"] or input("Admin email: ")).strip().lower()
        full_name = (options["name"] or input("Admin full name: ")).strip()
        phone = options["phone"].strip()
        if not email or "@" not in email:
            raise CommandError("Enter a valid email address.")
        if not full_name:
            raise CommandError("Admin full name is required.")

        if User.objects.filter(role="SUPER_ADMIN").exists():
            raise CommandError(
                "A Super Admin already exists. Ask an existing administrator to provision accounts."
            )
        if User.objects.filter(email__iexact=email).exists():
            raise CommandError("That email already belongs to an account.")

        password = getpass("Password (minimum 12 characters): ")
        confirmation = getpass("Confirm password: ")
        if len(password) < 12:
            raise CommandError("Password must be at least 12 characters.")
        if password != confirmation:
            raise CommandError("Passwords do not match.")

        try:
            with transaction.atomic():
                # Lock the existing user table rows where supported. The unique role
                # bootstrap check is repeated within the transaction to prevent races.
                if User.objects.select_for_update().filter(role="SUPER_ADMIN").exists():
                    raise CommandError("A Super Admin already exists.")
                User.objects.create(
                    email=email,
                    full_name=full_name,
                    phone=phone,
                    role="SUPER_ADMIN",
                    status="ACTIVE",
                    password_hash=make_password(password),
                )
        except IntegrityError as exc:
            raise CommandError("Could not create the admin. The email may already be in use.") from exc

        self.stdout.write(self.style.SUCCESS(f"Super Admin created for {email}. You can now sign in."))
