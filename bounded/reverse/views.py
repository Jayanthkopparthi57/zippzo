from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction

from .models import ReturnOrder, RTVOrder, RTSOrder
from .serializers import ReturnOrderSerializer, RTVOrderSerializer, RTSOrderSerializer

# A return is only worth opening once the goods have actually left the store
# for the customer, or once the order failed on the way back.
RETURNABLE_ORDER_STATES = {'DELIVERED', 'CANCELLED_PENDING_RETURN', 'FAILED'}

# The statuses a return can leave on its own. Anything else (REFUNDED, CLOSED)
# means somebody has already decided the outcome.
OPEN_RETURN_STATES = {
    'RETURN_CREATED', 'APPROVED', 'PICKUP_SCHEDULED', 'PICKED_UP',
    'RECEIVED_AT_DS', 'QC_IN_PROGRESS', 'REFUND_DECISION',
}

QC_DISPOSITIONS = {'RESTOCK', 'SCRAP', 'DAMAGED', 'RETURN_TO_VENDOR'}


def _visible_returns(user):
    """A shopper sees their own returns; the store sees its own orders'."""
    from bounded.ds_ops.access import is_superuser, operator_site_codes

    base = ReturnOrder.objects.select_related('order')
    if not user or not getattr(user, 'is_authenticated', False):
        return base.none()
    if is_superuser(user) or getattr(user, 'role', '') == 'ADMIN':
        return base.all()

    mine = base.filter(order__customer__user_id=user.user_id)
    codes = operator_site_codes(user)
    if not codes:
        # No site assignment still leaves a shopper their own returns - the
        # empty operator set must not empty the drawer.
        return mine
    return (mine | base.filter(order__site__code__in=codes)).distinct()


class ReturnOrderViewSet(viewsets.ModelViewSet):
    queryset = ReturnOrder.objects.select_related('order').all()
    serializer_class = ReturnOrderSerializer
    filterset_fields = ['status', 'fault']

    def get_queryset(self):
        return _visible_returns(self.request.user)

    def create(self, request, *args, **kwargs):
        """Open a return against the caller's own order.

        The serializer is fully read-only, so this builds the row itself and
        fixes every field a client is not entitled to choose: no status, no
        fault, no refund. The order must be theirs *and* already delivered -
        the previous open serializer accepted any order id, which is how one
        account could file a return against somebody else's purchase.
        """
        from bounded.orders.models import CustomerOrder

        order_id = request.data.get('order')
        if not order_id:
            return Response({'error': 'order is required'}, status=400)
        order = CustomerOrder.objects.filter(pk=order_id).select_related(
            'customer').first()
        if order is None:
            return Response({'error': 'Order not found.'}, status=404)

        owns = (order.customer_id is not None
                and order.customer.user_id == request.user.user_id)
        if not owns:
            # 404 rather than 403: a foreign order id must not be confirmable.
            return Response({'error': 'Order not found.'}, status=404)

        if order.status not in RETURNABLE_ORDER_STATES:
            return Response({
                'error': f'{order.order_no} is {order.status}; a return can '
                         f'only be opened for '
                         f'{", ".join(sorted(RETURNABLE_ORDER_STATES))}.'
            }, status=409)

        already = ReturnOrder.objects.filter(order=order).exclude(
            status__in=OPEN_RETURN_STATES | {'RETURN_DENIED', 'CLOSED'}).first()
        if already is not None:
            return Response({
                'error': f'A return is already open for {order.order_no}.',
                'return_id': str(already.return_id),
            }, status=409)

        reason = str(request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'Tell us what went wrong.'}, status=400)

        ret = ReturnOrder.objects.create(order=order, reason=reason,
                                         fault='NONE', status='RETURN_CREATED')
        return Response(ReturnOrderSerializer(ret).data, status=201)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def qc(self, request, pk=None):
        """Record what inspection found - the store's decision, not the shopper's."""
        from bounded.ds_ops.access import require_site_access

        ret = self.get_object()
        order = ret.order
        if order.site_id is None:
            return Response({'error': 'This order has no store against it.'},
                            status=409)
        try:
            require_site_access(request.user, order.site.code)
        except Exception as exc:  # PermissionDenied carries the reason
            return Response({'error': str(exc)}, status=403)

        disposition = str(request.data.get('qc_disposition') or '').upper()
        if disposition not in QC_DISPOSITIONS:
            return Response({
                'error': f'qc_disposition must be one of '
                         f'{", ".join(sorted(QC_DISPOSITIONS))}.'
            }, status=400)
        if ret.received_at_ds is None:
            return Response({
                'error': 'Goods have not been received back at the store yet.'
            }, status=409)

        ret.qc_disposition = disposition
        if ret.status in OPEN_RETURN_STATES:
            ret.status = 'REFUND_DECISION' if disposition == 'RESTOCK' else 'RETURN_DENIED'
        ret.save(update_fields=['qc_disposition', 'status'])

        refund = request.data.get('refund_amount')
        if refund is not None and disposition == 'RESTOCK':
            from decimal import Decimal, InvalidOperation
            try:
                amount = Decimal(str(refund)).quantize(Decimal('0.01'))
            except (InvalidOperation, ValueError, ArithmeticError):
                return Response({'error': 'refund_amount is not an amount.'},
                                status=400)
            if not amount.is_finite() or amount < 0:
                return Response({'error': 'refund_amount must be a non-negative amount.'},
                                status=400)
            if amount > order.grand_total:
                return Response({
                    'error': f'A refund cannot exceed the {order.grand_total} '
                             f'paid for {order.order_no}.'
                }, status=400)
            ret.refund_amount = amount
            ret.save(update_fields=['refund_amount'])

        return Response(ReturnOrderSerializer(ret).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def restock(self, request, pk=None):
        """Put received goods back into sellable stock at the given site.

        RESTOCK disposition -> balance increases and a RETURN movement is
        written. Idempotent: a second call is a no-op.

        The no-op holds for two independent reasons, because the ledger alone is
        not enough. `apply_stock` keys each movement on (type, ref, sku, lot,
        site, direction, container, container_ref), so replaying with the *same*
        bin is already swallowed by the idempotency check. Restocking the same
        return into a *different* bin is a different key and would add the units
        a second time, so `received_at_ds` is checked up front under
        select_for_update to close that window too.
        """
        from django.utils import timezone

        from bounded.catalog.models import InventoryLot, Sku
        from bounded.ds_ops.access import require_site_access
        from bounded.inventory.stock import apply_stock
        from bounded.network.models import Site, Location

        # get_object() only proves the return is *visible* to this caller, and
        # a shopper's own return is visible to them. Restocking writes stock, so
        # it additionally requires being on the store's roster.
        peek = ReturnOrder.objects.select_related('order').filter(pk=pk).first()
        if peek is None:
            return Response({'success': False, 'error': 'Return not found'}, status=404)
        if peek.order.site_id is None:
            return Response({'success': False,
                             'error': 'This order has no store against it.'},
                            status=409)
        try:
            require_site_access(request.user, peek.order.site.code)
        except Exception as exc:  # PermissionDenied carries the reason
            return Response({'success': False, 'error': str(exc)}, status=403)

        ret = ReturnOrder.objects.select_for_update().filter(pk=pk).first()
        if ret is None:
            return Response({'success': False, 'error': 'Return not found'}, status=404)

        if ret.received_at_ds:
            return Response({'success': True, 'already_restocked': True,
                             'return_id': str(ret.return_id),
                             'received_at_ds': str(ret.received_at_ds),
                             'site': ret.order.site.code if ret.order.site_id else None,
                             'restocked': []})

        if ret.qc_disposition != 'RESTOCK':
            return Response({
                'success': False,
                'error': f'QC disposition is {ret.qc_disposition or "unset"}; only RESTOCK puts goods back into stock.',
            }, status=400)

        code = request.data.get('site_code') or request.data.get('store_code')
        if not code:
            return Response({'success': False, 'error': 'site_code is required'}, status=400)
        try:
            site = Site.objects.get(code=code)
        except Site.DoesNotExist:
            return Response({'success': False, 'error': 'Site not found'}, status=404)

        bin_code = request.data.get('bin') or ''
        if bin_code:
            loc = Location.objects.filter(location_id=bin_code).first()
            if loc is None:
                return Response({'success': False,
                                 'error': f'Location {bin_code} not found'}, status=400)
            if loc.site_id != site.pk:
                return Response({'success': False,
                                 'error': f'Bin {bin_code} does not belong to {site.code}'},
                                status=400)
            container_ref = loc.location_id
        else:
            container_ref = ''

        lines = [l for l in ret.order.lines.all() if l.shipped_qty > 0]
        if not lines:
            return Response({'success': False,
                             'error': 'no shipped order lines to restock'}, status=400)
        missing_lot = [l.line_id for l in lines if l.lot_id is None]
        if missing_lot:
            return Response({
                'success': False,
                'error': 'order lines are missing a lot; stock cannot be attributed',
                'lines': [str(x) for x in missing_lot],
            }, status=400)

        moved = []
        for line in lines:
            sku = Sku.objects.filter(sku_id=line.sku_id).first()
            if sku is None:
                return Response({'success': False,
                                 'error': f'SKU for line {line.line_id} not found'},
                                status=400)
            lot = InventoryLot.objects.filter(lot_id=line.lot_id).first()
            if lot is None:
                return Response({'success': False,
                                 'error': f'Lot for line {line.line_id} not found'},
                                status=400)
            ok = apply_stock(
                site=site, sku=sku, lot=lot,
                qty=line.shipped_qty, direction='IN',
                movement_type='RETURN', ref_type='RETURN', ref_id=ret.return_id,
                actor_id=request.data.get('actor_id', ''),
                container='BIN' if container_ref else 'SITE',
                container_ref=container_ref,
            )
            if ok:
                moved.append({'sku': sku.sku_code, 'lot': str(lot.lot_id),
                              'qty': line.shipped_qty})

        ret.received_at_ds = ret.received_at_ds or timezone.now()
        ret.save(update_fields=['received_at_ds'])

        return Response({'success': True, 'return_id': str(ret.return_id),
                         'site': site.code, 'restocked': moved})


def _scoped_orders(user, model):
    """RTV / RTS rows for orders this caller may see.

    Both viewsets were bare ModelViewsets over the whole table, so any
    authenticated account could create, edit or delete the logistics record
    behind somebody else's return-to-vendor shipment.
    """
    from bounded.ds_ops.access import is_superuser, operator_site_codes

    base = model.objects.select_related('order')
    if not user or not getattr(user, 'is_authenticated', False):
        return base.none()
    if is_superuser(user) or getattr(user, 'role', '') == 'ADMIN':
        return base.all()
    mine = base.filter(order__customer__user_id=user.user_id)
    codes = operator_site_codes(user)
    if not codes:
        return mine
    return (mine | base.filter(order__site__code__in=codes)).distinct()


class RTVOrderViewSet(viewsets.ModelViewSet):
    queryset = RTVOrder.objects.all()
    serializer_class = RTVOrderSerializer

    def get_queryset(self):
        return _scoped_orders(self.request.user, RTVOrder)


class RTSOrderViewSet(viewsets.ModelViewSet):
    queryset = RTSOrder.objects.all()
    serializer_class = RTSOrderSerializer

    def get_queryset(self):
        return _scoped_orders(self.request.user, RTSOrder)
