import uuid
from django.db import models
from django.utils import timezone
from datetime import timedelta


class AuthOtp(models.Model):
    """One-time password for email-based login verification."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField()
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)

    class Meta:
        db_table = 'auth_otp'
        ordering = ['-created_at']

    def __str__(self):
        return f"OTP for {self.email} ({'used' if self.is_used else 'active'})"

    @property
    def is_expired(self):
        return timezone.now() > self.expires_at

    @classmethod
    def create_for_email(cls, email):
        """Create a new OTP, expiring old ones for the same email."""
        import random
        cls.objects.filter(email=email, is_used=False).update(is_used=True)
        code = f"{random.randint(100000, 999999)}"
        expires_at = timezone.now() + timedelta(minutes=15)
        return cls.objects.create(email=email, code=code, expires_at=expires_at)


class AuthSession(models.Model):
    """Simple token-based session for authenticated users."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField()
    user_name = models.CharField(max_length=200, blank=True)
    user_role = models.CharField(max_length=50, default='ADMIN')
    token = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'auth_session'
        ordering = ['-created_at']

    def __str__(self):
        return f"Session for {self.email} ({'active' if self.is_active else 'expired'})"

    @classmethod
    def create_for_email(cls, email):
        """Create a new session token for the given email."""
        import secrets
        token = secrets.token_hex(32)
        # Derive a display name from the email
        name_part = email.split('@')[0].replace('.', ' ').replace('_', ' ').title()
        return cls.objects.create(email=email, user_name=name_part, token=token)
