from decimal import Decimal, InvalidOperation

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import Payment, CancelIntent, Refund, RefundDecision, CashMovement, RiderCustodyState, RiderEarnings, DeliveryPricingRule
from .serializers import PaymentSerializer, CancelIntentSerializer, RefundSerializer, RefundDecisionSerializer, CashMovementSerializer, RiderCustodyStateSerializer, RiderEarningsSerializer, DeliveryPricingRuleSerializer


def _is_admin(user):
    from bounded.ds_ops.access import is_superuser
    return is_superuser(user) or getattr(user, 'role', '') == 'ADMIN'


def _can_move_cash(user):
    """Who may hand float over a counter, take it back, or record a remit.

    Everyone but the people physically at the store: riders are excluded
    even for money they are holding, because the ledger is counted by the
    person on the other side of the counter, never by the person carrying it.
    """
    return getattr(user, 'role', '') in (
        'SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER', 'WAREHOUSE_STAFF')


def _can_price(user):
    """Who may set what a store charges for delivery."""
    return _is_admin(user) or getattr(user, 'role', '') == 'OPS_MANAGER'


def _parse_amount(raw):
    """A positive rupee amount, or the reason it is not one."""
    if raw is None or str(raw).strip() == '':
        return None, 'amount is required.'
    try:
        amount = Decimal(str(raw).strip()).quantize(Decimal('0.01'))
    except (InvalidOperation, ValueError):
        return None, f'amount {str(raw)!r} is not an amount.'
    if not amount.is_finite():
        return None, f'amount {str(raw)!r} is not a finite amount.'
    if amount <= 0:
        return None, 'amount must be more than zero.'
    return amount, None


def _rider_or_404(pk):
    """The rider this custody row belongs to, or a 404-shaped response.

    Returns (rider_id, error_response). A custody row is looked up through
    the rider profile rather than the other way round, so a made-up id is a
    clean 404 instead of an orphaned ledger row nobody can ever settle.
    """
    import uuid
    from bounded.delivery.models import RiderProfile

    try:
        rider_id = uuid.UUID(str(pk))
    except (ValueError, TypeError):
        return None, Response({'error': 'That is not a rider id.'}, status=404)
    if not RiderProfile.objects.filter(rider_id=rider_id).exists():
        return None, Response({'error': 'No rider with that id.'}, status=404)
    return rider_id, None


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

    @action(detail=True, methods=['post'], url_path='issue-float')
    def issue_float(self, request, pk=None):
        """Hand a rider the change float for a shift, counted at the counter.

        Float is money the rider has not earned and must not keep: it is
        limited by the same custody ceiling that caps collected COD, so
        issuing cannot be used to park a rider over their limit. The site is
        fenced to the caller's own stores for anyone who is not an admin,
        which is the same line every other store operation draws.
        """
        if not _can_move_cash(request.user):
            return Response(
                {'error': 'Only a store operator can hand out float.'},
                status=403)
        amount, err = _parse_amount(request.data.get('amount'))
        if err:
            return Response({'error': err}, status=400)
        site_code = str(request.data.get('site_code') or '').strip()
        if not site_code:
            return Response({'error': 'site_code is required.'}, status=400)
        if not _is_admin(request.user) and site_code not in (
                self._caller_sites(request.user)):
            return Response(
                {'error': f'You do not operate {site_code}.'}, status=403)
        rider_id, err = _rider_or_404(pk)
        if err is not None:
            return err

        from bounded.delivery.handoff import DEFAULT_CASH_CEILING
        state, _created = RiderCustodyState.objects.get_or_create(
            rider_id=rider_id,
            defaults={
                'site': site_code,
                'current_cash': Decimal('0.00'),
                'current_float': Decimal('0.00'),
                'bags_in_custody': 0,
                'ceiling_amount': DEFAULT_CASH_CEILING,
            })
        held = (state.current_cash or Decimal('0.00')) + (
            state.current_float or Decimal('0.00'))
        if held + amount > state.ceiling_amount:
            return Response({
                'error': (
                    f'Rider already carries ₹{held} against a ceiling of '
                    f'₹{state.ceiling_amount}; ₹{amount} more would put them '
                    'over it. Collect or remit first.'),
                'held': str(held),
                'ceiling': str(state.ceiling_amount),
                'requested': str(amount),
            }, status=400)

        state.current_float = (state.current_float or Decimal('0.00')) + amount
        state.save(update_fields=['current_float', 'updated_at'])
        movement = CashMovement.objects.create(
            movement_type='FLOAT_ISSUE', amount=amount, site=site_code,
            from_container='VAULT', from_ref_id=site_code,
            to_container='RIDER', to_ref_id=str(rider_id),
            ref_type='FLOAT',
            actor_id=str(request.user.user_id),
            actor_type=getattr(request.user, 'role', 'SYSTEM'))
        return Response({
            'custody': RiderCustodyStateSerializer(state).data,
            'movement': movement.entry_id,
        })

    @action(detail=True, methods=['post'], url_path='return-float')
    def return_float(self, request, pk=None):
        """Take unused float back off a rider at the counter.

        Refuses more than the rider actually holds: a counted return cannot
        invent float that was never issued, and the ledger row it writes is
        the store's half of the same handover the issue wrote.
        """
        if not _can_move_cash(request.user):
            return Response(
                {'error': 'Only a store operator can take float back.'},
                status=403)
        amount, err = _parse_amount(request.data.get('amount'))
        if err:
            return Response({'error': err}, status=400)
        rider_id, err = _rider_or_404(pk)
        if err is not None:
            return err
        state = RiderCustodyState.objects.filter(rider_id=rider_id).first()
        if state is None:
            return Response(
                {'error': 'That rider has never held float or cash here.'},
                status=404)
        if not _is_admin(request.user) and state.site not in (
                self._caller_sites(request.user)):
            return Response(
                {'error': f'You do not operate {state.site or "this store"}.'},
                status=403)
        held = state.current_float or Decimal('0.00')
        if amount > held:
            return Response({
                'error': (f'Rider holds ₹{held} in float, not ₹{amount}. '
                          'Count it again.'),
                'held': str(held),
                'requested': str(amount),
            }, status=400)

        state.current_float = held - amount
        state.save(update_fields=['current_float', 'updated_at'])
        movement = CashMovement.objects.create(
            movement_type='FLOAT_RETURN', amount=amount,
            site=state.site or '',
            from_container='RIDER', from_ref_id=str(rider_id),
            to_container='VAULT', to_ref_id=state.site or '',
            ref_type='FLOAT',
            actor_id=str(request.user.user_id),
            actor_type=getattr(request.user, 'role', 'SYSTEM'))
        return Response({
            'custody': RiderCustodyStateSerializer(state).data,
            'movement': movement.entry_id,
        })

    @action(detail=True, methods=['post'], url_path='remit')
    def remit(self, request, pk=None):
        """Hand collected COD cash back to the vault, counted at the counter.

        This is what empties the rider's cash balance: the same money a POD
        moved from customer to rider leaves here as REMITTANCE_TO_VAULT, so
        an unremitted rider shows cash-on-hand instead of a settled shift.
        More than the rider holds is refused rather than clamped - a remit
        is a counted handover, not an estimate.
        """
        if not _can_move_cash(request.user):
            return Response(
                {'error': 'Only a store operator can record a remittance.'},
                status=403)
        amount, err = _parse_amount(request.data.get('amount'))
        if err:
            return Response({'error': err}, status=400)
        rider_id, err = _rider_or_404(pk)
        if err is not None:
            return err
        state = RiderCustodyState.objects.filter(rider_id=rider_id).first()
        if state is None:
            return Response(
                {'error': 'That rider has never held float or cash here.'},
                status=404)
        if not _is_admin(request.user) and state.site not in (
                self._caller_sites(request.user)):
            return Response(
                {'error': f'You do not operate {state.site or "this store"}.'},
                status=403)
        held = state.current_cash or Decimal('0.00')
        if amount > held:
            return Response({
                'error': (f'Rider is holding ₹{held} in collected cash, not '
                          f'₹{amount}. Count it again.'),
                'held': str(held),
                'requested': str(amount),
            }, status=400)

        state.current_cash = held - amount
        state.save(update_fields=['current_cash', 'updated_at'])
        movement = CashMovement.objects.create(
            movement_type='REMITTANCE_TO_VAULT', amount=amount,
            site=state.site or '',
            from_container='RIDER', from_ref_id=str(rider_id),
            to_container='VAULT', to_ref_id=state.site or '',
            ref_type='REMIT',
            actor_id=str(request.user.user_id),
            actor_type=getattr(request.user, 'role', 'SYSTEM'))
        return Response({
            'custody': RiderCustodyStateSerializer(state).data,
            'movement': movement.entry_id,
        })

    def _caller_sites(self, user):
        from bounded.ds_ops.access import operator_site_codes
        return operator_site_codes(user)


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


class DeliveryPricingRuleViewSet(viewsets.ModelViewSet):
    """What each store charges for delivery, editable by the people who set
    prices, readable by anyone signed in.

    Checkout reads this through resolve_delivery_fee, so a store with no row
    here simply charges the flat default - a fresh estate is never blocked on
    configuration that nobody has done yet. Writes are admin/ops: the fee
    lands on every order from that store, which is not a cashier's call.
    """
    queryset = DeliveryPricingRule.objects.select_related('site').all()
    serializer_class = DeliveryPricingRuleSerializer
    filterset_fields = ['is_active', 'site']

    def perform_create(self, serializer):
        if not _can_price(self.request.user):
            raise PermissionDenied(
                'Delivery pricing is set by an administrator or ops.')
        serializer.save(updated_by=str(self.request.user.user_id))

    def perform_update(self, serializer):
        if not _can_price(self.request.user):
            raise PermissionDenied(
                'Delivery pricing is set by an administrator or ops.')
        serializer.save(updated_by=str(self.request.user.user_id))

    def perform_destroy(self, instance):
        if not _can_price(self.request.user):
            raise PermissionDenied(
                'Delivery pricing is set by an administrator or ops.')
        instance.delete()
