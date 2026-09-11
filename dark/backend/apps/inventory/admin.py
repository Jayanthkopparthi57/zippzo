from django.contrib import admin
from .models import Inventory, InventoryTransaction

@admin.register(Inventory)
class InventoryAdmin(admin.ModelAdmin):
    list_display = ('batch', 'location', 'quantity_on_hand', 'quantity_reserved', 'status', 'updated_at')
    list_filter = ('status', 'warehouse')
    search_fields = ('batch__product__sku', 'batch__internal_batch_id', 'location__bin_code')

@admin.register(InventoryTransaction)
class InventoryTransactionAdmin(admin.ModelAdmin):
    list_display = ('transaction_type', 'batch', 'quantity', 'source_location', 'dest_location', 'reference_doc_type', 'created_at')
    list_filter = ('transaction_type', 'reference_doc_type', 'warehouse')
    search_fields = ('batch__product__sku', 'reference_doc_id', 'notes')
    readonly_fields = [f.name for f in InventoryTransaction._meta.fields]
