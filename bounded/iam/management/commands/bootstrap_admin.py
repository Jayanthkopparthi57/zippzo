import os
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
        parser.add_argument(
            "--password-from-env",
            help="Name of an environment variable holding the admin password. "
                 "When set, the command is fully non-interactive: it does nothing "
                 "unless the variable is present and no Super Admin exists yet, "
                 "so it is safe to run on every build.",
        )

    def handle(self, *args, **options):
        env_key = options.get("password_from_env")
        email_opt = (options.get("email") or "").strip().lower()
        full_name_opt = (options.get("name") or "").strip()
        phone_opt = (options.get("phone") or "").strip()

        email = email_opt or (input("Admin email: ").strip().lower() if not env_key else "")
        if env_key:
            if not email or "@" not in email:
                self.stdout.write(self.style.WARNING(
                    "Skipping Super Admin bootstrap: DJANGO_SUPERADMIN_EMAIL not set or invalid."))
                return
            full_name = full_name_opt or email.split("@", 1)[0]
            password = os.environ.get(env_key, "")
            if not password:
                self.stdout.write(self.style.WARNING(
                    f"Skipping Super Admin bootstrap: environment variable {env_key} not set."))
                return
            if len(password) < 12:
                raise CommandError(
                    f"{env_key} must be at least 12 characters long.")
            if User.objects.filter(role="SUPER_ADMIN").exists():
                self.stdout.write(
                    "A Super Admin already exists; skipping creation.")
                return
            confirmation = password  # no second prompt in non-interactive mode
        else:
            full_name = full_name_opt or input("Admin full name: ").strip()
            phone = phone_opt
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
                if User.objects.select_for_update().filter(role="SUPER_ADMIN").exists():
                    if env_key:
                        self.stdout.write(
                            "A Super Admin already exists; skipping creation.")
                        return
                    raise CommandError("A Super Admin already exists.")
                if User.objects.filter(email__iexact=email).exists():
                    raise CommandError(
                        "That email already belongs to an account.")
                User.objects.create(
                    email=email,
                    full_name=full_name,
                    phone=phone_opt,
                    role="SUPER_ADMIN",
                    status="ACTIVE",
                    password_hash=make_password(password),
                )
        except IntegrityError as exc:
            raise CommandError("Could not create the admin. The email may already be in use.") from exc

        self.stdout.write(self.style.SUCCESS(
            f"Super Admin created for {email}. You can now sign in."))
