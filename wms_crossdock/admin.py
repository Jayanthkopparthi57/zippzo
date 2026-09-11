from django.contrib import admin
from .models import CrossDockBatch, CrossDockLine

@admin.register(CrossDockBatch)
class CrossDockBatchAdmin(admin.ModelAdmin):
    list_display = ['batch_no', 'site', 'status', 'orders_count', 'ordered_qty', 'sorted_qty']
    list_filter = ['status']
    search_fields = ['batch_no']

admin.site.register(CrossDockLine)
