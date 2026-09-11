import uuid
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

class DepartmentChoices(models.TextChoices):
    ADMIN = 'admin', 'System Administration'
    MANAGEMENT = 'management', 'Warehouse Management'
    RECEIVING = 'receiving', 'Inbound Receiving'
    PICKING = 'picking', 'Order Picking'
    PACKING = 'packing', 'Packing & Verification'
    SHIPPING = 'shipping', 'Outbound Shipping'
    QC = 'qc', 'Quality Control'
    INVENTORY_CONTROL = 'inventory_control', 'Inventory Control & Audit'

class Employee(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='employee')
    employee_code = models.CharField(max_length=30, unique=True)
    department = models.CharField(max_length=30, choices=DepartmentChoices.choices)
    shift_start = models.TimeField(default='08:00:00')
    shift_end = models.TimeField(default='17:00:00')
    is_clocked_in = models.BooleanField(null=True, blank=True, default=False)
    current_gps_lat = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    current_gps_lng = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    forklift_certified = models.BooleanField(default=False)
    warehouse = models.ForeignKey('master_data.Warehouse', on_delete=models.SET_NULL, null=True, blank=True, related_name='employees')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.get_full_name() or self.user.username} ({self.employee_code}) - {self.department}"

class EmployeeClockIn(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='clock_ins')
    clock_in_time = models.DateTimeField(default=timezone.now)
    clock_out_time = models.DateTimeField(null=True, blank=True)
    clock_in_lat = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    clock_in_lng = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    total_hours_worked = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    def calculate_hours(self):
        if self.clock_out_time and self.clock_in_time:
            duration = self.clock_out_time - self.clock_in_time
            self.total_hours_worked = round(duration.total_seconds() / 3600.0, 2)
            return self.total_hours_worked
        return 0.00

    def __str__(self):
        return f"{self.employee.employee_code} Shift at {self.clock_in_time.strftime('%Y-%m-%d %H:%M')}"

class TaskTypeChoices(models.TextChoices):
    PICK = 'pick', 'Pick Task'
    GRN_QC = 'grn_qc', 'GRN Receiving & QC'
    PUTAWAY = 'putaway', 'Putaway Task'
    PACK = 'pack', 'Packing Station Task'
    CYCLE_COUNT = 'cycle_count', 'Cycle Counting'

class TaskStatusChoices(models.TextChoices):
    PENDING = 'pending', 'Pending'
    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'
    FAILED = 'failed', 'Failed / Exception'

class EmployeeDailyTask(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='daily_tasks')
    task_type = models.CharField(max_length=30, choices=TaskTypeChoices.choices)
    reference_id = models.CharField(max_length=100) # UUID or ID of related task
    assigned_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=TaskStatusChoices.choices, default=TaskStatusChoices.PENDING)
    items_handled_count = models.IntegerField(default=0)
    error_count = models.IntegerField(default=0)

    class Meta:
        indexes = [
            models.Index(fields=['employee', 'status'], name='idx_emp_tasks_active'),
        ]

    def __str__(self):
        return f"{self.employee.employee_code} - {self.task_type} [{self.status}] ({self.items_handled_count} items)"
