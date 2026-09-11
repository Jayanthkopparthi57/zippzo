from django.contrib import admin
from .models import Warehouse, Category, Zone, Location, LocationActivityLog

@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'city', 'country', 'is_active')
    search_fields = ('code', 'name', 'city')

@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'warehouse', 'parent_category', 'is_active')
    list_filter = ('warehouse', 'is_active')
    search_fields = ('code', 'name')

@admin.register(Zone)
class ZoneAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'warehouse', 'zone_type', 'is_active')
    list_filter = ('warehouse', 'zone_type')
    search_fields = ('code', 'name')

@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ('bin_code', 'zone', 'aisle', 'rack_number', 'shelf_level', 'barcode_label', 'is_occupied', 'is_blocked')
    list_filter = ('zone__warehouse', 'zone__zone_type', 'is_occupied', 'is_blocked')
    search_fields = ('bin_code', 'barcode_label')

@admin.register(LocationActivityLog)
class LocationActivityLogAdmin(admin.ModelAdmin):
    list_display = ('location', 'activity_type', 'quantity', 'timestamp')
    list_filter = ('activity_type', 'timestamp')
