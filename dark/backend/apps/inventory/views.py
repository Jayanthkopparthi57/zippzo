from rest_framework import viewsets, permissions, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Sum, Count, Q, F
from django.utils import timezone
from datetime import timedelta
from .models import Inventory, InventoryTransaction, InventoryStatusChoices
from .serializers import InventorySerializer, InventoryTransactionSerializer, StockTransferSerializer
from .services import InventoryService
from apps.master_data.models import Location, Zone

class InventoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Inventory.objects.all().select_related(
        'warehouse', 'batch', 'batch__product', 'location', 'location__zone'
    )
    serializer_class = InventorySerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['warehouse', 'status', 'location', 'batch']
    search_fields = ['batch__product__sku', 'batch__product__name', 'batch__internal_batch_id', 'location__bin_code']

    @action(detail=False, methods=['get'], url_path='lookup')
    def stock_lookup(self, request):
        """Lookup available quantity, batches, and locations by SKU, Barcode, or Bin."""
        sku = request.query_params.get('sku')
        barcode = request.query_params.get('barcode')
        bin_code = request.query_params.get('bin')

        query = Inventory.objects.filter(status=InventoryStatusChoices.AVAILABLE).select_related(
            'batch', 'batch__product', 'location', 'location__zone'
        )

        if sku:
            query = query.filter(batch__product__sku__iexact=sku)
        elif barcode:
            query = query.filter(
                Q(batch__product__barcode=barcode) | Q(location__barcode_label=barcode)
            )
        elif bin_code:
            query = query.filter(location__bin_code__iexact=bin_code)
        else:
            return Response({'error': 'Please provide sku, barcode, or bin parameter'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = InventorySerializer(query, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='heatmap')
    def warehouse_heatmap(self, request):
        """Calculates visual rack occupancy, expired batches, and dead stock (>90 days untouched)."""
        warehouse_id = request.query_params.get('warehouse_id')
        locations_query = Location.objects.filter(deleted_at__isnull=True).select_related('zone')
        if warehouse_id:
            locations_query = locations_query.filter(zone__warehouse_id=warehouse_id)

        now = timezone.now()
        ninety_days_ago = now - timedelta(days=90)

        # Total bins and occupancy
        total_bins = locations_query.count()
        occupied_bins = locations_query.filter(is_occupied=True).count()
        occupancy_rate = round((occupied_bins / total_bins * 100), 2) if total_bins > 0 else 0

        # Expired items currently on hand
        expired_records = Inventory.objects.filter(
            batch__expiry_date__lt=now.date(),
            quantity_on_hand__gt=0
        ).values('batch__product__sku', 'batch__internal_batch_id', 'location__bin_code', 'quantity_on_hand', 'batch__expiry_date')

        # Dead stock: Bins untouched for 90 days
        dead_stock_records = Inventory.objects.filter(
            updated_at__lt=ninety_days_ago,
            quantity_on_hand__gt=0
        ).values('batch__product__sku', 'location__bin_code', 'quantity_on_hand', 'updated_at')

        # Rack breakdown
        racks = {}
        for loc in locations_query:
            key = f"Aisle {loc.aisle} - Rack {loc.rack_number}"
            if key not in racks:
                racks[key] = {'total': 0, 'occupied': 0, 'bins': []}
            racks[key]['total'] += 1
            if loc.is_occupied:
                racks[key]['occupied'] += 1
            racks[key]['bins'].append({
                'bin_code': loc.bin_code,
                'shelf': loc.shelf_level,
                'is_occupied': loc.is_occupied
            })

        return Response({
            'total_bins': total_bins,
            'occupied_bins': occupied_bins,
            'occupancy_rate_percentage': occupancy_rate,
            'expired_batches_count': len(expired_records),
            'expired_records': list(expired_records),
            'dead_stock_count': len(dead_stock_records),
            'dead_stock_records': list(dead_stock_records),
            'racks_summary': racks
        })

    @action(detail=False, methods=['post'], url_path='transfer')
    def stock_transfer(self, request):
        serializer = StockTransferSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            dest_inv = InventoryService.transfer_stock(
                batch_id=serializer.validated_data['batch_id'],
                from_location_id=serializer.validated_data['from_location_id'],
                to_location_id=serializer.validated_data['to_location_id'],
                quantity=serializer.validated_data['quantity'],
                user=request.user,
                notes=serializer.validated_data.get('notes', '')
            )
            return Response({
                'message': 'Stock transfer completed successfully',
                'dest_inventory': InventorySerializer(dest_inv).data
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class InventoryTransactionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = InventoryTransaction.objects.all().select_related(
        'warehouse', 'batch', 'batch__product', 'source_location', 'dest_location', 'user'
    )
    serializer_class = InventoryTransactionSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['warehouse', 'transaction_type', 'batch__product__sku']
    search_fields = ['reference_doc_id', 'batch__internal_batch_id', 'notes']
