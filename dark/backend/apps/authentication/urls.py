from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    RegisterView,
    CustomTokenObtainPairView,
    CurrentUserView,
    PendingUsersListView,
    ApproveUserView,
    RejectUserView,
    EmployeeLoginRequestView,
    EmployeeVerifyOtpView,
    LoginApprovalStatusView,
    SendEmailCodeView,
    VerifyEmailCodeView,
    AdminPendingLoginsView,
    AdminApproveLoginView,
    AdminRejectLoginView,
)

urlpatterns = [
    path('register/', RegisterView.as_view(), name='auth_register'),
    path('login/', CustomTokenObtainPairView.as_view(), name='auth_login'),
    path('token/refresh/', TokenRefreshView.as_view(), name='auth_token_refresh'),
    path('me/', CurrentUserView.as_view(), name='auth_me'),
    
    # Passwordless Email OTP Verification Workflow
    path('send-code/', SendEmailCodeView.as_view(), name='auth_send_code'),
    path('verify-code/', VerifyEmailCodeView.as_view(), name='auth_verify_code'),
    
    # Employee OTP & Login Approval workflow
    path('employee-login-request/', EmployeeLoginRequestView.as_view(), name='employee_login_request'),
    path('employee-verify-otp/', EmployeeVerifyOtpView.as_view(), name='employee_verify_otp'),
    path('login-approval-status/<uuid:request_id>/', LoginApprovalStatusView.as_view(), name='login_approval_status'),
    
    # Admin approval endpoints
    path('admin/pending-users/', PendingUsersListView.as_view(), name='admin_pending_users'),
    path('admin/users/<int:user_id>/approve/', ApproveUserView.as_view(), name='admin_approve_user'),
    path('admin/users/<int:user_id>/reject/', RejectUserView.as_view(), name='admin_reject_user'),
    path('admin/pending-logins/', AdminPendingLoginsView.as_view(), name='admin_pending_logins'),
    path('admin/logins/<uuid:request_id>/approve/', AdminApproveLoginView.as_view(), name='admin_approve_login'),
    path('admin/logins/<uuid:request_id>/reject/', AdminRejectLoginView.as_view(), name='admin_reject_login'),
]
