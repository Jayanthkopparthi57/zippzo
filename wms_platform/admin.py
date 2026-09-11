from django.contrib import admin
from .models import User, ReasonCode

@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ['name', 'emp_code', 'role', 'status']
    list_filter = ['role', 'status']
    search_fields = ['name', 'emp_code']

@admin.register(ReasonCode)
class ReasonCodeAdmin(admin.ModelAdmin):
    list_display = ['code', 'category', 'requires_photo', 'requires_remark']
    list_filter = ['category']
