from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from .models import ReturnOrder, ReturnItem, RMAStatusChoices
from .serializers import ReturnOrderSerializer, RMAInspectionSerializer
from apps.inventory.models import Inventory, InventoryStatusChoices, TransactionTypeChoices
from apps.inventory.services import InventoryService

class ReturnOrderViewSet(viewsets.ModelViewSet):
    queryset = ReturnOrder.objects.all().select_related('order', 'customer').prefetch_related('items', 'items__product')
    serializer_class = ReturnOrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['status', 'reason', 'customer']
    search_fields = ['rma_number', 'order__order_number', 'tracking_number']

    @action(detail=True, methods=['post'], url_path='inspect-and-route')
    @transaction.atomic
    def inspect_and_route(self, request, pk=None):
        """
        Processes RMA inspection.
        If 'restockable' -> adds quantity into Available inventory.
        If 'damaged_scrap' -> adds quantity into Damaged inventory.
        Creates immutable double-entry stock ledger record.
        """
        serializer = RMAInspectionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        rma = ReturnOrder.objects.select_for_update().get(id=pk)
        warehouse = rma.order.warehouse

        for itm_data in serializer.validated_data['items']:
            item = ReturnItem.objects.select_for_update().get(id=itm_data['return_item_id'], rma=rma)
            result = itm_data['inspection_result']
            target_loc_id = itm_data['target_location_id']

            item.inspection_result = result
            item.target_location_id = target_loc_id
            item.save()

            inv_status = InventoryStatusChoices.AVAILABLE if result == 'restockable' else InventoryStatusChoices.DAMAGED

            inv, _ = Inventory.objects.select_for_update().get_or_create(
                warehouse=warehouse,
                batch=item.batch,
                location_id=target_loc_id,
                status=inv_status,
                defaults={'quantity_on_hand': 0, 'quantity_reserved': 0}
            )
            inv.quantity_on_hand += item.returned_qty
            inv.save()

            InventoryService.record_stock_movement(
                warehouse=warehouse,
                batch=item.batch,
                quantity=item.returned_qty,
                transaction_type=TransactionTypeChoices.CUSTOMER_RETURN,
                reference_doc_type='RMA',
                reference_doc_id=rma.rma_number,
                dest_location_id=target_loc_id,
                user=request.user,
                notes=f"Customer RMA return: {result} ({item.returned_qty} units)"
            )

        rma.status = RMAStatusChoices.INSPECTED
        rma.save()

        return Response({
            'message': 'RMA inspected and items routed to warehouse inventory.',
            'rma': ReturnOrderSerializer(rma).data
        })
