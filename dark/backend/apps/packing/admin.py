from django.contrib import admin
from .models import PackingTask

@admin.register(PackingTask)
class PackingTaskAdmin(admin.ModelAdmin):
    list_display = ('order', 'pick_task', 'status', 'scan_verified_qty', 'packaging_type', 'actual_weight_kg', 'packed_by')
    list_filter = ('status', 'packaging_type')
    search_fields = ('order__order_number', 'error_notes')
