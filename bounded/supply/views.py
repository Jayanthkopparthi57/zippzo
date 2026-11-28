# Supply Views
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from bounded.iam.names import AttributionContextMixin, acting_user_id
from bounded.iam.permissions import IsAdminUserOrReadOnly, IsFieldSurface
from bounded.money import payouts
from bounded.money.cashfree_payouts import CashfreePayoutError
from .models import Vendor, VendorPayment, Seller, Asn, AsnLine, Grn, GrnLine, DockDiscrepancy, QcInspection, PutawayTask, PutawayStrategy, VendorLicense, SellerCategoryApproval
from .serializers import VendorSerializer, VendorPaymentSerializer, SellerSerializer, AsnSerializer, AsnLineSerializer, GrnSerializer, GrnLineSerializer, DockDiscrepancySerializer, QcInspectionSerializer, PutawayTaskSerializer, PutawayStrategySerializer, VendorLicenseSerializer, SellerCategoryApprovalSerializer


def _facility_queryset(queryset, user, relation):
    from bounded.ds_ops.access import is_superuser, operator_site_codes
    if is_superuser(user):
        return queryset
    return queryset.filter(**{f'{relation}__code__in': operator_site_codes(user)})


def _require_facility(user, site):
    if site is None:
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied('The operation must have a facility assigned.')
    from bounded.ds_ops.access import require_site_access, require_session_facility
    require_site_access(user, site.code)
    require_session_facility(user, site.code)


class FacilityScopedViewSetMixin:
    facility_relation = None

    def get_queryset(self):
        queryset = super().get_queryset()
        return _facility_queryset(queryset, self.request.user, self.facility_relation)


def suggest_putaway_bin(site, sku, lot, qty):
    """Return the best live bin for a putaway, or None.

    Active strategies are tried in priority order, site-specific rows before
    global rows. Candidates must be active bins at the site with enough free
    capacity. Existing stock of the same SKU strongly prefers a bin; distinct
    product count is checked against the winning strategy's commingling cap.
    """
    from bounded.inventory.models import StockBalance
    from bounded.network.models import Location

    if not site or not sku:
        return None

    strategies = list(
        PutawayStrategy.objects.filter(is_active=True, status='ACTIVE')
        .filter(filter_by_sku(sku))
        .select_related('site', 'zone')
        .order_by('priority', 'code')
    )
    if not strategies:
        strategies = [None]

    balances = (
        StockBalance.objects.filter(site=site, container='BIN', qty__gt=0)
        .only('container_ref', 'sku_id', 'qty')
    )
    occupied_by_bin = {}
    skus_by_bin = {}
    for row in balances:
        ref = row.container_ref
        occupied_by_bin[ref] = occupied_by_bin.get(ref, 0) + int(row.qty or 0)
        skus_by_bin.setdefault(ref, set()).add(str(row.sku_id))

    locations = Location.objects.filter(
        site=site, location_type='BIN', is_active=True,
    ).select_related('zone')

    for strategy in strategies:
        if strategy is not None:
            if strategy.site_id and strategy.site_id != site.site_id:
                continue
            if strategy.storage_zone and strategy.storage_zone != sku.storage_zone:
                continue
        candidates = []
        for location in locations:
            if strategy is not None and strategy.zone_id and location.zone_id != strategy.zone_id:
                continue
            if strategy is not None and strategy.container and location.container != strategy.container:
                continue
            occupied = occupied_by_bin.get(location.location_id, 0)
            if location.capacity_qty is not None:
                free = int(location.capacity_qty) - int(occupied)
                if free < int(qty or 0):
                    continue
            existing_skus = skus_by_bin.get(location.location_id, set())
            max_commingled = int(strategy.max_commingled) if strategy else 5
            if existing_skus and str(sku.sku_id) not in existing_skus and len(existing_skus) >= max_commingled:
                continue
            score = 0
            if str(sku.sku_id) in existing_skus:
                score += 1000
            if strategy is not None and strategy.zone_id and location.zone_id == strategy.zone_id:
                score += 500
            if strategy is not None and strategy.container and location.container == strategy.container:
                score += 100
            if location.capacity_qty is not None:
                score += min(99, max(0, int(location.capacity_qty) - int(occupied)))
            candidates.append((score, location.location_id, location))
        if candidates:
            candidates.sort(key=lambda item: (-item[0], item[1]))
            return candidates[0][2]
    return None


def filter_by_sku(sku):
    from django.db.models import Q
    return Q(sku__isnull=True) | Q(sku=sku)


def sync_putaway_task(line):
    """Keep the putaway task equal to the units QC actually accepted.

    Receiving no longer declares stock accepted; QC does. So the task cannot be
    minted when the GRN closes with accepted_qty = 0 — it is created (or
    resized) here, the moment accepted units exist. A task that has already had
    units physically placed is never shrunk or deleted, because that would lose
    track of stock already on a shelf.
    """
    if line.lot_id is None or line.grn.status != 'COMPLETED':
        return None
    task = PutawayTask.objects.filter(grn_line=line).order_by('created_at').first()
    accepted = int(line.accepted_qty or 0)
    if task is not None and task.status == 'CONFIRMED':
        return task
    if accepted <= 0:
        if task is not None and int(task.placed_qty or 0) == 0:
            task.delete()
            return None
        return task
    if task is None:
        site = line.grn.asn.dest_site
        suggested_bin = suggest_putaway_bin(site, line.sku, line.lot, accepted)
        return PutawayTask.objects.create(
            grn_line=line,
            from_container='QC_PASSED_STAGING',
            to_container='PUTAWAY_PENDING',
            sku_id=line.sku_id,
            lot_id=line.lot_id,
            qty=accepted,
            suggested_bin=suggested_bin,
            status='GENERATED',
        )
    if int(task.placed_qty or 0) == 0 and int(task.qty or 0) != accepted:
        task.qty = accepted
        task.save(update_fields=['qty'])
    if task.suggested_bin_id is None:
        task.suggested_bin = suggest_putaway_bin(line.grn.asn.dest_site, line.sku, line.lot, task.qty)
        task.save(update_fields=['suggested_bin'])
    return task


class VendorViewSet(viewsets.ModelViewSet):
    queryset = Vendor.objects.all()
    serializer_class = VendorSerializer
    # Supplier records are reference data for every operator, but only admin
    # roles may add or edit one (see IsAdminUserOrReadOnly).
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['status']
    search_fields = ['code', 'name']

class VendorPaymentViewSet(viewsets.ModelViewSet):
    """Vendor payments are shared master-finance records for MH and DS."""
    queryset = VendorPayment.objects.select_related('vendor').all()
    serializer_class = VendorPaymentSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['vendor', 'status']
    search_fields = ['vendor__name', 'vendor__code', 'reference']
    ordering_fields = ['payment_date', 'amount', 'created_at']

    def perform_create(self, serializer):
        uid = getattr(self.request.user, 'user_id', None)
        serializer.save(created_by=uid if uid else None)

    @action(detail=True, methods=['post'], url_path='pay')
    def pay(self, request, pk=None):
        """Send this vendor payment through Cashfree Payouts."""
        record = self.get_object()
        if record.payout_channel == 'CASHFREE' and record.payout_status in ('PENDING', 'SUCCESS'):
            return Response({'error': 'This payment has already been sent to Cashfree.'},
                            status=status.HTTP_409_CONFLICT)
        vendor = record.vendor
        if not (vendor.bank_account_number and vendor.ifsc):
            return Response({'error': 'Add the vendor bank account and IFSC before paying.'},
                            status=status.HTTP_400_BAD_REQUEST)
        beneficiary = f'VEN_{str(vendor.vendor_id).replace("-", "")[:20]}'
        reference = f'VP{str(record.payment_id).replace("-", "")[:20]}'
        try:
            values = payouts.start_payout(
                record, beneficiary_id=beneficiary, amount=record.amount,
                reference_id=reference, purpose='VENDOR_PAYMENT',
                name=vendor.name, email=vendor.email, phone=vendor.contact_phone,
                account=vendor.bank_account_number, ifsc=vendor.ifsc,
                address=vendor.address)
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
            return Response({'error': 'This payment was not sent through Cashfree.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            values = payouts.sync_payout(record)
        except CashfreePayoutError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        for key, value in values.items():
            setattr(record, key, value)
        record.save(update_fields=list(values))
        return Response(self.get_serializer(record).data)


class SellerViewSet(viewsets.ModelViewSet):
    queryset = Seller.objects.all()
    serializer_class = SellerSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['status', 'fulfilment_mode']

class AsnViewSet(FacilityScopedViewSetMixin, AttributionContextMixin, viewsets.ModelViewSet):
    facility_relation = 'dest_site'
    queryset = Asn.objects.select_related(
        'dest_site', 'source_site', 'source_vendor',
    ).prefetch_related('lines__sku').all()
    serializer_class = AsnSerializer
    attribution_fields = ('created_by',)
    filterset_fields = {
        'type': ['exact'],
        'status': ['exact'],
        'dest_site': ['exact'],
        'created_by': ['exact'],
        'created_at': ['gte', 'lte'],
    }
    # Without this, ?search=<asn_no> was silently ignored and the frontend
    # always received the first page of ASNs instead of the scanned one.
    search_fields = ['asn_no', 'po_ref', 'source_vendor__code', 'source_vendor__name']

    @staticmethod
    def _next_asn_no():
        """ASN-YYYYMMDD-NNNN, gapless within the day via a row lock."""
        from django.db.models import Max
        today = timezone.now().strftime('%Y%m%d')
        prefix = f'ASN-{today}-'
        with transaction.atomic():
            last = (Asn.objects.select_for_update()
                    .filter(asn_no__startswith=prefix)
                    .aggregate(m=Max('asn_no'))['m'])
            seq = int(last.rsplit('-', 1)[-1]) + 1 if last else 1
        return f'{prefix}{seq:04d}'

    def perform_create(self, serializer):
        """Auto-number the ASN and stamp the creator.

        Clients (the receive wizard, mobile receiving) POST a type + dest_site
        and never an asn_no. Before this, creation 400'd on the required unique
        field, so the entire "Create consignment" path was dead UI.
        """
        data = serializer.validated_data
        _require_facility(self.request.user, data.get('dest_site'))
        if not data.get('asn_no'):
            data['asn_no'] = self._next_asn_no()
        serializer.save(created_by=acting_user_id(self.request))

    def perform_update(self, serializer):
        site = serializer.validated_data.get('dest_site', serializer.instance.dest_site)
        _require_facility(self.request.user, site)
        serializer.save()

    @action(detail=True, methods=['post'], url_path='receive-scanned', permission_classes=[IsAuthenticated, IsFieldSurface])
    @transaction.atomic
    def receive_scanned(self, request, pk=None):
        """Record a complete, physically scanned Darkstore receipt atomically."""
        asn = Asn.objects.select_for_update().get(pk=self.get_object().pk)
        _require_facility(request.user, asn.dest_site)
        if Grn.objects.filter(asn=asn).exists():
            return Response({
                'detail': 'A GRN already exists for this consignment. Resume or resolve that receipt before retrying.',
            }, status=409)
        if asn.status not in ('CONFIRMED', 'ARRIVED', 'CHECKED_IN'):
            return Response({'detail': f'ASN is {asn.status} and cannot be received.'}, status=400)

        payload_lines = request.data.get('lines')
        if not isinstance(payload_lines, list):
            return Response({'detail': 'lines must be a list of scanned ASN-line quantities.'}, status=400)
        expected_lines = list(asn.lines.select_related('sku'))
        if not expected_lines:
            return Response({'detail': 'This ASN has no product lines to receive.'}, status=400)
        expected_by_id = {str(line.line_id): line for line in expected_lines}
        received_by_id = {}
        for item in payload_lines:
            if not isinstance(item, dict):
                return Response({'detail': 'Each scanned line must be an object.'}, status=400)
            line_id = str(item.get('asn_line') or '')
            if line_id not in expected_by_id or line_id in received_by_id:
                return Response({'detail': 'Scanned lines must uniquely match this ASN.'}, status=400)
            raw_quantity = item.get('received_qty')
            if isinstance(raw_quantity, bool) or not isinstance(raw_quantity, (int, str)):
                return Response({'detail': 'received_qty must be a non-negative integer.'}, status=400)
            try:
                quantity = int(raw_quantity)
            except (TypeError, ValueError):
                return Response({'detail': 'received_qty must be a non-negative integer.'}, status=400)
            if quantity < 0:
                return Response({'detail': 'received_qty must be a non-negative integer.'}, status=400)
            received_by_id[line_id] = quantity
        if set(received_by_id) != set(expected_by_id):
            return Response({'detail': 'Record a scanned quantity, including zero, for every ASN line.'}, status=400)

        has_discrepancy = any(
            received_by_id[str(line.line_id)] != int(line.ordered_qty)
            for line in expected_lines
        )
        grn = Grn.objects.create(
            grn_no=GrnViewSet._next_grn_no(),
            asn=asn,
            mode='PIECE',
            status='IN_PROGRESS',
            has_discrepancy=has_discrepancy,
            created_by=acting_user_id(request),
        )
        grn_lines = []
        for asn_line in expected_lines:
            received = received_by_id[str(asn_line.line_id)]
            lot = None
            if received > 0:
                from bounded.catalog.models import InventoryLot
                lot = InventoryLot.objects.create(
                    sku=asn_line.sku,
                    site=asn.dest_site,
                    batch_number=f'{asn.asn_no}-{asn_line.line_no}'[:30],
                    inbound_type='ASN',
                    inbound_ref=asn.asn_no,
                    source_site=asn.source_site,
                    source_vendor_id=asn.source_vendor_id,
                    bucket='QC_HOLD',
                    status='AVAILABLE',
                )
            grn_lines.append(GrnLine.objects.create(
                grn=grn,
                asn_line=asn_line,
                sku=asn_line.sku,
                ordered_qty=asn_line.ordered_qty,
                received_qty=received,
                accepted_qty=0,
                damaged_qty=0,
                excess_qty=max(0, received - int(asn_line.ordered_qty)),
                lot=lot,
            ))

        grn.status = 'COMPLETED'
        grn.completed_at = timezone.now()
        grn.received_by = acting_user_id(request)
        grn.save(update_fields=['status', 'completed_at', 'received_by', 'has_discrepancy'])
        asn.status = 'CLOSED'
        asn.save(update_fields=['status', 'updated_at'])

        for line in grn_lines:
            if line.received_qty > 0:
                QcInspection.objects.create(grn_line=line, status='PENDING')
            if line.received_qty != line.ordered_qty:
                shortage = max(0, line.ordered_qty - line.received_qty)
                excess = max(0, line.received_qty - line.ordered_qty)
                DockDiscrepancy.objects.create(
                    code=f'{"SHORT" if shortage else "OVER"}-{line.line_id}',
                    grn=grn,
                    grn_line=line,
                    site=asn.dest_site,
                    sku=line.sku,
                    lot=line.lot,
                    discrepancy_type='SHORT' if shortage else 'OVERAGE',
                    expected_qty=line.ordered_qty,
                    received_qty=line.received_qty,
                    shortage_qty=shortage,
                    excess_qty=excess,
                    reason_code='RECEIPT_SHORT' if shortage else 'RECEIPT_OVERAGE',
                )

        from bounded.outbox.services import enqueue_event
        enqueue_event(
            aggregate_type='Grn',
            aggregate_id=grn.grn_id,
            event_type='warehouse.grn.completed',
            payload_json={
                'grn_id': str(grn.grn_id),
                'grn_no': grn.grn_no,
                'asn_no': asn.asn_no,
                'site_code': asn.dest_site.code,
                'received_by': str(grn.received_by) if grn.received_by else '',
                'has_discrepancy': grn.has_discrepancy,
                'line_count': len(grn_lines),
            },
        )
        if grn.has_discrepancy:
            enqueue_event(
                aggregate_type='Grn',
                aggregate_id=grn.grn_id,
                event_type='warehouse.inbound.discrepancy',
                payload_json={
                    'grn_id': str(grn.grn_id),
                    'grn_no': grn.grn_no,
                    'asn_no': asn.asn_no,
                    'site_code': asn.dest_site.code,
                    'received_by': str(grn.received_by) if grn.received_by else '',
                },
            )
        return Response({
            'grn_id': str(grn.grn_id),
            'grn_no': grn.grn_no,
            'status': grn.status,
            'qc_inspections_created': QcInspection.objects.filter(grn_line__grn=grn).count(),
            'has_discrepancy': grn.has_discrepancy,
        }, status=201)

class AsnLineViewSet(FacilityScopedViewSetMixin, viewsets.ModelViewSet):
    facility_relation = 'asn__dest_site'
    queryset = AsnLine.objects.select_related('asn', 'sku').all()
    serializer_class = AsnLineSerializer
    # ?asn=<asn_id> and ?search=<ean> were both ignored without these, so the
    # ASN detail lookup and the per-line product scan always returned every line.
    filterset_fields = ['asn', 'line_status', 'sku']
    search_fields = ['ean', 'sku__sku_code', 'sku__name']

    @transaction.atomic
    def perform_create(self, serializer):
        asn = serializer.validated_data['asn']
        # `line_no` is server-assigned, but computing MAX(line_no)+1 without
        # locking the consignment meant two lines added together (a bundle
        # posts its SKUs in one batch) both read the same highest number and
        # one INSERT hit the (asn, line_no) unique constraint. Locking the
        # parent ASN row serialises those inserts, so every line is numbered.
        Asn.objects.select_for_update().get(pk=asn.pk)
        _require_facility(self.request.user, asn.dest_site)
        from django.db.models import Max
        last = AsnLine.objects.filter(asn=asn).aggregate(m=Max('line_no'))['m']
        serializer.save(line_no=(last or 0) + 1)

    def perform_update(self, serializer):
        asn = serializer.validated_data.get('asn', serializer.instance.asn)
        _require_facility(self.request.user, asn.dest_site)
        serializer.save()

class GrnViewSet(FacilityScopedViewSetMixin, AttributionContextMixin, viewsets.ModelViewSet):
    facility_relation = 'asn__dest_site'
    queryset = Grn.objects.select_related('asn', 'asn__dest_site').all()
    serializer_class = GrnSerializer
    attribution_fields = ('created_by', 'received_by')

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsFieldSurface()]
    # `asn` is needed to resume an in-progress receipt for a scanned consignment.
    # Without it `?asn=<id>` was silently ignored and the caller received the
    # first page of every GRN in the system.
    # The actor/window lookups feed the inbound ledger's "who received, when".
    filterset_fields = {
        'status': ['exact'],
        'mode': ['exact'],
        'asn': ['exact'],
        'asn__dest_site': ['exact'],
        'created_by': ['exact'],
        'received_by': ['exact'],
        'created_at': ['gte', 'lte'],
        'completed_at': ['gte', 'lte'],
    }
    # Lets a worker scan either the GRN number or the ASN it belongs to and
    # land on that receipt.
    search_fields = ['grn_no', 'asn__asn_no', 'asn__po_ref']

    @staticmethod
    def _next_grn_no():
        """GRN-YYYYMMDD-NNNN, gapless within the day via a row lock."""
        from django.db.models import Max
        today = timezone.now().strftime('%Y%m%d')
        prefix = f'GRN-{today}-'
        with transaction.atomic():
            last = (Grn.objects.select_for_update()
                    .filter(grn_no__startswith=prefix)
                    .aggregate(m=Max('grn_no'))['m'])
            seq = int(last.rsplit('-', 1)[-1]) + 1 if last else 1
        return f'{prefix}{seq:04d}'

    def perform_create(self, serializer):
        """Auto-number the GRN and stamp the raiser; clients POST asn+mode."""
        data = serializer.validated_data
        _require_facility(self.request.user, data.get('asn').dest_site)
        if not data.get('grn_no'):
            data['grn_no'] = self._next_grn_no()
        serializer.save(created_by=acting_user_id(self.request))

    def perform_update(self, serializer):
        asn = serializer.validated_data.get('asn', serializer.instance.asn)
        _require_facility(self.request.user, asn.dest_site)
        serializer.save()

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, IsFieldSurface])
    @transaction.atomic
    def complete(self, request, pk=None):
        """Close the GRN and generate one putaway task per accepted line.

        Idempotent: existing putaway tasks for a line are never duplicated.
        """
        grn = Grn.objects.select_for_update().get(pk=self.get_object().pk)
        if grn.status == 'COMPLETED':
            # Repair missing tasks if a prior completion stopped after the GRN
            # state was saved. Existing tasks are reused by sync_putaway_task.
            for line in grn.lines.select_related('sku', 'lot'):
                if line.received_qty > 0:
                    QcInspection.objects.get_or_create(
                        grn_line=line,
                        defaults={'status': 'PENDING'},
                    )
                if line.accepted_qty > 0 and line.lot_id is not None:
                    sync_putaway_task(line)
            return Response({'success': True, 'already_completed': True,
                             'grn_no': grn.grn_no,
                             'putaway_tasks': PutawayTask.objects.filter(
                                 grn_line__grn=grn).count()})

        lines = list(grn.lines.select_related('sku', 'lot'))
        if not lines:
            return Response({'detail': 'GRN has no lines to receive'}, status=400)

        unaccounted = [l.line_id for l in lines
                       if l.received_qty == 0 and grn.mode != 'PIECE']
        if unaccounted:
            return Response({
                'detail': 'every GRN line must record received_qty before closing',
                'lines': [str(x) for x in unaccounted],
            }, status=400)
        if grn.mode == 'PIECE' and any(
            line.accepted_qty or line.damaged_qty or line.expired_qty
            for line in lines
        ):
            return Response({
                'detail': 'piece-scanned receipts must complete QC after the GRN is closed',
            }, status=400)

        grn.status = 'COMPLETED'
        grn.completed_at = timezone.now()
        # Who actually received wins over any client-supplied value.
        grn.received_by = acting_user_id(request)
        grn.has_discrepancy = bool(grn.has_discrepancy or any(
            l.received_qty < l.ordered_qty
            or l.damaged_qty or l.expired_qty or l.excess_qty
            for l in lines
        ))
        grn.save()

        asn = grn.asn
        if asn and asn.status not in ('CLOSED',):
            asn.status = 'CLOSED'
            asn.save()

        # sync_putaway_task deliberately requires a completed GRN. Generate
        # tasks only after the status save, inside this same transaction.
        created = []
        for line in lines:
            if line.received_qty > 0:
                QcInspection.objects.get_or_create(
                    grn_line=line,
                    defaults={'status': 'PENDING'},
                )
            if line.received_qty != line.ordered_qty and not DockDiscrepancy.objects.filter(
                grn_line=line,
            ).exists():
                shortage = max(0, line.ordered_qty - line.received_qty)
                excess = max(0, line.received_qty - line.ordered_qty)
                DockDiscrepancy.objects.create(
                    code=f'{"SHORT" if shortage else "OVER"}-{line.line_id}',
                    grn=grn,
                    grn_line=line,
                    site=grn.asn.dest_site,
                    sku=line.sku,
                    lot=line.lot,
                    discrepancy_type='SHORT' if shortage else 'OVERAGE',
                    expected_qty=line.ordered_qty,
                    received_qty=line.received_qty,
                    shortage_qty=shortage,
                    excess_qty=excess,
                    reason_code='RECEIPT_SHORT' if shortage else 'RECEIPT_OVERAGE',
                )
            if line.accepted_qty <= 0 or line.lot_id is None:
                continue
            task = sync_putaway_task(line)
            if task is not None:
                created.append(str(task.task_id))

        # Notify supervisors when goods receipt is completed and if any discrepancy was found
        try:
            from bounded.outbox.services import enqueue_event
            site = (
                getattr(getattr(asn, 'dest_site', None), 'code', None)
                or getattr(getattr(lines[0].lot, 'site', None), 'code', '')
            )
            enqueue_event(
                aggregate_type='Grn',
                aggregate_id=grn.grn_id,
                event_type='warehouse.grn.completed',
                payload_json={
                    'grn_id': str(grn.grn_id),
                    'grn_no': grn.grn_no,
                    'asn_no': asn.asn_no if asn else '',
                    'site_code': site,
                    'received_by': str(grn.received_by) if grn.received_by else '',
                    'has_discrepancy': grn.has_discrepancy,
                    'line_count': len(lines),
                },
            )
            if grn.has_discrepancy:
                enqueue_event(
                    aggregate_type='Grn',
                    aggregate_id=grn.grn_id,
                    event_type='warehouse.inbound.discrepancy',
                    payload_json={
                        'grn_id': str(grn.grn_id),
                        'grn_no': grn.grn_no,
                        'asn_no': asn.asn_no if asn else '',
                        'site_code': site,
                        'received_by': str(grn.received_by) if grn.received_by else '',
                    },
                )
        except Exception:  # noqa: BLE001
            pass

        return Response({'success': True, 'grn_no': grn.grn_no,
                         'status': grn.status,
                         'putaway_tasks_created': created,
                         'putaway_task_count': PutawayTask.objects.filter(
                             grn_line__grn=grn).count()})

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, IsFieldSurface])
    def manual_batch(self, request, pk=None):
        """Record a typed batch / tote reference as a labelled exception.

        Scanning is the only normal way to open a receipt. When a label is
        damaged the operator may type it, but the GRN then carries who did it,
        when, and why, and the frontend has to show that exception on screen.
        """
        grn = self.get_object()
        batch_code = str(request.data.get('batch_code') or '').strip()
        reason = str(request.data.get('reason') or '').strip()
        if not batch_code:
            return Response({'detail': 'batch_code is required'}, status=400)
        if not reason:
            return Response({'detail': 'A reason is required for manual batch entry'}, status=400)
        grn.batch_code = batch_code[:100]
        grn.manual_entry_by = acting_user_id(request)
        grn.manual_entry_reason = reason[:2000]
        grn.manual_entry_at = timezone.now()
        grn.save(update_fields=['batch_code', 'manual_entry_by',
                                'manual_entry_reason', 'manual_entry_at'])
        return Response(GrnSerializer(grn).data)

class GrnLineViewSet(FacilityScopedViewSetMixin, viewsets.ModelViewSet):
    facility_relation = 'grn__asn__dest_site'
    queryset = GrnLine.objects.select_related('grn', 'sku').all()
    serializer_class = GrnLineSerializer

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsFieldSurface()]
    # Receiving and QC both work one GRN (and one product) at a time. With no
    # filterset declared, `?grn=`/`?asn_line=` were accepted and ignored, so
    # those screens were handed every GRN line in the database and matched the
    # first one that happened to look right. `received_qty__gte` lets QC ask for
    # "lines that have actually been received" without downloading the lot.
    filterset_fields = {
        'grn': ['exact'],
        'asn_line': ['exact'],
        'sku': ['exact'],
        'received_qty': ['exact', 'gte'],
        'accepted_qty': ['exact', 'gte'],
    }
    search_fields = ['sku__sku_code', 'sku__ean', 'sku__name']

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError

        grn = serializer.validated_data['grn']
        _require_facility(self.request.user, grn.asn.dest_site)
        if grn.mode == 'PIECE' and grn.status != 'IN_PROGRESS':
            raise ValidationError({'grn': 'Piece-scanned lines can only be recorded on an in-progress receipt.'})
        if grn.mode == 'PIECE' and serializer.validated_data.get('accepted_qty', 0) > 0:
            raise ValidationError({'accepted_qty': 'Piece-scanned units must pass QC before acceptance.'})
        serializer.save()

    def perform_update(self, serializer):
        from rest_framework.exceptions import ValidationError

        grn = serializer.validated_data.get('grn', serializer.instance.grn)
        _require_facility(self.request.user, grn.asn.dest_site)
        if serializer.instance.grn.mode == 'PIECE' and serializer.instance.grn.status == 'COMPLETED':
            raise ValidationError({'grn': 'A completed piece-scanned receipt cannot be changed.'})
        if serializer.instance.grn.mode == 'PIECE' and serializer.validated_data.get('accepted_qty', 0) > 0:
            raise ValidationError({'accepted_qty': 'Piece-scanned units must pass QC before acceptance.'})
        serializer.save()


class DockDiscrepancyViewSet(FacilityScopedViewSetMixin, viewsets.ModelViewSet):
    facility_relation = 'site'
    queryset = DockDiscrepancy.objects.select_related(
        'grn', 'grn_line', 'site', 'sku', 'lot', 'created_by', 'resolved_by').all()
    serializer_class = DockDiscrepancySerializer
    filterset_fields = {
        'status': ['exact'],
        'site': ['exact'],
        'grn': ['exact'],
        'grn_line': ['exact'],
        'sku': ['exact'],
        'discrepancy_type': ['exact'],
    }
    search_fields = ['code', 'grn__grn_no', 'sku__sku_code', 'sku__name', 'reason_code', 'remarks']
    ordering_fields = ['created_at', 'shortage_qty', 'received_qty']

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsFieldSurface()]

    def perform_create(self, serializer):
        _require_facility(self.request.user, serializer.validated_data['site'])
        serializer.save(created_by=self.request.user if getattr(self.request.user, 'is_authenticated', False) else None)

    def perform_update(self, serializer):
        site = serializer.validated_data.get('site', serializer.instance.site)
        _require_facility(self.request.user, site)
        serializer.save()

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        discrepancy = self.get_object()
        if discrepancy.status in ('RESOLVED', 'CLOSED'):
            return Response({
                'success': True,
                'already_resolved': True,
                'discrepancy_id': str(discrepancy.discrepancy_id),
                'status': discrepancy.status,
            })
        _require_facility(request.user, discrepancy.site)
        discrepancy.status = 'RESOLVED'
        discrepancy.resolved_at = timezone.now()
        discrepancy.resolved_by = request.user if getattr(request.user, 'is_authenticated', False) else None
        discrepancy.save(update_fields=['status', 'resolved_at', 'resolved_by', 'updated_at'])
        return Response({
            'success': True,
            'discrepancy_id': str(discrepancy.discrepancy_id),
            'status': discrepancy.status,
        })

class QcInspectionViewSet(FacilityScopedViewSetMixin, AttributionContextMixin, viewsets.ModelViewSet):
    facility_relation = 'grn_line__grn__asn__dest_site'
    queryset = QcInspection.objects.select_related(
        'grn_line__grn__asn', 'grn_line__sku').all()
    serializer_class = QcInspectionSerializer
    attribution_fields = ('tested_by',)
    # Same reason as above: a scanned unit has to resolve to the inspection (if
    # any) already recorded for its GRN line, not to an arbitrary row.
    # `grn_line__received_qty__gte` lets the QC queue ask for "inspections that
    # belong to received lines" without downloading the whole QC history.
    filterset_fields = {
        'grn_line': ['exact'],
        'status': ['exact'],
        'tested_by': ['exact'],
        'grn_line__received_qty': ['exact', 'gte'],
        'grn_line__grn__asn__dest_site': ['exact'],
        'tested_at': ['gte', 'lte'],
    }
    search_fields = ['grn_line__sku__sku_code', 'grn_line__sku__ean']

    def perform_create(self, serializer):
        line = serializer.validated_data['grn_line']
        _require_facility(self.request.user, line.grn.asn.dest_site)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        line = serializer.validated_data.get('grn_line', serializer.instance.grn_line)
        _require_facility(self.request.user, line.grn.asn.dest_site)
        serializer.save()

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, IsFieldSurface])
    @transaction.atomic
    def verify(self, request, pk=None):
        inspection = self.get_object()
        data = request.data
        line = inspection.grn_line
        received = int(line.received_qty or 0)

        try:
            pass_count = int(data.get('pass_count', inspection.pass_count) or 0)
            fail_count = int(data.get('fail_count', inspection.fail_count) or 0)
        except (TypeError, ValueError):
            return Response({'detail': 'pass_count and fail_count must be integers'}, status=400)
        if pass_count < 0 or fail_count < 0:
            return Response({'detail': 'pass_count and fail_count cannot be negative'}, status=400)
        if pass_count + fail_count > received:
            return Response({
                'detail': f'{pass_count + fail_count} units inspected but only {received} were received',
                'received_qty': received,
            }, status=400)
        if data.get('require_full_inspection') and pass_count + fail_count != received:
            return Response({
                'detail': f'inspect all {received} received unit(s) before completing QC',
                'received_qty': received,
                'inspected_qty': pass_count + fail_count,
            }, status=400)

        # Only units the inspector actually scanned as PASS become available to
        # putaway. Everything else — failed units and units not yet inspected —
        # stays out of the accepted balance, so QC failure can never leak into
        # sellable stock.
        accepted = min(pass_count, received)
        damaged = min(fail_count, max(0, received - accepted))
        task = PutawayTask.objects.filter(grn_line=line).order_by('created_at').first()
        if task is not None and int(task.placed_qty or 0) > accepted:
            return Response({
                'detail': f'{task.placed_qty} unit(s) are already placed; accepted cannot fall to {accepted}',
                'placed_qty': task.placed_qty,
            }, status=400)

        inspection.sample_size = pass_count + fail_count
        inspection.pass_count = pass_count
        inspection.fail_count = fail_count
        inspection.status = data.get('status', 'PASSED')
        inspection.remarks = data.get('remarks', inspection.remarks)
        # Stamped from the token: earlier clients sent 'console' (not even a
        # UUID) into this UUID column, which crashed the save.
        inspection.tested_by = acting_user_id(request)
        inspection.tested_at = timezone.now()
        inspection.save()

        line.accepted_qty = accepted
        line.damaged_qty = damaged
        line.save(update_fields=['accepted_qty', 'damaged_qty'])
        if line.lot_id:
            line.lot.bucket = 'Good' if accepted > 0 else 'BAD' if fail_count > 0 else 'QC_HOLD'
            line.lot.save(update_fields=['bucket'])
        task = sync_putaway_task(line)

        payload = QcInspectionSerializer(inspection).data
        payload['accepted_qty'] = line.accepted_qty
        payload['damaged_qty'] = line.damaged_qty
        payload['uninspected_qty'] = max(0, received - accepted - damaged)
        payload['putaway_task_id'] = str(task.task_id) if task else None

        # Notify supervisors when units are rejected or only partially accepted.
        # PASSED inspections with zero failures need no alert.
        if fail_count > 0 or inspection.status in ('FAILED', 'PARTIAL'):
            try:
                from bounded.outbox.services import enqueue_event
                site = (
                    getattr(getattr(getattr(getattr(line, 'grn', None), 'asn', None), 'dest_site', None), 'code', None)
                    or ''
                )
                sku_code = getattr(getattr(line, 'sku', None), 'sku_code', str(line.sku_id))
                enqueue_event(
                    aggregate_type='QcInspection',
                    aggregate_id=inspection.qc_id,
                    event_type='warehouse.qc.exception',
                    payload_json={
                        'qc_id': str(inspection.qc_id),
                        'grn_line_id': str(line.line_id),
                        'verdict': inspection.status,
                        'pass_count': pass_count,
                        'fail_count': fail_count,
                        'sku_code': sku_code,
                        'site_code': site,
                        'inspector_id': str(inspection.tested_by) if inspection.tested_by else '',
                    },
                )
            except Exception:  # noqa: BLE001 — notification failure must not break the verify response
                pass

        return Response(payload)


class PutawayTaskViewSet(FacilityScopedViewSetMixin, AttributionContextMixin, viewsets.ModelViewSet):
    facility_relation = 'grn_line__grn__asn__dest_site'
    queryset = PutawayTask.objects.select_related(
        'grn_line__grn__asn__dest_site', 'sku', 'lot',
        'suggested_bin', 'confirmed_bin').all()
    serializer_class = PutawayTaskSerializer
    attribution_fields = ('assigned_to', 'confirmed_by')
    # `sku` lets a scanned barcode resolve to exactly the open tasks for that
    # product; ordering is -created_at, so an unfiltered page is entirely
    # CONFIRMED history and the open putaway queue looks empty.
    filterset_fields = {
        'status': ['exact'],
        'sku': ['exact'],
        'lot': ['exact'],
        'grn_line__grn': ['exact'],
        'grn_line__grn__asn__dest_site': ['exact'],
        'assigned_to': ['exact'],
        'confirmed_by': ['exact'],
        'created_at': ['gte', 'lte'],
        'completed_at': ['gte', 'lte'],
    }
    search_fields = ['sku__sku_code', 'sku__ean', 'grn_line__grn__grn_no']

    def perform_create(self, serializer):
        line = serializer.validated_data['grn_line']
        _require_facility(self.request.user, line.grn.asn.dest_site)
        super().perform_create(serializer)

    @transaction.atomic
    def perform_update(self, serializer):
        task = serializer.instance
        line = serializer.validated_data.get('grn_line', task.grn_line)
        task_site = line.grn.asn.dest_site
        _require_facility(self.request.user, task_site)
        assignee = serializer.validated_data.get('assigned_to', task.assigned_to)
        if assignee:
            from bounded.network.models import EmployeeSiteAssignment
            if not EmployeeSiteAssignment.objects.filter(
                user_id=assignee, site=task_site, is_active=True,
            ).exists():
                from rest_framework.exceptions import ValidationError
                raise ValidationError({'assigned_to': 'Worker is not assigned to this facility.'})
        previous_assignee = task.assigned_to
        serializer.save()
        if (task.assigned_to and
                str(previous_assignee or '') != str(task.assigned_to)):
            from bounded.outbox.services import enqueue_event
            try:
                site = task.grn_line.grn.asn.dest_site
                site_code = site.code if site else ''
            except AttributeError:
                site_code = ''
            enqueue_event(
                aggregate_type='PutawayTask', aggregate_id=task.task_id,
                event_type='warehouse.task.assigned',
                payload_json={
                    'recipient_user_id': str(task.assigned_to),
                    'task_id': str(task.task_id),
                    'task_type': 'PUTAWAY',
                    'site_code': site_code,
                    'sku_code': task.sku.sku_code,
                    'qty': task.remaining_qty,
                },
            )

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def assign(self, request, pk=None):
        """Hand this putaway to one worker. Unassign by sending user=null."""
        task = self.get_object()
        if task.status in ('CONFIRMED',):
            return Response({'error': f'Task is {task.status} and cannot be reassigned.'}, status=400)
        user = request.data.get('user')
        if user in (None, '', 'null'):
            task.assigned_to = None
            task.save(update_fields=['assigned_to'])
            return Response({'success': True, 'assigned_to': None, 'status': task.status})
        task_site = task.grn_line.grn.asn.dest_site
        from bounded.network.models import EmployeeSiteAssignment
        if not EmployeeSiteAssignment.objects.filter(
            user_id=user, site=task_site, is_active=True,
        ).exists():
            return Response({'error': 'Worker is not assigned to this facility.'}, status=400)
        previous_assignee = task.assigned_to
        task.assigned_to = user
        if task.status == 'GENERATED':
            task.status = 'ACCEPTED'
        if task.started_at is None and task.status in ('ACCEPTED', 'IN_PROGRESS'):
            task.started_at = task.started_at or timezone.now()
        task.save()
        if str(previous_assignee or '') != str(task.assigned_to):
            from bounded.outbox.services import enqueue_event
            try:
                site = task.grn_line.grn.asn.dest_site
                site_code = site.code if site else ''
            except AttributeError:
                site_code = ''
            enqueue_event(
                aggregate_type='PutawayTask', aggregate_id=task.task_id,
                event_type='warehouse.task.assigned',
                payload_json={
                    'recipient_user_id': str(task.assigned_to),
                    'task_id': str(task.task_id),
                    'task_type': 'PUTAWAY',
                    'site_code': site_code,
                    'sku_code': task.sku.sku_code,
                    'qty': task.remaining_qty,
                },
            )
        return Response({'success': True, 'assigned_to': str(task.assigned_to), 'status': task.status})

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        task = self.get_object()
        if task.status == 'CONFIRMED':
            return Response({'error': f'Task is {task.status}.'}, status=400)
        task.assigned_to = None
        task.save(update_fields=['assigned_to'])
        return Response({'success': True, 'assigned_to': None})

    @staticmethod
    def _resolve_location(data):
        from bounded.network.models import Location
        bin_id = (data.get('destination_location_id') or data.get('confirmed_bin')
                  or data.get('location_id'))
        if not bin_id:
            return None, 'destination_location_id is required'
        loc = Location.objects.filter(location_id=bin_id).select_related('site').first()
        if loc is None:
            return None, f'Location {bin_id} not found'
        return loc, None

    @staticmethod
    def _bin_occupancy(loc):
        from bounded.inventory.models import StockBalance
        occupied = (StockBalance.objects
                    .filter(container='BIN', container_ref=loc.location_id)
                    .aggregate(t=Sum('qty'))['t'] or 0)
        capacity = int(loc.capacity_qty) if loc.capacity_qty is not None else None
        return {
            'location_id': loc.location_id,
            'barcode': loc.barcode,
            'capacity_qty': capacity,
            'occupied_qty': int(occupied),
            'free_qty': None if capacity is None else max(0, capacity - int(occupied)),
        }

    def _post_units(self, task, loc, qty, request):
        """Write one Proceed's units to the bin and its ledger movement.

        The ledger key deliberately includes the placement sequence: a second
        Proceed of the same SKU into the same bin would otherwise look like a
        replay of the first and be silently dropped.
        """
        from bounded.catalog.models import InventoryLot, Sku
        from bounded.inventory.stock import apply_stock

        sku = Sku.objects.filter(sku_id=task.sku_id).first()
        lot = InventoryLot.objects.filter(lot_id=task.lot_id).first() if task.lot_id else None
        if sku is None:
            raise ValueError(f'SKU {task.sku_id} not found')
        seq = int(task.placed_qty or 0) + 1
        apply_stock(
            site=loc.site, sku=sku, lot=lot, qty=qty, direction='IN',
            movement_type='PUTAWAY', ref_type='PUTAWAYTASK',
            ref_id=f'{task.task_id}:{seq}',
            actor_id=acting_user_id(request) or task.assigned_to or '',
            actor_type='STAFF',
            container='BIN', container_ref=loc.location_id,
        )
        task.placed_qty = int(task.placed_qty or 0) + qty
        task.confirmed_bin = loc
        task.status = 'IN_PROGRESS'
        if task.started_at is None:
            task.started_at = timezone.now()
        task.save(update_fields=['placed_qty', 'confirmed_bin', 'status', 'started_at'])

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, IsFieldSurface])
    @transaction.atomic
    def place(self, request, pk=None):
        """Commit units into a bin as the operator presses Proceed.

        Stock and bin occupancy move on every call — never only when the task
        is finally dropped — so a half-finished putaway is still reflected in
        the inventory the rest of the warehouse reads.
        """
        task = (PutawayTask.objects.select_for_update()
                .select_related('grn_line', 'sku', 'lot')
                .get(pk=self.get_object().pk))
        if task.status == 'CONFIRMED':
            return Response({'detail': 'task is already confirmed',
                             'task': PutawayTaskSerializer(task).data}, status=400)
        loc, err = self._resolve_location(request.data)
        if err:
            return Response({'detail': err}, status=400)
        task_site = task.grn_line.grn.asn.dest_site
        if loc.site_id != task_site.site_id:
            return Response({'detail': 'Bin does not belong to this receiving facility.'}, status=400)
        try:
            qty = int(request.data.get('qty') or 1)
        except (TypeError, ValueError):
            return Response({'detail': 'qty must be an integer'}, status=400)
        remaining = int(task.qty or 0) - int(task.placed_qty or 0)
        if qty <= 0:
            return Response({'detail': 'qty must be greater than 0'}, status=400)
        if qty > remaining:
            return Response({
                'detail': f'only {remaining} unit(s) left on this task',
                'remaining_qty': remaining,
            }, status=400)

        occ = self._bin_occupancy(loc)
        if occ['capacity_qty'] is not None and occ['occupied_qty'] + qty > occ['capacity_qty']:
            return Response({
                'detail': (f"{loc.barcode} is full: capacity {occ['capacity_qty']}, "
                           f"holding {occ['occupied_qty']}, cannot take {qty}"),
                'bin': occ,
            }, status=400)

        try:
            self._post_units(task, loc, qty, request)
        except ValueError as e:
            return Response({'detail': str(e)}, status=400)

        task.refresh_from_db()
        payload = PutawayTaskSerializer(task).data
        payload['bin'] = self._bin_occupancy(loc)
        return Response(payload)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, IsFieldSurface])
    @transaction.atomic
    def complete(self, request, pk=None):
        """Close a putaway task once every unit has physically been placed."""
        task = (PutawayTask.objects.select_for_update()
                .select_related('grn_line', 'sku', 'lot')
                .get(pk=self.get_object().pk))
        if task.status == 'CONFIRMED':
            # Replay: stock was already added by the placements.
            return Response(PutawayTaskSerializer(task).data)

        loc, err = self._resolve_location(request.data)
        if err:
            return Response({'detail': err}, status=400)
        task_site = task.grn_line.grn.asn.dest_site
        if loc.site_id != task_site.site_id:
            return Response({'detail': 'Bin does not belong to this receiving facility.'}, status=400)

        remaining = int(task.qty or 0) - int(task.placed_qty or 0)
        if remaining > 0:
            # Compatibility for a caller that closes in one step (the CLI and
            # the older tests do this). The console always uses place() first,
            # so a partly placed task is refused rather than silently topped up.
            if int(task.placed_qty or 0) == 0:
                occ = self._bin_occupancy(loc)
                if occ['capacity_qty'] is not None and occ['occupied_qty'] + remaining > occ['capacity_qty']:
                    return Response({
                        'detail': (f"{loc.barcode} is full: capacity {occ['capacity_qty']}, "
                                   f"holding {occ['occupied_qty']}, cannot take {remaining}"),
                        'bin': occ,
                    }, status=400)
                self._post_units(task, loc, remaining, request)
            else:
                return Response({
                    'detail': f'{remaining} of {task.qty} unit(s) still to place',
                    'remaining_qty': remaining,
                    'placed_qty': task.placed_qty,
                }, status=400)

        task.refresh_from_db()
        task.status = 'CONFIRMED'
        task.confirmed_bin = loc
        task.confirmed_by = acting_user_id(request)
        task.completed_at = timezone.now()
        if task.started_at is None:
            task.started_at = timezone.now()
        task.save()

        # Notify site supervisors that putaway is confirmed and stock is live on shelf
        try:
            from bounded.outbox.services import enqueue_event
            site_code = loc.site.code if loc and loc.site else ''
            enqueue_event(
                aggregate_type='PutawayTask',
                aggregate_id=task.task_id,
                event_type='warehouse.putaway.completed',
                payload_json={
                    'task_id': str(task.task_id),
                    'site_code': site_code,
                    'sku_code': task.sku.sku_code if task.sku else '',
                    'bin_barcode': loc.barcode if loc else '',
                    'placed_qty': int(task.placed_qty or 0),
                    'completed_by': str(task.confirmed_by) if task.confirmed_by else '',
                },
            )
        except Exception:  # noqa: BLE001
            pass

        payload = PutawayTaskSerializer(task).data
        payload['bin'] = self._bin_occupancy(loc)
        return Response(payload)


class PutawayStrategyViewSet(viewsets.ModelViewSet):
    """Ranked putaway rules; global rows have no site and apply everywhere."""

    queryset = PutawayStrategy.objects.select_related('site', 'sku', 'zone').all()
    serializer_class = PutawayStrategySerializer
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]
    filterset_fields = ['site', 'sku', 'zone', 'storage_zone', 'is_active', 'status']
    search_fields = ['code', 'name', 'sku__sku_code', 'zone__code', 'site__code']
    ordering_fields = ['priority', 'code', 'created_at']

    def get_queryset(self):
        from bounded.ds_ops.access import is_superuser, operator_site_codes

        if is_superuser(self.request.user):
            return self.queryset
        codes = operator_site_codes(self.request.user)
        from django.db.models import Q
        return self.queryset.filter(Q(site__isnull=True) | Q(site__code__in=codes))


class PutawayBinListView(APIView):
    """Bins an operator can choose, with capacity, space and contents.

    Putaway used to open on a bare scan box: the worker had no way to see which
    bins existed, how full they were, or what was already inside them. That
    list is the first thing the screen now shows, and every row is scannable.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.network.models import Location
        from bounded.inventory.models import StockBalance
        from bounded.ds_ops.access import is_superuser, operator_site_codes

        qs = (Location.objects
              .filter(location_type='BIN', is_active=True)
              .select_related('site', 'zone'))
        if not is_superuser(request.user):
            qs = qs.filter(site__code__in=operator_site_codes(request.user))

        site = request.query_params.get('site')
        if site:
            qs = qs.filter(site_id=site)
        search = (request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(barcode__icontains=search)

        try:
            limit = min(int(request.query_params.get('limit', 200)), 500)
        except (TypeError, ValueError):
            limit = 200

        bins = list(qs[:limit])
        refs = [b.location_id for b in bins]
        balances = (StockBalance.objects
                    .filter(container='BIN', container_ref__in=refs, qty__gt=0)
                    .select_related('sku', 'lot')) if refs else []

        occupancy = {}
        contents = {}
        for bal in balances:
            ref = bal.container_ref
            occupancy[ref] = occupancy.get(ref, 0) + int(bal.qty or 0)
            contents.setdefault(ref, []).append({
                'sku_code': bal.sku.sku_code,
                'sku_name': bal.sku.name,
                'lot': str(bal.lot_id),
                'batch_number': bal.lot.batch_number if bal.lot else '',
                'qty': int(bal.qty or 0),
            })

        rows = []
        for b in bins:
            cap = int(b.capacity_qty) if b.capacity_qty is not None else None
            used = occupancy.get(b.location_id, 0)
            rows.append({
                'location_id': b.location_id,
                'barcode': b.barcode,
                'label': b.barcode,
                'site': b.site.code,
                'site_id': str(b.site_id),
                'zone': b.zone.code if b.zone else '',
                'aisle': b.aisle,
                'rack': b.rack,
                'level': b.level,
                'position': b.position,
                'capacity_qty': cap,
                'occupied_qty': used,
                'free_qty': None if cap is None else max(0, cap - used),
                'product_count': len(contents.get(b.location_id, [])),
                'contents': contents.get(b.location_id, []),
                'is_sellable_bin': b.is_sellable_bin,
            })

        return Response({'count': len(rows), 'results': rows})
