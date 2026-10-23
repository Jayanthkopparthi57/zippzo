"""
The audit fields across supply / ds_ops (created_by, received_by, assigned_to,
confirmed_by, completed_by, dispatched_by …) are deliberately bare UUIDFields
rather than FKs: they record who acted even when the user row is later
deleted, and they keep the operational tables free of cross-app FK cycles.

Every list endpoint that exposes one of those fields therefore needs a name.
Doing it with SerializerMethodFields would issue one User query per row — a
100-row page would be 100 queries — so callers fetch a map once per response
and every serializer reads from that single context entry.

Imported directly rather than through get_user_model(): this project does not
set AUTH_USER_MODEL, so get_user_model() would resolve to django.contrib.auth's
model instead of bounded.iam.User.
"""
from bounded.iam.models import User


def user_display_map(ids):
    """{user_id str -> display name} for the given ids, one query.

    Unknown ids (deleted users, synthetic actors like 'test') are reported as
    their raw value rather than dropped, so a ledger never shows a blank cell
    for a real event.
    """
    wanted = {str(i) for i in ids if i}
    if not wanted:
        return {}
    rows = User.objects.filter(user_id__in=wanted).values_list(
        'user_id', 'full_name', 'email',
    )
    return {
        str(pk): (full_name or email or str(pk))
        for pk, full_name, email in rows
    }


def acting_user_id(request):
    """Server-side actor id for attribution stamps.

    Every audit column is stamped from the JWT, never from the request body:
    a client could otherwise claim someone else's name and the ledger would
    lie (the same convention bounded/tests/test_pick_scan.py enforces on
    stock movements).
    """
    user = getattr(request, 'user', None)
    return getattr(user, 'user_id', None)


def display_name(user_map, user_id):
    """Name for one id.

    ``user_map`` is the per-response map from :func:`user_display_map`:
    - a dict (list endpoints) → dict lookup, zero extra queries; unknown ids
      (deleted users) degrade to the raw value so no cell is ever blank;
    - ``None`` (detail responses / one-off serializations with no map) → one
      small lookup, which is fine because exactly one row is being rendered.
    """
    if not user_id:
        return ''
    key = str(user_id)
    if user_map is not None:
        return user_map.get(key, key)
    row = (User.objects.filter(user_id=key)
           .values_list('full_name', 'email').first())
    if row and (row[0] or row[1]):
        return row[0] or row[1]
    return key


class AttributionContextMixin:
    """Builds one user_map per list response and puts it in serializer context.

    Without this, exposing actor names would mean either one User query per
    row (SerializerMethodField) or a JOIN per audit column. DRF's
    get_serializer() is called with the already-paginated page as args[0] in
    list(), so that is the hook: collect every actor id on the page across
    this viewset's ``attribution_fields``, resolve them in a single IN query,
    and hand the map to the serializers via context.

    Detail/create calls (instance or no list) keep the serializer's own
    single-row fallback.
    """
    # Override per viewset: the bare UUID columns this endpoint renders.
    attribution_fields = ()

    def get_serializer(self, *args, **kwargs):
        if 'context' not in kwargs:
            kwargs['context'] = self.get_serializer_context()
        rows = args[0] if args else None
        if isinstance(rows, (list, tuple)) and rows:
            ids = []
            for row in rows:
                for field in self.attribution_fields:
                    value = getattr(row, field, None)
                    if value:
                        ids.append(value)
            if ids:
                kwargs['context'] = {
                    **kwargs['context'],
                    'user_map': user_display_map(ids),
                }
        return super().get_serializer(*args, **kwargs)
