import csv
from rest_framework import viewsets, permissions, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from django.http import HttpResponse
from django.utils import timezone
from django.db.models import Sum, Count, Q
from datetime import datetime, time
from .models import Employee, EmployeeClockIn, EmployeeDailyTask, TaskStatusChoices
from .serializers import (
    EmployeeSerializer,
    ClockInSerializer,
    EmployeeClockInSerializer,
    EmployeeDailyTaskSerializer
)

class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.all().select_related('user', 'warehouse')
    serializer_class = EmployeeSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['department', 'is_clocked_in', 'forklift_certified', 'warehouse']
    search_fields = ['employee_code', 'user__username', 'user__first_name', 'user__last_name', 'user__email', 'warehouse__code']

    @action(detail=False, methods=['post'], url_path='clock-in')
    def clock_in(self, request):
        employee = getattr(request.user, 'employee', None)
        if not employee:
            return Response({'error': 'No employee profile linked to this user'}, status=status.HTTP_400_BAD_REQUEST)

        if employee.is_clocked_in:
            return Response({'error': 'Employee is already clocked in'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = ClockInSerializer(data=request.data)
        serializer.is_valid()
        lat = serializer.validated_data.get('gps_lat')
        lng = serializer.validated_data.get('gps_lng')

        clock_in = EmployeeClockIn.objects.create(
            employee=employee,
            clock_in_time=timezone.now(),
            clock_in_lat=lat,
            clock_in_lng=lng
        )

        employee.is_clocked_in = True
        employee.current_gps_lat = lat
        employee.current_gps_lng = lng
        employee.save()

        return Response({
            'message': f'Clock-in successful at {clock_in.clock_in_time.strftime("%H:%M:%S")}',
            'clock_in': EmployeeClockInSerializer(clock_in).data,
            'warehouse': employee.warehouse.code if employee.warehouse else None
        })

    @action(detail=False, methods=['post'], url_path='clock-out')
    def clock_out(self, request):
        employee = getattr(request.user, 'employee', None)
        if not employee:
            return Response({'error': 'No employee profile linked to this user'}, status=status.HTTP_400_BAD_REQUEST)

        if not employee.is_clocked_in:
            return Response({'error': 'Employee is not currently clocked in'}, status=status.HTTP_400_BAD_REQUEST)

        clock_in = EmployeeClockIn.objects.filter(employee=employee, clock_out_time__isnull=True).last()
        if not clock_in:
            employee.is_clocked_in = False
            employee.save()
            return Response({'message': 'Clocked out'})

        clock_in.clock_out_time = timezone.now()
        hours = clock_in.calculate_hours()
        clock_in.save()

        employee.is_clocked_in = False
        employee.save()

        return Response({
            'message': f'Clock-out successful. Total shift hours: {hours} hrs.',
            'clock_out': EmployeeClockInSerializer(clock_in).data,
            'warehouse': employee.warehouse.code if employee.warehouse else None
        })

    @action(detail=False, methods=['get'], url_path='dashboard-me')
    def dashboard_me(self, request):
        """Returns progress bar metrics for warehouse floor worker."""
        employee = getattr(request.user, 'employee', None)
        if not employee:
            return Response({'error': 'No employee profile linked to this user'}, status=status.HTTP_400_BAD_REQUEST)

        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_tasks = EmployeeDailyTask.objects.filter(employee=employee, assigned_at__gte=today_start)

        completed_count = today_tasks.filter(status=TaskStatusChoices.COMPLETED).count()
        pending_count = today_tasks.filter(status__in=[TaskStatusChoices.PENDING, TaskStatusChoices.IN_PROGRESS]).count()
        total_items_handled = today_tasks.aggregate(total=Sum('items_handled_count'))['total'] or 0

        # Calculate working hours today
        today_clock_ins = EmployeeClockIn.objects.filter(employee=employee, clock_in_time__gte=today_start)
        total_hours = 0.0
        for c in today_clock_ins:
            if c.clock_out_time:
                total_hours += float(c.total_hours_worked or 0)
            else:
                duration = timezone.now() - c.clock_in_time
                total_hours += round(duration.total_seconds() / 3600.0, 2)

        pick_rate = round(total_items_handled / total_hours, 1) if total_hours > 0 else total_items_handled

        return Response({
            'employee_code': employee.employee_code,
            'department': employee.department,
            'is_clocked_in': employee.is_clocked_in,
            'warehouse': employee.warehouse.code if employee.warehouse else None,
            'tasks_completed_today': completed_count,
            'tasks_pending_today': pending_count,
            'items_handled_today': total_items_handled,
            'working_hours_today': round(total_hours, 2),
            'items_per_hour_rate': pick_rate
        })

    @action(detail=False, methods=['get'], url_path='leaderboard')
    def leaderboard(self, request):
        """Manager Leaderboard: Ranks floor employees by items picked/handled today."""
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        top_performers = EmployeeDailyTask.objects.filter(
            assigned_at__gte=today_start,
            status=TaskStatusChoices.COMPLETED
        ).values(
            'employee__id', 'employee__employee_code', 'employee__user__first_name', 'employee__user__last_name', 'employee__department', 'employee__warehouse'
        ).annotate(
            total_items=Sum('items_handled_count'),
            completed_tasks=Count('id'),
            total_errors=Sum('error_count')
        ).order_by('-total_items')[:10]

        return Response(list(top_performers))

    @action(detail=False, methods=['get'], url_path='payroll-export')
    def payroll_export_csv(self, request):
        """Exports monthly employee performance and payroll CSV."""
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="zippzo_payroll_{timezone.now().strftime("%Y_%m")}.csv"'

        writer = csv.writer(response)
        writer.writerow(['Employee Code', 'Employee Name', 'Department', 'Total Hours Worked', 'Tasks Completed', 'Items Handled', 'Errors Logged'])

        month_start = timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        employees = Employee.objects.all().select_related('user', 'warehouse')

        for emp in employees:
            hours = EmployeeClockIn.objects.filter(employee=emp, clock_in_time__gte=month_start).aggregate(
                total=Sum('total_hours_worked')
            )['total'] or 0.00

            tasks_qs = EmployeeDailyTask.objects.filter(employee=emp, assigned_at__gte=month_start)
            completed_tasks = tasks_qs.filter(status=TaskStatusChoices.COMPLETED).count()
            items_handled = tasks_qs.aggregate(total=Sum('items_handled_count'))['total'] or 0
            errors = tasks_qs.aggregate(total=Sum('error_count'))['total'] or 0

            writer.writerow([
                emp.employee_code,
                emp.user.get_full_name() or emp.user.username,
                emp.department,
                emp.warehouse.code if emp.warehouse else 'N/A',
                float(hours),
                completed_tasks,
                items_handled,
                errors
            ])

        return response
