"""Authenticate Channels connections with the same signed JWT used by REST."""
from urllib.parse import parse_qs

import jwt
from channels.db import database_sync_to_async
from django.conf import settings


@database_sync_to_async
def _user_for_token(token):
    from bounded.iam.models import User

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=['HS256'])
        user = User.objects.get(user_id=payload.get('user_id'))
        if user.status != 'ACTIVE':
            return None
        return user
    except (jwt.InvalidTokenError, User.DoesNotExist, TypeError, ValueError):
        return None


class JWTWebSocketAuthMiddleware:
    """Read a token from a WebSocket subprotocol, with query fallback for tools.

    Browsers cannot set an Authorization header for WebSockets. The app sends
    `auth.<JWT>` as a subprotocol so credentials are not placed in access logs.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = next(
            (part[5:] for part in scope.get('subprotocols', []) if part.startswith('auth.')),
            None,
        )
        if not token:
            query = parse_qs(scope.get('query_string', b'').decode('ascii', errors='ignore'))
            token = (query.get('token') or [None])[0]
        scope = dict(scope)
        scope['user'] = await _user_for_token(token) if token else None
        return await self.app(scope, receive, send)
