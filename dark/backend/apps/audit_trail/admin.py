from django.contrib import admin
from .models import AuditLog

@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'entity_type', 'entity_id', 'user', 'ip_address', 'timestamp')
    list_filter = ('action', 'entity_type', 'timestamp')
    search_fields = ('entity_id', 'action', 'user__username')
    readonly_fields = [f.name for f in AuditLog._meta.fields]
