"""
Site scoping for dark-store operations.

`EmployeeSiteAssignment.employee` is a bare code ("DSP470CFE") that matched no
iam.User at all, so nothing could be resolved back to an authenticated operator
and every operational endpoint was effectively "any logged-in user, any store".
A picker at DS-A could post a pick against an order belonging to DS-B, and the
ledger would happily move DS-B's stock.

`EmployeeSiteAssignment.user` is the missing link. This module resolves the
sites a caller may work at, and nothing here guesses: a field operator with no
assignment resolves to nothing, and callers get a 403 naming the gap rather than
a silent allow.

Estate roles (SUPER_ADMIN, OPS_MANAGER) are the exception: they administer the
whole network rather than working a single store, so they resolve to every site
without needing an assignment row per store. This matters because an
assignment also changes the facility and target app returned at login; a
manager should not have to be "assigned" to DS-x just to open its pick queue.
"""
from rest_framework.exceptions import PermissionDenied

#: Roles that administer the estate rather than a single facility.
ESTATE_ROLES = ('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER')


def is_estate_role(user):
    return bool(user) and getattr(user, 'role', '') in ESTATE_ROLES


def operator_site_codes(user):
    """Site codes this user may work at. Empty set = nowhere.

    Field users get exactly their active `EmployeeSiteAssignment` rows.
    Estate roles get every site in the network.
    """
    from bounded.network.models import EmployeeSiteAssignment, Site

    if not user or not getattr(user, 'is_authenticated', False):
        return set()
    if is_estate_role(user):
        return set(Site.objects.values_list('code', flat=True))
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


def require_session_facility(user, site_code):
    """Raise PermissionDenied when a field session acts outside its facility.

    Assignment scope says which sites an employee may ever work at; the session
    facility says which one they actually selected at sign-in. A picker with two
    store assignments must not be able to keep a store-A token and post a
    movement against store B by editing the request. Estate roles administer the
    network and are exempt, matching `require_site_access`.
    """
    if is_estate_role(user) or is_superuser(user):
        return
    session = getattr(user, 'session', None)
    # force_authenticate (tests) bypasses JWTAuthentication, so there is no
    # session. Production traffic always has one; allow the request through
    # here and rely on the assignment check above.
    if session is None:
        return
    if session.facility_id is None:
        raise PermissionDenied(
            'Choose an authorized facility before performing this action.'
        )
    if site_code and session.facility and session.facility.code != site_code:
        raise PermissionDenied(
            f'This session is scoped to {session.facility.code}, not {site_code}. '
            'Switch facility first.'
        )


def require_order_access(user, order):
    """Raise PermissionDenied unless `user` may operate on `order`'s site."""
    require_site_access(user, order.site.code)


#: Which department may perform each class of floor work. Managers and estate
#: roles always pass; generic associates (the legacy WAREHOUSE_STAFF role that
#: has no role_at_site) pass too, because they have no department to be limited
#: to. A named department is a restriction, not a promotion.
DEPARTMENT_WORK = {
    'PICK': ('PICKER',),
    'RECEIVE': ('INBOUND',),
    'PUTAWAY': ('PUTAWAY',),
    'COUNT': ('INVENTORY',),
}


def require_department(user, site, work):
    """Raise PermissionDenied unless `user`'s site department may do `work`.

    `require_site_access` answers "may this person work at this store at all".
    This answers the narrower question the charts ask: an inbound associate and
    a picker can both be assigned to DS-01, but only the picker may complete a
    pick. Without it the mobile app merely hid the button; the API still let an
    inbound token scan stock off a shelf.
    """
    from bounded.iam import staff_auth

    if is_estate_role(user) or is_superuser(user):
        return
    allowed = DEPARTMENT_WORK.get(work, ())
    role_at_site = staff_auth.facility_role(user, site)
    department = staff_auth.department_for(user, site, role_at_site)
    if department in allowed or department in ('MANAGER', 'ASSOCIATE'):
        return
    raise PermissionDenied(
        f'{work.title()} work belongs to the {", ".join(allowed)} department '
        f'at {site.code}; your department there is {department}.'
    )