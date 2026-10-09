from rest_framework.permissions import BasePermission


class IsAdminUser(BasePermission):
    """Restrict a view to users whose role is SUPER_ADMIN or OPS_MANAGER.

    This applies to *every* HTTP method, including GET. Returning True for
    SAFE_METHODS let any authenticated operator read the full user list
    (emails, roles, password change flags) from /iam/users/, which is
    admin-only data, while the class name and docstring promised otherwise.
    """
    message = "Admin access required."

    ADMIN_ROLES = ("SUPER_ADMIN", "OPS_MANAGER")

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return getattr(user, "role", None) in self.ADMIN_ROLES

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)
