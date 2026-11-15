# Inventory Views
import json
from django.db.models import Q

from django.db import transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response

from bounded.iam.permissions import IsFieldSurface
from .models import LpnMaster, LpnContent, StockMovement, StockBalance, StockMovementsChain, ReplenishmentTask
from .serializers import LpnMasterSerializer, LpnContentSerializer, StockMovementSerializer, StockBalanceSerializer, StockMovementsChainSerializer, ReplenishmentTaskSerializer


def _ledger_scope(user):
    """Site codes this caller may read, or None for the network-wide view.

    Every balance and every movement of every store used to be readable by any
    authenticated account - stock levels across the network, with the site and
    lot each one sits on. Administrators keep the network-wide view.
    """
    from bounded.ds_ops.access import is_superuser, operator_site_codes

    if user is None or not getattr(user, 'is_authenticated', False):
        return set()
    if is_superuser(user):
        return None
    return operator_site_codes(user)


class LpnMasterViewSet(viewsets.ModelViewSet):
    queryset = LpnMaster.objects.all()
    serializer_class = LpnMasterSerializer

    def get_permissions(self):
        # Reads (looking up an LPN label) are safe anywhere. Creating or
        # changing an LPN is packing/execution work and belongs to the app.
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsFieldSurface()]
    # The pack screen asks for `?status__in=EMPTY,CREATED` and the rider
    # handoff asks for `?status__in=<a few task states>`. Declaring
    # `filterset_fields = ['status']` only ever builds an *exact* match, so
    # `status__in` was not a known parameter: django-filter dropped it and the
    # query came back with every row for the site. The packer was therefore
    # offered totes that were already sealed onto another order.
    filterset_fields = {
        'status': ['exact', 'in'],
        'lpn_type': ['exact', 'in'],
        'current_site': ['exact'],
    }
    search_fields = ['barcode', 'lpn_id']

    def get_queryset(self):
        from bounded.ds_ops.access import is_superuser, operator_site_codes
        if is_superuser(self.request.user):
            return self.queryset
        codes = operator_site_codes(self.request.user)
        return self.queryset.filter(
            Q(current_site__code__in=codes) |
            Q(source_site__code__in=codes) |
            Q(dest_site__code__in=codes)
        )

    def perform_create(self, serializer):
        from bounded.ds_ops.access import require_site_access, require_session_facility
        import uuid as _uuid
        lpn = serializer.validated_data
        site = lpn.get('current_site') or lpn.get('source_site') or lpn.get('dest_site')
        if site:
            require_site_access(self.request.user, site.code)
            require_session_facility(self.request.user, site.code)
        # Mobile (and any client that only knows the site) may create a tote
        # without minting its own id/barcode. Auto-number like ASN/GRN so a
        # scan-first pack flow can mint an empty tote in one call.
        if not lpn.get('lpn_id'):
            lpn['lpn_id'] = f'TOTE-{_uuid.uuid4().hex[:12].upper()}'
        if not lpn.get('barcode'):
            lpn['barcode'] = lpn['lpn_id']
        serializer.save()

    @transaction.atomic
    def perform_update(self, serializer):
        lpn = serializer.instance
        was_packed = lpn.status == 'PACKED'
        target_status = serializer.validated_data.get('status')

        if target_status == 'PACKED' and not was_packed:
            if not LpnContent.objects.filter(lpn=lpn, qty__gt=0).exists():
                from rest_framework import serializers
                raise serializers.ValidationError({'status': 'Cannot seal an empty tote. Scan items before sealing.'})

            from django.utils import timezone
            contents = []
            for row in (LpnContent.objects
                        .filter(lpn=lpn)
                        .select_related('sku', 'lot')
                        .order_by('sku__sku_code')):
                contents.append({
                    'sku': str(row.sku_id),
                    'sku_code': row.sku.sku_code,
                    'sku_name': row.sku.name,
                    'lot': str(row.lot_id) if row.lot_id else '',
                    'batch_number': row.lot.batch_number if row.lot else '',
                    'qty': int(row.qty or 0),
                    'location': '',
                })

            manifest = {
                'lpn_id': lpn.lpn_id,
                'barcode': lpn.barcode,
                'destination': {
                    'site_id': str(lpn.dest_site_id) if lpn.dest_site_id else None,
                    'code': lpn.dest_site.code if lpn.dest_site else '',
                    'name': lpn.dest_site.name if lpn.dest_site else '',
                },
                'source': {
                    'site_id': str(lpn.source_site_id) if lpn.source_site_id else None,
                    'code': lpn.source_site.code if lpn.source_site else '',
                    'name': lpn.source_site.name if lpn.source_site else '',
                },
                'items': contents,
                'total_qty': sum(c['qty'] for c in contents),
                'packed_by': str(lpn.created_by or ''),
                'sealed_at': timezone.now().isoformat(),
            }
            serializer.validated_data['manifest'] = manifest
            serializer.validated_data['sealed_at'] = timezone.now()

        instance = serializer.save()

        if instance.transfer_id and target_status == 'PACKED' and not was_packed:
            from bounded.ds_ops.models import PickTask, TransferOrder
            to = TransferOrder.objects.filter(pk=instance.transfer_id).first()
            if to and to.status in ('APPROVED', 'ALLOCATED', 'PICKING', 'PICKED', 'SORTED', 'PACKING'):
                total_picked = sum(p.picked_qty or p.qty for p in PickTask.objects.filter(batch=str(to.pk), status='COMPLETED'))
                total_packed = sum(LpnContent.objects.filter(lpn__transfer_id=to.pk, lpn__status__in=['PACKED', 'SEALED', 'STAGED', 'IN_TRANSIT', 'RECEIVED']).values_list('qty', flat=True))
                if total_picked > 0 and total_packed >= total_picked:
                    to.status = 'PACKED'
                else:
                    to.status = 'PACKING'
                to.save(update_fields=['status'])

    @action(detail=False, methods=['get'], url_path='resolve')
    def resolve(self, request):
        """Resolve a scanned LPN label anywhere into its manifest + destination.

        The barcode printed on a tote is the only thing a worker has in hand at
        the pack bench, the store dock or a picking face. This endpoint accepts
        that barcode (or the lpn_id, or the stored qr payload) and answers with
        the full manifest, the destination dark store and the live contents.
        """
        code = (request.query_params.get('code')
                or request.query_params.get('barcode')
                or request.query_params.get('lpn')
                or '').strip()
        if not code:
            return Response({'detail': 'code is required'}, status=400)

        # A printed QR can carry the whole label payload (lpn id + barcode)
        # rather than a bare string. Accept both, so "scan the label anywhere"
        # does not depend on which symbology the pack bench printed.
        candidates = [code]
        if code.startswith('{'):
            try:
                payload = json.loads(code)
            except (TypeError, ValueError):
                payload = None
            if isinstance(payload, dict):
                for key in ('lpn_id', 'lpn', 'barcode', 'code'):
                    value = str(payload.get(key) or '').strip()
                    if value and value not in candidates:
                        candidates.append(value)

        lpn = None
        for candidate in candidates:
            lpn = (LpnMaster.objects
                   .select_related('dest_site', 'source_site', 'current_site')
                   .filter(barcode__iexact=candidate).first())
            if lpn is None:
                lpn = LpnMaster.objects.select_related(
                    'dest_site', 'source_site', 'current_site'
                ).filter(lpn_id__iexact=candidate).first()
            if lpn is not None:
                break
        if lpn is None:
            return Response({'detail': f'No LPN matches "{code}"'}, status=404)

        from bounded.ds_ops.access import is_superuser, operator_site_codes
        if not is_superuser(request.user):
            from bounded.network.models import Site
            relevant_sites = {
                value for value in (lpn.current_site_id, lpn.source_site_id, lpn.dest_site_id)
                if value
            }
            allowed_site_ids = set(
                Site.objects.filter(code__in=operator_site_codes(request.user))
                .values_list('site_id', flat=True)
            )
            if not relevant_sites.intersection(allowed_site_ids):
                return Response({'detail': 'You are not assigned to this LPN facility.'}, status=403)

        contents = []
        for row in (LpnContent.objects
                    .filter(lpn=lpn)
                    .select_related('sku', 'lot')
                    .order_by('sku__sku_code')):
            contents.append({
                'sku': str(row.sku_id),
                'sku_code': row.sku.sku_code,
                'sku_name': row.sku.name,
                'lot': str(row.lot_id),
                'batch_number': row.lot.batch_number if row.lot else '',
                'qty': int(row.qty or 0),
            })

        manifest = lpn.manifest or {}
        if not manifest:
            # Older totes predate the frozen manifest. Synthesise the same shape
            # from the live contents so a scan never returns an empty answer.
            manifest = {
                'lpn_id': lpn.lpn_id,
                'barcode': lpn.barcode,
                'destination': {
                    'site_id': str(lpn.dest_site_id) if lpn.dest_site_id else None,
                    'code': lpn.dest_site.code if lpn.dest_site else '',
                    'name': lpn.dest_site.name if lpn.dest_site else '',
                },
                'items': [
                    {**c, 'location': ''} for c in contents
                ],
                'total_qty': sum(c['qty'] for c in contents),
                'synthesised': True,
            }

        return Response({
            'lpn_id': lpn.lpn_id,
            'barcode': lpn.barcode,
            'status': lpn.status,
            'lpn_type': lpn.lpn_type,
            'source_site': lpn.source_site.code if lpn.source_site else None,
            'destination': {
                'site_id': str(lpn.dest_site_id) if lpn.dest_site_id else None,
                'code': lpn.dest_site.code if lpn.dest_site else '',
                'name': lpn.dest_site.name if lpn.dest_site else '',
            },
            'manifest': manifest,
            'contents': contents,
            'total_qty': sum(c['qty'] for c in contents),
        })

class LpnContentViewSet(viewsets.ModelViewSet):
    queryset = LpnContent.objects.select_related('lpn', 'sku', 'lot').all()
    serializer_class = LpnContentSerializer
    filterset_fields = ['lpn', 'sku', 'lot']

    def get_permissions(self):
        # Adding a unit to a tote moves it out of a bin into LPN custody.
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsFieldSurface()]

    def get_queryset(self):
        from bounded.ds_ops.access import is_superuser, operator_site_codes
        if is_superuser(self.request.user):
            return self.queryset
        codes = operator_site_codes(self.request.user)
        return self.queryset.filter(
            Q(lpn__current_site__code__in=codes) |
            Q(lpn__source_site__code__in=codes) |
            Q(lpn__dest_site__code__in=codes)
        )

    def _validate_and_commit(self, lpn, sku, lot, new_qty, old_qty=0, instance=None):
        from django.db.models import Sum
        from rest_framework import serializers
        from bounded.iam.names import acting_user_id
        from bounded.inventory.models import StockBalance
        from bounded.inventory.stock import apply_stock, InsufficientStock

        delta = new_qty - old_qty
        actor_id = str(acting_user_id(self.request) or '')

        source_site = lpn.source_site or lpn.current_site
        if source_site:
            from bounded.ds_ops.access import require_site_access, require_session_facility
            require_site_access(self.request.user, source_site.code)
            require_session_facility(self.request.user, source_site.code)
        source_bin = ''
        if lpn.transfer_id:
            from bounded.ds_ops.models import PickTask
            picks = PickTask.objects.filter(
                batch=str(lpn.transfer_id),
                sku=sku.sku_id,
                status='COMPLETED'
            )
            if not picks.exists():
                raise serializers.ValidationError({
                    'sku': f"SKU {sku.sku_code} is not on completed picks for transfer {lpn.transfer_id}."
                })

            total_picked = sum(p.picked_qty or p.qty for p in picks)
            other_contents = LpnContent.objects.filter(lpn__transfer_id=lpn.transfer_id, sku=sku)
            if instance:
                other_contents = other_contents.exclude(pk=instance.pk)
            already_packed = sum(other_contents.values_list('qty', flat=True))

            if already_packed + new_qty > total_picked:
                remaining = max(0, total_picked - already_packed)
                raise serializers.ValidationError({
                    'qty': f"Cannot pack {new_qty} units of {sku.sku_code}: exceeds completed picks ({remaining} remaining)."
                })

            lot_picks = picks.filter(lot=lot.lot_id) if lot else picks.none()
            if lot_picks.exists():
                candidate_bins = list(lot_picks.exclude(bin='').values_list('bin', flat=True).distinct())
            else:
                candidate_bins = list(picks.exclude(bin='').values_list('bin', flat=True).distinct())

            source_bin = ''
            for b in candidate_bins:
                bal = (StockBalance.objects
                       .filter(site=source_site, container='BIN', container_ref=b, sku=sku, lot=lot)
                       .aggregate(t=Sum('qty'))['t'] or 0)
                if bal >= delta:
                    source_bin = b
                    break
            if not source_bin and candidate_bins:
                source_bin = candidate_bins[0]
        if delta > 0 and source_site:
            bin_balance = 0
            if source_bin:
                bin_balance = (StockBalance.objects
                               .filter(site=source_site, container='BIN', container_ref=source_bin,
                                       sku=sku, lot=lot)
                               .aggregate(t=Sum('qty'))['t'] or 0)
            if bin_balance >= delta:
                try:
                    line_ref = f"PACK:{lpn.lpn_id}:{str(sku.sku_id)[:8]}:{new_qty}"
                    apply_stock(
                        site=source_site, sku=sku, lot=lot, qty=delta,
                        direction='OUT', movement_type='PACK', ref_type='LPN', ref_id=line_ref,
                        actor_id=actor_id, actor_type='STAFF',
                        container='BIN', container_ref=source_bin,
                        enforce_available=True,
                    )
                    apply_stock(
                        site=source_site, sku=sku, lot=lot, qty=delta,
                        direction='IN', movement_type='PACK', ref_type='LPN', ref_id=line_ref,
                        actor_id=actor_id, actor_type='STAFF',
                        container='LPN', container_ref=str(lpn.lpn_id),
                        sellable=False, supply_from='CUSTODY', supply_from_ref=source_bin,
                    )
                except InsufficientStock as e:
                    raise serializers.ValidationError({'stock': str(e)})
            else:
                line_ref = f"PACK:{lpn.lpn_id}:{str(sku.sku_id)[:8]}:{new_qty}"
                if lpn.transfer_id:
                    # A transfer pick already took these units out of their
                    # source bins when its PickTask completed. Only the custody
                    # half - into the tote - is still owed here.
                    apply_stock(
                        site=source_site, sku=sku, lot=lot, qty=delta,
                        direction='IN', movement_type='PACK', ref_type='LPN', ref_id=line_ref,
                        actor_id=actor_id, actor_type='STAFF',
                        container='LPN', container_ref=str(lpn.lpn_id),
                        sellable=False, supply_from='CUSTODY', supply_from_ref=source_bin or 'PICK',
                    )
                else:
                    # Draw the units from every bin that holds them, then add
                    # them to the tote. The old code wrote only the IN movement
                    # and left the bins untouched, so the same units counted
                    # both on the shelf and inside the LPN.
                    need = delta
                    draws = []
                    for bal_row in (StockBalance.objects
                                    .filter(site=source_site, container='BIN',
                                            sku=sku, lot=lot, qty__gt=0)
                                    .order_by('container_ref')):
                        if need <= 0:
                            break
                        take = min(need, bal_row.qty)
                        draws.append((bal_row.container_ref, take))
                        need -= take
                    if need > 0:
                        raise serializers.ValidationError({
                            'stock': f"Only {delta - need} of {delta} units of "
                                     f"{sku.sku_code} are on bins at "
                                     f"{source_site.code}.",
                        })
                    for bin_ref, take in draws:
                        apply_stock(
                            site=source_site, sku=sku, lot=lot, qty=take,
                            direction='OUT', movement_type='PACK', ref_type='LPN',
                            ref_id=line_ref, actor_id=actor_id, actor_type='STAFF',
                            container='BIN', container_ref=bin_ref,
                            enforce_available=True,
                        )
                    apply_stock(
                        site=source_site, sku=sku, lot=lot, qty=delta,
                        direction='IN', movement_type='PACK', ref_type='LPN', ref_id=line_ref,
                        actor_id=actor_id, actor_type='STAFF',
                        container='LPN', container_ref=str(lpn.lpn_id),
                        sellable=False, supply_from='CUSTODY', supply_from_ref=source_bin or 'PICK',
                    )
        elif delta < 0 and source_site:
            rem_qty = abs(delta)
            line_ref = f"UNPACK:{lpn.lpn_id}:{str(sku.sku_id)[:8]}:{new_qty}"
            apply_stock(
                site=source_site, sku=sku, lot=lot, qty=rem_qty,
                direction='OUT', movement_type='PACK', ref_type='LPN', ref_id=line_ref,
                actor_id=actor_id, actor_type='STAFF',
                container='LPN', container_ref=str(lpn.lpn_id),
                sellable=False,
            )

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        lpn_id = request.data.get('lpn')
        sku_id = request.data.get('sku')
        lot_id = request.data.get('lot')
        try:
            qty = int(request.data.get('qty', 1))
        except (ValueError, TypeError):
            qty = 1

        existing = LpnContent.objects.filter(lpn_id=lpn_id, sku_id=sku_id, lot_id=lot_id).first()
        if existing:
            if existing.qty == qty:
                serializer = self.get_serializer(existing)
                return Response(serializer.data, status=200)
            # Same tote + SKU + lot is unique. Treating a different quantity as
            # a second create hit the unique constraint and returned a 500.
            # It is really an adjustment to the existing content row, so run it
            # through the update path (which moves the quantity difference in
            # the ledger) and answer 200.
            serializer = self.get_serializer(existing, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)
            return Response(serializer.data, status=200)

        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def perform_create(self, serializer):
        lpn = serializer.validated_data['lpn']
        sku = serializer.validated_data['sku']
        lot = serializer.validated_data.get('lot')
        qty = serializer.validated_data.get('qty', 1)
        self._validate_and_commit(lpn, sku, lot, new_qty=qty, old_qty=0)
        serializer.save()

    @transaction.atomic
    def perform_update(self, serializer):
        instance = serializer.instance
        lpn = instance.lpn
        sku = instance.sku
        lot = instance.lot
        new_qty = serializer.validated_data.get('qty', instance.qty)
        self._validate_and_commit(lpn, sku, lot, new_qty=new_qty, old_qty=instance.qty, instance=instance)
        serializer.save()

    @transaction.atomic
    def perform_destroy(self, instance):
        lpn = instance.lpn
        sku = instance.sku
        lot = instance.lot
        qty = instance.qty
        source_site = lpn.source_site or lpn.current_site
        if source_site:
            from bounded.ds_ops.access import require_site_access, require_session_facility
            require_site_access(self.request.user, source_site.code)
            require_session_facility(self.request.user, source_site.code)
        if qty > 0 and source_site:
            from bounded.inventory.stock import apply_stock
            line_ref = f"UNPACK:{lpn.lpn_id}:{str(sku.sku_id)[:8]}:{qty}"
            apply_stock(
                site=source_site, sku=sku, lot=lot, qty=qty,
                direction='OUT', movement_type='PACK', ref_type='LPN', ref_id=line_ref,
                container='LPN', container_ref=str(lpn.lpn_id),
                sellable=False,
            )
        instance.delete()

class StockMovementViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = StockMovement.objects.select_related('sku', 'lot', 'site').all()
    serializer_class = StockMovementSerializer
    filterset_fields = ['movement_type', 'site', 'from_container', 'to_container', 'actor_type']

    def get_queryset(self):
        codes = _ledger_scope(self.request.user)
        if codes is None:
            return self.queryset
        return self.queryset.filter(site__code__in=codes)

class StockBalanceViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = StockBalance.objects.select_related('site', 'sku', 'lot').all()
    serializer_class = StockBalanceSerializer
    filterset_fields = ['site', 'container', 'container_ref', 'sku', 'sellable']

    def get_queryset(self):
        codes = _ledger_scope(self.request.user)
        if codes is None:
            return self.queryset
        return self.queryset.filter(site__code__in=codes)

class StockMovementsChainViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = StockMovementsChain.objects.select_related('site').all()
    serializer_class = StockMovementsChainSerializer

    def get_queryset(self):
        codes = _ledger_scope(self.request.user)
        if codes is None:
            return self.queryset
        return self.queryset.filter(site__code__in=codes)


class ReplenishmentTaskViewSet(viewsets.ModelViewSet):
    queryset = ReplenishmentTask.objects.select_related('site', 'sku', 'lot', 'assigned_to', 'completed_by').all()
    serializer_class = ReplenishmentTaskSerializer
    filterset_fields = ['site', 'sku', 'lot', 'status', 'trigger', 'assigned_to']
    search_fields = ['sku__sku_code', 'sku__name', 'from_container_ref', 'to_container_ref', 'reason']
    ordering_fields = ['created_at', 'qty', 'status']

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsFieldSurface()]

    def get_queryset(self):
        codes = _ledger_scope(self.request.user)
        if codes is None:
            return self.queryset
        return self.queryset.filter(site__code__in=codes)

    def perform_create(self, serializer):
        from bounded.ds_ops.access import require_site_access, require_session_facility
        site = serializer.validated_data['site']
        require_site_access(self.request.user, site.code)
        require_session_facility(self.request.user, site.code)
        serializer.save(created_by=self.request.user if getattr(self.request.user, 'is_authenticated', False) else None)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def assign(self, request, pk=None):
        task = self.get_object()
        if task.status in ('COMPLETED', 'CANCELLED'):
            return Response({'error': f'Task is {task.status} and cannot be reassigned.'}, status=400)
        user_id = request.data.get('user') or request.data.get('assigned_to')
        if user_id in (None, '', 'null'):
            task.assigned_to = None
            if task.status == 'ASSIGNED':
                task.status = 'OPEN'
            task.save(update_fields=['assigned_to', 'status', 'updated_at'])
            return Response({'success': True, 'assigned_to': None, 'status': task.status})
        task.assigned_to_id = user_id
        if task.status == 'OPEN':
            task.status = 'ASSIGNED'
        task.save(update_fields=['assigned_to', 'status', 'updated_at'])
        return Response({'success': True, 'assigned_to': str(task.assigned_to_id), 'status': task.status})

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def complete(self, request, pk=None):
        from django.utils import timezone
        from bounded.ds_ops.access import require_site_access, require_session_facility
        from bounded.iam.names import acting_user_id
        from .stock import apply_stock, already_applied, InsufficientStock

        task = self.get_object()
        if task.status == 'COMPLETED':
            return Response({
                'success': True,
                'already_completed': True,
                'task_id': str(task.task_id),
                'status': task.status,
            })
        if task.status == 'CANCELLED':
            return Response({'error': 'Cancelled replenishment tasks cannot be completed.'}, status=400)

        require_site_access(request.user, task.site.code)
        require_session_facility(request.user, task.site.code)

        actor_id = acting_user_id(request) or ''
        actor_type = getattr(request.user, 'role', 'STAFF') or 'STAFF'
        ref_id = str(task.task_id)
        already_out = already_applied(
            site=task.site, sku=task.sku, lot=task.lot,
            movement_type='REPLENISH', ref_type='REPLENISHMENT', ref_id=ref_id,
            direction='OUT', container=task.from_container,
            container_ref=task.from_container_ref,
        )
        already_in = already_applied(
            site=task.site, sku=task.sku, lot=task.lot,
            movement_type='REPLENISH', ref_type='REPLENISHMENT', ref_id=ref_id,
            direction='IN', container=task.to_container,
            container_ref=task.to_container_ref,
        )
        if already_out and already_in:
            task.status = 'COMPLETED'
            task.completed_at = task.completed_at or timezone.now()
            task.completed_by_id = task.completed_by_id or actor_id
            task.save(update_fields=['status', 'completed_at', 'completed_by', 'updated_at'])
            return Response({'success': True, 'already_completed': True, 'task_id': ref_id, 'status': task.status})

        try:
            if not already_out:
                apply_stock(
                    site=task.site, sku=task.sku, lot=task.lot, qty=task.qty,
                    direction='OUT', movement_type='REPLENISH',
                    ref_type='REPLENISHMENT', ref_id=ref_id,
                    actor_id=actor_id, actor_type=actor_type,
                    container=task.from_container,
                    container_ref=task.from_container_ref,
                    enforce_available=True,
                )
            if not already_in:
                apply_stock(
                    site=task.site, sku=task.sku, lot=task.lot, qty=task.qty,
                    direction='IN', movement_type='REPLENISH',
                    ref_type='REPLENISHMENT', ref_id=ref_id,
                    actor_id=actor_id, actor_type=actor_type,
                    container=task.to_container,
                    container_ref=task.to_container_ref,
                    supply_from='CUSTODY', supply_from_ref=task.from_container_ref,
                )
        except InsufficientStock as exc:
            return Response({'error': str(exc)}, status=400)

        now = timezone.now()
        task.status = 'COMPLETED'
        task.started_at = task.started_at or now
        task.completed_at = now
        task.completed_by_id = actor_id
        task.save(update_fields=['status', 'started_at', 'completed_at', 'completed_by', 'updated_at'])
        return Response({'success': True, 'task_id': ref_id, 'status': task.status})
