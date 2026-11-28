from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from bounded.iam.permissions import IsAdminUserOrReadOnly
from . import payouts
from .cashfree_payouts import CashfreePayoutError
from .models import (Payment, CancelIntent, Refund, RefundDecision, CashMovement,
                     RiderCustodyState, RiderEarnings, RiderPayout,
                     EmployeeBankDetail, SalaryPayment, DeliveryPricingRule)
from .serializers import (PaymentSerializer, CancelIntentSerializer,
                          RefundSerializer, RefundDecisionSerializer,
                          CashMovementSerializer, RiderCustodyStateSerializer,
                          RiderEarningsSerializer, RiderPayoutSerializer,
                          EmployeeBankDetailSerializer, SalaryPaymentSerializer,
                          DeliveryPricingRuleSerializer)


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


def _can_run_payout(user):
    """Who may settle rider earnings.

    A payout moves real money out of the company, so it is finance and ops -
    not the counter that hands out float, and never the rider being paid.
    """
    return _is_admin(user) or getattr(user, 'role', '') in (
        'SUPER_ADMIN', 'OPS_MANAGER')


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
    user_id = getattr(user, 'user_id', None)
    if not user_id:
        return None
    return RiderProfile.objects.filter(user_id=user_id).first()


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
        if _is_admin(self.request.user) or _can_run_payout(self.request.user):
            return self.queryset
        return self.queryset.filter(order__in=_my_orders(self.request.user))

    @action(detail=True, methods=['post'], url_path='process')
    def process(self, request, pk=None):
        """Push an approved refund back through the rail that took the money.

        A gateway payment is refunded by Cashfree, using the refund row's own id
        as the provider idempotency key, so a retried click cannot pay the
        customer twice. Anything else (cash collected at the door, a payment
        with no provider payment id) is a manual ops transfer: the row is
        stamped MANUAL_OPS rather than pretending a card rail handled it.
        """
        if not _can_run_payout(request.user):
            return Response(
                {'error': 'Only finance or ops can process a refund.'}, status=403)
        refund = self.get_object()
        if refund.status in ('SUCCESS', 'PROCESSED'):
            return Response(
                {'error': 'This refund has already been processed.'}, status=400)
        amount, err = _parse_amount(request.data.get('amount') or refund.amount)
        if err:
            return Response({'error': err}, status=400)
        payment = refund.payment
        if amount > (refund.amount or Decimal('0.00')) or amount > (
                payment.amount or Decimal('0.00')):
            return Response({
                'error': (f'₹{amount} is more than this refund (₹{refund.amount}) '
                          f'or the captured payment (₹{payment.amount}).'),
            }, status=400)

        note = str(request.data.get('note') or '').strip()
        now = timezone.now()
        from bounded.orders.payments import CashfreeError, refund_payment

        if payment.gateway != 'CASHFREE' or not payment.gateway_order_id:
            refund.status = 'MANUAL_OPS'
            refund.utr = str(request.data.get('utr') or '')[:40]
            refund.initiated_at = refund.initiated_at or now
            refund.completed_at = now
            refund.save(update_fields=[
                'status', 'utr', 'initiated_at', 'completed_at'])
            return Response({
                'refund': RefundSerializer(refund).data,
                'manual': True,
                'message': ('Cash refunds are paid at the counter; this record '
                            'is the ops hand-off.'),
            })

        if not payment.gateway_payment_id:
            return Response({
                'error': ('This payment has no provider payment id, so it '
                          'cannot be refunded through Cashfree.'),
            }, status=400)

        try:
            reply = refund_payment(
                payment, amount, refund_id=refund.refund_id,
                note=note or f'Zippzo refund for {refund.order.order_no}')
        except CashfreeError as exc:
            refund.status = 'FAILED'
            refund.retry_count = (refund.retry_count or 0) + 1
            refund.save(update_fields=['status', 'retry_count'])
            return Response({'error': str(exc)}, status=400)

        provider_status = str(reply.get('refund_status') or '').upper()
        refund.gateway_refund_id = str(
            reply.get('cf_refund_id') or reply.get('refund_id') or '')[:80]
        refund.status = (
            'SUCCESS' if provider_status in ('SUCCESS', 'PROCESSED') else 'PROCESSED')
        refund.initiated_at = now
        refund.completed_at = now if refund.status == 'SUCCESS' else None
        refund.save(update_fields=[
            'gateway_refund_id', 'status', 'initiated_at', 'completed_at'])
        if amount >= (payment.amount or Decimal('0.00')):
            payment.status = 'REFUNDED'
            payment.save(update_fields=['status'])
        return Response({
            'refund': RefundSerializer(refund).data,
            'provider_status': provider_status,
            'manual': False,
        })


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
        if profile is not None:
            return self.queryset.filter(rider_id=profile.rider_id)
        # Counter staff are neither estate admins nor riders, but they are the
        # people who hand float over and take it back: the board must show the
        # riders they can act on. Custody is tracked per rider, not per store,
        # so a row opened by another store in the past still belongs to the
        # rider standing at this counter - match on the row site and on the
        # rider's current posting.
        from bounded.ds_ops.access import operator_site_codes
        from bounded.delivery.models import RiderProfile

        codes = operator_site_codes(user)
        if not codes:
            return self.queryset.none()
        riders_here = RiderProfile.objects.filter(
            current_site__code__in=codes).values('rider_id')
        return self.queryset.filter(
            Q(site__in=codes) | Q(rider_id__in=riders_here)).distinct()

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
        if _is_admin(user) or getattr(user, 'role', '') in ('SUPER_ADMIN', 'OPS_MANAGER'):
            return self.queryset
        profile = _my_rider(user)
        if profile is None:
            return self.queryset.none()
        return self.queryset.filter(rider=profile)


class RiderPayoutViewSet(viewsets.ModelViewSet):
    """Settle a rider's PENDING earnings into one counted payout.

    A payout is a batch, not a flag: ``RiderEarnings.payout`` points at the run
    that paid it, so the rider's statement can be reprinted from the payout row
    even after the orders themselves are archived. Only finance/ops may run one;
    a rider can read their own statements but never settle them.
    """
    queryset = RiderPayout.objects.select_related('rider').prefetch_related(
        'earnings__order').all()
    serializer_class = RiderPayoutSerializer
    filterset_fields = ['status', 'rider']

    def get_queryset(self):
        user = self.request.user
        if not _authenticated(user):
            return self.queryset.none()
        if _is_admin(user) or getattr(user, 'role', '') in (
                'SUPER_ADMIN', 'OPS_MANAGER'):
            return self.queryset
        profile = _my_rider(user)
        if profile is None:
            return self.queryset.none()
        return self.queryset.filter(rider=profile)

    def create(self, request, *args, **kwargs):
        return self._run_payout(request)

    @action(detail=False, methods=['post'], url_path='run')
    def run(self, request):
        """Explicit alias of create: POST rider-payouts/run/."""
        return self._run_payout(request)

    def _run_payout(self, request):
        if not _can_run_payout(request.user):
            return Response(
                {'error': 'Only finance or ops can run a rider payout.'},
                status=403)
        rider_id = request.data.get('rider') or request.data.get('rider_id')
        rider_id, err = _rider_or_404(rider_id)
        if err is not None:
            return err

        with transaction.atomic():
            pending = RiderEarnings.objects.select_for_update().filter(
                rider_id=rider_id, status='PENDING', payout__isnull=True)
            requested = request.data.get('earning_ids')
            if requested:
                pending = pending.filter(earning_id__in=requested)
            rows = list(pending.select_related('order'))
            if not rows:
                return Response({
                    'error': 'That rider has no unsettled earnings to pay.',
                    'pending_count': 0,
                }, status=400)
            total = sum((row.amount or Decimal('0.00')) for row in rows)
            site = str(request.data.get('site') or '').strip()[:50]
            if not site:
                last = RiderEarnings.objects.filter(
                    rider_id=rider_id, order__site__isnull=False
                ).select_related('order__site').order_by('-created_at').first()
                site = last.order.site.code if last and last.order.site_id else ''
            now = timezone.now()
            delivered = [row.order.delivered_at for row in rows if row.order_id]
            delivered = [stamp for stamp in delivered if stamp]
            payout = RiderPayout.objects.create(
                rider_id=rider_id,
                site=site,
                amount=total,
                earnings_count=len(rows),
                period_start=min(delivered) if delivered else None,
                period_end=max(delivered) if delivered else now,
                status='PAID',
                reference=str(request.data.get('reference') or '')[:80],
                created_by=str(request.user.user_id)[:64],
            )
            RiderEarnings.objects.filter(
                earning_id__in=[row.earning_id for row in rows]
            ).update(payout=payout, status='PAID', paid_at=now)

        payout = self.get_queryset().get(pk=payout.pk)
        return Response(
            RiderPayoutSerializer(payout).data, status=201)

    @action(detail=False, methods=['get'], url_path='statement')
    def statement(self, request):
        """One rider's outstanding pay and the runs that settled it."""
        profile = _my_rider(request.user)
        rider_id = request.query_params.get('rider')
        if not (_can_run_payout(request.user)):
            # A rider may only read their own statement.
            if profile is None:
                return Response(
                    {'error': 'You can only read your own statement.'}, status=403)
            if rider_id and str(rider_id) != str(profile.rider_id):
                return Response(
                    {'error': 'You can only read your own statement.'}, status=403)
            rider_id = profile.rider_id
        rider_id, err = _rider_or_404(rider_id)
        if err is not None:
            return err

        from django.db.models import Count, Sum

        settled = RiderEarnings.objects.filter(
            rider_id=rider_id, status='PAID').aggregate(
            total=Sum('amount'), count=Count('earning_id'))
        pending = RiderEarnings.objects.filter(
            rider_id=rider_id, status='PENDING', payout__isnull=True).aggregate(
            total=Sum('amount'), count=Count('earning_id'))
        payouts = self.queryset.filter(rider_id=rider_id).order_by('-created_at')[:50]
        return Response({
            'rider': str(rider_id),
            'pending_amount': str(pending['total'] or Decimal('0.00')),
            'pending_count': pending['count'] or 0,
            'paid_amount': str(settled['total'] or Decimal('0.00')),
            'paid_count': settled['count'] or 0,
            'payouts': RiderPayoutSerializer(payouts, many=True).data,
        })


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

class EmployeeBankDetailViewSet(viewsets.ModelViewSet):
    """Staff beneficiary bank details, readable by operators and edited by admins."""
    queryset = EmployeeBankDetail.objects.select_related('user').all()
    serializer_class = EmployeeBankDetailSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    search_fields = ['user__email', 'user__full_name', 'account_holder_name']


class SalaryPaymentViewSet(viewsets.ModelViewSet):
    """Salary disbursements, optionally settled through Cashfree Payouts."""
    queryset = SalaryPayment.objects.select_related('user', 'site').all()
    serializer_class = SalaryPaymentSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['user', 'site', 'status', 'payout_status']
    search_fields = ['user__email', 'user__full_name', 'reference']
    ordering_fields = ['created_at', 'amount', 'period_end']

    def perform_create(self, serializer):
        uid = getattr(self.request.user, 'user_id', None)
        serializer.save(created_by=uid if uid else None)

    @action(detail=True, methods=['post'], url_path='pay')
    def pay(self, request, pk=None):
        record = self.get_object()
        if record.payout_channel == 'CASHFREE' and record.payout_status in ('PENDING', 'SUCCESS'):
            return Response({'error': 'This salary has already been sent to Cashfree.'},
                            status=status.HTTP_409_CONFLICT)
        detail = EmployeeBankDetail.objects.filter(user=record.user).first()
        if not detail or not (detail.bank_account_number and detail.ifsc):
            return Response({'error': 'Add this employee bank account and IFSC before paying.'},
                            status=status.HTTP_400_BAD_REQUEST)
        beneficiary = f'EMP_{str(record.user_id).replace("-", "")[:20]}'
        reference = f'SP{str(record.payment_id).replace("-", "")[:20]}'
        name = detail.account_holder_name or record.user.full_name or record.user.email
        try:
            values = payouts.start_payout(
                record, beneficiary_id=beneficiary, amount=record.amount,
                reference_id=reference, purpose='SALARY',
                name=name, email=record.user.email, phone=record.user.phone,
                account=detail.bank_account_number, ifsc=detail.ifsc,
                address='')
        except CashfreePayoutError as exc:
            record.payout_channel = 'CASHFREE'
            record.payout_status = 'FAILED'
            record.payout_error = str(exc)[:240]
            record.save(update_fields=['payout_channel', 'payout_status', 'payout_error'])
            return Response({'error': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        for key, value in values.items():
            setattr(record, key, value)
        record.save(update_fields=list(values))
        return Response(self.get_serializer(record).data)

    @action(detail=True, methods=['post'], url_path='sync-payout')
    def sync_payout(self, request, pk=None):
        record = self.get_object()
        if record.payout_channel != 'CASHFREE' or not record.transfer_id:
            return Response({'error': 'This salary was not sent through Cashfree.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            values = payouts.sync_payout(record)
        except CashfreePayoutError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        for key, value in values.items():
            setattr(record, key, value)
        record.save(update_fields=list(values))
        return Response(self.get_serializer(record).data)
