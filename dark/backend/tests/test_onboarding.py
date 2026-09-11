from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status
from apps.authentication.models import UserProfile, UserRole, ApprovalRequest
from apps.hr_tracking.models import Employee

class UserOnboardingGateTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser('admin_user', 'admin@zippzo.com', 'AdminPass123')
        UserProfile.objects.create(user=self.admin, is_approved_by_admin=True, approval_status='approved')
        UserRole.objects.create(user=self.admin, role='admin')

    def test_registration_and_admin_approval_creates_employee(self):
        # 1. Register new applicant
        reg_response = self.client.post('/api/v1/auth/register/', {
            'username': 'john_picker',
            'email': 'john@zippzo.com',
            'password': 'PickerPass123',
            'first_name': 'John',
            'last_name': 'Doe'
        })
        self.assertEqual(reg_response.status_code, status.HTTP_201_CREATED)
        
        user = User.objects.get(username='john_picker')
        self.assertFalse(user.is_active)
        self.assertFalse(user.profile.is_approved_by_admin)
        self.assertEqual(user.profile.approval_status, 'pending')

        # 2. Login fails before admin approval
        login_fail = self.client.post('/api/v1/auth/login/', {
            'username': 'john_picker',
            'password': 'PickerPass123'
        })
        self.assertEqual(login_fail.status_code, status.HTTP_401_UNAUTHORIZED)

        # 3. Admin approves applicant with department='picking'
        self.client.force_authenticate(user=self.admin)
        approve_resp = self.client.patch(f'/api/v1/auth/admin/users/{user.id}/approve/', {
            'department': 'picking',
            'roles': ['picker'],
            'forklift_certified': True
        })
        self.assertEqual(approve_resp.status_code, status.HTTP_200_OK)

        # 4. Verify employee auto-provisioned with EMP code
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertTrue(user.profile.is_approved_by_admin)
        
        employee = Employee.objects.get(user=user)
        self.assertTrue(employee.employee_code.startswith('EMP-'))
        self.assertEqual(employee.department, 'picking')
        self.assertFalse(employee.is_clocked_in)
