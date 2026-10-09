from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied

from .models import Payment, CancelIntent, Refund, RefundDecision, CashMovement, RiderCustodyState, RiderEarnings
from .serializers import PaymentSerializer, CancelIntentSerializer, RefundSerializer, RefundDecisionSerializer, CashMovementSerializer, RiderCustodyStateSerializer, RiderEarningsSerializer


def _is_admin(user):
    from bounded.ds_ops.access import is_superuser
    return is_superuser(user) or getattr(user, 'role', '') == 'ADMIN'


def _my_orders(user):
    from bounded.orders.models import CustomerOrder
    return CustomerOrder.objects.filter(customer__user_id=user.user_id)


def _my_rider(user):
    from bounded.delivery.models import RiderProfile
    return RiderProfile.objects.filter(user_id=user.user_id).first()


def _authenticated(user):
    return user is not None and getattr(user, 'is_authenticated', False)


class CustomerScopedViewSet(viewsets.ModelViewSet):
    """Writes are for the people who run the money; reads are for its owner.

    Every viewset here was a bare ModelViewSet over the whole table, so any
    authenticated account could read - or POST - the payment, refund and
    custody records of the entire platform.
    """
    def get_queryset(self):
        raise NotImplementedError

    def perform_create(self, serializer):
        if not _is_admin(self.request.user):
            raise PermissionDenied('Payments are recorded by the platform, not created over the API.')
        serializer.save()

    def perform_update(self, serializer):
        if not _is_admin(self.request.user):
            raise PermissionDenied('Only an administrator can change a money record.')
        serializer.save()

    def perform_destroy(self, instance):
        if not _is_admin(self.request.user):
            raise PermissionDenied('Money records are never deleted over the API.')


class PaymentViewSet(CustomerScopedViewSet):
    queryset = Payment.objects.select_related('order','customer').all()
    serializer_class = PaymentSerializer
    filterset_fields = ['method','status','customer']

    def get_queryset(self):
        if not _authenticated(self.request.user):
            return self.queryset.none()
        if _is_admin(self.request.user):
            return self.queryset
        return self.queryset.filter(order__in=_my_orders(self.request.user))


class CancelIntentViewSet(CustomerScopedViewSet):
    queryset = CancelIntent.objects.all()
    serializer_class = CancelIntentSerializer
    filterset_fields = ['status']

    def get_queryset(self):
        if not _authenticated(self.request.user):
            return self.queryset.none()
        if _is_admin(self.request.user):
            return self.queryset
        return self.queryset.filter(order__in=_my_orders(self.request.user))


class RefundViewSet(CustomerScopedViewSet):
    queryset = Refund.objects.select_related('order','payment').all()
    serializer_class = RefundSerializer
    filterset_fields = ['status','refund_method']

    def get_queryset(self):
        if not _authenticated(self.request.user):
            return self.queryset.none()
        if _is_admin(self.request.user):
            return self.queryset
        return self.queryset.filter(order__in=_my_orders(self.request.user))


class RefundDecisionViewSet(CustomerScopedViewSet):
    queryset = RefundDecision.objects.all()
    serializer_class = RefundDecisionSerializer

    def get_queryset(self):
        if not _authenticated(self.request.user):
            return self.queryset.none()
        if _is_admin(self.request.user):
            return self.queryset
        return self.queryset.filter(refund__order__in=_my_orders(self.request.user))


class CashMovementViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only and narrowed: a ledger of every rupee in the network.

    Scoped to the stores the caller works at, and to cash sitting with the
    rider whose account this is, so the rider's own custody trail is readable
    while the rest of the network's cash is not.
    """
    queryset = CashMovement.objects.all()
    serializer_class = CashMovementSerializer
    filterset_fields = ['movement_type','site']

    def get_queryset(self):
        user = self.request.user
        if not _authenticated(user):
            return self.queryset.none()
        if _is_admin(user):
            return self.queryset

        from bounded.ds_ops.access import operator_site_codes
        codes = operator_site_codes(user)
        profile = _my_rider(user)
        qs = self.queryset.none()
        if codes:
            qs = qs | self.queryset.filter(site__in=codes)
        if profile is not None:
            qs = qs | self.queryset.filter(to_ref_id=str(profile.rider_id))
        return qs.distinct()


class RiderCustodyStateViewSet(CustomerScopedViewSet):
    queryset = RiderCustodyState.objects.all()
    serializer_class = RiderCustodyStateSerializer
    filterset_fields = ['site']

    def get_queryset(self):
        user = self.request.user
        if not _authenticated(user):
            return self.queryset.none()
        if _is_admin(user):
            return self.queryset
        profile = _my_rider(user)
        if profile is None:
            return self.queryset.none()
        return self.queryset.filter(rider_id=profile.rider_id)


class RiderEarningsViewSet(CustomerScopedViewSet):
    queryset = RiderEarnings.objects.select_related('rider','order').all()
    serializer_class = RiderEarningsSerializer
    filterset_fields = ['status','rider']

    def get_queryset(self):
        user = self.request.user
        if not _authenticated(user):
            return self.queryset.none()
        if _is_admin(user):
            return self.queryset
        profile = _my_rider(user)
        if profile is None:
            return self.queryset.none()
        return self.queryset.filter(rider=profile)
