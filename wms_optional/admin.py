from django.contrib import admin
from .models import CycleCount, CycleCountLine, ReplenishmentTask

admin.site.register(CycleCount)
admin.site.register(CycleCountLine)

@admin.register(ReplenishmentTask)
class ReplenishmentAdmin(admin.ModelAdmin):
    list_display = ['rep_id', 'sku', 'qty', 'trigger', 'status']
    list_filter = ['status', 'trigger']
