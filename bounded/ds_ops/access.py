"""
Site scoping for dark-store operations.

`EmployeeSiteAssignment.employee` is a bare code ("DSP470CFE") that matched no
iam.User at all, so nothing could be resolved back to an authenticated operator
and every operational endpoint was effectively "any logged-in user, any store".
A picker at DS-A could post a pick against an order belonging to DS-B, and the
ledger would happily move DS-B's stock.

`EmployeeSiteAssignment.user` is the missing link. This module resolves the
sites a caller may work at, and nothing here guesses: an operator with no
assignment resolves to nothing, and callers get a 403 naming the gap rather than
a silent allow.
"""
from rest_framework.exceptions import PermissionDenied


def operator_site_codes(user):
    """Site codes this user is actively assigned to. Empty set = nowhere.

    Superusers are deliberately NOT special-cased here. An admin who is not
    assigned to a store should be refused by the operational endpoints exactly
    like anyone else; the admin surfaces that do need network-wide reach use
    IsAdminUser instead.
    """
    from bounded.network.models import EmployeeSiteAssignment

    if not user or not getattr(user, 'is_authenticated', False):
        return set()
    return set(
        EmployeeSiteAssignment.objects
        .filter(user=user, is_active=True)
        .values_list('site__code', flat=True)
    )


def is_superuser(user):
    return bool(user and getattr(user, 'is_superuser', False)) or (
        user is not None and getattr(user, 'role', '') in ('SUPER_ADMIN', 'ADMIN')
    )


def require_site_access(user, site_code):
    """Raise PermissionDenied unless `user` is assigned to `site_code`."""
    if is_superuser(user):
        return
    allowed = operator_site_codes(user)
    if site_code in allowed:
        return
    if not allowed:
        raise PermissionDenied(
            f'You have no active site assignment, so you cannot work at '
            f'{site_code}. An operator must be added to that dark store '
            f'(network.EmployeeSiteAssignment) before they can pick.'
        )
    raise PermissionDenied(
        f'You are not assigned to {site_code}. Your stores: '
        f'{", ".join(sorted(allowed))}.'
    )


def require_order_access(user, order):
    """Raise PermissionDenied unless `user` may operate on `order`'s site."""
    require_site_access(user, order.site.code)