from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path('admin/', admin.site.urls),

    # API modules
    path('api/platform/', include('wms_platform.urls')),
    path('api/master/', include('wms_master.urls')),
    path('api/inventory/', include('wms_inventory.urls')),
    path('api/inbound/', include('wms_inbound.urls')),
    path('api/outbound/', include('wms_outbound.urls')),
    path('api/transport/', include('wms_transport.urls')),
    path('api/crossdock/', include('wms_crossdock.urls')),
    path('api/optional/', include('wms_optional.urls')),

    # OpenAPI docs
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),

    # Dark Store Customer Portal
    path('dark/', TemplateView.as_view(template_name='index.html'), name='dark_storefront'),

    # Frontend SPA — catch-all
    path('', TemplateView.as_view(template_name='index.html'), name='frontend'),
] + static(settings.STATIC_URL, document_root=settings.STATICFILES_DIRS[0] if settings.STATICFILES_DIRS else settings.STATIC_ROOT)
