from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import SAPInboundDelivery, SAPInboundLineItem, SAPSyncLog
from .serializers import (
    SAPInboundDeliverySerializer,
    SAPInboundLineItemSerializer,
    SAPSyncLogSerializer
)
from .services import SAPIntegrationService

class SAPInboundDeliveryViewSet(viewsets.ModelViewSet):
    queryset = SAPInboundDelivery.objects.all().select_related('destination_warehouse').prefetch_related('items', 'items__product')
    serializer_class = SAPInboundDeliverySerializer
    permission_classes = [permissions.AllowAny] # Allow worker scanners to access
    filterset_fields = ['destination_warehouse', 'status']
    search_fields = ['sap_delivery_number', 'po_reference', 'vehicle_number']

    @action(detail=False, methods=['post'], url_path='sync-from-sap')
    def sync_from_sap(self, request):
        """Triggers or receives an inbound delivery dispatch from Central Hub / SAP system."""
        warehouse_code = request.data.get('warehouse_code', 'WH-01')
        delivery = SAPIntegrationService.sync_inbound_from_sap(warehouse_code=warehouse_code)
        return Response(SAPInboundDeliverySerializer(delivery).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='scan-item')
    def scan_item(self, request, pk=None):
        """Warehouse worker scans an inbound item at the dock and checks quality/quantity."""
        item_id = request.data.get('item_id')
        scanned_qty = int(request.data.get('scanned_qty', 0))
        passed_qty = int(request.data.get('passed_qty', scanned_qty))
        damaged_qty = int(request.data.get('damaged_qty', 0))
        putaway_bin = request.data.get('putaway_bin_code')

        if not item_id or scanned_qty <= 0:
            return Response({'error': 'item_id and positive scanned_qty required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            line_item = SAPIntegrationService.process_inbound_item_scan(
                delivery_id=pk,
                item_id=item_id,
                scanned_qty=scanned_qty,
                passed_qty=passed_qty,
                damaged_qty=damaged_qty,
                putaway_bin_code=putaway_bin,
                user=request.user if request.user.is_authenticated else None
            )
            return Response(SAPInboundLineItemSerializer(line_item).data, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='post-goods-receipt')
    def post_goods_receipt(self, request, pk=None):
        """Posts final Goods Receipt (Movement 101) confirmation to SAP."""
        try:
            delivery = SAPIntegrationService.post_goods_receipt_to_sap(
                delivery_id=pk,
                user=request.user if request.user.is_authenticated else None
            )
            return Response(SAPInboundDeliverySerializer(delivery).data, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class SAPSyncLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SAPSyncLog.objects.all().order_by('-timestamp')
    serializer_class = SAPSyncLogSerializer
    permission_classes = [permissions.AllowAny]
