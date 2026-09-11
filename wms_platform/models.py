import uuid
from django.db import models


class User(models.Model):
    ROLE_CHOICES = [
        ('PICKER', 'Picker'), ('PACKER', 'Packer'), ('SORTER', 'Sorter'),
        ('GRN_OP', 'GRN Operator'), ('QC', 'QC'), ('SUPERVISOR', 'Supervisor'),
        ('ADMIN', 'Admin'),
    ]
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('INACTIVE', 'Inactive'), ('BLOCKED', 'Blocked')]

    user_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    emp_code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    site_id = models.UUIDField(null=True, blank=True)  # FK -> site (avoid circular)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'user'
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.emp_code})"


class ReasonCode(models.Model):
    CATEGORY_CHOICES = [
        ('SHORT_PICK', 'Short Pick'), ('DAMAGE', 'Damage'),
        ('DISCREPANCY', 'Discrepancy'), ('CHECK_IN_BREACH', 'Check-in Breach'),
        ('CANCEL', 'Cancel'),
    ]

    rc_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES)
    code = models.CharField(max_length=50, unique=True)
    description = models.TextField()
    requires_photo = models.BooleanField(default=False)
    requires_remark = models.BooleanField(default=False)

    class Meta:
        db_table = 'reason_code'
        ordering = ['category', 'code']

    def __str__(self):
        return self.code
