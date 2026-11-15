"""Shared viewset plumbing for the reference-data tables.

Site scoping is the same rule the operational endpoints use: an estate role
sees everything, a field operator sees only the sites they are assigned to and
a caller with no assignment sees nothing. Reads are open to any signed-in
operator; writes are admin-only (the screens are back-office tools).
"""
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from bounded.ds_ops.access import is_estate_role, operator_site_codes
from bounded.iam.names import acting_user_id
from bounded.iam.permissions import IsAdminUserOrReadOnly


class SiteScopedViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]
    #: Field on this model that points at network.Site.
    site_field = 'site'
    #: Optional second site field, for rows that have an origin and a
    #: destination. A non-estate caller sees a row if either side is theirs.
    alt_site_field = None

    def get_queryset(self):
        queryset = super().get_queryset()
        user = getattr(self.request, 'user', None)
        if is_estate_role(user):
            return queryset
        codes = operator_site_codes(user)
        if not codes:
            return queryset.none()
        if self.alt_site_field:
            return queryset.filter(
                Q(**{f'{self.site_field}__code__in': codes})
                | Q(**{f'{self.alt_site_field}__code__in': codes})
            ).distinct()
        return queryset.filter(**{f'{self.site_field}__code__in': codes})


class StampActorMixin:
    """Stamp audit columns from the token, never from the request body."""

    #: {'model field': 'relation' | 'char'} — relation fields get the User row,
    #: char fields get the user id string.
    actor_fields = {'created_by': 'char'}

    def perform_create(self, serializer):
        model = serializer.Meta.model
        field_names = {f.name: f for f in model._meta.fields}
        stamps = {}
        for name, kind in self.actor_fields.items():
            if name not in field_names:
                continue
            if kind == 'relation':
                if getattr(self.request.user, 'is_authenticated', False):
                    stamps[name] = self.request.user
            else:
                stamps[name] = str(acting_user_id(self.request) or '')
        serializer.save(**stamps)
