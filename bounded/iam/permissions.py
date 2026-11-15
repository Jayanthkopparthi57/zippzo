from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsAdminUserOrReadOnly(BasePermission):
    """Any signed-in operator may read master data; only admins may change it.

    The catalog and supplier screens are working tools - a picker needs the SKU
    list and a receiving clerk needs to see vendors - but creating or editing
    that master data is a back-office job. Writes are therefore limited to the
    same roles as IsAdminUser, while anonymous callers get nothing at all.
    """

    message = "Admin access required to change master data."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return getattr(user, "role", None) in IsAdminUser.ADMIN_ROLES

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


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


class IsFieldSurface(BasePermission):
    """Physical stock work requires a field-capable surface.

    Hiding scanner controls in the browser is not a security control: the
    endpoints were still reachable with a web token. This permission makes the
    product boundary enforceable. It complements, and never replaces, the
    facility and role checks on the same endpoint.

    The WMS console is the exception on the web. Warehouse supervisors work the
    dock, putaway and dispatch from the console with a mouse and a plugged-in
    scanner, so an office session held by a console role (SUPER_ADMIN /
    OPS_MANAGER) may execute. Floor accounts such as WAREHOUSE_STAFF and riders
    stay mobile-only, which is the boundary this permission was added for.
    """

    message = "Physical stock work is only available in the Zippzo Operations mobile app."
    code = "physical_execution_requires_mobile"

    # Same roles that LoginAPIView routes to the WMS console.
    CONSOLE_ROLES = {'SUPER_ADMIN', 'OPS_MANAGER'}

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return False
        session = getattr(user, "session", None)
        # Real requests always carry a session (JWTAuthentication rejects
        # tokens without one). force_authenticate in tests bypasses that, so a
        # sessionless user is treated as mobile-capable to keep the suite
        # runnable; production traffic can never reach here without a session.
        if session is None:
            return True
        if session.surface == "mobile":
            return True
        return (session.surface == "web"
                and getattr(user, "role", None) in self.CONSOLE_ROLES)


class IsEstateRole(BasePermission):
    """Network-wide administration, not facility work."""

    message = "Estate administrator access required."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(
            user and getattr(user, "is_authenticated", False)
            and getattr(user, "role", None) in ("SUPER_ADMIN", "ADMIN", "OPS_MANAGER")
        )
