from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
from .models import PackingTask, PackingStatusChoices
from .serializers import PackingTaskSerializer, PackScanItemSerializer
from apps.fulfillment.models import SalesOrder, OrderStatusChoices

class PackingTaskViewSet(viewsets.ModelViewSet):
    queryset = PackingTask.objects.all().select_related(
        'order', 'order__customer', 'pick_task', 'pick_task__order_item__product',
        'pick_task__batch', 'packed_by'
    )
    serializer_class = PackingTaskSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['status', 'order', 'packed_by']
    search_fields = ['order__order_number', 'pick_task__order_item__product__sku']

    @action(detail=True, methods=['post'], url_path='verify-scan')
    @transaction.atomic
    def verify_scan(self, request, pk=None):
        """
        Packing Station Scan Verification:
        Validates scanned product barcode against order SKU. If mismatch, places task on mismatch_hold.
        """
        serializer = PackScanItemSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        task = PackingTask.objects.select_for_update().get(id=pk)
        expected_barcode = task.pick_task.order_item.product.barcode
        scanned_barcode = serializer.validated_data['scanned_barcode']

        if expected_barcode != scanned_barcode:
            task.status = PackingStatusChoices.MISMATCH_HOLD
            task.error_notes = f"Item mismatch: Scanned {scanned_barcode} does not match expected {expected_barcode}"
            task.save()
            return Response({
                'error': f'Item barcode mismatch! Expected {expected_barcode}, got {scanned_barcode}',
                'task': PackingTaskSerializer(task).data
            }, status=status.HTTP_400_BAD_REQUEST)

        employee = getattr(request.user, 'employee', None)
        task.packed_by = employee
        task.scan_verified_qty += 1
        
        target_qty = task.pick_task.quantity_picked
        if task.scan_verified_qty >= target_qty:
            task.status = PackingStatusChoices.VERIFIED
            task.packaging_type = serializer.validated_data.get('box_type', task.packaging_type)
            if 'actual_weight_kg' in serializer.validated_data:
                task.actual_weight_kg = serializer.validated_data['actual_weight_kg']
        else:
            task.status = PackingStatusChoices.IN_PROGRESS

        task.save()
        return Response({
            'message': f'Verified {task.scan_verified_qty}/{target_qty} items.',
            'task': PackingTaskSerializer(task).data
        })

    @action(detail=True, methods=['post'], url_path='complete-packing')
    @transaction.atomic
    def complete_packing(self, request, pk=None):
        """Finalizes package sealing and marks order as packed."""
        task = PackingTask.objects.select_for_update().get(id=pk)
        if task.status != PackingStatusChoices.VERIFIED:
            return Response({'error': 'Task must be verified before completing packing'}, status=status.HTTP_400_BAD_REQUEST)

        task.status = PackingStatusChoices.PACKED
        task.completed_at = timezone.now()
        task.save()

        # Check if all tasks for the order are packed
        order = task.order
        all_packed = not PackingTask.objects.filter(order=order).exclude(status=PackingStatusChoices.PACKED).exists()
        if all_packed:
            order.status = OrderStatusChoices.PACKED
            order.save()

        return Response({
            'message': 'Packing completed! Box sealed and ready for shipping.',
            'task': PackingTaskSerializer(task).data
        })
