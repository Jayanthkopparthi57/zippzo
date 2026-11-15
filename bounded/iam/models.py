import uuid
from django.db import models


class User(models.Model):
    STATUS_CHOICES = [('ACTIVE','Active'),('INACTIVE','Inactive'),('BLOCKED','Blocked'),('PENDING','Pending')]
    ROLE_CHOICES = [
        ('SUPER_ADMIN','Super Admin'),
        ('OPS_MANAGER','Ops Manager'),
        ('WAREHOUSE_STAFF','Warehouse Staff'),
        # Floor associate departments. They are store-level roles so a picker,
        # inbound associate, putaway associate or inventory associate can sign
        # in with a phone number and the store's daily code without needing a
        # separate account type. Existing WAREHOUSE_STAFF accounts keep working
        # because the department is also carried on
        # EmployeeSiteAssignment.role_at_site.
        ('PICKER','Picker'),
        ('INVENTORY_ASSOCIATE','Inventory Associate'),
        ('INBOUND_ASSOCIATE','Inbound Associate'),
        ('PUTAWAY_ASSOCIATE','Putaway Associate'),
        ('RIDER','Rider'),
        ('CUSTOMER','Customer'),
        ('SENDER','Sender'),
    ]
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
    """A real, revocable server session behind every access token.

    Before this existed the JWT was stateless: logout only deleted a browser
    key, a stolen token stayed valid for 15 hours, and removing an assignment
    did not end the session that had already opened the wrong console. The
    access token now carries `sid`, and every request re-reads this row.
    """

    SURFACE_CHOICES = [('web', 'Web'), ('mobile', 'Mobile')]

    session_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sessions')
    #: The access-token id (jti) — not the token itself. A token is never stored.
    token = models.CharField(max_length=500, unique=True)
    #: SHA-256 of the opaque refresh token, never the token.
    refresh_token = models.CharField(max_length=128, unique=True, null=True, blank=True)
    surface = models.CharField(max_length=10, choices=SURFACE_CHOICES, default='web')
    facility = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='staff_sessions',
    )
    device_fingerprint = models.CharField(max_length=255, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'iam_sessions'
        ordering = ['-created_at']

    def __str__(self):
        return f"Session {self.session_id} for {self.user.email}"


class ShopperAccountChallenge(models.Model):
    PURPOSES = [('VERIFY_EMAIL', 'Verify email'), ('RESET_PASSWORD', 'Reset password')]
    challenge_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE,
                             related_name='shopper_account_challenges')
    purpose = models.CharField(max_length=20, choices=PURPOSES)
    code_hash = models.CharField(max_length=64)
    attempts = models.PositiveSmallIntegerField(default=0)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'iam_shopper_account_challenges'
        ordering = ['-created_at']
        indexes = [models.Index(fields=['user', 'purpose', 'created_at'],
                                name='ix_shopper_challenge_lookup')]


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


class LoginChallenge(models.Model):
    """One password-verified login waiting for facility selection and OTP.

    The client receives a random `challenge_token`; only its hash is stored.
    Possession of the token plus the account password is required to advance,
    so a leaked challenge id alone cannot be used to enumerate or hijack a
    colleague's sign-in. The code itself is also stored only as a hash.
    """

    PURPOSE_CHOICES = [('STAFF_LOGIN', 'Staff login')]
    STATUS_CHOICES = [
        ('PASSWORD_OK', 'Password verified'),
        ('FACILITY_SELECTED', 'Facility selected'),
        ('CONSUMED', 'Consumed'),
        ('EXPIRED', 'Expired'),
    ]

    challenge_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='login_challenges')
    facility = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='login_challenges',
    )
    surface = models.CharField(max_length=10, default='web')
    purpose = models.CharField(max_length=30, choices=PURPOSE_CHOICES, default='STAFF_LOGIN')
    requested_app = models.CharField(max_length=20, blank=True, default='')
    challenge_token_hash = models.CharField(max_length=128)
    code_hash = models.CharField(max_length=128, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PASSWORD_OK')
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=5)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'iam_login_challenges'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['expires_at']),
        ]

    def __str__(self):
        return f"LoginChallenge {self.challenge_id} ({self.status})"
