from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import path, include
from django.views.generic import TemplateView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.permissions import IsAuthenticated


def health(request):
    """Liveness probe for the platform.

    Deliberately a plain Django view with no DRF permission: Render's health
    check has no token, and every other endpoint under /api/ is
    IsAuthenticated by default — pointing healthCheckPath at /api/schema/
    returned 401 forever and the service was never marked healthy.

    It answers 503 rather than 200 when the database is unreachable, because
    a reachable process with an unreachable database is not healthy either.
    """
    try:
        connection.ensure_connection()
    except Exception:
        return JsonResponse({'status': 'degraded', 'db': 'error'}, status=503)
    return JsonResponse({'status': 'ok', 'db': 'ok'})


class AuthenticatedSchemaView(SpectacularAPIView):
    """The OpenAPI schema enumerates every route, model and field.

    drf_spectacular defaults it to AllowAny, which hands an anonymous caller a
    complete map of the internal API. Require a valid token like everything
    else under /api/ that is not the login endpoint.
    """
    permission_classes = [IsAuthenticated]


class AuthenticatedSwaggerView(SpectacularSwaggerView):
    permission_classes = [IsAuthenticated]


urlpatterns = [
    path('admin/', admin.site.urls),
    # Public liveness probe (see health() above).
    path('api/health/', health, name='health'),
    # API Schema
    path('api/schema/', AuthenticatedSchemaView.as_view(), name='schema'),
    path('api/docs/', AuthenticatedSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    # Platform Core
    path('api/iam/', include('bounded.iam.urls')),
    path('api/audit/', include('bounded.audit.urls')),
    path('api/outbox/', include('bounded.outbox.urls')),
    path('api/notifications/', include('bounded.notifications.urls')),
    path('api/holds/', include('bounded.holds.urls')),
    # Network
    path('api/network/', include('bounded.network.urls')),
    path('api/catalog/', include('bounded.catalog.urls')),
    # Supply Chain
    path('api/supply/', include('bounded.supply.urls')),
    path('api/inventory/', include('bounded.inventory.urls')),
    # Demand & Fulfilment
    path('api/orders/', include('bounded.orders.urls')),
    path('api/routing/', include('bounded.routing.urls')),
    path('api/ds-ops/', include('bounded.ds_ops.urls')),
    path('api/fulfilment/', include('bounded.fulfilment.urls')),
    # Last Mile
    path('api/delivery/', include('bounded.delivery.urls')),
    path('api/lastmile/', include('bounded.lastmile.urls')),
    # Money
    path('api/money/', include('bounded.money.urls')),
    path('api/reverse/', include('bounded.reverse.urls')),
    # Frontend SPA.
    #
    # WhiteNoise serves `frontend/dist` (index.html and /assets/*) from
    # settings.WHITENOISE_ROOT before this is ever reached. This view remains
    # as the dev-time fallback, and as the 404-free answer for `/` before the
    # first `npm run build`.
    path('', TemplateView.as_view(template_name='index.html'), name='frontend'),
]
