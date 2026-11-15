import os
import django
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'zippzo_wms.settings')
django.setup()

from bounded.notifications.websocket_auth import JWTWebSocketAuthMiddleware
from bounded.notifications.routing import websocket_urlpatterns

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": JWTWebSocketAuthMiddleware(URLRouter(websocket_urlpatterns)),
})
