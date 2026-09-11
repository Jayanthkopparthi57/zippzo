from django.contrib import admin
from .models import Trip, VehicleCheckin, TripReturnLeg

@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = ['trip_no', 'direction', 'dest_site', 'status', 'delay_status', 'trip_date']
    list_filter = ['status', 'direction', 'delay_status', 'gps_status']
    search_fields = ['trip_no', 'vehicle_no', 'driver_name']

@admin.register(VehicleCheckin)
class VehicleCheckinAdmin(admin.ModelAdmin):
    list_display = ['vehicle_no', 'trip', 'direction', 'delay_status', 'checkin_at']
    list_filter = ['direction', 'delay_status']

admin.site.register(TripReturnLeg)
