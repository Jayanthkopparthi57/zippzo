from django.contrib import admin
from .models import SalesOrder, OrderItem, PickWave, PickTask

class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0

@admin.register(SalesOrder)
class SalesOrderAdmin(admin.ModelAdmin):
    list_display = ('order_number', 'customer', 'warehouse', 'status', 'priority', 'order_date', 'delivery_deadline')
    list_filter = ('status', 'priority', 'warehouse')
    search_fields = ('order_number', 'customer__name', 'city')
    inlines = [OrderItemInline]

class PickTaskInline(admin.TabularInline):
    model = PickTask
    extra = 0

@admin.register(PickWave)
class PickWaveAdmin(admin.ModelAdmin):
    list_display = ('wave_number', 'warehouse', 'strategy', 'status', 'created_at')
    list_filter = ('status', 'strategy', 'warehouse')
    search_fields = ('wave_number',)
    inlines = [PickTaskInline]

@admin.register(PickTask)
class PickTaskAdmin(admin.ModelAdmin):
    list_display = ('order_item', 'batch', 'source_location', 'quantity_to_pick', 'quantity_picked', 'sequence_route_order', 'status', 'assigned_employee')
    list_filter = ('status', 'source_location__zone__warehouse')
    search_fields = ('order_item__product__sku', 'batch__internal_batch_id', 'source_location__bin_code')
