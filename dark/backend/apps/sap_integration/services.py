import random
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from .models import SAPInboundDelivery, SAPInboundLineItem, SAPSyncLog, SAPDocumentTypeChoices, SAPSyncStatusChoices
from apps.master_data.models import Warehouse, Location, ZoneTypeChoices
from apps.catalog.models import Product, Batch
from apps.inventory.models import Inventory, InventoryStatusChoices
from apps.inventory.services import InventoryService

class SAPIntegrationService:
    @staticmethod
    def sync_inbound_from_sap(warehouse_code='WH-01', payload=None):
        """
        Ingests an Inbound Delivery / ASN document from Head Management / SAP system.
        If no payload provided, generates a realistic multi-SKU quick-commerce mother-hub shipment.
        """
        warehouse = Warehouse.objects.filter(code=warehouse_code).first()
        if not warehouse:
            warehouse = Warehouse.objects.first()

        today_str = timezone.now().strftime('%Y%m%d')
        rand_suffix = random.randint(1000, 9999)
        delivery_num = f"SAP-ASN-{today_str}-{rand_suffix}"

        delivery = SAPInboundDelivery.objects.create(
            sap_delivery_number=delivery_num,
            po_reference=f"SAP-STO-4500{rand_suffix}",
            source_plant="CENTRAL-HUB-01 (Head Office)",
            destination_warehouse=warehouse,
            vehicle_number=f"MH-04-TX-{random.randint(1000, 9999)}",
            driver_name="Ramesh Logistics (Express Trucking)",
            driver_contact="+91-9876543210",
            expected_arrival=timezone.now() + timedelta(hours=random.randint(1, 4)),
            status=SAPSyncStatusChoices.PENDING
        )

        # Retrieve available active products to simulate inbound shipment lines
        products = list(Product.objects.filter(is_active=True)[:6])
        if not products:
            return delivery

        total_units = 0
        line_idx = 10

        for p in products:
            expected_qty = random.choice([20, 30, 50, 75, 100])
            total_units += expected_qty
            
            # Find an optimal Dark Store Bin in the Pick Face or Bulk Zone
            suggested_bin = Location.objects.filter(
                zone__warehouse=warehouse,
                zone__zone_type=ZoneTypeChoices.PICK,
                is_blocked=False
            ).order_by('is_occupied').first()
            bin_code = suggested_bin.bin_code if suggested_bin else "A1-R1-SA"

            today = timezone.now().date()
            mfg = today - timedelta(days=random.randint(5, 20))
            exp = today + timedelta(days=random.randint(180, 540))

            SAPInboundLineItem.objects.create(
                delivery=delivery,
                sap_item_number=f"{line_idx:06d}",
                product=p,
                expected_qty=expected_qty,
                received_qty=0,
                passed_qty=0,
                damaged_qty=0,
                vendor_batch_code=f"LOT-{p.sku[:4]}-{today.strftime('%y%m')}-{random.randint(100, 999)}",
                mfg_date=mfg,
                expiry_date=exp,
                unit_price=p.buy_cost if hasattr(p, 'buy_cost') and p.buy_cost else 150.00,
                suggested_putaway_bin=bin_code
            )
            line_idx += 10

        delivery.total_line_items = len(products)
        delivery.total_expected_units = total_units
        delivery.save()

        # Log SAP Sync event
        SAPSyncLog.objects.create(
            document_type=SAPDocumentTypeChoices.ASN,
            reference_id=delivery.sap_delivery_number,
            payload_sent={'warehouse': warehouse.code, 'requested_sync': True},
            response_received={'status': 'SUCCESS', 'delivery_number': delivery.sap_delivery_number, 'items_count': len(products)},
            http_status_code=200,
            is_successful=True
        )

        return delivery

    @staticmethod
    @transaction.atomic
    def process_inbound_item_scan(delivery_id, item_id, scanned_qty, passed_qty, damaged_qty, putaway_bin_code=None, user=None):
        """
        Worker scans an incoming item at the dock:
        1. Validates scanned quantity and inspection status.
        2. Creates official Batch record with internal and vendor batch codes.
        3. Assigns and creates/updates Inventory balance in destination dark-store bin.
        4. Writes double-entry stock movement transaction ledger.
        5. Updates SAP Delivery Item progress.
        """
        delivery = SAPInboundDelivery.objects.select_for_update().get(id=delivery_id)
        line_item = SAPInboundLineItem.objects.select_for_update().get(id=item_id, delivery=delivery)

        line_item.received_qty += scanned_qty
        line_item.passed_qty += passed_qty
        line_item.damaged_qty += damaged_qty
        line_item.is_received = True
        line_item.save()

        warehouse = delivery.destination_warehouse
        product = line_item.product

        # Create or update internal Batch
        today = timezone.now().date()
        date_str = today.strftime('%Y%m')

        batch, _ = Batch.objects.get_or_create(
            product=product,
            vendor_batch_code=line_item.vendor_batch_code or f"LOT-{product.sku[:4]}-{date_str}",
            defaults={
                'mfg_date': line_item.mfg_date or (today - timedelta(days=15)),
                'expiry_date': line_item.expiry_date or (today + timedelta(days=365)),
                'unit_cost': line_item.unit_price or 100.00,
                'currency': 'USD'
            }
        )

        # Determine destination putaway bin
        target_bin_code = putaway_bin_code or line_item.suggested_putaway_bin or "A1-R1-SA"
        target_loc = Location.objects.filter(zone__warehouse=warehouse, bin_code=target_bin_code).first()
        if not target_loc:
            target_loc = Location.objects.filter(zone__warehouse=warehouse).first()

        # Update Inventory balance for Passed Qty
        if passed_qty > 0 and target_loc:
            inv, _ = Inventory.objects.select_for_update().get_or_create(
                warehouse=warehouse,
                batch=batch,
                location=target_loc,
                status=InventoryStatusChoices.AVAILABLE,
                defaults={'quantity_on_hand': 0, 'quantity_reserved': 0}
            )
            inv.quantity_on_hand += passed_qty
            inv.save()

            target_loc.is_occupied = True
            target_loc.save()

            # Record in Double-Entry Stock Movement Ledger
            InventoryService.record_stock_movement(
                warehouse=warehouse,
                batch=batch,
                quantity=passed_qty,
                transaction_type='GRN_RECEIPT',
                reference_doc_type='SAP_ASN',
                reference_doc_id=delivery.sap_delivery_number,
                dest_location=target_loc,
                user=user,
                notes=f"Zepto Inbound Dock Receipt & Putaway to {target_loc.bin_code} (SAP ASN: {delivery.sap_delivery_number})"
            )

        # Handle Damaged Qty -> Quarantine / Damaged Bay
        if damaged_qty > 0:
            quar_loc = Location.objects.filter(zone__warehouse=warehouse, zone__zone_type=ZoneTypeChoices.DAMAGED).first()
            if not quar_loc:
                quar_loc = Location.objects.filter(zone__warehouse=warehouse, zone__zone_type=ZoneTypeChoices.QUARANTINE).first()
            if not quar_loc:
                quar_loc = target_loc

            inv_dmg, _ = Inventory.objects.select_for_update().get_or_create(
                warehouse=warehouse,
                batch=batch,
                location=quar_loc,
                status=InventoryStatusChoices.DAMAGED,
                defaults={'quantity_on_hand': 0, 'quantity_reserved': 0}
            )
            inv_dmg.quantity_on_hand += damaged_qty
            inv_dmg.save()

            InventoryService.record_stock_movement(
                warehouse=warehouse,
                batch=batch,
                quantity=damaged_qty,
                transaction_type='QC_REJECT',
                reference_doc_type='SAP_ASN',
                reference_doc_id=delivery.sap_delivery_number,
                dest_location=quar_loc,
                user=user,
                notes=f"Inbound QC damaged stock routed to quarantine {quar_loc.bin_code}"
            )

        # Update Delivery Progress
        all_items = delivery.items.all()
        delivery.total_received_units = sum(i.received_qty for i in all_items)
        if all(i.is_received for i in all_items):
            delivery.status = SAPSyncStatusChoices.IN_PROGRESS
        delivery.save()

        return line_item

    @staticmethod
    @transaction.atomic
    def post_goods_receipt_to_sap(delivery_id, user=None):
        """
        Completes the inbound delivery receiving process and posts Movement Type 101 Goods Receipt
        back to SAP ERP / Head Management system.
        """
        delivery = SAPInboundDelivery.objects.select_for_update().get(id=delivery_id)
        mat_doc = f"5000{random.randint(100000, 999999)}"
        delivery.sap_gr_document_number = mat_doc
        delivery.status = SAPSyncStatusChoices.COMPLETED
        delivery.save()

        # Log SAP Goods Receipt Confirmation
        SAPSyncLog.objects.create(
            document_type=SAPDocumentTypeChoices.GR_POSTING,
            reference_id=delivery.sap_delivery_number,
            payload_sent={
                'sap_delivery_number': delivery.sap_delivery_number,
                'po_reference': delivery.po_reference,
                'movement_type': '101',
                'material_doc': mat_doc,
                'received_total_units': delivery.total_received_units,
                'completed_by': user.username if user else 'scanner_worker',
                'timestamp': timezone.now().isoformat()
            },
            response_received={
                'status': 'SUCCESS',
                'sap_code': 'M7001',
                'sap_message': f'Material Document {mat_doc} posted successfully in SAP ERP.'
            },
            http_status_code=200,
            is_successful=True
        )

        return delivery
