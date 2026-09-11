from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status
from apps.authentication.models import UserProfile, UserRole, LoginApprovalRequest

class EmployeeOTPAuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # 1. Create Admin User
        self.admin_user = User.objects.create_user(
            username='admin_test',
            password='Password123!',
            email='admin@zippzo.test',
            first_name='Admin',
            last_name='Supervisor',
            is_superuser=True
        )
        UserProfile.objects.create(
            user=self.admin_user,
            is_approved_by_admin=True,
            approval_status='approved'
        )
        UserRole.objects.create(user=self.admin_user, role='admin')

        # 2. Create Floor Employee (Picker)
        self.employee_user = User.objects.create_user(
            username='picker_test',
            password='Password123!',
            email='picker@zippzo.test',
            first_name='Rahul',
            last_name='Sharma'
        )
        UserProfile.objects.create(
            user=self.employee_user,
            is_approved_by_admin=True,
            approval_status='approved'
        )
        UserRole.objects.create(user=self.employee_user, role='picker')

    def test_admin_direct_login(self):
        """Admin/Manager login should bypass OTP and return JWT tokens immediately"""
        res = self.client.post('/api/v1/auth/login/', {
            'username': 'admin_test',
            'password': 'Password123!'
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)
        self.assertEqual(res.data['user']['username'], 'admin_test')

    def test_floor_employee_login_request_generates_otp(self):
        """Floor employee login should trigger OTP generation and return requires_admin_approval"""
        res = self.client.post('/api/v1/auth/employee-login-request/', {
            'username': 'picker_test',
            'password': 'Password123!'
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['requires_admin_approval'])
        self.assertTrue(res.data['request_id'])
        self.assertEqual(len(res.data['otp_hint']), 6)

        # Verify record created in DB
        req = LoginApprovalRequest.objects.get(id=res.data['request_id'])
        self.assertEqual(req.user, self.employee_user)
        self.assertEqual(req.status, 'pending')

    def test_employee_verify_valid_otp(self):
        """Entering the valid OTP should approve the session and issue JWT tokens"""
        # Step 1: Employee requests login
        req_res = self.client.post('/api/v1/auth/employee-login-request/', {
            'username': 'picker_test',
            'password': 'Password123!'
        })
        request_id = req_res.data['request_id']
        req = LoginApprovalRequest.objects.get(id=request_id)
        otp = req.otp_code

        # Step 2: Employee submits valid OTP
        verify_res = self.client.post('/api/v1/auth/employee-verify-otp/', {
            'request_id': request_id,
            'otp_code': otp
        })
        self.assertEqual(verify_res.status_code, status.HTTP_200_OK)
        self.assertEqual(verify_res.data['status'], 'approved')
        self.assertIn('tokens', verify_res.data)
        self.assertIn('access', verify_res.data['tokens'])

        # DB status should be updated to approved
        req.refresh_from_db()
        self.assertEqual(req.status, 'approved')

    def test_employee_verify_invalid_otp(self):
        """Entering incorrect OTP should return 400 Bad Request"""
        req_res = self.client.post('/api/v1/auth/employee-login-request/', {
            'username': 'picker_test',
            'password': 'Password123!'
        })
        request_id = req_res.data['request_id']

        verify_res = self.client.post('/api/v1/auth/employee-verify-otp/', {
            'request_id': request_id,
            'otp_code': '000000' # Wrong code
        })
        self.assertEqual(verify_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Invalid OTP code', verify_res.data['error'])

    def test_admin_approve_login_and_status_polling(self):
        """Admin approving the login request should allow the employee polling to receive tokens"""
        # Step 1: Employee requests login
        req_res = self.client.post('/api/v1/auth/employee-login-request/', {
            'username': 'picker_test',
            'password': 'Password123!'
        })
        request_id = req_res.data['request_id']

        # Step 2: Employee polls before approval -> status should be pending
        poll_res1 = self.client.get(f'/api/v1/auth/login-approval-status/{request_id}/')
        self.assertEqual(poll_res1.status_code, status.HTTP_200_OK)
        self.assertEqual(poll_res1.data['status'], 'pending')

        # Step 3: Admin authenticates and approves the request
        admin_login = self.client.post('/api/v1/auth/login/', {
            'username': 'admin_test',
            'password': 'Password123!'
        })
        admin_token = admin_login.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {admin_token}')

        approve_res = self.client.post(f'/api/v1/auth/admin/logins/{request_id}/approve/')
        self.assertEqual(approve_res.status_code, status.HTTP_200_OK)

        # Step 4: Employee polls again (unauthenticated) -> status should now be approved with tokens
        self.client.credentials() # Clear auth credentials
        poll_res2 = self.client.get(f'/api/v1/auth/login-approval-status/{request_id}/')
        self.assertEqual(poll_res2.status_code, status.HTTP_200_OK)
        self.assertEqual(poll_res2.data['status'], 'approved')
        self.assertIn('tokens', poll_res2.data)
        self.assertIn('access', poll_res2.data['tokens'])

    def test_admin_reject_login(self):
        """Admin rejecting the login request should notify the employee on status poll"""
        req_res = self.client.post('/api/v1/auth/employee-login-request/', {
            'username': 'picker_test',
            'password': 'Password123!'
        })
        request_id = req_res.data['request_id']

        # Admin rejects
        admin_login = self.client.post('/api/v1/auth/login/', {
            'username': 'admin_test',
            'password': 'Password123!'
        })
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {admin_login.data['access']}")
        reject_res = self.client.post(f'/api/v1/auth/admin/logins/{request_id}/reject/')
        self.assertEqual(reject_res.status_code, status.HTTP_200_OK)

        # Employee poll
        self.client.credentials()
        poll_res = self.client.get(f'/api/v1/auth/login-approval-status/{request_id}/')
        self.assertEqual(poll_res.status_code, status.HTTP_200_OK)
        self.assertEqual(poll_res.data['status'], 'rejected')
