from django.contrib import admin
from .models import OutgoingWebhook

@admin.register(OutgoingWebhook)
class OutgoingWebhookAdmin(admin.ModelAdmin):
    list_display = ('event_type', 'target_url', 'is_active', 'retry_count', 'last_response_code', 'last_triggered_at')
    list_filter = ('event_type', 'is_active', 'last_response_code')
    search_fields = ('target_url', 'last_error_message')
