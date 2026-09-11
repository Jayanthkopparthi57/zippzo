from django.db import transaction
from django.db.models import F
from django.core.exceptions import ValidationError
from .models import Inventory, InventoryTransaction, TransactionTypeChoices, InventoryStatusChoices
from apps.master_data.models import LocationActivityLog, LocationActivityTypeChoices

class InventoryService:
    @staticmethod
    @transaction.atomic
    def record_stock_movement(warehouse, batch, quantity, transaction_type, reference_doc_type, reference_doc_id, source_location=None, dest_location=None, user=None, notes=''):
        """Creates an immutable double-entry stock transaction record and logs location activity."""
        txn = InventoryTransaction.objects.create(
            warehouse=warehouse,
            batch=batch,
            source_location=source_location,
            dest_location=dest_location,
            transaction_type=transaction_type,
            quantity=quantity,
            reference_doc_type=reference_doc_type,
            reference_doc_id=str(reference_doc_id),
            user=user,
            notes=notes
        )

        # Log location activities for heatmap analytics
        if dest_location:
            LocationActivityLog.objects.create(
                location=dest_location,
                activity_type=LocationActivityTypeChoices.PUTAWAY,
                quantity=quantity
            )
        if source_location:
            LocationActivityLog.objects.create(
                location=source_location,
                activity_type=LocationActivityTypeChoices.PICK,
                quantity=quantity
            )

        return txn

    @staticmethod
    @transaction.atomic
    def reserve_stock(inventory_id, quantity, user=None, ref_doc_id=None):
        """Pessimistically locks the inventory row and reserves quantity."""
        inv = Inventory.objects.select_for_update().get(id=inventory_id)
        available = inv.quantity_on_hand - inv.quantity_reserved
        if available < quantity:
            raise ValidationError(f"Insufficient available quantity in bin {inv.location.bin_code}. Requested: {quantity}, Available: {available}")

        inv.quantity_reserved += quantity
        inv.save()

        InventoryService.record_stock_movement(
            warehouse=inv.warehouse,
            batch=inv.batch,
            quantity=quantity,
            transaction_type=TransactionTypeChoices.PICK_RESERVE,
            reference_doc_type='PICK_TASK',
            reference_doc_id=ref_doc_id or 'RESERVATION',
            source_location=inv.location,
            user=user,
            notes=f"Reserved {quantity} units for picking"
        )
        return inv

    @staticmethod
    @transaction.atomic
    def confirm_pick(inventory_id, quantity, user=None, ref_doc_id=None):
        """Deducts both quantity_on_hand and quantity_reserved upon successful physical pick."""
        inv = Inventory.objects.select_for_update().get(id=inventory_id)
        if inv.quantity_reserved < quantity or inv.quantity_on_hand < quantity:
            raise ValidationError(f"Cannot confirm pick of {quantity} units. On hand: {inv.quantity_on_hand}, Reserved: {inv.quantity_reserved}")

        inv.quantity_on_hand -= quantity
        inv.quantity_reserved -= quantity
        inv.save()

        InventoryService.record_stock_movement(
            warehouse=inv.warehouse,
            batch=inv.batch,
            quantity=quantity,
            transaction_type=TransactionTypeChoices.PICK_CONFIRM,
            reference_doc_type='PICK_TASK',
            reference_doc_id=ref_doc_id or 'PICK_CONFIRMED',
            source_location=inv.location,
            user=user,
            notes=f"Physically picked {quantity} units"
        )
        return inv

    @staticmethod
    @transaction.atomic
    def transfer_stock(batch_id, from_location_id, to_location_id, quantity, user=None, notes=''):
        """Transfers stock between two warehouse locations atomically."""
        source_inv = Inventory.objects.select_for_update().get(batch_id=batch_id, location_id=from_location_id, status=InventoryStatusChoices.AVAILABLE)
        available = source_inv.quantity_on_hand - source_inv.quantity_reserved
        if available < quantity:
            raise ValidationError(f"Cannot transfer {quantity} units; only {available} available in {source_inv.location.bin_code}")

        source_inv.quantity_on_hand -= quantity
        source_inv.save()

        dest_inv, _ = Inventory.objects.select_for_update().get_or_create(
            warehouse=source_inv.warehouse,
            batch=source_inv.batch,
            location_id=to_location_id,
            status=InventoryStatusChoices.AVAILABLE,
            defaults={'quantity_on_hand': 0, 'quantity_reserved': 0}
        )
        dest_inv.quantity_on_hand += quantity
        dest_inv.save()

        InventoryService.record_stock_movement(
            warehouse=source_inv.warehouse,
            batch=source_inv.batch,
            quantity=quantity,
            transaction_type=TransactionTypeChoices.REPLENISHMENT_MOVE,
            reference_doc_type='STOCK_TRANSFER',
            reference_doc_id='TRANSFER',
            source_location=source_inv.location,
            dest_location=dest_inv.location,
            user=user,
            notes=notes or f"Transferred from {source_inv.location.bin_code} to {dest_inv.location.bin_code}"
        )
        return dest_inv
