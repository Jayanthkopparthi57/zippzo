from django.contrib import admin
from .models import Site, SkuCategory, Sku, Vendor, Zone, Bin, ClusterZone, DockDoor, VehicleType, Transporter

admin.site.register(Site)
admin.site.register(SkuCategory)

@admin.register(Sku)
class SkuAdmin(admin.ModelAdmin):
    list_display = ['sku_code', 'name', 'storage_zone', 'mrp', 'status']
    list_filter = ['storage_zone', 'status', 'is_food']
    search_fields = ['sku_code', 'name', 'ean']

@admin.register(Vendor)
class VendorAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'is_customer', 'status']
    search_fields = ['code', 'name']

@admin.register(Zone)
class ZoneAdmin(admin.ModelAdmin):
    list_display = ['code', 'site', 'zone_type', 'status']
    list_filter = ['zone_type', 'status', 'site']

@admin.register(Bin)
class BinAdmin(admin.ModelAdmin):
    list_display = ['code', 'site', 'zone', 'status', 'condition']
    list_filter = ['status', 'condition', 'site']
    search_fields = ['code']

admin.site.register(ClusterZone)
admin.site.register(DockDoor)
admin.site.register(VehicleType)
admin.site.register(Transporter)
