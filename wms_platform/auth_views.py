import logging

from django.conf import settings
from django.core.mail import send_mail
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .auth_models import AuthOtp, AuthSession

logger = logging.getLogger(__name__)


class SendOtpView(APIView):
    """Send a 6-digit OTP to the given email address."""

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        if not email or '@' not in email:
            return Response(
                {'error': 'A valid email address is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        otp = AuthOtp.create_for_email(email)

        subject = f'Zippzo WMS - Login Code: {otp.code}'
        body = (
            f'Your Zippzo WMS login verification code is:\n\n'
            f'    {otp.code}\n\n'
            f'This code expires in 15 minutes.\n\n'
            f'— Zippzo Operations'
        )

        email_delivered = False
        try:
            send_mail(
                subject=subject,
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                fail_silently=False,
            )
            email_delivered = True
        except Exception as exc:
            logger.exception('Failed to send OTP email to %s', email)
            print(f"\n{'='*50}")
            print(f"  ZIPPZO WMS LOGIN CODE (email delivery failed)")
            print(f"  Email: {email}")
            print(f"  Code:  {otp.code}")
            print(f"  Error: {exc}")
            print(f"{'='*50}\n")

            if not settings.DEBUG:
                return Response(
                    {
                        'error': (
                            'Could not send verification email. '
                            'Check SMTP settings or try again shortly.'
                        ),
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )

        if email_delivered:
            message = f'Verification code sent to {email}. Check your inbox (and spam).'
        else:
            message = (
                f'Email delivery failed (check Gmail app password in .env). '
                f'OTP printed in Django server terminal for {email}.'
            )

        return Response({
            'success': True,
            'message': message,
            'email': email,
            'email_delivered': email_delivered,
        })


class VerifyOtpView(APIView):
    """Verify a 6-digit OTP and return a session token."""

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        code = (request.data.get('code') or '').strip()

        if not email or not code:
            return Response(
                {'error': 'Email and verification code are required.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Find the most recent unused OTP for this email
        otp = AuthOtp.objects.filter(
            email=email,
            is_used=False,
        ).order_by('-created_at').first()

        if not otp:
            return Response(
                {'error': 'No active verification code found. Please request a new one.'},
                status=status.HTTP_404_NOT_FOUND
            )

        if otp.is_expired:
            otp.is_used = True
            otp.save(update_fields=['is_used'])
            return Response(
                {'error': 'Verification code has expired. Please request a new one.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if otp.code != code:
            return Response(
                {'error': 'Invalid verification code. Please check and try again.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Mark OTP as used
        otp.is_used = True
        otp.save(update_fields=['is_used'])

        # Create session
        session = AuthSession.create_for_email(email)

        return Response({
            'success': True,
            'message': f'Login verified. Welcome!',
            'token': session.token,
            'user': {
                'email': session.email,
                'name': session.user_name,
                'role': session.user_role,
            }
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
