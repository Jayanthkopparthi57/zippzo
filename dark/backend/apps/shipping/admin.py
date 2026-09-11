from django.contrib import admin
from .models import Shipment, ShipmentManifest

@admin.register(Shipment)
class ShipmentAdmin(admin.ModelAdmin):
    list_display = ('shipment_number', 'order', 'logistics_partner', 'tracking_number', 'package_weight_kg', 'status', 'created_at')
    list_filter = ('status', 'logistics_partner')
    search_fields = ('shipment_number', 'tracking_number', 'order__order_number')

@admin.register(ShipmentManifest)
class ShipmentManifestAdmin(admin.ModelAdmin):
    list_display = ('manifest_number', 'logistics_partner', 'driver_name', 'vehicle_number', 'total_packages', 'departure_time')
    list_filter = ('logistics_partner',)
    search_fields = ('manifest_number', 'driver_name', 'vehicle_number')
