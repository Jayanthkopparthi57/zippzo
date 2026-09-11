from django.contrib import admin
from .models import UserProfile, UserRole, ApprovalRequest

@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'approval_status', 'is_approved_by_admin', 'phone', 'created_at')
    list_filter = ('approval_status', 'is_approved_by_admin')
    search_fields = ('user__username', 'user__email', 'phone')

@admin.register(UserRole)
class UserRoleAdmin(admin.ModelAdmin):
    list_display = ('user', 'role')
    list_filter = ('role',)
    search_fields = ('user__username', 'user__email')

@admin.register(ApprovalRequest)
class ApprovalRequestAdmin(admin.ModelAdmin):
    list_display = ('user', 'requested_at', 'approved_by', 'approved_at')
    list_filter = ('approved_at',)
    search_fields = ('user__username', 'notes')
