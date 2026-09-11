from django.contrib import admin
from .models import Employee, EmployeeClockIn, EmployeeDailyTask

@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ('employee_code', 'user', 'department', 'shift_start', 'shift_end', 'is_clocked_in', 'forklift_certified')
    list_filter = ('department', 'is_clocked_in', 'forklift_certified')
    search_fields = ('employee_code', 'user__username', 'user__email')

@admin.register(EmployeeClockIn)
class EmployeeClockInAdmin(admin.ModelAdmin):
    list_display = ('employee', 'clock_in_time', 'clock_out_time', 'total_hours_worked')
    list_filter = ('clock_in_time',)
    search_fields = ('employee__employee_code',)

@admin.register(EmployeeDailyTask)
class EmployeeDailyTaskAdmin(admin.ModelAdmin):
    list_display = ('employee', 'task_type', 'reference_id', 'status', 'items_handled_count', 'error_count', 'assigned_at')
    list_filter = ('task_type', 'status')
    search_fields = ('employee__employee_code', 'reference_id')
