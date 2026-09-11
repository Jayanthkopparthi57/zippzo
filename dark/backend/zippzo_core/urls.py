from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('', TemplateView.as_view(template_name='index.html'), name='home_dashboard'),
    path('admin/', admin.site.urls),
    path('api/v1/auth/', include('apps.authentication.urls')),
    path('api/v1/master/', include('apps.master_data.urls')),
    path('api/v1/catalog/', include('apps.catalog.urls')),
    path('api/v1/inventory/', include('apps.inventory.urls')),
    path('api/v1/receiving/', include('apps.receiving.urls')),
    path('api/v1/fulfillment/', include('apps.fulfillment.urls')),
    path('api/v1/packing/', include('apps.packing.urls')),
    path('api/v1/shipping/', include('apps.shipping.urls')),
    path('api/v1/returns/', include('apps.reverse_logistics.urls')),
    path('api/v1/hr/', include('apps.hr_tracking.urls')),
    path('api/v1/webhooks/', include('apps.webhooks.urls')),
    path('api/v1/audit/', include('apps.audit_trail.urls')),
    path('api/v1/sap/', include('apps.sap_integration.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATICFILES_DIRS[0])

