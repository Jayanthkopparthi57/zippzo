# DS Ops Views
from django.db import transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from django.db.models import Count, Sum
from bounded.iam.names import AttributionContextMixin, acting_user_id
from .models import PickTask, PackTask, SortingWave, StagedAging, TransferOrder, BinTransfer
from .serializers import PickTaskSerializer, PackTaskSerializer, SortingWaveSerializer, StagedAgingSerializer, TransferOrderSerializer, BinTransferSerializer

# Below this many units on hand a lot is reported as LOW_STOCK. There is no
# per-SKU reorder point in the catalog, so the store console uses one flat rule
# and says so rather than inventing a threshold from an unrelated field.
DS_LOW_STOCK_THRESHOLD = 10

class PickTaskViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = PickTask.objects.all()
    serializer_class = PickTaskSerializer
    attribution_fields = ('assigned_to', 'started_by', 'completed_by')
    # `batch` is the transfer this pick belongs to. Packing reads a transfer's
    # lines through ?batch=, and without it here the param was silently ignored:
    # a lookup for one transfer returned every pick task in the system, and
    # PickTask ordering is -created_at, so the packer adopted another batch's
    # lines and "verified" a tote against stock that was never on it.
    # Actor + window lookups feed the outbound ledger's "who picked, when".
    filterset_fields = {
        'status': ['exact'],
        'sku': ['exact'],
        'batch': ['exact'],
        'picklist_id': ['exact'],
        'order': ['exact'],
        'assigned_to': ['exact'],
        'started_by': ['exact'],
        'completed_by': ['exact'],
        'created_at': ['gte', 'lte'],
        'completed_at': ['gte', 'lte'],
    }

    def _apply_pick_to_ledger(self, task, actor_id=''):
        """Decrement source stock exactly once when a pick completes."""
        from bounded.catalog.models import InventoryLot, Sku
        from bounded.inventory.stock import apply_stock, InsufficientStock
        from bounded.network.models import Location, Site

        if not task.bin:
            return None
        loc = Location.objects.filter(location_id=task.bin).select_related('site').first()
        site = loc.site if loc else None
        if site is None:
            return None

        sku = Sku.objects.filter(sku_id=task.sku).first()
        lot = InventoryLot.objects.filter(lot_id=task.lot).first() if task.lot else None
        if sku is None:
            return None

        try:
            apply_stock(
                site=site, sku=sku, lot=lot, qty=task.picked_qty,
                direction='OUT', movement_type='PICK',
                ref_type='PICKTASK', ref_id=task.pk,
                actor_id=actor_id or task.assigned_to or '',
                container='BIN', container_ref=task.bin,
                enforce_available=True,
            )
        except InsufficientStock:
            # Fall back to site-level stock (e.g. units sitting on a pallet/LPN
            # rather than in the exact pick bin) before rejecting the pick.
            try:
                apply_stock(
                    site=site, sku=sku, lot=lot, qty=task.picked_qty,
                    direction='OUT', movement_type='PICK',
                    ref_type='PICKTASK', ref_id=task.pk,
                    actor_id=actor_id or task.assigned_to or '',
                    container='SITE', container_ref='',
                    enforce_available=True,
                )
            except InsufficientStock as e:
                from rest_framework import serializers as _s
                raise _s.ValidationError({'stock': str(e)})
        return site

    @transaction.atomic
    def perform_update(self, serializer):
        task = serializer.instance
        was_completed = task.status == 'COMPLETED'
        was_started = task.started_at is not None
        serializer.save()
        stamp = []
        if task.status == 'COMPLETED' and not was_completed:
            # The PATCH path never stamped completion, so avg-pick reporting
            # silently dropped every task closed from the queue screen.
            if task.completed_at is None:
                from django.utils import timezone as _tz
                task.completed_at = _tz.now()
                stamp.append('completed_at')
            task.completed_by = acting_user_id(self.request)
            stamp.append('completed_by')
            self._apply_pick_to_ledger(task)
        # Claiming a task (assigned_to set or status flips to IN_PROGRESS)
        # stamps started_at so avg pick time is real, not null forever.
        if task.status == 'IN_PROGRESS' and not was_started:
            from django.utils import timezone as _tz
            task.started_at = _tz.now()
            stamp.append('started_at')
            task.started_by = acting_user_id(self.request)
            stamp.append('started_by')
        if stamp:
            task.save(update_fields=stamp)

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        """Hand this pick to one worker. Unassign by sending user=null."""
        task = self.get_object()
        if task.status in ('COMPLETED', 'CANCELLED'):
            return Response({'error': f'Task is {task.status} and cannot be reassigned.'}, status=400)
        user = request.data.get('user')
        if user in (None, '', 'null'):
            task.assigned_to = None
            task.save(update_fields=['assigned_to'])
            return Response({'success': True, 'assigned_to': None, 'status': task.status})
        task.assigned_to = user
        if task.status == 'NOT_STARTED':
            from django.utils import timezone as _tz
            task.status = 'IN_PROGRESS'
            task.started_at = task.started_at or _tz.now()
            # Work attribution: the assignee is who will do the picking, so
            # they are who the start is recorded against, not the manager
            # handing the task over.
            task.started_by = user
        task.save()
        return Response({'success': True, 'assigned_to': str(task.assigned_to), 'status': task.status})

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        task = self.get_object()
        if task.status in ('COMPLETED', 'CANCELLED'):
            return Response({'error': f'Task is {task.status}.'}, status=400)
        task.assigned_to = None
        task.save(update_fields=['assigned_to'])
        return Response({'success': True, 'assigned_to': None})

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def complete(self, request, pk=None):
        from django.utils import timezone as _tz
        task = self.get_object()
        if task.status == 'COMPLETED':
            return Response({'success': True, 'already_completed': True, 'picked_qty': task.picked_qty})
        if not task.picked_qty:
            task.picked_qty = task.qty
        task.status = 'COMPLETED'
        task.completed_at = task.completed_at or _tz.now()
        # Stamped from the token; a body-supplied actor_id can never claim
        # someone else's completion (same rule as the pick-scan endpoint).
        task.completed_by = acting_user_id(request)
        if task.started_at is None:
            task.started_at = task.completed_at
            if task.started_by is None:
                task.started_by = task.completed_by
        task.save()
        site = self._apply_pick_to_ledger(task, str(acting_user_id(request) or ''))
        return Response({'success': True, 'picklist_id': str(task.picklist_id),
                         'picked_qty': task.picked_qty, 'status': task.status,
                         'site': site.code if site else None})

class PackTaskViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = PackTask.objects.all()
    serializer_class = PackTaskSerializer
    attribution_fields = ('assigned_to', 'completed_by')
    filterset_fields = {
        'status': ['exact'],
        'assigned_to': ['exact'],
        'completed_by': ['exact'],
        'order': ['exact'],
        'created_at': ['gte', 'lte'],
        'completed_at': ['gte', 'lte'],
    }

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        task = self.get_object()
        if task.status in ('COMPLETED', 'CANCELLED'):
            return Response({'error': f'Task is {task.status} and cannot be reassigned.'}, status=400)
        user = request.data.get('user')
        if user in (None, '', 'null'):
            task.assigned_to = None
            task.save(update_fields=['assigned_to'])
            return Response({'success': True, 'assigned_to': None, 'status': task.status})
        task.assigned_to = user
        if task.status == 'NOT_STARTED':
            task.status = 'IN_PROGRESS'
            from django.utils import timezone as _tz
            task.started_at = task.started_at or _tz.now()
        task.save()
        return Response({'success': True, 'assigned_to': str(task.assigned_to), 'status': task.status})

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        task = self.get_object()
        if task.status in ('COMPLETED', 'CANCELLED'):
            return Response({'error': f'Task is {task.status}.'}, status=400)
        task.assigned_to = None
        task.save(update_fields=['assigned_to'])
        return Response({'success': True, 'assigned_to': None})

class SortingWaveViewSet(viewsets.ModelViewSet):
    queryset = SortingWave.objects.all()
    serializer_class = SortingWaveSerializer
    filterset_fields = ['status', 'type']

class StagedAgingViewSet(viewsets.ReadOnlyModelViewSet):
    """How long a packed order has been sitting before a rider collects it.

    Read-only and narrowed to the caller's stores: staged ageing says how much
    work is waiting at each site, and an operator at one store has no business
    watching another store's queue.
    """
    queryset = StagedAging.objects.all()
    serializer_class = StagedAgingSerializer
    filterset_fields = ['site', 'current_stage']

    def get_queryset(self):
        from .access import is_superuser, operator_site_codes

        user = self.request.user
        if user is None or not getattr(user, 'is_authenticated', False):
            return self.queryset.none()
        if is_superuser(user):
            return self.queryset
        return self.queryset.filter(site__in=operator_site_codes(user))

class TransferOrderViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = TransferOrder.objects.all()
    serializer_class = TransferOrderSerializer
    attribution_fields = ('created_by', 'dispatched_by')
    filterset_fields = {
        'status': ['exact'],
        'source_site': ['exact'],
        'dest_site': ['exact'],
        'created_by': ['exact'],
        'dispatched_by': ['exact'],
        'created_at': ['gte', 'lte'],
    }

    def perform_create(self, serializer):
        serializer.save(created_by=acting_user_id(self.request))

    def _lpns_for(self, to):
        """LPNs explicitly packed against this transfer.

        Matching on source/dest lane alone would sweep up unrelated LPNs when two
        transfers share a lane, so the LPN must name its transfer.
        """
        from bounded.inventory.models import LpnMaster
        return LpnMaster.objects.filter(
            transfer_id=to.pk,
            status__in=['PACKED', 'CREATED'],
        )

    def _mark_in_transit(self, to):
        """Dispatching the transfer must publish its LPNs to the dark store."""
        from bounded.inventory.models import LpnContent
        moved = []
        for lpn in self._lpns_for(to):
            qty = sum(LpnContent.objects.filter(lpn=lpn).values_list('qty', flat=True))
            if not qty:
                continue
            lpn.status = 'IN_TRANSIT'
            lpn.save(update_fields=['status'])
            moved.append(lpn.barcode)
        return moved

    @transaction.atomic
    def perform_update(self, serializer):
        to = serializer.instance
        was = to.status
        serializer.save()
        if to.status == 'IN_TRANSIT' and was != 'IN_TRANSIT':
            # The PUT path to dispatch must record who put it on the road,
            # exactly like the dedicated dispatch action below.
            to.dispatched_by = acting_user_id(self.request)
            to.save(update_fields=['dispatched_by'])
            self._mark_in_transit(to)

    @action(detail=True, methods=['post'], url_path='dispatch')
    @transaction.atomic
    def mark_dispatch(self, request, pk=None):
        to = self.get_object()
        to.status = 'IN_TRANSIT'
        to.dispatched_by = acting_user_id(request)
        to.save()
        moved = self._mark_in_transit(to)
        return Response({'success': True, 'transfer_id': str(to.transfer_id),
                         'status': to.status, 'lpns_dispatched': moved})

class BinTransferViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = BinTransfer.objects.all()
    serializer_class = BinTransferSerializer
    attribution_fields = ('created_by', 'completed_by')
    filterset_fields = {
        'status': ['exact'],
        'source_bin': ['exact'],
        'dest_bin': ['exact'],
        'created_by': ['exact'],
        'completed_by': ['exact'],
        'created_at': ['gte', 'lte'],
    }

    def perform_create(self, serializer):
        serializer.save(created_by=acting_user_id(self.request))

    def perform_update(self, serializer):
        task = serializer.instance
        was_completed = task.status == 'COMPLETED'
        serializer.save()
        if task.status == 'COMPLETED' and not was_completed:
            serializer.instance.completed_by = acting_user_id(self.request)
            serializer.instance.save(update_fields=['completed_by'])


# Dark Store Standalone Views (local imports to avoid circular dependencies)
class DSOverviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import timedelta
        from django.utils import timezone
        from django.db.models import Sum, Count, Avg, Q, F, ExpressionWrapper, FloatField
        from bounded.network.models import Site
        from bounded.orders.models import CustomerOrder
        from bounded.inventory.models import LpnMaster, StockBalance
        from bounded.delivery.models import RiderProfile
        from bounded.ds_ops.models import PickTask
        from bounded.network.models import EmployeeSiteAssignment
        from bounded.supply.models import PutawayTask

        store_code = request.query_params.get('store_code', '')
        site = None
        if store_code:
            try:
                site = Site.objects.get(code=store_code)
            except Site.DoesNotExist:
                return Response({'error': 'Site not found'}, status=404)

        orders = CustomerOrder.objects.all()
        if site:
            orders = orders.filter(site=site)
        today_start = timezone.now() - timedelta(days=1)

        def _orders():
            return CustomerOrder.objects.filter(site=site) if site else CustomerOrder.objects.all()

        total_orders = _orders().count()
        active_orders = _orders().filter(
            status__in=['PLACED', 'PAYMENT_PENDING', 'CONFIRMED', 'PICKING', 'PICKED', 'PACKED']
        ).count()
        out_for_delivery = _orders().filter(status__in=['RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED']).count()

        # Delivered in the last 24h, and the money actually collected for them.
        delivered_today = _orders().filter(status='DELIVERED', delivered_at__gte=today_start)
        today_dispatched_orders = delivered_today.count()
        revenue = delivered_today.aggregate(s=Sum('grand_total'))['s'] or 0

        # SLA: delivered vs. cancelled-after-placement, over the same window.
        settled_today = _orders().filter(
            Q(status='DELIVERED', delivered_at__gte=today_start)
            | Q(status__in=['CANCELLED', 'CANCELLED_PENDING_RETURN', 'EXPIRED', 'FAILED', 'REFUNDED'],
                placed_at__gte=today_start)
        ).count()
        delivered_today_count = delivered_today.count()
        # Null (not 0) when nothing settled: "no data" must not read as "0% SLA".
        sla_compliance_pct = round(100.0 * delivered_today_count / settled_today, 2) if settled_today else None

        # Real pick duration: completed tasks that recorded start and finish.
        picks = PickTask.objects.filter(completed_at__isnull=False, started_at__isnull=False)
        avg_pick = picks.annotate(
            secs=ExpressionWrapper(F('completed_at') - F('started_at'), output_field=FloatField())
        ).aggregate(a=Avg('secs'))['a']

        pickers = EmployeeSiteAssignment.objects.filter(is_active=True)
        if site:
            pickers = pickers.filter(site=site)
        active_pickers_count = pickers.filter(role_at_site__icontains='pick').count()

        riders = RiderProfile.objects.filter(is_online=True)
        if site:
            riders = riders.filter(current_site=site)
        online_riders_count = riders.count()

        if site:
            lpn_qs = LpnMaster.objects.filter(current_site=site)
            incoming_lpns = LpnMaster.objects.filter(dest_site=site, status='IN_TRANSIT').count()
            shelf_inventory = StockBalance.objects.filter(site=site).aggregate(
                total_units=Sum('qty'),
                total_skus=Count('sku', distinct=True)
            )
        else:
            lpn_qs = LpnMaster.objects.all()
            incoming_lpns = LpnMaster.objects.filter(dest_site__isnull=False, status='IN_TRANSIT').count()
            shelf_inventory = StockBalance.objects.all().aggregate(
                total_units=Sum('qty'),
                total_skus=Count('sku', distinct=True)
            )
        total_lpns = lpn_qs.count()

        open_putaways = PutawayTask.objects.all()
        if site:
            open_putaways = open_putaways.filter(grn_line__grn__asn__dest_site=site)
        pending_putaways = open_putaways.exclude(status='CONFIRMED').count()

        return Response({
            'scope': {'site': site.code if site else None, 'site_name': site.name if site else None},
            'sla_compliance_pct': sla_compliance_pct,
            'avg_pick_time_sec': round(avg_pick, 1) if avg_pick is not None else None,
            'active_pickers_count': active_pickers_count,
            'online_riders_count': online_riders_count,
            'today_dispatched_orders': today_dispatched_orders,
            'today_revenue': str(revenue),
            'total_orders': total_orders,
            'active_orders': active_orders,
            'out_for_delivery': out_for_delivery,
            'total_lpns': total_lpns,
            'incoming_lpns': incoming_lpns,
            'pending_putaways': pending_putaways,
            'shelf_inventory': shelf_inventory,
        })

class DSIncomingLpnsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.network.models import Site
        from bounded.inventory.models import LpnMaster
        store_code = request.query_params.get('store_code', '')
        site = None
        if store_code:
            try:
                site = Site.objects.get(code=store_code)
            except Site.DoesNotExist:
                return Response({'error': 'Site not found'}, status=404)

        lpns = LpnMaster.objects.filter(dest_site=site, status='IN_TRANSIT') if site else LpnMaster.objects.filter(status='IN_TRANSIT')
        data = []
        for lpn in lpns:
            contents = list(lpn.contents.all())
            data.append({
                'id': lpn.lpn_id,
                'barcode': lpn.barcode,
                'lpn_type': lpn.lpn_type,
                'status': lpn.status,
                'mother_hub': lpn.source_site.code if lpn.source_site else 'UNKNOWN',
                'item_count': len(contents),
                'total_units': sum(c.qty for c in contents),
                'created_at': str(lpn.created_at),
            })
        return Response(data)


class DSShelfPutawayView(APIView):
    """Break a received LPN down onto the dark store's pick-face bins.

    Receipt parks the stock in the LPN container; this is the step that makes it
    pickable, mirroring the mother-hub putaway flow.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        from bounded.catalog.models import InventoryLot, Sku
        from bounded.inventory.models import LpnContent, LpnMaster, StockBalance
        from bounded.inventory.stock import apply_stock, InsufficientStock
        from bounded.network.models import Location

        data = request.data
        lpn = LpnMaster.objects.filter(lpn_id=data.get('lpn')).first()
        if lpn is None:
            return Response({'error': 'LPN not found'}, status=404)
        if lpn.status != 'RECEIVED':
            return Response({'error': f'LPN status is {lpn.status}; must be RECEIVED'},
                            status=400)
        site = lpn.current_site
        if site is None:
            return Response({'error': 'LPN has no current site'}, status=400)

        placements = data.get('placements') or []
        if not placements:
            return Response({'error': 'placements[] with {sku, lot, bin, qty} is required'},
                            status=400)

        moved = []
        for p in placements:
            bin_id = p.get('bin') or p.get('location_id')
            loc = Location.objects.filter(location_id=bin_id).first()
            if loc is None:
                return Response({'error': f'Location {bin_id} not found'}, status=400)
            if loc.site_id != site.pk:
                return Response({'error': f'Bin {bin_id} does not belong to {site.code}'},
                                status=400)
            sku = Sku.objects.filter(sku_id=p.get('sku')).first()
            lot = InventoryLot.objects.filter(lot_id=p.get('lot')).first() if p.get('lot') else None
            qty = int(p.get('qty') or 0)
            if sku is None or qty <= 0:
                continue
            try:
                ok = apply_stock(
                    site=site, sku=sku, lot=lot, qty=qty, direction='OUT',
                    movement_type='SHELF_PICK', ref_type='LPN',
                    ref_id=f"{lpn.lpn_id}:{loc.location_id}",
                    container='LPN', container_ref=str(lpn.lpn_id),
                    enforce_available=True,
                )
            except InsufficientStock as e:
                return Response({'error': str(e)}, status=400)
            if not ok:
                continue
            apply_stock(
                site=site, sku=sku, lot=lot, qty=qty, direction='IN',
                movement_type='SHELF_PUTAWAY', ref_type='LPN',
                ref_id=f"{lpn.lpn_id}:{loc.location_id}",
                container='BIN', container_ref=loc.location_id,
            )
            moved.append({'sku': sku.sku_code,
                          'lot': str(lot.lot_id) if lot else None,
                          'bin': loc.location_id, 'qty': qty})

        # Once nothing is left in the tote the LPN is free to re-use.
        remaining = StockBalance.objects.filter(
            site=site, container='LPN', container_ref=str(lpn.lpn_id)
        ).aggregate(t=Sum('qty'))['t'] or 0
        fully_shelved = remaining == 0
        if fully_shelved:
            lpn.status = 'EMPTY'
            lpn.current_container = None
            lpn.current_ref_id = None
            lpn.save(update_fields=['status', 'current_container', 'current_ref_id'])

        return Response({'success': True, 'lpn': str(lpn.lpn_id),
                         'site': site.code, 'shelved': moved,
                         'lpn_status': lpn.status,
                         'lpn_emptied': fully_shelved})

class DSInventoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.network.models import Site
        from bounded.catalog.models import InventoryLot
        from bounded.inventory.models import StockBalance
        store_code = request.query_params.get('store_code', '')
        site = None
        if store_code:
            try:
                site = Site.objects.get(code=store_code)
            except Site.DoesNotExist:
                return Response({'error': 'Site not found'}, status=404)

        qty_by_lot = dict(
            StockBalance.objects.filter(site=site)
            .values_list('lot_id')
            .annotate(total=Sum('qty'))
        ) if site else {}

        # The bin a lot is actually shelved in is the BIN container's ref, not
        # InventoryLot.bucket — `bucket` is a quality state (Good / BAD /
        # QC_HOLD) and reading it as a location made every row report "Bin: Good".
        # A lot split across several bins keeps its first ref; this field is a
        # display hint, and the authoritative per-bin position is StockBalance.
        bin_by_lot = {}
        if site:
            for lot_id, ref in StockBalance.objects.filter(
                site=site, container='BIN'
            ).values_list('lot_id', 'container_ref'):
                if ref:
                    bin_by_lot.setdefault(lot_id, ref)

        # The store holds stock through `StockBalance`, and the lots those
        # balances point at are raised at the warehouse that owns the product
        # (WH-02A599 for DS-02A599), never at the dark store. Selecting
        # `InventoryLot` by this site therefore matched nothing at all: every
        # dark store rendered "no stock" here while the command centre beside
        # it reported units, because that tile sums `StockBalance`. Pick the
        # lots this store actually holds instead.
        #
        # With no store selected there is no shelf to describe, so the answer
        # is an empty list rather than every lot in the network wearing a
        # zero balance.
        held = (StockBalance.objects.filter(site=site)
                if site else StockBalance.objects.none())
        lots = (InventoryLot.objects.filter(lot_id__in=held.values('lot_id'))
                .select_related('sku').distinct())
        data = []
        for lot in lots:
            on_hand = qty_by_lot.get(lot.lot_id, 0)
            data.append({
                'id': str(lot.lot_id),
                'sku': str(lot.sku.sku_id),
                'sku_code': lot.sku.sku_code,
                'product_name': lot.sku.name,
                'category': lot.sku.sub_category or 'General',
                'batch_code': lot.batch_number,
                'expiry_date': str(lot.expiry_date) if lot.expiry_date else None,
                'stock_qty': on_hand,
                # InventoryLot has no `available_qty`. The old status expression
                # read one, so this endpoint raised AttributeError and 500'd on
                # every request; the badge now derives from the same on-hand sum
                # this endpoint reports as `stock_qty`, so the two agree.
                'min_threshold': None,
                'mrp': float(lot.mrp) if lot.mrp else 0,
                'shelf_bin': bin_by_lot.get(lot.lot_id),
                'status': 'OPTIMAL' if on_hand > DS_LOW_STOCK_THRESHOLD
                          else 'LOW_STOCK' if on_hand > 0
                          else 'OUT_OF_STOCK',
                'lot_bucket': lot.bucket,
                'storage_zone': lot.sku.storage_zone,
            })
        return Response(data)

class DSReceiveLpnView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        from bounded.inventory.models import LpnContent, LpnMaster
        from bounded.inventory.stock import apply_stock
        from bounded.network.models import Site
        data = request.data
        barcode = data.get('barcode')
        seal = data.get('seal_number')
        received_by = data.get('received_by')
        store_code = data.get('store_code', '')

        if not store_code:
            return Response({'error': 'store_code is required'}, status=400)
        try:
            site = Site.objects.get(code=store_code)
        except Site.DoesNotExist:
            return Response({'error': 'Store not found'}, status=404)

        lpn = LpnMaster.objects.filter(barcode=barcode).first()
        if not lpn:
            return Response({'error': 'LPN not found'}, status=404)

        from_site = lpn.current_site
        moved = []
        if from_site and from_site.pk != site.pk:
            # Stock already left the source when the LPN was picked, so receipt
            # only has to bring it into the dark store's custody.
            for c in LpnContent.objects.filter(lpn=lpn).select_related('sku', 'lot'):
                try:
                    if apply_stock(
                            site=site, sku=c.sku, lot=c.lot, qty=c.qty,
                            direction='IN', movement_type='LPN_RECEIPT',
                            ref_type='LPN', ref_id=lpn.lpn_id,
                            actor_id=received_by or '',
                            container='LPN', container_ref=str(lpn.lpn_id)):
                        moved.append({'sku': c.sku.sku_code, 'qty': c.qty})
                except Exception as e:
                    return Response({'error': f'Stock receipt failed: {e}'}, status=400)

        lpn.status = 'RECEIVED'
        lpn.dest_site = site
        lpn.current_site = site
        lpn.save()
        return Response({'success': True, 'lpn_barcode': lpn.barcode,
                         'from_site': from_site.code if from_site else None,
                         'site': site.code,
                         'stock_moved': moved,
                         'message': 'LPN received, stock in dark store custody, ready for shelf putaway'})

class DSOrderActionView(APIView):
    permission_classes = [IsAuthenticated]

    # action -> (target status, allowed source statuses)
    #
    # COMPLETE_PICK lands on PICKED, not PACKED. It used to jump straight to
    # PACKED, which made "packed" mean two different things: stock had been
    # scanned off a shelf, and stock was in a tote with an LPN. Nothing could
    # tell them apart, so there was no point at which the pack station could be
    # told to do its job. Picking now stops at PICKED; the pack endpoint owns
    # PICKED -> PACKED.
    #
    # HANDOFF_RIDER and DELIVERED used to live here too, which made this a
    # back door around the whole last mile: one call moved an order to
    # OUT_FOR_DELIVERY without a tote scan, and another to DELIVERED without a
    # pickup code or any cash recorded. Both are now owned by operations that
    # cannot be skipped:
    #
    #   PACKED -> PICKED_UP   POST /delivery/handoff/pickup  (scans the tote)
    #   PICKED_UP -> DELIVERED  POST /delivery/handoff/pod   (needs the customer's
    #                                                   pickup code, and the cash
    #                                                   actually collected for COD)
    #
    # COMPLETE_PICK is the only action a dark-store operator can reach here, and
    # it is the only one that makes sense on a screen in a store.
    ORDER_ACTIONS = {
        'COMPLETE_PICK': ('PICKED', {'CONFIRMED', 'PICKING', 'INTERRUPTED',
                                     'PARTIALLY_FULFILLED'}),
    }

    # Named so the 400 says why, instead of "Unsupported action".
    RETIRED_ACTIONS = {
        'HANDOFF_RIDER': 'Use POST /delivery/handoff/pickup: it verifies the tote '
                         'barcode and moves the units out of the store.',
        'DELIVERED': 'Use POST /delivery/handoff/pod: it requires the pickup code '
                     'the customer reads, and the amount collected on a COD order.',
    }

    def post(self, request):
        from django.utils import timezone
        from bounded.orders.models import CustomerOrder, OrderStatusHistory
        data = request.data
        order_id = data.get('order_id')
        action_val = data.get('action')
        picker = data.get('picker')

        if not order_id:
            return Response({'error': 'order_id is required'}, status=400)
        if action_val not in self.ORDER_ACTIONS:
            retired = self.RETIRED_ACTIONS.get(action_val)
            return Response(
                {
                    'error': (
                        f'{action_val} is no longer available: {retired}'
                        if retired else
                        f'Unsupported action: {action_val!r}'
                    ),
                    'action': action_val,
                    'supported_actions': sorted(self.ORDER_ACTIONS),
                },
                # 410, not 400: the action used to be valid here, so a client
                # that still sends it needs to be moved rather than corrected.
                status=410 if retired else 400,
            )

        try:
            order = CustomerOrder.objects.select_related('site').get(order_id=order_id)
        except (CustomerOrder.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Order not found'}, status=404)

        # An operator can only act on orders belonging to a store they are
        # assigned to. Without this, a picker at DS-A could complete the pick on
        # DS-B's order and mark it PACKED.
        from bounded.ds_ops.access import require_order_access
        require_order_access(request.user, order)

        target_status, allowed_from = self.ORDER_ACTIONS[action_val]
        if order.status not in allowed_from:
            return Response(
                {
                    'error': (
                        f'Cannot {action_val} an order in status {order.status}. '
                        f'Expected one of: {", ".join(sorted(allowed_from))}.'
                    ),
                    'order_id': str(order.order_id),
                    'status': order.status,
                },
                status=409,
            )

        # A pick cannot be declared complete while stock is still on the shelf.
        # Previously the client sent a session tally that the server never saw,
        # and completing a pick moved the order to PACKED without a single unit
        # leaving stock. The authoritative count is CustomerOrderLine.picked_qty,
        # written by DSPickLineView as each unit is scanned off the shelf.
        if action_val == 'COMPLETE_PICK':
            from bounded.orders.models import CustomerOrderLine
            short = [
                {
                    'line_id': str(l.line_id),
                    'line_no': l.line_no,
                    'sku': str(l.sku_id),
                    'qty': l.qty,
                    'picked_qty': l.picked_qty,
                    'outstanding': l.qty - l.picked_qty,
                }
                for l in CustomerOrderLine.objects.filter(order=order)
                if l.picked_qty < l.qty
            ]
            if short:
                return Response(
                    {
                        'error': (
                            f'Order {order.order_no} is not fully picked: '
                            f'{len(short)} line(s) still short. Scan the remaining '
                            f'units, or drop out to put them back.'
                        ),
                        'short_lines': short,
                        'order_id': str(order.order_id),
                        'status': order.status,
                    },
                    status=409,
                )

        previous_status = order.status
        order.status = target_status
        # Only COMPLETE_PICK is reachable, and it stamps no timestamp of its own:
        # picked_up_at and delivered_at belong to the handoff endpoints, which
        # are the only operations that actually move goods and money.
        order.save(update_fields=['status'])

        # CustomerOrder has no assigned_picker column. PickTask.assigned_to is a
        # user UUID (not a display name), so only accept a real user id.
        if action_val == 'COMPLETE_PICK' and picker:
            from bounded.iam.models import User
            from bounded.ds_ops.models import PickTask
            from bounded.network.models import Location
            try:
                picker_user = User.objects.get(user_id=picker)
            except (User.DoesNotExist, ValueError, TypeError):
                picker_user = None
            if picker_user:
                # Fence the sweep to THIS order's tasks. Two earlier bugs are
                # fixed here:
                #  - it used to sweep every open task the operator held anywhere
                #    in the network, so one pick closed out unrelated work;
                #  - it then swept by site bin, which still caught another
                #    order's tasks in the same store.
                # PickTask.order is the honest boundary. `order=None` tasks
                # (legacy allocation rows) are deliberately left alone: they
                # cannot be attributed to this order, so closing them would be a
                # guess. Their own completion endpoint still moves their stock.
                PickTask.objects.filter(
                    order=order,
                    assigned_to=picker_user.user_id,
                ).exclude(status='COMPLETED').update(
                    status='COMPLETED', completed_at=timezone.now(),
                    completed_by=picker_user.user_id,
                )

        OrderStatusHistory.objects.create(
            order=order,
            from_status=previous_status,
            to_status=target_status,
            actor_type=request.user.role,
            actor_id=request.user.user_id,
        )

        return Response({
            'success': True,
            'order_id': str(order.order_id),
            'status': order.status,
            'previous_status': previous_status,
            'message': f'Order {order.order_no}: {previous_status} -> {target_status}',
        })
