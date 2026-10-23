# Supply Views
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
from bounded.iam.names import AttributionContextMixin, acting_user_id
from bounded.iam.permissions import IsAdminUserOrReadOnly
from .models import Vendor, Seller, Asn, AsnLine, Grn, GrnLine, QcInspection, PutawayTask, VendorLicense, SellerCategoryApproval
from .serializers import VendorSerializer, SellerSerializer, AsnSerializer, AsnLineSerializer, GrnSerializer, GrnLineSerializer, QcInspectionSerializer, PutawayTaskSerializer, VendorLicenseSerializer, SellerCategoryApprovalSerializer

class VendorViewSet(viewsets.ModelViewSet):
    queryset = Vendor.objects.all()
    serializer_class = VendorSerializer
    # Supplier records are reference data for every operator, but only admin
    # roles may add or edit one (see IsAdminUserOrReadOnly).
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['status']
    search_fields = ['code', 'name']

class SellerViewSet(viewsets.ModelViewSet):
    queryset = Seller.objects.all()
    serializer_class = SellerSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['status', 'fulfilment_mode']

class AsnViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = Asn.objects.select_related('dest_site', 'source_vendor').all()
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
        if not data.get('asn_no'):
            data['asn_no'] = self._next_asn_no()
        serializer.save(created_by=acting_user_id(self.request))

class AsnLineViewSet(viewsets.ModelViewSet):
    queryset = AsnLine.objects.select_related('asn', 'sku').all()
    serializer_class = AsnLineSerializer
    # ?asn=<asn_id> and ?search=<ean> were both ignored without these, so the
    # ASN detail lookup and the per-line product scan always returned every line.
    filterset_fields = ['asn', 'line_status', 'sku']
    search_fields = ['ean', 'sku__sku_code', 'sku__name']

class GrnViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = Grn.objects.select_related('asn').all()
    serializer_class = GrnSerializer
    attribution_fields = ('created_by', 'received_by')
    # `asn` is needed to resume an in-progress receipt for a scanned consignment.
    # Without it `?asn=<id>` was silently ignored and the caller received the
    # first page of every GRN in the system.
    # The actor/window lookups feed the inbound ledger's "who received, when".
    filterset_fields = {
        'status': ['exact'],
        'mode': ['exact'],
        'asn': ['exact'],
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
        if not data.get('grn_no'):
            data['grn_no'] = self._next_grn_no()
        serializer.save(created_by=acting_user_id(self.request))

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def complete(self, request, pk=None):
        """Close the GRN and generate one putaway task per accepted line.

        Idempotent: existing putaway tasks for a line are never duplicated.
        """
        grn = self.get_object()
        if grn.status == 'COMPLETED':
            return Response({'success': True, 'already_completed': True,
                             'grn_no': grn.grn_no,
                             'putaway_tasks': PutawayTask.objects.filter(
                                 grn_line__grn=grn).count()})

        lines = list(grn.lines.select_related('sku', 'lot'))
        if not lines:
            return Response({'detail': 'GRN has no lines to receive'}, status=400)

        unaccounted = [l.line_id for l in lines
                       if l.received_qty == 0]
        if unaccounted:
            return Response({
                'detail': 'every GRN line must record received_qty before closing',
                'lines': [str(x) for x in unaccounted],
            }, status=400)

        created = []
        for line in lines:
            if line.accepted_qty <= 0 or line.lot_id is None:
                continue
            task, was_created = PutawayTask.objects.get_or_create(
                grn_line=line,
                defaults={
                    'from_container': 'QC_PASSED_STAGING',
                    'to_container': 'PUTAWAY_PENDING',
                    'sku_id': line.sku_id,
                    'lot_id': line.lot_id,
                    'qty': line.accepted_qty,
                    'status': 'GENERATED',
                },
            )
            if was_created:
                created.append(str(task.task_id))

        grn.status = 'COMPLETED'
        grn.completed_at = timezone.now()
        # Who actually received wins over any client-supplied value.
        grn.received_by = acting_user_id(request)
        grn.has_discrepancy = any(
            l.damaged_qty or l.expired_qty or l.excess_qty for l in lines)
        grn.save()

        asn = grn.asn
        if asn and asn.status not in ('CLOSED',):
            asn.status = 'CLOSED'
            asn.save()

        return Response({'success': True, 'grn_no': grn.grn_no,
                         'status': grn.status,
                         'putaway_tasks_created': created,
                         'putaway_task_count': PutawayTask.objects.filter(
                             grn_line__grn=grn).count()})

class GrnLineViewSet(viewsets.ModelViewSet):
    queryset = GrnLine.objects.select_related('grn', 'sku').all()
    serializer_class = GrnLineSerializer
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

class QcInspectionViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = QcInspection.objects.select_related('grn_line').all()
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
        'tested_at': ['gte', 'lte'],
    }
    search_fields = ['grn_line__sku__sku_code', 'grn_line__sku__ean']

    @action(detail=True, methods=['post'])
    def verify(self, request, pk=None):
        inspection = self.get_object()
        data = request.data
        inspection.sample_size = data.get('sample_size', inspection.sample_size)
        inspection.pass_count = data.get('pass_count', inspection.pass_count)
        inspection.fail_count = data.get('fail_count', inspection.fail_count)
        inspection.status = data.get('status', 'PASSED')
        inspection.remarks = data.get('remarks', inspection.remarks)
        # Stamped from the token: earlier clients sent 'console' (not even a
        # UUID) into this UUID column, which crashed the save.
        inspection.tested_by = acting_user_id(request)
        inspection.tested_at = timezone.now()
        inspection.save()
        return Response(QcInspectionSerializer(inspection).data)


class PutawayTaskViewSet(AttributionContextMixin, viewsets.ModelViewSet):
    queryset = PutawayTask.objects.select_related('grn_line', 'sku', 'lot').all()
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
        'assigned_to': ['exact'],
        'confirmed_by': ['exact'],
        'created_at': ['gte', 'lte'],
        'completed_at': ['gte', 'lte'],
    }
    search_fields = ['sku__sku_code', 'sku__ean', 'grn_line__grn__grn_no']

    @action(detail=True, methods=['post'])
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
        task.assigned_to = user
        if task.status == 'GENERATED':
            task.status = 'ACCEPTED'
        if task.started_at is None and task.status in ('ACCEPTED', 'IN_PROGRESS'):
            task.started_at = task.started_at or timezone.now()
        task.save()
        return Response({'success': True, 'assigned_to': str(task.assigned_to), 'status': task.status})

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        task = self.get_object()
        if task.status == 'CONFIRMED':
            return Response({'error': f'Task is {task.status}.'}, status=400)
        task.assigned_to = None
        task.save(update_fields=['assigned_to'])
        return Response({'success': True, 'assigned_to': None})

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def complete(self, request, pk=None):
        from bounded.inventory.stock import apply_stock
        from bounded.network.models import Location
        task = self.get_object()
        if task.status == 'CONFIRMED':
            # Replay: stock was already added by the first call.
            return Response(PutawayTaskSerializer(task).data)
        data = request.data
        bin_id = data.get('destination_location_id') or data.get('confirmed_bin')
        if not bin_id:
            return Response({'detail': 'destination_location_id is required'}, status=400)
        try:
            loc = Location.objects.get(location_id=bin_id)
        except Location.DoesNotExist:
            return Response({'detail': f'Location {bin_id} not found'}, status=400)

        # Receiving is what actually creates stock. Bin code is the balance key,
        # matching how picking decrements (container=BIN, container_ref=<bin code>).
        gl = task.grn_line
        accepted = gl.accepted_qty if gl else task.qty
        from bounded.catalog.models import InventoryLot, Sku
        sku = Sku.objects.filter(sku_id=task.sku_id).first()
        lot = InventoryLot.objects.filter(lot_id=task.lot_id).first() if task.lot_id else None
        if sku is not None and accepted and accepted > 0:
            apply_stock(
                site=loc.site, sku=sku, lot=lot, qty=accepted, direction='IN',
                movement_type='PUTAWAY', ref_type='PUTAWAYTASK', ref_id=task.grn_line_id,
                actor_id=acting_user_id(request) or task.assigned_to or '',
                actor_type='STAFF',
                container='BIN', container_ref=loc.location_id,
            )

        task.confirmed_bin = loc
        task.status = 'CONFIRMED'
        task.confirmed_by = acting_user_id(request)
        task.completed_at = timezone.now()
        if task.started_at is None:
            task.started_at = timezone.now()
        task.save()
        return Response(PutawayTaskSerializer(task).data)
