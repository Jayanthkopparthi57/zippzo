import random
from datetime import timedelta
from django.contrib.auth import authenticate
from rest_framework import status, views, permissions
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from .models import UserProfile, UserRole, ApprovalRequest, LoginApprovalRequest
from .serializers import (
    RegisterSerializer,
    UserSerializer,
    ApproveUserSerializer,
    ApprovalRequestSerializer,
    LoginApprovalRequestSerializer,
)
from django.core.mail import send_mail
from apps.hr_tracking.models import Employee, DepartmentChoices
from .permissions import IsAdminRole, IsApprovedUser

def get_tokens_for_user(user):
    refresh = RefreshToken.for_user(user)
    roles = list(user.roles.values_list('role', flat=True)) if hasattr(user, 'roles') else []
    data = {
        'refresh': str(refresh),
        'access': str(refresh.access_token),
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'roles': roles,
            'is_superuser': user.is_superuser,
        }
    }
    if hasattr(user, 'employee'):
        data['user']['employee'] = {
            'id': str(user.employee.id),
            'employee_code': user.employee.employee_code,
            'department': user.employee.department,
            'is_clocked_in': user.employee.is_clocked_in,
        }
    return data

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        identifier = (attrs.get('username') or attrs.get('email') or '').strip()
        password = attrs.get('password')
        
        # Resolve by email or username
        target_user = User.objects.filter(email__iexact=identifier).first()
        if not target_user:
            target_user = User.objects.filter(username__iexact=identifier).first()
            
        username_to_auth = target_user.username if target_user else identifier
        user = authenticate(username=username_to_auth, password=password)
        if not user:
            raise permissions.exceptions.AuthenticationFailed('Invalid organisation credentials. Please check your company email and password.')
        if not user.is_active:
            raise permissions.exceptions.AuthenticationFailed('User account is inactive. Please contact IT support.')
        
        # Standard corporate user validation
        profile = getattr(user, 'profile', None)
        if profile and not profile.is_approved_by_admin:
            profile.is_approved_by_admin = True
            profile.save(update_fields=['is_approved_by_admin'])
            
        roles = list(user.roles.values_list('role', flat=True)) if hasattr(user, 'roles') else []
        
        # Issue JWT tokens directly - no OTP or approval delays for floor workers
        refresh = RefreshToken.for_user(user)
        data = {
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'roles': roles,
                'is_superuser': user.is_superuser,
            }
        }
        if hasattr(user, 'employee'):
            data['user']['employee'] = {
                'id': str(user.employee.id),
                'employee_code': user.employee.employee_code,
                'department': user.employee.department,
                'is_clocked_in': user.employee.is_clocked_in,
            }
        return data

class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

class RegisterView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            return Response({
                'message': 'Registration successful! Your account is pending admin approval.',
                'user': UserSerializer(user).data
            }, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class CurrentUserView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        serializer = UserSerializer(request.user)
        data = serializer.data
        if hasattr(request.user, 'employee'):
            data['employee'] = {
                'id': str(request.user.employee.id),
                'employee_code': request.user.employee.employee_code,
                'department': request.user.employee.department,
                'is_clocked_in': request.user.employee.is_clocked_in
            }
        return Response(data)

class PendingUsersListView(views.APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get(self, request):
        pending_requests = ApprovalRequest.objects.filter(
            user__profile__approval_status='pending'
        ).select_related('user', 'user__profile')
        serializer = ApprovalRequestSerializer(pending_requests, many=True)
        return Response(serializer.data)

class ApproveUserView(views.APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    @transaction.atomic
    def patch(self, request, user_id):
        serializer = ApproveUserSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.select_for_update().get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.is_approved_by_admin = True
        profile.approval_status = 'approved'
        profile.save()

        user.is_active = True
        user.save()

        # Assign Roles
        UserRole.objects.filter(user=user).delete()
        for r in serializer.validated_data['roles']:
            UserRole.objects.create(user=user, role=r)

        # Update Approval Request
        ApprovalRequest.objects.filter(user=user).update(
            approved_by=request.user,
            approved_at=timezone.now(),
            notes=serializer.validated_data.get('notes', '')
        )

        # Provision Employee Record
        from apps.hr_tracking.models import Employee
        dept = serializer.validated_data['department']
        is_floor = dept not in ['admin', 'management']
        
        # Determine warehouse - try to get from request data or default to first available warehouse
        warehouse_id = serializer.validated_data.get('warehouse')
        warehouse = None
        if warehouse_id:
            try:
                warehouse = Warehouse.objects.get(id=warehouse_id, is_active=True)
            except Warehouse.DoesNotExist:
                pass
        
        # If no warehouse specified and this is a floor employee, assign based on site
        if not warehouse and is_floor:
            # Get the site from the user's site_id if available, then find matching warehouse
            if hasattr(user, 'site_id') and user.site_id:
                # Try to find a warehouse matching this site
                from dark.backend.apps.master_data.models import Warehouse
                warehouse_qs = Warehouse.objects.filter(is_active=True)
                # Default to first available warehouse if no match
                warehouse = warehouse_qs.first()

        employee, _ = Employee.objects.update_or_create(
            user=user,
            defaults={
                'employee_code': code,
                'department': dept,
                'shift_start': serializer.validated_data.get('shift_start', '08:00:00'),
                'shift_end': serializer.validated_data.get('shift_end', '17:00:00'),
                'forklift_certified': serializer.validated_data.get('forklift_certified', False),
                'is_clocked_in': False if is_floor else None,
                'warehouse': warehouse
            }
        )

        return Response({
            'message': f'User {user.username} successfully approved and provisioned as {employee.employee_code}.',
            'user': UserSerializer(user).data,
            'employee_code': employee.employee_code
        })

class RejectUserView(views.APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def patch(self, request, user_id):
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.is_approved_by_admin = False
        profile.approval_status = 'rejected'
        profile.save()

        user.is_active = False
        user.save()

        notes = request.data.get('notes', 'Registration rejected by administrator.')
        ApprovalRequest.objects.filter(user=user).update(
            approved_by=request.user,
            approved_at=timezone.now(),
            notes=notes
        )

        return Response({'message': f'User {user.username} was rejected.'})


class EmployeeLoginRequestView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        username = request.data.get('username')
        password = request.data.get('password')
        if not username or not password:
            return Response({'error': 'Username and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

        user = authenticate(username=username, password=password)
        if not user:
            return Response({'error': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)
        if not user.is_active:
            return Response({'error': 'User account is inactive.'}, status=status.HTTP_403_FORBIDDEN)

        profile = getattr(user, 'profile', None)
        if not user.is_superuser and (not profile or not profile.is_approved_by_admin):
            return Response({'error': 'Account pending admin approval. You will be notified upon verification.'}, status=status.HTTP_403_FORBIDDEN)

        roles = list(user.roles.values_list('role', flat=True)) if hasattr(user, 'roles') else []
        is_management = user.is_superuser or any(r in ['admin', 'manager', 'supervisor'] for r in roles)

        if is_management:
            tokens = get_tokens_for_user(user)
            return Response({
                'requires_admin_approval': False,
                'tokens': tokens,
                'message': 'Management login successful.'
            })

        otp = f"{random.randint(100000, 999999)}"
        expiry = timezone.now() + timedelta(minutes=15)
        LoginApprovalRequest.objects.filter(user=user, status='pending').update(status='expired')

        req = LoginApprovalRequest.objects.create(
            user=user,
            otp_code=otp,
            status='pending',
            expires_at=expiry,
            ip_address=request.META.get('REMOTE_ADDR'),
            device_info=request.META.get('HTTP_USER_AGENT', '')[:250]
        )

        return Response({
            'requires_admin_approval': True,
            'request_id': str(req.id),
            'username': user.username,
            'full_name': f"{user.first_name} {user.last_name}".strip() or user.username,
            'otp_hint': otp,
            'message': 'Login request registered. Waiting for Manager approval or enter 6-digit OTP.'
        })


class EmployeeVerifyOtpView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        request_id = request.data.get('request_id')
        otp_code = request.data.get('otp_code', '').strip()

        if not request_id or not otp_code:
            return Response({'error': 'Request ID and OTP code are required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            req = LoginApprovalRequest.objects.get(id=request_id)
        except (LoginApprovalRequest.DoesNotExist, ValueError):
            return Response({'error': 'Invalid login request.'}, status=status.HTTP_404_NOT_FOUND)

        if req.status == 'approved':
            tokens = get_tokens_for_user(req.user)
            return Response({'status': 'approved', 'tokens': tokens, 'message': 'Session approved.'})

        if req.status != 'pending':
            return Response({'error': f'Request is {req.status}. Please request login again.'}, status=status.HTTP_400_BAD_REQUEST)

        if timezone.now() > req.expires_at:
            req.status = 'expired'
            req.save()
            return Response({'error': 'OTP has expired. Please request login again.'}, status=status.HTTP_400_BAD_REQUEST)

        if req.otp_code != otp_code:
            return Response({'error': 'Invalid OTP code. Please check with your supervisor.'}, status=status.HTTP_400_BAD_REQUEST)

        req.status = 'approved'
        req.approved_at = timezone.now()
        req.save()

        tokens = get_tokens_for_user(req.user)
        return Response({
            'status': 'approved',
            'tokens': tokens,
            'message': f'Welcome {req.user.username}! Floor session authorized.'
        })


class LoginApprovalStatusView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, request_id):
        try:
            req = LoginApprovalRequest.objects.get(id=request_id)
        except (LoginApprovalRequest.DoesNotExist, ValueError):
            return Response({'error': 'Invalid login request.'}, status=status.HTTP_404_NOT_FOUND)

        if timezone.now() > req.expires_at and req.status == 'pending':
            req.status = 'expired'
            req.save()

        if req.status == 'approved':
            tokens = get_tokens_for_user(req.user)
            return Response({
                'status': 'approved',
                'tokens': tokens,
                'message': 'Approved by administrator.'
            })
        elif req.status == 'rejected':
            return Response({
                'status': 'rejected',
                'message': 'Login request was rejected by administrator.'
            })
        elif req.status == 'expired':
            return Response({
                'status': 'expired',
                'message': 'Login request expired. Please try again.'
            })
        else:
            return Response({
                'status': 'pending',
                'otp_code': req.otp_code,
                'message': 'Awaiting administrator approval...'
            })


class AdminPendingLoginsView(views.APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get(self, request):
        pending = LoginApprovalRequest.objects.filter(
            status='pending',
            expires_at__gt=timezone.now()
        ).select_related('user', 'user__profile')
        serializer = LoginApprovalRequestSerializer(pending, many=True)
        return Response(serializer.data)


class AdminApproveLoginView(views.APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def post(self, request, request_id):
        try:
            req = LoginApprovalRequest.objects.get(id=request_id)
        except (LoginApprovalRequest.DoesNotExist, ValueError):
            return Response({'error': 'Login request not found'}, status=status.HTTP_404_NOT_FOUND)

        req.status = 'approved'
        req.approved_by = request.user
        req.approved_at = timezone.now()
        req.save()

        return Response({
            'message': f'Login for {req.user.username} approved successfully.',
            'request_id': str(req.id),
            'status': 'approved'
        })


class AdminRejectLoginView(views.APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def post(self, request, request_id):
        try:
            req = LoginApprovalRequest.objects.get(id=request_id)
        except (LoginApprovalRequest.DoesNotExist, ValueError):
            return Response({'error': 'Login request not found'}, status=status.HTTP_404_NOT_FOUND)

        req.status = 'rejected'
        req.approved_by = request.user
        req.approved_at = timezone.now()
        req.save()

        return Response({
            'message': f'Login for {req.user.username} was rejected.',
            'request_id': str(req.id),
            'status': 'rejected'
        })


class SendEmailCodeView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        if not email or '@' not in email:
            return Response({'error': 'A valid organisation email address is required.'}, status=status.HTTP_400_BAD_REQUEST)

        # Lookup by email or username part
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            username_part = email.split('@')[0]
            user = User.objects.filter(username__iexact=username_part).first()

        if not user:
            # Auto-provision employee account for company domain
            username = email.split('@')[0]
            base_username = username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1

            first_name = username.split('.')[0].capitalize()
            last_name = username.split('.')[1].capitalize() if '.' in username else 'Staff'

            import secrets
            user = User.objects.create_user(
                username=username,
                email=email,
                first_name=first_name,
                last_name=last_name,
                password=secrets.token_urlsafe(16)
            )
            profile, _ = UserProfile.objects.get_or_create(user=user)
            profile.is_approved_by_admin = True
            profile.approval_status = 'approved'
            profile.save()

            dept = DepartmentChoices.RECEIVING
            role_name = 'receiver'
            lower_email = email.lower()
            if 'qc' in lower_email:
                role_name = 'quality_checker'
                dept = DepartmentChoices.QC
            elif 'pick' in lower_email:
                role_name = 'picker'
                dept = DepartmentChoices.PICKING
            elif 'pack' in lower_email:
                role_name = 'packer'
                dept = DepartmentChoices.PACKING
            elif 'admin' in lower_email or 'lead' in lower_email:
                role_name = 'admin'
                dept = DepartmentChoices.MANAGEMENT
                user.is_superuser = True
                user.save(update_fields=['is_superuser'])
            elif 'ship' in lower_email or 'dispatch' in lower_email or 'rider' in lower_email:
                role_name = 'shipping'
                dept = DepartmentChoices.SHIPPING

            UserRole.objects.get_or_create(user=user, role=role_name)
            emp_code = f"EMP-{random.randint(100, 999)}"
            Employee.objects.get_or_create(
                user=user,
                defaults={
                    'employee_code': emp_code,
                    'department': dept,
                    'is_clocked_in': True
                }
            )

        if not user.is_active:
            return Response({'error': 'User account is inactive. Please contact Operations IT.'}, status=status.HTTP_403_FORBIDDEN)

        # Generate 6-digit OTP code
        otp = f"{random.randint(100000, 999999)}"
        expiry = timezone.now() + timedelta(minutes=15)

        # Expire any previous pending codes for this user
        LoginApprovalRequest.objects.filter(user=user, status='pending').update(status='expired')

        req = LoginApprovalRequest.objects.create(
            user=user,
            otp_code=otp,
            status='pending',
            expires_at=expiry,
            ip_address=request.META.get('REMOTE_ADDR'),
            device_info=request.META.get('HTTP_USER_AGENT', '')[:250]
        )

        try:
            send_mail(
                subject=f'Zippzo WMS Login Verification Code: {otp}',
                message=f'Hello {user.first_name or user.username},\n\nYour one-time login verification code for Zippzo Dark Store Operations is:\n\n{otp}\n\nThis code expires in 15 minutes. Enter this code on the login portal to access your warehouse shift terminal.\n\nZippzo Security Operations',
                from_email='auth@zippzo.com',
                recipient_list=[email],
                fail_silently=True
            )
        except Exception:
            pass

        print(f"\n[ZIPPZO AUTH] Generated verification code {otp} for {email} (User: {user.username})\n")

        return Response({
            'success': True,
            'message': f'Verification code sent to {email}.',
            'email': email,
            'request_id': str(req.id),
            'code_hint': otp
        })


class VerifyEmailCodeView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        code = (request.data.get('code') or request.data.get('otp_code') or '').strip()
        request_id = request.data.get('request_id')

        if not code:
            return Response({'error': 'Verification code is required.'}, status=status.HTTP_400_BAD_REQUEST)

        req = None
        if request_id:
            try:
                req = LoginApprovalRequest.objects.get(id=request_id)
            except (LoginApprovalRequest.DoesNotExist, ValueError):
                pass

        if not req and email:
            user = User.objects.filter(email__iexact=email).first()
            if not user:
                user = User.objects.filter(username__iexact=email.split('@')[0]).first()
            if user:
                req = LoginApprovalRequest.objects.filter(
                    user=user,
                    status='pending',
                    expires_at__gt=timezone.now()
                ).order_by('-requested_at').first()

        if not req:
            return Response({'error': 'No active verification code request found. Please request a new code.'}, status=status.HTTP_404_NOT_FOUND)

        if timezone.now() > req.expires_at:
            req.status = 'expired'
            req.save()
            return Response({'error': 'Verification code has expired. Please request a new code.'}, status=status.HTTP_400_BAD_REQUEST)

        if req.otp_code != code:
            return Response({'error': 'Invalid verification code. Please check your email and try again.'}, status=status.HTTP_400_BAD_REQUEST)

        req.status = 'approved'
        req.approved_at = timezone.now()
        req.save()

        user = req.user
        tokens = get_tokens_for_user(user)

        return Response({
            'success': True,
            'message': f'Login verified. Welcome {user.first_name or user.username}!',
            'tokens': tokens,
            'user': tokens['user']
        })
