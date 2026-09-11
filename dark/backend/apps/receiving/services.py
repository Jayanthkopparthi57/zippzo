from django.db import transaction
from django.core.exceptions import ValidationError
from django.utils import timezone
from .models import GoodsReceiptNote, GRNItem, GRNStatusChoices, POStatusChoices
from apps.inventory.models import Inventory, InventoryStatusChoices, TransactionTypeChoices
from apps.inventory.services import InventoryService
from apps.webhooks.tasks import trigger_outgoing_webhook_async

class ReceivingService:
    @staticmethod
    @transaction.atomic
    def process_qc_inspection(grn_id, qc_results, user=None):
        """
        Updates QC passed/rejected quantities for GRN items.
        Moves passed quantities from Quarantine to Available inventory in designated Putaway bins.
        Moves rejected quantities to Damaged inventory.
        """
        grn = GoodsReceiptNote.objects.select_for_update().get(id=grn_id)
        
        all_completed = True
        for item_data in qc_results:
            item_id = item_data['grn_item_id']
            passed_qty = int(item_data['passed_qty'])
            rejected_qty = int(item_data.get('rejected_qty', 0))
            putaway_location_id = item_data.get('putaway_location_id')
            qc_notes = item_data.get('qc_notes', '')
            damaged_photos = item_data.get('damaged_photos_url', [])

            grn_item = GRNItem.objects.select_for_update().get(id=item_id, grn=grn)
            
            if passed_qty + rejected_qty > grn_item.received_qty:
                raise ValidationError(f"Passed ({passed_qty}) + Rejected ({rejected_qty}) cannot exceed received qty ({grn_item.received_qty})")

            grn_item.passed_qty = passed_qty
            grn_item.rejected_qty = rejected_qty
            grn_item.putaway_location_id = putaway_location_id
            grn_item.qc_notes = qc_notes
            grn_item.damaged_photos_url = damaged_photos
            grn_item.save()

            # 1. Deduct from quarantine inventory
            quarantine_inv, _ = Inventory.objects.select_for_update().get_or_create(
                warehouse=grn.warehouse,
                batch=grn_item.batch,
                location=grn_item.quarantine_location,
                status=InventoryStatusChoices.QUARANTINE,
                defaults={'quantity_on_hand': 0, 'quantity_reserved': 0}
            )
            quarantine_inv.quantity_on_hand = max(0, quarantine_inv.quantity_on_hand - (passed_qty + rejected_qty))
            quarantine_inv.save()

            # 2. Add passed qty to Putaway Location as Available
            if passed_qty > 0 and putaway_location_id:
                avail_inv, _ = Inventory.objects.select_for_update().get_or_create(
                    warehouse=grn.warehouse,
                    batch=grn_item.batch,
                    location_id=putaway_location_id,
                    status=InventoryStatusChoices.AVAILABLE,
                    defaults={'quantity_on_hand': 0, 'quantity_reserved': 0}
                )
                avail_inv.quantity_on_hand += passed_qty
                avail_inv.save()

                InventoryService.record_stock_movement(
                    warehouse=grn.warehouse,
                    batch=grn_item.batch,
                    quantity=passed_qty,
                    transaction_type=TransactionTypeChoices.QC_PASS,
                    reference_doc_type='GRN',
                    reference_doc_id=grn.id,
                    source_location=grn_item.quarantine_location,
                    dest_location_id=putaway_location_id,
                    user=user,
                    notes=f"Passed QC: {passed_qty} units"
                )

            # 3. Add rejected qty to Damaged zone
            if rejected_qty > 0:
                damaged_inv, _ = Inventory.objects.select_for_update().get_or_create(
                    warehouse=grn.warehouse,
                    batch=grn_item.batch,
                    location=grn_item.quarantine_location,
                    status=InventoryStatusChoices.DAMAGED,
                    defaults={'quantity_on_hand': 0, 'quantity_reserved': 0}
                )
                damaged_inv.quantity_on_hand += rejected_qty
                damaged_inv.save()

                InventoryService.record_stock_movement(
                    warehouse=grn.warehouse,
                    batch=grn_item.batch,
                    quantity=rejected_qty,
                    transaction_type=TransactionTypeChoices.QC_REJECT,
                    reference_doc_type='GRN',
                    reference_doc_id=grn.id,
                    source_location=grn_item.quarantine_location,
                    user=user,
                    notes=f"QC Rejected: {rejected_qty} units. Reason: {qc_notes}"
                )

            # Update PO item received quantity
            po_item = grn_item.po_item
            po_item.received_qty += passed_qty
            po_item.save()

        grn.status = GRNStatusChoices.COMPLETED
        grn.save()

        # Check if entire PO is fulfilled
        po = grn.po
        total_ordered = sum(item.ordered_qty for item in po.items.all())
        total_received = sum(item.received_qty for item in po.items.all())
        if total_received >= total_ordered:
            po.status = POStatusChoices.RECEIVED
        elif total_received > 0:
            po.status = POStatusChoices.PARTIALLY_RECEIVED
        po.save()

        # Dispatch outgoing webhook to Head Office
        try:
            trigger_outgoing_webhook_async.delay(
                'grn.received',
                {
                    'grn_number': grn.grn_number,
                    'po_number': po.po_number,
                    'warehouse_code': grn.warehouse.code,
                    'receipt_date': grn.receipt_date.isoformat(),
                    'items_count': grn.items.count()
                }
            )
        except Exception:
            pass

        return grn
