import jwt
from datetime import datetime, timedelta
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.authentication import BaseAuthentication
from django.conf import settings
from drf_spectacular.extensions import OpenApiAuthenticationExtension


class JWTAuthentication(BaseAuthentication):
    """JWT-based authentication for Zippzo platform."""

    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            return None

        token = auth_header.split('Bearer ')[1].strip()
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=['HS256'])
            user_id = payload.get('user_id')
            if not user_id:
                raise AuthenticationFailed('Invalid token')
            from bounded.iam.models import User
            user = User.objects.get(user_id=user_id)
            if user.status == 'BLOCKED':
                raise AuthenticationFailed('User blocked')
            return (user, token)
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed('Token expired')
        except jwt.InvalidTokenError:
            raise AuthenticationFailed('Invalid token')
        except User.DoesNotExist:
            raise AuthenticationFailed('User not found')

    def authenticate_header(self, request):
        return 'Bearer'


def generate_jwt_token(user_id, role='STAFF', exp_hours=15):
    """Generate a JWT token for a user."""
    payload = {
        'user_id': str(user_id),
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=exp_hours),
        'iat': datetime.utcnow(),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm='HS256')


class JWTOpenApiAuthenticationExtension(OpenApiAuthenticationExtension):
    """Describe our Bearer scheme to drf-spectacular.

    Without this, schema generation logs "could not resolve authenticator"
    for every JWT-authenticated view: roughly a hundred warnings that buried
    the real findings in `manage.py check --deploy`.
    """

    target_class = 'bounded.iam.authentication.jwt.JWTAuthentication'
    name = 'bearerAuth'

    def get_security_definition(self, auto_schema):
        return {
            'type': 'apiKey',
            'in': 'header',
            'name': 'Authorization',
            'description': 'JWT access token, prefixed with `Bearer `.',
        }
