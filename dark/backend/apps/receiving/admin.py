from django.contrib import admin
from .models import PurchaseOrder, PurchaseOrderItem, GoodsReceiptNote, GRNItem

class PurchaseOrderItemInline(admin.TabularInline):
    model = PurchaseOrderItem
    extra = 0

@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ('po_number', 'vendor', 'warehouse', 'status', 'total_amount', 'order_date')
    list_filter = ('status', 'warehouse')
    search_fields = ('po_number', 'vendor__name')
    inlines = [PurchaseOrderItemInline]

class GRNItemInline(admin.TabularInline):
    model = GRNItem
    extra = 0

@admin.register(GoodsReceiptNote)
class GoodsReceiptNoteAdmin(admin.ModelAdmin):
    list_display = ('grn_number', 'po', 'warehouse', 'status', 'received_by', 'receipt_date')
    list_filter = ('status', 'warehouse')
    search_fields = ('grn_number', 'po__po_number', 'vehicle_number')
    inlines = [GRNItemInline]
