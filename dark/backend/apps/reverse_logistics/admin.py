from django.contrib import admin
from .models import ReturnOrder, ReturnItem

class ReturnItemInline(admin.TabularInline):
    model = ReturnItem
    extra = 0

@admin.register(ReturnOrder)
class ReturnOrderAdmin(admin.ModelAdmin):
    list_display = ('rma_number', 'order', 'customer', 'reason', 'status', 'created_at')
    list_filter = ('status', 'reason')
    search_fields = ('rma_number', 'order__order_number')
    inlines = [ReturnItemInline]
