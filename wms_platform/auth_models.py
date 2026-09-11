import uuid
from django.db import models


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
