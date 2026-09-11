from django.contrib import admin
from .models import (DispatchPlan, Batch, Order, OrderLine, OrderAllocation,
                     Picklist, PicklistLine, Sortlist, SortlistLine,
                     Manifest, ManifestLine, CancellationPutaway)

@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ['order_no', 'type', 'status', 'ordered_qty', 'shipped_qty', 'created_at']
    list_filter = ['type', 'status', 'shipment_type']
    search_fields = ['order_no', 'reference_order']

@admin.register(Batch)
class BatchAdmin(admin.ModelAdmin):
    list_display = ['batch_no', 'site', 'status', 'ordered_qty', 'picked_qty', 'created_at']
    list_filter = ['status', 'type']
    search_fields = ['batch_no']

@admin.register(Picklist)
class PicklistAdmin(admin.ModelAdmin):
    list_display = ['code', 'batch', 'status', 'assigned_qty', 'picked_qty']
    list_filter = ['status', 'type']

@admin.register(Sortlist)
class SortlistAdmin(admin.ModelAdmin):
    list_display = ['code', 'batch', 'status', 'assigned_qty', 'sorted_qty']
    list_filter = ['status', 'type']

@admin.register(Manifest)
class ManifestAdmin(admin.ModelAdmin):
    list_display = ['manifest_no', 'site', 'status', 'packed_qty', 'packed_totes']
    list_filter = ['status', 'type']

admin.site.register(DispatchPlan)
admin.site.register(OrderLine)
admin.site.register(OrderAllocation)
admin.site.register(PicklistLine)
admin.site.register(SortlistLine)
admin.site.register(ManifestLine)
admin.site.register(CancellationPutaway)
