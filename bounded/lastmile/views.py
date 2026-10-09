from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied

from .models import PODEvidence
from .serializers import PODEvidenceSerializer


class PODEvidenceViewSet(viewsets.ModelViewSet):
    """Who accepted the bag at the door.

    Read is open to the rider who delivered it, the store that packed it and
    the customer who received it - this is the record that settles a dispute.
    Writing it is not: evidence is created by POST /delivery/handoff/pod as a
    side effect of an OTP-verified delivery, so a client that could POST here
    would be able to forge proof of a delivery that never happened.
    """
    queryset = PODEvidence.objects.select_related('task', 'task__order',
                                                  'task__site').all()
    serializer_class = PODEvidenceSerializer

    def get_queryset(self):
        from bounded.ds_ops.access import is_superuser, operator_site_codes

        user = self.request.user
        if user is None or not getattr(user, 'is_authenticated', False):
            return self.queryset.none()
        if is_superuser(user) or getattr(user, 'role', '') == 'ADMIN':
            return self.queryset

        from bounded.delivery.models import RiderProfile
        base = self.queryset
        mine = base.filter(rider__user_id=user.user_id)
        codes = operator_site_codes(user)
        if codes:
            mine = mine | base.filter(task__site__code__in=codes)
        if getattr(user, 'role', '') in ('CUSTOMER', 'SENDER'):
            mine = mine | base.filter(task__order__customer__user_id=user.user_id)
        return mine.distinct()

    def perform_create(self, serializer):
        raise PermissionDenied(
            'Proof of delivery is written by POST /delivery/handoff/pod.')

    def perform_update(self, serializer):
        raise PermissionDenied('Proof of delivery is written once, at the door.')

    def perform_destroy(self, instance):
        raise PermissionDenied('Proof of delivery is never deleted.')
