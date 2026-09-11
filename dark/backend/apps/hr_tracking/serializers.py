from rest_framework import serializers
from .models import Employee, EmployeeClockIn, EmployeeDailyTask

class EmployeeSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.get_full_name', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True)
    warehouse_code = serializers.CharField(source='warehouse.code', read_only=True)

    class Meta:
        model = Employee
        fields = [
            'id', 'user', 'user_name', 'user_email', 'employee_code',
            'department', 'shift_start', 'shift_end', 'is_clocked_in',
            'current_gps_lat', 'current_gps_lng', 'forklift_certified', 'warehouse', 'warehouse_code', 'created_at'
        ]

class ClockInSerializer(serializers.Serializer):
    gps_lat = serializers.DecimalField(max_digits=10, decimal_places=7, required=False)
    gps_lng = serializers.DecimalField(max_digits=10, decimal_places=7, required=False)

class EmployeeClockInSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.employee_code', read_only=True)

    class Meta:
        model = EmployeeClockIn
        fields = ['id', 'employee', 'employee_code', 'clock_in_time', 'clock_out_time', 'clock_in_lat', 'clock_in_lng', 'total_hours_worked']

class EmployeeDailyTaskSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.employee_code', read_only=True)

    class Meta:
        model = EmployeeDailyTask
        fields = [
            'id', 'employee', 'employee_code', 'task_type', 'reference_id',
            'assigned_at', 'started_at', 'completed_at', 'status',
            'items_handled_count', 'error_count'
        ]
