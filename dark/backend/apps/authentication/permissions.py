from rest_framework import permissions

class IsApprovedUser(permissions.BasePermission):
    """Allows access only to authenticated and admin-approved users."""
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        return hasattr(request.user, 'profile') and request.user.profile.is_approved_by_admin

class HasAnyRole(permissions.BasePermission):
    """Allows access to users who have at least one of the required roles."""
    required_roles = []

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        user_roles = request.user.roles.values_list('role', flat=True)
        return any(role in user_roles for role in self.required_roles)

class IsAdminRole(HasAnyRole):
    required_roles = ['admin']

class IsManagerOrAbove(HasAnyRole):
    required_roles = ['admin', 'manager']

class IsSupervisorOrAbove(HasAnyRole):
    required_roles = ['admin', 'manager', 'supervisor']

class IsPicker(HasAnyRole):
    required_roles = ['admin', 'manager', 'supervisor', 'picker']

class IsPacker(HasAnyRole):
    required_roles = ['admin', 'manager', 'supervisor', 'packer']

class IsReceiver(HasAnyRole):
    required_roles = ['admin', 'manager', 'supervisor', 'receiver']

class IsShipper(HasAnyRole):
    required_roles = ['admin', 'manager', 'supervisor', 'shipper']
