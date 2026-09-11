from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Warehouse, Category, Zone, Location, LocationActivityLog
from .serializers import (
    WarehouseSerializer,
    CategorySerializer,
    ZoneSerializer,
    LocationSerializer,
    LocationActivityLogSerializer
)

class WarehouseViewSet(viewsets.ModelViewSet):
    queryset = Warehouse.objects.filter(is_active=True)
    serializer_class = WarehouseSerializer
    permission_classes = [permissions.IsAuthenticated]

class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.filter(is_active=True, parent_category__isnull=True)
    serializer_class = CategorySerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['warehouse']
    search_fields = ['name', 'code']

class ZoneViewSet(viewsets.ModelViewSet):
    queryset = Zone.objects.filter(is_active=True)
    serializer_class = ZoneSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['warehouse', 'zone_type']

class LocationViewSet(viewsets.ModelViewSet):
    queryset = Location.objects.filter(deleted_at__isnull=True).select_related('zone', 'zone__warehouse')
    serializer_class = LocationSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['zone', 'zone__warehouse', 'is_occupied', 'is_blocked', 'aisle']
    search_fields = ['bin_code', 'barcode_label']

    @action(detail=False, methods=['get'], url_path='verify-barcode')
    def verify_barcode(self, request):
        barcode = request.query_params.get('barcode')
        if not barcode:
            return Response({'error': 'Barcode parameter required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            loc = Location.objects.select_related('zone').get(barcode_label=barcode, deleted_at__isnull=True)
            return Response(LocationSerializer(loc).data)
        except Location.DoesNotExist:
            return Response({'error': f'Location with barcode {barcode} not found'}, status=status.HTTP_404_NOT_FOUND)

class LocationActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = LocationActivityLog.objects.all().select_related('location')
    serializer_class = LocationActivityLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['location', 'activity_type']
