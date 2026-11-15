import uuid
from datetime import datetime, timedelta

import jwt
from django.conf import settings
from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


class JWTAuthentication(BaseAuthentication):
    """Session-backed JWT authentication.

    The token is only a pointer. Every request re-reads the `iam.Session` row,
    so logout, device loss, refresh-token rotation and assignment revocation
    take effect immediately instead of waiting for a stateless JWT to expire.
    """

    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            return None

        token = auth_header.split('Bearer ', 1)[1].strip()
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=['HS256'])
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed('Token expired')
        except jwt.InvalidTokenError:
            raise AuthenticationFailed('Invalid token')

        user_id = payload.get('user_id')
        session_id = payload.get('sid')
        jti = payload.get('jti')
        if not user_id or not session_id or not jti:
            raise AuthenticationFailed('Invalid token')

        from bounded.iam.models import Session, User
        from bounded.network.models import EmployeeSiteAssignment

        try:
            user = User.objects.get(user_id=user_id)
        except (User.DoesNotExist, ValueError):
            raise AuthenticationFailed('User not found')
        if user.status != 'ACTIVE':
            raise AuthenticationFailed('Account is not active')

        now = timezone.now()
        session = (
            Session.objects.select_related('facility')
            .filter(session_id=session_id, user=user, is_active=True,
                    revoked_at__isnull=True, expires_at__gt=now)
            .first()
        )
        if session is None:
            raise AuthenticationFailed('Session expired or revoked')
        if session.token != jti:
            # A refresh rotated the access-token id; the old token is dead.
            raise AuthenticationFailed('Token superseded')

        facility = session.facility
        if facility is not None:
            if facility.status != 'ACTIVE':
                raise AuthenticationFailed('Facility is not active')
            if user.role not in ('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER'):
                assigned = EmployeeSiteAssignment.objects.filter(
                    user=user, site=facility, is_active=True,
                ).exists()
                if not assigned:
                    # Assignment removed while the session was open.
                    Session.objects.filter(session_id=session.session_id).update(
                        is_active=False, revoked_at=now,
                    )
                    raise AuthenticationFailed('Facility assignment revoked')

        # Avoid a write on every request; five-minute resolution is enough for
        # "when was this session last used" and keeps the hot path cheap.
        if session.last_used_at is None or (now - session.last_used_at).total_seconds() > 300:
            Session.objects.filter(session_id=session.session_id).update(last_used_at=now)

        # Attributes read by facility/surface permission helpers.
        user.session = session
        user.active_facility = facility
        return (user, payload)

    def authenticate_header(self, request):
        return 'Bearer'


def generate_jwt_token(user_id, role='STAFF', exp_hours=15, *, session_id=None,
                       surface='web', jti=None, exp_minutes=None):
    """Generate a session-bound access token.

    `session_id` and `jti` are required for operation; the defaults exist only
    so old call sites fail closed at authentication (a token without `sid`
    cannot pass `JWTAuthentication`).
    """
    now = datetime.utcnow()
    exp = now + (timedelta(minutes=exp_minutes) if exp_minutes
                 else timedelta(hours=exp_hours))
    payload = {
        'user_id': str(user_id),
        'role': role,
        'sid': str(session_id) if session_id else None,
        'jti': jti or uuid.uuid4().hex,
        'surf': surface,
        'exp': exp,
        'iat': now,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm='HS256')


class JWTOpenApiAuthenticationExtension(OpenApiAuthenticationExtension):
    """Describe our Bearer scheme to drf-spectacular."""

    target_class = 'bounded.iam.authentication.jwt.JWTAuthentication'
    name = 'bearerAuth'

    def get_security_definition(self, auto_schema):
        return {
            'type': 'apiKey',
            'in': 'header',
            'name': 'Authorization',
            'description': 'Short-lived staff access token, prefixed with `Bearer `.',
        }
