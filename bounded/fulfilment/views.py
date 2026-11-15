from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Batch, OrderAllocation
from .serializers import BatchSerializer, OrderAllocationSerializer


def _allowed_codes(user):
    from bounded.ds_ops.access import is_superuser, operator_site_codes
    return None if is_superuser(user) else operator_site_codes(user)

class BatchViewSet(viewsets.ModelViewSet):
    queryset = Batch.objects.all()
    serializer_class = BatchSerializer
    filterset_fields = ['status','type','site']
    search_fields = ['batch_no']

    def get_queryset(self):
        codes = _allowed_codes(self.request.user)
        return self.queryset if codes is None else self.queryset.filter(site__code__in=codes)

    def perform_create(self, serializer):
        from bounded.ds_ops.access import require_site_access
        require_site_access(self.request.user, serializer.validated_data['site'].code)
        serializer.save()

    @action(detail=True, methods=['post'], url_path='dispatch')
    def mark_dispatch(self, request, pk=None):
        batch = self.get_object()
        # Batch.STATUS_CHOICES has no IN_TRANSIT; dispatched == finished at this site.
        batch.status = 'CLOSED'
        batch.save()
        return Response({'success': True, 'batch_id': batch.batch_no, 'status': batch.status})

class OrderAllocationViewSet(viewsets.ModelViewSet):
    queryset = OrderAllocation.objects.all()
    serializer_class = OrderAllocationSerializer
    filterset_fields = ['status', 'batch']

    def get_queryset(self):
        codes = _allowed_codes(self.request.user)
        if codes is None:
            return self.queryset
        batch_ids = Batch.objects.filter(site__code__in=codes).values_list('batch_id', flat=True)
        return self.queryset.filter(batch__in=batch_ids)

    def _check_batch_access(self, batch_id):
        if not batch_id:
            from bounded.ds_ops.access import is_superuser
            if not is_superuser(self.request.user):
                from rest_framework.exceptions import ValidationError
                raise ValidationError({'batch': 'A facility-scoped outbound batch is required.'})
            return
        from bounded.ds_ops.access import require_site_access
        batch = Batch.objects.filter(batch_id=batch_id).select_related('site').first()
        if batch is None:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'batch': 'Outbound batch does not exist.'})
        require_site_access(self.request.user, batch.site.code)

    def perform_create(self, serializer):
        self._check_batch_access(serializer.validated_data.get('batch'))
        serializer.save()

    def perform_update(self, serializer):
        batch_id = serializer.validated_data.get('batch', serializer.instance.batch)
        self._check_batch_access(batch_id)
        serializer.save()
