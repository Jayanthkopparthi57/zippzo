from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import CrossDockBatch, CrossDockLine
from .serializers import CrossDockBatchSerializer, CrossDockLineSerializer


class CrossDockBatchViewSet(viewsets.ModelViewSet):
    queryset = CrossDockBatch.objects.select_related('site').prefetch_related('lines').all()
    serializer_class = CrossDockBatchSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status', 'site']
    search_fields = ['batch_no']


class CrossDockLineViewSet(viewsets.ModelViewSet):
    queryset = CrossDockLine.objects.select_related('sku', 'xdb', 'asn', 'order').all()
    serializer_class = CrossDockLineSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['xdb', 'status', 'sku']
