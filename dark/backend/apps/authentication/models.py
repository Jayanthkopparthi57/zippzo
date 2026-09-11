import uuid
from django.db import models
from django.contrib.auth.models import User

class UserRoleChoices(models.TextChoices):
    ADMIN = 'admin', 'Admin'
    MANAGER = 'manager', 'Manager'
    SUPERVISOR = 'supervisor', 'Supervisor'
    PICKER = 'picker', 'Picker'
    PACKER = 'packer', 'Packer'
    RECEIVER = 'receiver', 'Receiver'
    SHIPPER = 'shipper', 'Shipper'
    QC_INSPECTOR = 'qc_inspector', 'QC Inspector'

class ApprovalStatusChoices(models.TextChoices):
    PENDING = 'pending', 'Pending'
    APPROVED = 'approved', 'Approved'
    REJECTED = 'rejected', 'Rejected'

class UserProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    is_approved_by_admin = models.BooleanField(default=False)
    approval_status = models.CharField(
        max_length=20,
        choices=ApprovalStatusChoices.choices,
        default=ApprovalStatusChoices.PENDING
    )
    phone = models.CharField(max_length=30, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username} ({self.approval_status})"

class UserRole(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='roles')
    role = models.CharField(max_length=30, choices=UserRoleChoices.choices)

    class Meta:
        unique_together = ('user', 'role')

    def __str__(self):
        return f"{self.user.username} - {self.role}"

class ApprovalRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='approval_requests')
    requested_at = models.DateTimeField(auto_now_add=True)
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='approved_requests')
    approved_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"Approval for {self.user.username} - {self.user.profile.approval_status if hasattr(self.user, 'profile') else 'N/A'}"


class LoginApprovalStatusChoices(models.TextChoices):
    PENDING = 'pending', 'Pending Admin Approval'
    APPROVED = 'approved', 'Approved'
    REJECTED = 'rejected', 'Rejected'
    EXPIRED = 'expired', 'Expired'


class LoginApprovalRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='login_approvals')
    otp_code = models.CharField(max_length=6)
    status = models.CharField(
        max_length=20,
        choices=LoginApprovalStatusChoices.choices,
        default=LoginApprovalStatusChoices.PENDING
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    device_info = models.CharField(max_length=255, blank=True, null=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    approved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='approved_logins'
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ['-requested_at']

    def __str__(self):
        return f"Login OTP {self.otp_code} for {self.user.username} ({self.status})"
