from django.contrib.auth import authenticate, get_user_model
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .auth_models import AuthSession

def create_session_for_user(user):
    session = AuthSession.create_for_email(user.email)
    session.user_name = user.get_full_name() or user.email.split('@')[0]
    session.user_role = 'ADMIN' if user.is_staff else 'SUPERVISOR'
    session.save(update_fields=['user_name', 'user_role'])
    return session


class RegisterView(APIView):
    """Create an email/password account and return an authenticated session."""

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        password = request.data.get('password') or ''
        name = (request.data.get('name') or '').strip()

        if not email or '@' not in email:
            return Response({'error': 'A valid email address is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(password) < 8:
            return Response({'error': 'Password must be at least 8 characters.'}, status=status.HTTP_400_BAD_REQUEST)
        User = get_user_model()
        if User.objects.filter(username=email).exists():
            return Response({'error': 'An account with this email already exists.'}, status=status.HTTP_409_CONFLICT)

        user = User.objects.create_user(username=email, email=email, password=password)
        user.first_name = name
        user.save(update_fields=['first_name'])
        session = create_session_for_user(user)
        return Response({
            'success': True,
            'token': session.token,
            'user': {'email': user.email, 'name': session.user_name, 'role': session.user_role},
        }, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    """Authenticate an account with email and password."""

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        password = request.data.get('password') or ''
        user = authenticate(request, username=email, password=password)
        if not user:
            return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        session = create_session_for_user(user)
        return Response({
            'success': True,
            'token': session.token,
            'user': {'email': user.email, 'name': session.user_name, 'role': session.user_role},
        })


class CurrentUserView(APIView):
    """Return the currently authenticated user's info."""

    def get(self, request):
        token = request.headers.get('Authorization', '').replace('Token ', '').strip()
        if not token:
            return Response(
                {'error': 'Not authenticated.'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        session = AuthSession.objects.filter(token=token, is_active=True).first()
        if not session:
            return Response(
                {'error': 'Invalid or expired session.'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        return Response({
            'email': session.email,
            'name': session.user_name,
            'role': session.user_role,
        })


class LogoutView(APIView):
    """Invalidate the current session."""

    def post(self, request):
        token = request.headers.get('Authorization', '').replace('Token ', '').strip()
        if token:
            AuthSession.objects.filter(token=token).update(is_active=False)
        return Response({'success': True, 'message': 'Logged out.'})
