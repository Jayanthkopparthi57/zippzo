from django.contrib import admin
from .models import InventoryLot, InventoryTx, Lpn, Droplist

@admin.register(InventoryLot)
class InventoryLotAdmin(admin.ModelAdmin):
    list_display = ['lot_code', 'sku', 'site', 'qty', 'bucket', 'status', 'expiry_date']
    list_filter = ['bucket', 'status', 'on_hold', 'site']
    search_fields = ['lot_code', 'sku__sku_code']

@admin.register(InventoryTx)
class InventoryTxAdmin(admin.ModelAdmin):
    list_display = ['tx_id', 'sku', 'flow', 'qty', 'from_bin', 'to_bin', 'created_at']
    list_filter = ['flow', 'site']
    ordering = ['-tx_id']

@admin.register(Lpn)
class LpnAdmin(admin.ModelAdmin):
    list_display = ['barcode', 'type', 'status', 'current_site']
    list_filter = ['type', 'status']
    search_fields = ['barcode']

admin.site.register(Droplist)
