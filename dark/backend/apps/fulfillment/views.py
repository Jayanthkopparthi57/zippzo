from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
from django.db.models import F
from .models import SalesOrder, OrderItem, PickWave, PickTask, PickTaskStatusChoices, OrderStatusChoices
from .serializers import (
    SalesOrderSerializer,
    PickWaveSerializer,
    PickTaskSerializer,
    ScanVerifySerializer,
    PickExceptionSerializer
)
from .fefo_engine import FEFOAllocationEngine
from apps.inventory.services import InventoryService
from apps.inventory.models import Inventory, InventoryStatusChoices
from apps.packing.models import PackingTask
from apps.hr_tracking.models import EmployeeDailyTask

class SalesOrderViewSet(viewsets.ModelViewSet):
    queryset = SalesOrder.objects.all().select_related('customer', 'warehouse').prefetch_related('items', 'items__product')
    serializer_class = SalesOrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['warehouse', 'customer', 'status', 'priority']
    search_fields = ['order_number', 'customer__name', 'city']

    @action(detail=True, methods=['post'], url_path='allocate')
    def allocate(self, request, pk=None):
        """Triggers FEFO allocation for a specific sales order."""
        try:
            tasks = FEFOAllocationEngine.allocate_order_items(order_id=pk, user=request.user)
            order = self.get_object()
            return Response({
                'message': f'Allocated {len(tasks)} pick tasks for order {order.order_number}',
                'order': SalesOrderSerializer(order).data,
                'tasks_count': len(tasks)
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'], url_path='fulfillment-status')
    def fulfillment_status(self, request, pk=None):
        """Returns ordered, picked, shipped, and remaining backorder count."""
        order = self.get_object()
        items_summary = []
        total_requested = 0
        total_picked = 0
        total_shipped = 0
        total_remaining = 0

        for itm in order.items.all():
            rem = itm.remaining_qty
            total_requested += itm.requested_qty
            total_picked += itm.picked_qty
            total_shipped += itm.shipped_qty
            total_remaining += rem
            items_summary.append({
                'sku': itm.product.sku,
                'product_name': itm.product.name,
                'requested': itm.requested_qty,
                'picked': itm.picked_qty,
                'shipped': itm.shipped_qty,
                'remaining_backorder': rem
            })

        return Response({
            'order_number': order.order_number,
            'status': order.status,
            'total_requested': total_requested,
            'total_picked': total_picked,
            'total_shipped': total_shipped,
            'total_remaining_backorder': total_remaining,
            'items': items_summary
        })

class PickWaveViewSet(viewsets.ModelViewSet):
    queryset = PickWave.objects.all().select_related('warehouse').prefetch_related(
        'tasks', 'tasks__order_item__product', 'tasks__batch', 'tasks__source_location'
    )
    serializer_class = PickWaveSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['warehouse', 'status', 'strategy']
    search_fields = ['wave_number']

    @action(detail=False, methods=['post'], url_path='generate')
    def generate_wave(self, request):
        warehouse_id = request.data.get('warehouse_id')
        strategy = request.data.get('strategy', 'batch_pick')
        order_ids = request.data.get('order_ids')

        if not warehouse_id:
            return Response({'error': 'warehouse_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            wave = FEFOAllocationEngine.generate_wave(
                warehouse_id=warehouse_id,
                order_ids=order_ids,
                strategy=strategy,
                user=request.user
            )
            return Response(PickWaveSerializer(wave).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class PickTaskViewSet(viewsets.ModelViewSet):
    queryset = PickTask.objects.all().select_related(
        'wave', 'order_item', 'order_item__order', 'order_item__product',
        'batch', 'source_location', 'source_location__zone', 'assigned_employee'
    ).order_by('sequence_route_order')
    serializer_class = PickTaskSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['wave', 'status', 'assigned_employee']

    @action(detail=False, methods=['get'], url_path='me')
    def my_tasks(self, request):
        """Returns active pick tasks assigned to the logged-in employee sorted by S-Shape sequence."""
        employee = getattr(request.user, 'employee', None)
        if not employee:
            return Response({'error': 'User is not linked to an employee profile'}, status=status.HTTP_400_BAD_REQUEST)

        tasks = PickTask.objects.filter(
            assigned_employee=employee,
            status__in=[PickTaskStatusChoices.OPEN, PickTaskStatusChoices.ASSIGNED, PickTaskStatusChoices.IN_PROGRESS]
        ).select_related(
            'order_item__product', 'batch', 'source_location'
        ).order_by('sequence_route_order')

        serializer = PickTaskSerializer(tasks, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='scan-verify')
    @transaction.atomic
    def scan_verify(self, request, pk=None):
        """
        Two-step Physical Verification:
        1. Validates scanned location barcode matches physical bin sticker.
        2. Validates scanned product barcode matches requested SKU.
        3. Confirms picked quantity, deducts inventory, and creates packing task.
        """
        serializer = ScanVerifySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        task = PickTask.objects.select_for_update().get(id=pk)
        data = serializer.validated_data

        # 1. Location Barcode Verification
        if task.source_location.barcode_label != data['location_barcode']:
            return Response({
                'error': f"Location mismatch! Scanned: {data['location_barcode']} != Expected: {task.source_location.barcode_label}"
            }, status=status.HTTP_400_BAD_REQUEST)

        # 2. Item Barcode Verification
        if task.order_item.product.barcode != data['product_barcode']:
            return Response({
                'error': f"Product barcode mismatch! Scanned: {data['product_barcode']} != Expected: {task.order_item.product.barcode}"
            }, status=status.HTTP_400_BAD_REQUEST)

        picked_qty = data['picked_qty']
        if picked_qty > (task.quantity_to_pick - task.quantity_picked):
            return Response({'error': 'Picked quantity exceeds remaining quantity for this task'}, status=status.HTTP_400_BAD_REQUEST)

        # 3. Confirm pick in Inventory
        inv = Inventory.objects.filter(
            batch=task.batch,
            location=task.source_location,
            status=InventoryStatusChoices.AVAILABLE
        ).first()

        if inv:
            InventoryService.confirm_pick(
                inventory_id=inv.id,
                quantity=picked_qty,
                user=request.user,
                ref_doc_id=task.order_item.order.order_number
            )

        task.quantity_picked += picked_qty
        if task.quantity_picked >= task.quantity_to_pick:
            task.status = PickTaskStatusChoices.COMPLETED
            task.completed_at = timezone.now()

            # Atomically increment employee performance metric
            employee = getattr(request.user, 'employee', None)
            if employee:
                EmployeeDailyTask.objects.filter(
                    employee=employee,
                    reference_id=task.id
                ).update(
                    items_handled_count=F('items_handled_count') + task.quantity_picked,
                    status='completed'
                )

            # Auto-provision Packing Task for Packing Station verification
            PackingTask.objects.get_or_create(
                pick_task=task,
                order=task.order_item.order,
                defaults={'status': 'pending'}
            )

        task.save()

        # Update order item picked quantity
        order_item = task.order_item
        order_item.picked_qty += picked_qty
        order_item.save()

        return Response({
            'message': 'Scan verification successful! Item picked and staged for packing.',
            'task': PickTaskSerializer(task).data
        })

    @action(detail=True, methods=['post'], url_path='exception')
    @transaction.atomic
    def report_exception(self, request, pk=None):
        """
        Reports damaged / missing stock in bin.
        Moves pick task to 'exception' and automatically triggers replenishment search.
        """
        serializer = PickExceptionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        task = PickTask.objects.select_for_update().get(id=pk)
        reason = serializer.validated_data['exception_reason']
        task.status = PickTaskStatusChoices.EXCEPTION
        task.exception_reason = reason
        task.save()

        # If stock was damaged, move remaining inventory in that bin to Damaged status
        if reason == 'damaged_stock':
            inv = Inventory.objects.filter(batch=task.batch, location=task.source_location).first()
            if inv:
                inv.status = InventoryStatusChoices.DAMAGED
                inv.save()

        # Try to find alternative batch/location
        unfulfilled_qty = task.quantity_to_pick - task.quantity_picked
        alt_tasks = FEFOAllocationEngine.allocate_order_items(task.order_item.order.id, user=request.user)

        return Response({
            'message': f'Exception logged ({reason}). Auto-replenishment attempted.',
            'new_tasks_created': len(alt_tasks),
            'task': PickTaskSerializer(task).data
        })
