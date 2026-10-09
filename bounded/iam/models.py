import uuid
from django.db import models


class User(models.Model):
    STATUS_CHOICES = [('ACTIVE','Active'),('INACTIVE','Inactive'),('BLOCKED','Blocked'),('PENDING','Pending')]
    ROLE_CHOICES = [('SUPER_ADMIN','Super Admin'),('OPS_MANAGER','Ops Manager'),('WAREHOUSE_STAFF','Warehouse Staff'),('RIDER','Rider'),('CUSTOMER','Customer'),('SENDER','Sender')]
    user_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.CharField(max_length=255, unique=True)
    phone = models.CharField(max_length=20, blank=True)
    full_name = models.CharField(max_length=200, blank=True)
    role = models.CharField(max_length=30, choices=ROLE_CHOICES, default='CUSTOMER')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    password_hash = models.CharField(max_length=255)
    last_login_at = models.DateTimeField(null=True, blank=True)
    failed_login_attempts = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    device_token = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'iam_users'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['phone']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return self.email

    # DRF-compatible auth flags (plain model, not AbstractUser).
    # Required by rest_framework.permissions.IsAuthenticated.
    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False


class Session(models.Model):
    session_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sessions')
    token = models.CharField(max_length=500, unique=True)
    refresh_token = models.CharField(max_length=500, unique=True, null=True, blank=True)
    device_fingerprint = models.CharField(max_length=255, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'iam_sessions'
        ordering = ['-created_at']

    def __str__(self):
        return f"Session {self.session_id} for {self.user.email}"


class Role(models.Model):
    role_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    permissions = models.JSONField(default=list)
    is_system = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'iam_roles'

    def __str__(self):
        return self.name


class Device(models.Model):
    device_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='devices')
    device_token = models.CharField(max_length=500)
    platform = models.CharField(max_length=20, choices=[('IOS','iOS'),('ANDROID','Android'),('WEB','Web')])
    push_token = models.CharField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'iam_devices'
        unique_together = [('user', 'device_token')]

    def __str__(self):
        return f"{self.platform} - {self.device_id}"


class QRCode(models.Model):
    qr_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=200, unique=True)
    data = models.JSONField()
    qr_type = models.CharField(max_length=20, choices=[('LOCATION','Location'),('INVENTORY','Inventory'),('ORDER','Order'),('USER','User')])
    expires_at = models.DateTimeField(null=True, blank=True)
    scan_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'iam_qrcodes'

    def __str__(self):
        return self.code


class IdempotencyKey(models.Model):
    key = models.CharField(max_length=255, primary_key=True)
    action = models.CharField(max_length=100)
    user_id = models.UUIDField(null=True, blank=True)
    response_json = models.JSONField(null=True, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'iam_idempotency_keys'

    def __str__(self):
        return self.key
