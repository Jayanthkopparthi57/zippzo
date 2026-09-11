from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone
from .models import SalesOrder, OrderItem, PickWave, PickTask, OrderStatusChoices, PickTaskStatusChoices
from apps.inventory.models import Inventory, InventoryStatusChoices
from apps.inventory.services import InventoryService
from apps.master_data.models import Location
from .s_shape_router import SShapeRouter

class FEFOAllocationEngine:
    @staticmethod
    @transaction.atomic
    def allocate_order_items(order_id, wave=None, user=None):
        """
        Allocates order items using First-Expired-First-Out (FEFO) strategy.
        Pessimistically locks inventory rows using select_for_update() to prevent race conditions.
        """
        order = SalesOrder.objects.select_for_update().get(id=order_id)
        order_items = order.items.select_for_update().filter(
            allocated_qty__lt=F('requested_qty')
        )

        today = timezone.now().date()
        created_tasks = []
        is_partially_allocated = False

        for item in order_items:
            unallocated_qty = item.requested_qty - item.allocated_qty
            if unallocated_qty <= 0:
                continue

            # Query available bins: FEFO ordering (earliest expiry first, NULLs last, then FIFO batch created_at)
            available_bins = Inventory.objects.select_for_update().filter(
                warehouse=order.warehouse,
                batch__product=item.product,
                status=InventoryStatusChoices.AVAILABLE,
                quantity_on_hand__gt=F('quantity_reserved')
            ).filter(
                Q(batch__expiry_date__gte=today) | Q(batch__expiry_date__isnull=True)
            ).order_by(
                F('batch__expiry_date').asc(nulls_last=True),
                'batch__created_at',
                'location__aisle',
                'location__rack_number'
            )

            remaining_to_allocate = unallocated_qty
            for inv in available_bins:
                available_in_bin = inv.quantity_on_hand - inv.quantity_reserved
                if available_in_bin <= 0:
                    continue

                alloc_from_bin = min(remaining_to_allocate, available_in_bin)
                
                # Reserve inventory atomically
                InventoryService.reserve_stock(
                    inventory_id=inv.id,
                    quantity=alloc_from_bin,
                    user=user,
                    ref_doc_id=order.order_number
                )

                item.allocated_qty += alloc_from_bin
                item.save()

                # Create Pick Task
                task = PickTask.objects.create(
                    wave=wave,
                    order_item=item,
                    batch=inv.batch,
                    source_location=inv.location,
                    quantity_to_pick=alloc_from_bin,
                    status=PickTaskStatusChoices.OPEN
                )
                created_tasks.append(task)

                remaining_to_allocate -= alloc_from_bin
                if remaining_to_allocate == 0:
                    break

            if remaining_to_allocate > 0:
                is_partially_allocated = True

        # Update Order Status
        if is_partially_allocated:
            order.status = OrderStatusChoices.PARTIALLY_ALLOCATED
        else:
            order.status = OrderStatusChoices.ALLOCATED
        order.save()

        # Optimize Route Sequence for generated tasks
        SShapeRouter.optimize_task_sequence(created_tasks)

        return created_tasks

    @staticmethod
    @transaction.atomic
    def generate_wave(warehouse_id, order_ids=None, strategy='batch_pick', user=None):
        """
        Generates a PickWave for confirmed/unfulfilled sales orders in a warehouse.
        """
        wave = PickWave.objects.create(
            warehouse_id=warehouse_id,
            strategy=strategy,
            created_by=user
        )

        orders_query = SalesOrder.objects.filter(
            warehouse_id=warehouse_id,
            status__in=[OrderStatusChoices.CONFIRMED, OrderStatusChoices.PARTIALLY_ALLOCATED]
        )
        if order_ids:
            orders_query = orders_query.filter(id__in=order_ids)

        all_wave_tasks = []
        for order in orders_query:
            tasks = FEFOAllocationEngine.allocate_order_items(order.id, wave=wave, user=user)
            all_wave_tasks.extend(tasks)

        # Optimize full wave path
        SShapeRouter.optimize_task_sequence(all_wave_tasks)

        return wave
