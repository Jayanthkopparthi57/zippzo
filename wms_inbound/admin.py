from django.contrib import admin
from .models import Asn, AsnLine, Grn, GrnLine, PutawayTask, InboundDiscrepancy

@admin.register(Asn)
class AsnAdmin(admin.ModelAdmin):
    list_display = ['asn_no', 'type', 'dest_site', 'status', 'total_qty', 'created_at']
    list_filter = ['type', 'status']
    search_fields = ['asn_no', 'po_ref']

@admin.register(Grn)
class GrnAdmin(admin.ModelAdmin):
    list_display = ['grn_no', 'asn', 'mode', 'status', 'has_discrepancy']
    list_filter = ['status', 'mode']

@admin.register(PutawayTask)
class PutawayTaskAdmin(admin.ModelAdmin):
    list_display = ['putaway_id', 'status', 'priority', 'from_location', 'to_bin']
    list_filter = ['status']

admin.site.register(AsnLine)
admin.site.register(GrnLine)
admin.site.register(InboundDiscrepancy)
