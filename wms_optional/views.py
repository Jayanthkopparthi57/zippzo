from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import CycleCount, CycleCountLine, ReplenishmentTask
from .serializers import CycleCountSerializer, CycleCountLineSerializer, ReplenishmentTaskSerializer


class CycleCountViewSet(viewsets.ModelViewSet):
    queryset = CycleCount.objects.select_related('site').prefetch_related('lines').all()
    serializer_class = CycleCountSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['site', 'type', 'status']


class CycleCountLineViewSet(viewsets.ModelViewSet):
    queryset = CycleCountLine.objects.select_related('sku', 'bin', 'count').all()
    serializer_class = CycleCountLineSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['count', 'status', 'sku']


class ReplenishmentTaskViewSet(viewsets.ModelViewSet):
    queryset = ReplenishmentTask.objects.select_related('sku', 'from_bin', 'to_bin', 'site').all()
    serializer_class = ReplenishmentTaskSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['site', 'status', 'trigger', 'sku']
    ordering_fields = ['created_at', 'qty']
