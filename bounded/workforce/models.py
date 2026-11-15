"""Workforce execution records: assignment, time, activity and productivity.

Before this app a task carried a bare actor UUID and a single timestamp. There
was no assignment record to accept, no time log to bucket effort into, no
activity event stream and no productivity row — the Man Power screen invented
its numbers from a hash of the operator's name. These tables make the console
report facts it can join back to a task.
"""
import uuid

from django.db import models


class PickerZoneMapping(models.Model):
    """Which zone a picker works, and in what preference order."""

    mapping_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'iam.User', on_delete=models.CASCADE, related_name='picker_zones')
    site = models.ForeignKey(
        'network.Site', on_delete=models.CASCADE, related_name='picker_zones')
    zone = models.ForeignKey(
        'network.Zone', on_delete=models.CASCADE, related_name='picker_mappings')
    priority = models.PositiveSmallIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'picker_zone_mapping'
        ordering = ['site', 'priority']
        unique_together = [('user', 'site', 'zone')]
        indexes = [
            models.Index(fields=['site', 'is_active'], name='ix_pzmap_site_active'),
            models.Index(fields=['user', 'is_active'], name='ix_pzmap_user_active'),
        ]

    def __str__(self):
        return f'{self.user_id} @ {self.zone.code}'


class WorkAssignment(models.Model):
    """One unit of work handed to one operator.

    `ref_type` + `ref_id` point at the owning record (a PickTask, a PutawayTask,
    a CycleCount, a Shipment). A plain string reference is deliberate: the
    design has one assignment table serving several task tables, and a generic
    foreign key would put a content-type dependency in every query.
    """

    TASK_TYPE_CHOICES = [
        ('PICK', 'Pick'), ('PACK', 'Pack'), ('PUTAWAY', 'Putaway'),
        ('GRN', 'GRN'), ('SORT', 'Sort'), ('CYCLE_COUNT', 'Cycle Count'),
        ('DISPATCH', 'Dispatch'), ('CHECKIN', 'Check-in'), ('OTHER', 'Other'),
    ]
    STATUS_CHOICES = [
        ('ASSIGNED', 'Assigned'), ('ACCEPTED', 'Accepted'),
        ('IN_PROGRESS', 'In Progress'), ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]

    assignment_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'iam.User', on_delete=models.CASCADE, related_name='work_assignments')
    site = models.ForeignKey(
        'network.Site', on_delete=models.CASCADE, related_name='work_assignments')
    task_type = models.CharField(
        max_length=15, choices=TASK_TYPE_CHOICES, default='OTHER')
    ref_type = models.CharField(max_length=40, blank=True)
    ref_id = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='ASSIGNED')
    priority = models.PositiveSmallIntegerField(default=5)
    assigned_by = models.ForeignKey(
        'iam.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='assignments_made',
    )
    assigned_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=250, blank=True)

    class Meta:
        db_table = 'work_assignments'
        ordering = ['-assigned_at']
        indexes = [
            models.Index(fields=['user', 'status'], name='ix_wassign_user_status'),
            models.Index(fields=['site', 'status'], name='ix_wassign_site_status'),
            models.Index(fields=['task_type', 'status'], name='ix_wassign_type_status'),
            models.Index(fields=['ref_type', 'ref_id'], name='ix_wassign_ref'),
        ]

    def __str__(self):
        return f'{self.task_type} {self.ref_id} -> {self.user_id}'


class WorkTimeLog(models.Model):
    """A measured interval of work. Minutes is stored, not derived at read time,
    so a closed interval survives a later clock change."""

    ACTIVITY_CHOICES = [
        ('PICK', 'Pick'), ('PACK', 'Pack'), ('PUTAWAY', 'Putaway'),
        ('GRN', 'GRN'), ('SORT', 'Sort'), ('CYCLE_COUNT', 'Cycle Count'),
        ('DISPATCH', 'Dispatch'), ('IDLE', 'Idle'), ('BREAK', 'Break'),
        ('MEETING', 'Meeting'), ('OTHER', 'Other'),
    ]
    SOURCE_CHOICES = [('AUTO', 'Auto'), ('MANUAL', 'Manual')]

    log_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'iam.User', on_delete=models.CASCADE, related_name='work_time_logs')
    site = models.ForeignKey(
        'network.Site', on_delete=models.CASCADE, related_name='work_time_logs')
    assignment = models.ForeignKey(
        WorkAssignment, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='time_logs',
    )
    shift = models.ForeignKey(
        'network.StaffShift', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='time_logs',
    )
    activity = models.CharField(
        max_length=15, choices=ACTIVITY_CHOICES, default='OTHER')
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    minutes = models.PositiveIntegerField(default=0)
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default='MANUAL')
    notes = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'work_time_logs'
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['user', 'started_at'], name='ix_wtimelog_user_time'),
            models.Index(fields=['site', 'started_at'], name='ix_wtimelog_site_time'),
            models.Index(fields=['activity'], name='ix_wtimelog_activity'),
        ]

    def __str__(self):
        return f'{self.user_id} {self.activity} {self.minutes}m'


class EmployeeActivityEvent(models.Model):
    """Append-only activity stream. One row per thing an operator did."""

    EVENT_CHOICES = [
        ('LOGIN', 'Login'), ('LOGOUT', 'Logout'), ('SCAN', 'Scan'),
        ('PICK', 'Pick'), ('PACK', 'Pack'), ('PUTAWAY', 'Putaway'),
        ('SHORT_PICK', 'Short Pick'), ('CYCLE_COUNT', 'Cycle Count'),
        ('DISPATCH', 'Dispatch'), ('IDLE', 'Idle'), ('BREAK', 'Break'),
        ('ERROR', 'Error'),
    ]

    event_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'iam.User', on_delete=models.CASCADE, related_name='activity_events')
    site = models.ForeignKey(
        'network.Site', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='activity_events',
    )
    event_type = models.CharField(max_length=20, choices=EVENT_CHOICES)
    ref_type = models.CharField(max_length=40, blank=True)
    ref_id = models.CharField(max_length=64, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'employee_activity_events'
        ordering = ['-occurred_at']
        indexes = [
            models.Index(fields=['user', 'occurred_at'], name='ix_activity_user_time'),
            models.Index(fields=['site', 'event_type'], name='ix_activity_site_type'),
        ]

    def __str__(self):
        return f'{self.user_id} {self.event_type}'


class ProductivityRollup(models.Model):
    """Daily per-operator totals. Computed by a job or entered by a supervisor;
    the console reads it instead of guessing."""

    SOURCE_CHOICES = [('ROLLUP', 'Rollup'), ('MANUAL', 'Manual')]

    rollup_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'iam.User', on_delete=models.CASCADE, related_name='productivity_rollups')
    site = models.ForeignKey(
        'network.Site', on_delete=models.CASCADE, related_name='productivity_rollups')
    work_date = models.DateField()
    tasks_completed = models.PositiveIntegerField(default=0)
    units_processed = models.PositiveIntegerField(default=0)
    minutes_worked = models.PositiveIntegerField(default=0)
    idle_minutes = models.PositiveIntegerField(default=0)
    units_per_hour = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default='ROLLUP')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'productivity_rollups'
        ordering = ['-work_date', 'site']
        unique_together = [('user', 'site', 'work_date')]
        indexes = [
            models.Index(fields=['work_date'], name='ix_prod_date'),
            models.Index(fields=['site', 'work_date'], name='ix_prod_site_date'),
        ]

    def __str__(self):
        return f'{self.user_id} {self.work_date} {self.units_per_hour}/h'
