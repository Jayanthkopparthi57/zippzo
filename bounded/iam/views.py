from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from bounded.iam.permissions import IsAdminUser
from rest_framework.views import APIView
from django.contrib.auth.hashers import check_password
from django.utils import timezone
from .authentication.jwt import generate_jwt_token
from .models import User, Session, Role, Device, QRCode, IdempotencyKey
from .serializers import UserSerializer, SessionSerializer, RoleSerializer, DeviceSerializer, QRCodeSerializer, IdempotencyKeySerializer


# Which console each role logs into.
#
# This used to collapse every non-WMS role into DARK_STORE, so a RIDER login
# landed in the dark-store menu and the rider app was unreachable code, and a
# CUSTOMER was handed a store console. Each role now has its own front door.
WMS_ROLES = ('SUPER_ADMIN', 'OPS_MANAGER', 'WAREHOUSE_STAFF')
SHOPPER_ROLES = ('CUSTOMER', 'SENDER')
RIDER_ROLES = ('RIDER',)


def target_app_for(role):
    if role in RIDER_ROLES:
        return 'RIDER'
    if role in SHOPPER_ROLES:
        return 'SHOPPER'
    if role in WMS_ROLES:
        return 'WMS'
    return 'DARK_STORE'


class LoginAPIView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = request.data.get('email')
        password = request.data.get('password')
        if not email or not password:
            return Response({'error': 'Email and password required'}, status=400)
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response({'error': 'Invalid credentials'}, status=401)
        if not check_password(password, user.password_hash):
            return Response({'error': 'Invalid credentials'}, status=401)
        if user.status == 'BLOCKED':
            return Response({'error': 'User blocked'}, status=403)
        if user.status != 'ACTIVE':
            return Response({'error': f'Account is {user.status.lower()}'}, status=403)
        user.last_login_at = timezone.now()
        user.failed_login_attempts = 0
        user.save(update_fields=['last_login_at', 'failed_login_attempts', 'updated_at'])
        return Response({
            'status': 'success',
            'user': {
                'user_id': str(user.user_id),
                'email': user.email,
                'full_name': user.full_name,
                'role': user.role,
                'status': user.status,
            },
            'facility': {'code': user.email.split('@')[0].upper()},
            'target_app': target_app_for(user.role),
            'token': generate_jwt_token(user.user_id, user.role),
        })


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]

    def list(self, request):
        users = User.objects.all()
        serializer = UserSerializer(users, many=True)
        return Response(serializer.data)

    def retrieve(self, request, pk=None):
        user = self.get_object()
        serializer = UserSerializer(user)
        return Response(serializer.data)


class SessionViewSet(viewsets.ModelViewSet):
    queryset = Session.objects.all()
    serializer_class = SessionSerializer
    permission_classes = [IsAuthenticated]

    def list(self, request):
        sessions = Session.objects.filter(user=request.user)
        serializer = SessionSerializer(sessions, many=True)
        return Response(serializer.data)


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated]


class DeviceViewSet(viewsets.ModelViewSet):
    queryset = Device.objects.all()
    serializer_class = DeviceSerializer
    permission_classes = [IsAuthenticated]

    def list(self, request):
        devices = Device.objects.filter(user=request.user)
        serializer = DeviceSerializer(devices, many=True)
        return Response(serializer.data)


class QRCodeViewSet(viewsets.ModelViewSet):
    queryset = QRCode.objects.all()
    serializer_class = QRCodeSerializer
    permission_classes = [IsAuthenticated]


class IdempotencyKeyViewSet(viewsets.ModelViewSet):
    queryset = IdempotencyKey.objects.all()
    serializer_class = IdempotencyKeySerializer
    permission_classes = [IsAuthenticated]
