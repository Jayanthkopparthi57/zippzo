from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from bounded.masterdata.scoping import SiteScopedViewSet, StampActorMixin

from .models import CycleCount, CycleCountLine
from .serializers import CycleCountSerializer, CycleCountLineSerializer


def _may_approve(user, site):
    """Who may clear a count variance: estate roles and the store manager."""
    from bounded.ds_ops.access import is_estate_role, is_superuser
    from bounded.iam import staff_auth

    if is_estate_role(user) or is_superuser(user):
        return True
    return staff_auth.department_for(user, site) == 'MANAGER'


class CycleCountViewSet(StampActorMixin, SiteScopedViewSet):
    queryset = CycleCount.objects.select_related(
        'site', 'assigned_to', 'created_by').all()
    serializer_class = CycleCountSerializer
    actor_fields = {'created_by': 'relation'}
    filterset_fields = ['site', 'count_type', 'status', 'assigned_to', 'scheduled_for']
    search_fields = ['code', 'notes', 'site__code']
    ordering_fields = ['created_at', 'scheduled_for', 'status']

    def get_permissions(self):
        """Counting is floor work, not master-data editing.

        An inventory associate starts a spot count from the mobile app, so a
        blanket "admins only" write rule made the chart's inventory role
        unusable. Reads and count writes are open to any signed-in operator;
        the queryset still scopes every row to the caller's store and the
        serializer refuses a `site` the caller is not assigned to. Deleting a
        count stays an administrator action.
        """
        from rest_framework.permissions import IsAuthenticated

        from bounded.iam.permissions import IsAdminUser

        if self.request.method == 'DELETE':
            return [IsAuthenticated(), IsAdminUser()]
        return [IsAuthenticated()]

    def get_queryset(self):
        from django.db.models import Count
        return super().get_queryset().annotate(
            line_count=Count('lines'),
        ).order_by('-created_at')

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def generate(self, request, pk=None):
        """Create count lines from the site's live stock balances.

        Scope may name container refs and SKU ids; with no scope the whole
        site's BIN balances are snapshotted. Existing lines are kept, so a
        retry or an in-progress count cannot duplicate the same shelf row.
        """
        from bounded.inventory.models import StockBalance
        from bounded.network.models import Location

        count = self.get_object()
        if count.status in ('CLOSED', 'CANCELLED'):
            return Response({'error': f'Count is {count.status} and cannot be generated.'}, status=400)

        scope = count.scope or {}
        balances = StockBalance.objects.filter(site=count.site)
        container = scope.get('container')
        if container:
            balances = balances.filter(container=container)
        else:
            balances = balances.filter(container='BIN')
        sku_ids = scope.get('sku_ids') or scope.get('skus')
        if sku_ids:
            balances = balances.filter(sku_id__in=sku_ids)
        container_refs = scope.get('container_refs') or scope.get('bins')
        if container_refs:
            balances = balances.filter(container_ref__in=container_refs)
        zone_id = scope.get('zone_id') or scope.get('zone')
        if zone_id:
            location_ids = list(Location.objects.filter(site=count.site, zone_id=zone_id).values_list('location_id', flat=True))
            balances = balances.filter(container='BIN', container_ref__in=location_ids)
        try:
            limit = min(int(scope.get('limit', 1000)), 5000)
        except (TypeError, ValueError):
            limit = 1000

        locations = {
            location.location_id: location
            for location in Location.objects.filter(site=count.site)
        }
        existing = {
            (str(line.location_id), str(line.sku_id), str(line.lot_id))
            for line in count.lines.all()
        }
        created = 0
        for balance in balances.select_related('sku', 'lot')[:limit]:
            location = locations.get(balance.container_ref) if balance.container == 'BIN' else None
            key = (str(location.location_id) if location else '', str(balance.sku_id), str(balance.lot_id))
            if key in existing:
                continue
            CycleCountLine.objects.create(
                count=count,
                location=location,
                sku=balance.sku,
                lot=balance.lot,
                system_qty=int(balance.qty or 0),
                status='PENDING',
            )
            existing.add(key)
            created += 1

        if count.status == 'DRAFT':
            count.status = 'IN_PROGRESS'
            count.started_at = timezone.now()
            count.save(update_fields=['status', 'started_at', 'updated_at'])
        return Response({
            'success': True,
            'count_id': str(count.count_id),
            'lines_created': created,
            'line_count': count.lines.count(),
            'status': count.status,
        })

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def complete(self, request, pk=None):
        """Close the count and post approved variances to the ledger."""
        from bounded.iam.names import acting_user_id
        from bounded.inventory.stock import apply_stock, InsufficientStock

        count = self.get_object()
        if count.status == 'CLOSED':
            return Response({
                'success': True,
                'already_completed': True,
                'count_id': str(count.count_id),
                'status': count.status,
            })
        if count.status == 'CANCELLED':
            return Response({'error': 'Cancelled counts cannot be completed.'}, status=400)

        lines = list(count.lines.select_related('sku', 'lot', 'location').all())
        incomplete = [line for line in lines if line.counted_qty is None or line.status == 'RECOUNT']
        if incomplete:
            return Response({
                'error': f'{len(incomplete)} count line(s) still need a counted quantity.',
            }, status=400)

        # A variance is a stock write. The person who counted the shelf may not
        # also clear the difference, or "cycle count" becomes a way to make the
        # ledger agree with whatever was left on the shelf. Managers and estate
        # roles approve; a field associate's completion stops at REVIEW and the
        # count waits for that approval. A zero-variance count still closes
        # immediately, because it moves no stock.
        variances = [
            (line, int(line.counted_qty or 0) - int(line.system_qty or 0))
            for line in lines
        ]
        if any(variance for _, variance in variances) and not _may_approve(
                request.user, count.site):
            for line, variance in variances:
                if line.status != 'APPROVED':
                    line.variance = variance
                    line.status = 'VARIANCE' if variance else 'COUNTED'
                    line.save(update_fields=['variance', 'status'])
            count.status = 'REVIEW'
            count.closed_at = None
            count.save(update_fields=['status', 'closed_at', 'updated_at'])
            return Response({
                'error': (
                    'This count has variances. A store manager must approve the '
                    'adjustment before stock is changed.'),
                'code': 'approval_required',
                'count_id': str(count.count_id),
                'status': count.status,
                'variance_lines': sum(1 for _, variance in variances if variance),
            }, status=409)

        actor_id = acting_user_id(request) or ''
        actor_type = getattr(request.user, 'role', 'STAFF') or 'STAFF'
        for line in lines:
            variance = int(line.counted_qty or 0) - int(line.system_qty or 0)
            line.variance = variance
            if variance and line.status != 'APPROVED':
                container = 'BIN' if line.location_id else 'SITE'
                container_ref = line.location.location_id if line.location_id else ''
                ref_id = str(count.count_id)
                try:
                    if variance > 0:
                        apply_stock(
                            site=count.site, sku=line.sku, lot=line.lot, qty=variance,
                            direction='IN', movement_type='CYCLE_COUNT',
                            ref_type='CYCLECOUNT', ref_id=ref_id,
                            actor_id=actor_id, actor_type=actor_type,
                            container=container, container_ref=container_ref,
                            supply_from='CUSTODY', supply_from_ref=ref_id,
                        )
                    else:
                        apply_stock(
                            site=count.site, sku=line.sku, lot=line.lot, qty=abs(variance),
                            direction='OUT', movement_type='CYCLE_COUNT',
                            ref_type='CYCLECOUNT', ref_id=ref_id,
                            actor_id=actor_id, actor_type=actor_type,
                            container=container, container_ref=container_ref,
                            enforce_available=True,
                        )
                except InsufficientStock as exc:
                    return Response({'error': str(exc)}, status=400)
                line.status = 'APPROVED'
            elif line.status not in ('APPROVED',):
                line.status = 'COUNTED' if variance == 0 else 'VARIANCE'
            line.save(update_fields=['variance', 'status'])

        count.status = 'CLOSED'
        count.closed_at = timezone.now()
        count.save(update_fields=['status', 'closed_at', 'updated_at'])
        return Response({
            'success': True,
            'count_id': str(count.count_id),
            'status': count.status,
            'lines_posted': len(lines),
        })

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def approve(self, request, pk=None):
        """Clear a counted variance that a field associate left in REVIEW.

        `complete` stops at REVIEW when the caller may not approve. This is the
        manager's half of that workflow: the stock movements are posted here,
        with the approver recorded as the actor, so the ledger and the audit
        trail name the person who authorized the difference.
        """
        count = self.get_object()
        if not _may_approve(request.user, count.site):
            return Response({
                'error': 'Only a store manager or estate administrator can approve count variances.',
            }, status=403)
        return self.complete(request, pk=pk)


class CycleCountLineViewSet(SiteScopedViewSet):
    queryset = CycleCountLine.objects.select_related(
        'count', 'location', 'sku', 'lpn', 'counted_by').all()
    serializer_class = CycleCountLineSerializer
    site_field = 'count__site'
    filterset_fields = ['count', 'status', 'location', 'sku']
    search_fields = ['sku__sku_code', 'sku__name', 'location__barcode', 'count__code']
    ordering_fields = ['count', 'status', 'variance']

    def get_permissions(self):
        """The counter records what they physically see on the shelf."""
        from rest_framework.permissions import IsAuthenticated

        from bounded.iam.permissions import IsAdminUser

        if self.request.method == 'DELETE':
            return [IsAuthenticated(), IsAdminUser()]
        return [IsAuthenticated()]
