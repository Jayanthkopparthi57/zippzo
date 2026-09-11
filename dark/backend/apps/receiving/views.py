from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from .models import PurchaseOrder, GoodsReceiptNote, GRNItem
from .serializers import (
    PurchaseOrderSerializer,
    GoodsReceiptNoteSerializer,
    QCInspectionSerializer
)
from .services import ReceivingService
from apps.catalog.models import Batch
from apps.inventory.models import Inventory, InventoryStatusChoices
from apps.inventory.services import InventoryService

class PurchaseOrderViewSet(viewsets.ModelViewSet):
    queryset = PurchaseOrder.objects.all().select_related('warehouse', 'vendor').prefetch_related('items', 'items__product')
    serializer_class = PurchaseOrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['warehouse', 'vendor', 'status']
    search_fields = ['po_number', 'vendor__name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

class GoodsReceiptNoteViewSet(viewsets.ModelViewSet):
    queryset = GoodsReceiptNote.objects.all().select_related(
        'po', 'warehouse', 'received_by'
    ).prefetch_related('items', 'items__product', 'items__batch', 'items__quarantine_location')
    serializer_class = GoodsReceiptNoteSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['warehouse', 'status', 'po']
    search_fields = ['grn_number', 'po__po_number', 'vehicle_number']

    @action(detail=False, methods=['post'], url_path='inward-receive')
    @transaction.atomic
    def inward_receive(self, request):
        """
        Receives shipment at the warehouse loading dock, creates/registers batch,
        creates GRN and GRN items, and places stock into Quarantine zone.
        """
        data = request.data
        po_id = data.get('po_id')
        warehouse_id = data.get('warehouse_id')
        vehicle_number = data.get('vehicle_number', '')
        driver_phone = data.get('driver_phone', '')
        items_data = data.get('items', [])

        if not po_id or not items_data:
            return Response({'error': 'po_id and items are required'}, status=status.HTTP_400_BAD_REQUEST)

        employee = getattr(request.user, 'employee', None)
        grn = GoodsReceiptNote.objects.create(
            po_id=po_id,
            warehouse_id=warehouse_id,
            received_by=employee,
            vehicle_number=vehicle_number,
            driver_phone=driver_phone
        )

        for itm in items_data:
            product_id = itm['product_id']
            po_item_id = itm['po_item_id']
            received_qty = int(itm['received_qty'])
            quarantine_loc_id = itm['quarantine_location_id']
            vendor_batch_code = itm.get('vendor_batch_code', '')
            mfg_date = itm.get('mfg_date')
            expiry_date = itm.get('expiry_date')
            unit_cost = itm.get('unit_cost', 0.00)

            # Create or get Batch
            batch = Batch.objects.create(
                product_id=product_id,
                vendor_batch_code=vendor_batch_code,
                mfg_date=mfg_date,
                expiry_date=expiry_date,
                unit_cost=unit_cost
            )

            # Create GRN item
            grn_item = GRNItem.objects.create(
                grn=grn,
                po_item_id=po_item_id,
                product_id=product_id,
                batch=batch,
                received_qty=received_qty,
                quarantine_location_id=quarantine_loc_id
            )

            # Put stock into Quarantine inventory
            quarantine_inv, _ = Inventory.objects.select_for_update().get_or_create(
                warehouse_id=warehouse_id,
                batch=batch,
                location_id=quarantine_loc_id,
                status=InventoryStatusChoices.QUARANTINE,
                defaults={'quantity_on_hand': 0, 'quantity_reserved': 0}
            )
            quarantine_inv.quantity_on_hand += received_qty
            quarantine_inv.save()

            InventoryService.record_stock_movement(
                warehouse=grn.warehouse,
                batch=batch,
                quantity=received_qty,
                transaction_type='GRN_RECEIPT',
                reference_doc_type='GRN',
                reference_doc_id=grn.id,
                dest_location_id=quarantine_loc_id,
                user=request.user,
                notes=f"Inward GRN receipt of {received_qty} units in quarantine"
            )

        return Response(GoodsReceiptNoteSerializer(grn).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch'], url_path='qc-inspect')
    def qc_inspect(self, request, pk=None):
        serializer = QCInspectionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            grn = ReceivingService.process_qc_inspection(
                grn_id=pk,
                qc_results=serializer.validated_data['items'],
                user=request.user
            )
            return Response(GoodsReceiptNoteSerializer(grn).data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
