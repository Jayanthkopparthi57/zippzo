from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Batch, OrderAllocation
from .serializers import BatchSerializer, OrderAllocationSerializer

class BatchViewSet(viewsets.ModelViewSet):
    queryset = Batch.objects.all()
    serializer_class = BatchSerializer
    filterset_fields = ['status','type','site']
    search_fields = ['batch_no']

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
    filterset_fields = ['status']
