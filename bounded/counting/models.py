"""Cycle counting: the table the design called for and the platform had none of.

Without a count record there was no way to compare system stock with a physical
count, record a variance, request a recount or approve an adjustment. A cycle
count line is deliberately a snapshot: system_qty is copied when the line is
created so a later ledger movement cannot rewrite what the counter was shown.
"""
import uuid

from django.db import models


class CycleCount(models.Model):
    COUNT_TYPE_CHOICES = [
        ('FULL', 'Full'), ('ZONE', 'Zone'), ('BIN', 'Bin'),
        ('SKU', 'SKU'), ('SPOT', 'Spot'),
    ]
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'), ('SCHEDULED', 'Scheduled'),
        ('IN_PROGRESS', 'In Progress'), ('REVIEW', 'Review'),
        ('CLOSED', 'Closed'), ('CANCELLED', 'Cancelled'),
    ]

    count_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=60, unique=True)
    site = models.ForeignKey(
        'network.Site', on_delete=models.PROTECT, related_name='cycle_counts')
    count_type = models.CharField(
        max_length=10, choices=COUNT_TYPE_CHOICES, default='SPOT')
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='DRAFT')
    scope = models.JSONField(
        default=dict, blank=True,
        help_text='Zone / bin / SKU filters the count was generated from.')
    scheduled_for = models.DateField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    assigned_to = models.ForeignKey(
        'iam.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cycle_counts_assigned',
    )
    created_by = models.ForeignKey(
        'iam.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cycle_counts_created',
    )
    notes = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cycle_counts'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['site', 'status'], name='ix_ccount_site_status'),
            models.Index(fields=['scheduled_for'], name='ix_ccount_scheduled'),
        ]

    def __str__(self):
        return self.code


class CycleCountLine(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'), ('COUNTED', 'Counted'),
        ('VARIANCE', 'Variance'), ('RECOUNT', 'Recount'),
        ('APPROVED', 'Approved'),
    ]

    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    count = models.ForeignKey(
        CycleCount, on_delete=models.CASCADE, related_name='lines')
    location = models.ForeignKey(
        'network.Location', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cycle_count_lines',
    )
    sku = models.ForeignKey(
        'catalog.Sku', on_delete=models.PROTECT, related_name='cycle_count_lines')
    lot = models.ForeignKey(
        'catalog.InventoryLot', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cycle_count_lines',
    )
    lpn = models.ForeignKey(
        'inventory.LpnMaster', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cycle_count_lines',
    )
    system_qty = models.IntegerField(default=0)
    counted_qty = models.IntegerField(null=True, blank=True)
    variance = models.IntegerField(default=0)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='PENDING')
    counted_by = models.ForeignKey(
        'iam.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cycle_count_lines',
    )
    counted_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=250, blank=True)

    class Meta:
        db_table = 'cycle_count_lines'
        ordering = ['count', 'location', 'sku']
        indexes = [
            models.Index(fields=['count', 'status'], name='ix_ccline_count_status'),
            models.Index(fields=['sku'], name='ix_ccline_sku'),
        ]

    def __str__(self):
        return f'{self.count.code} {self.sku_id}'
