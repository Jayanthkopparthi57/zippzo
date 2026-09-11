from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import Asn, AsnLine, Grn, GrnLine, PutawayTask, InboundDiscrepancy
from .serializers import (AsnSerializer, AsnLineSerializer, GrnSerializer, GrnLineSerializer,
                          PutawayTaskSerializer, InboundDiscrepancySerializer)


class AsnViewSet(viewsets.ModelViewSet):
    queryset = Asn.objects.select_related('dest_site', 'source_site', 'source_vendor').prefetch_related('lines').all()
    serializer_class = AsnSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['type', 'status', 'dest_site']
    search_fields = ['asn_no', 'po_ref', 'expected_vehicle']
    ordering_fields = ['created_at', 'slot_start']


class AsnLineViewSet(viewsets.ModelViewSet):
    queryset = AsnLine.objects.select_related('sku', 'asn').all()
    serializer_class = AsnLineSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['asn', 'sku', 'line_status']


class GrnViewSet(viewsets.ModelViewSet):
    queryset = Grn.objects.select_related('asn').prefetch_related('lines').all()
    serializer_class = GrnSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status', 'mode', 'has_discrepancy']
    search_fields = ['grn_no']


class GrnLineViewSet(viewsets.ModelViewSet):
    queryset = GrnLine.objects.select_related('sku', 'grn').all()
    serializer_class = GrnLineSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['grn', 'sku']


class PutawayTaskViewSet(viewsets.ModelViewSet):
    queryset = PutawayTask.objects.select_related(
        'grn_line',
        'grn_line__grn',
        'grn_line__grn__asn',
        'grn_line__sku',
        'to_bin',
        'assigned_to',
    ).all()
    serializer_class = PutawayTaskSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'assigned_to']


class InboundDiscrepancyViewSet(viewsets.ModelViewSet):
    queryset = InboundDiscrepancy.objects.select_related('asn', 'sku').all()
    serializer_class = InboundDiscrepancySerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['type', 'status', 'asn']
