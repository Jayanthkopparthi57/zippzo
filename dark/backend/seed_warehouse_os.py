import os
import django
from datetime import datetime, date

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'zippzo_core.settings')
django.setup()

from apps.receiving.models import InboundShipment, InboundProductItem, InboundQCRecord, InboundScanHistory
from apps.inventory.models import PutawayTask, LocationInventory
from apps.fulfillment.models import PickingTask, PickingItemDetail, PickingScanHistory
from apps.packing.models import PackingRecord
from apps.shipping.models import ShipmentMaster, ShipmentDeliveryDetail, ShippingScanHistory

def seed():
    print("Seeding WarehouseOS 13-Table Core Operational Data...")

    # 1. Inbound Main Shipments
    InboundShipment.objects.all().delete()
    s1 = InboundShipment.objects.create(
        inbound_no='INB-00124',
        shipment_type='Supplier Delivery',
        source='ABC Foods',
        warehouse='RJY-DS-001',
        items_count=25,
        expected_qty=1500,
        received_qty=1480,
        accepted_qty=1475,
        rejected_qty=0,
        damaged_qty=5,
        status='Receiving',
        expected_arrival=datetime(2026, 9, 6, 9, 0),
        actual_arrival=datetime(2026, 9, 6, 9, 15)
    )
    s2 = InboundShipment.objects.create(
        inbound_no='INB-00125',
        shipment_type='Warehouse Transfer',
        source='VSK-WH-01',
        warehouse='RJY-DS-001',
        items_count=12,
        expected_qty=500,
        received_qty=0,
        accepted_qty=0,
        rejected_qty=0,
        damaged_qty=0,
        status='Scheduled',
        expected_arrival=datetime(2026, 9, 7, 10, 0),
        actual_arrival=None
    )
    s3 = InboundShipment.objects.create(
        inbound_no='INB-00126',
        shipment_type='Supplier Delivery',
        source='Fresh Dairy',
        warehouse='RJY-DS-001',
        items_count=8,
        expected_qty=800,
        received_qty=800,
        accepted_qty=798,
        rejected_qty=0,
        damaged_qty=2,
        status='Putaway Pending',
        expected_arrival=datetime(2026, 9, 6, 8, 0),
        actual_arrival=datetime(2026, 9, 6, 8, 10)
    )

    # 2. Inbound Product Items
    InboundProductItem.objects.all().delete()
    InboundProductItem.objects.create(
        inbound_no='INB-00124',
        item_name='Basmati Rice 5kg',
        product_id='PROD-00182',
        sku='RICE-BAS-5KG',
        barcode='8901234567890',
        batch_no='BTH-R2408',
        serial_no='—',
        uom='Bag',
        pack_size='5kg',
        expected_qty=500,
        scanned_qty=498,
        received_qty=498,
        accepted_qty=495,
        rejected_qty=1,
        damaged_qty=2,
        shortage_qty=2,
        excess_qty=0,
        mfg_date=date(2026, 8, 15),
        expiry_date=date(2027, 8, 15),
        best_before='12 Months',
        remaining_shelf_life='343 Days',
        temperature='26°C',
        storage_condition='Ambient',
        qc_status='Passed',
        scanner_id='SCN-014',
        receiver='Arjun',
        scan_time='10:53',
        status='Received'
    )
    InboundProductItem.objects.create(
        inbound_no='INB-00124',
        item_name='Fresh Milk 1L',
        product_id='PROD-00183',
        sku='MILK-1L',
        barcode='8909876543210',
        batch_no='MILK-0905',
        serial_no='—',
        uom='Pack',
        pack_size='1L',
        expected_qty=300,
        scanned_qty=300,
        received_qty=300,
        accepted_qty=298,
        rejected_qty=0,
        damaged_qty=2,
        shortage_qty=0,
        excess_qty=0,
        mfg_date=date(2026, 9, 5),
        expiry_date=date(2026, 9, 8),
        best_before='3 Days',
        remaining_shelf_life='2 Days',
        temperature='4.2°C',
        storage_condition='Chilled',
        qc_status='Passed',
        scanner_id='SCN-014',
        receiver='Arjun',
        scan_time='10:57',
        status='QC Completed'
    )
    InboundProductItem.objects.create(
        inbound_no='INB-00124',
        item_name='Coca-Cola 750ml',
        product_id='PROD-00184',
        sku='COKE-750',
        barcode='8905555555555',
        batch_no='COKE-A82',
        serial_no='—',
        uom='Bottle',
        pack_size='750ml',
        expected_qty=200,
        scanned_qty=200,
        received_qty=200,
        accepted_qty=200,
        rejected_qty=0,
        damaged_qty=0,
        shortage_qty=0,
        excess_qty=0,
        mfg_date=date(2026, 8, 1),
        expiry_date=date(2027, 2, 1),
        best_before='6 Months',
        remaining_shelf_life='148 Days',
        temperature='25°C',
        storage_condition='Ambient',
        qc_status='Passed',
        scanner_id='SCN-014',
        receiver='Arjun',
        scan_time='11:03',
        status='Ready for Putaway'
    )

    # 3. Inbound QC Records
    InboundQCRecord.objects.all().delete()
    InboundQCRecord.objects.create(
        qc_id='QC-00121',
        inbound_no='INB-00124',
        item_name='Basmati Rice 5kg',
        sku='RICE-BAS-5KG',
        batch_no='BTH-R2408',
        inspected_qty=498,
        accepted_qty=495,
        rejected_qty=1,
        damaged_qty=2,
        qc_status='Passed with Exceptions',
        damage_type='Torn Packaging',
        rejection_reason='1 unit failed packaging inspection',
        inspector='Priya',
        inspection_time='11:20',
        evidence_photos='IMG-1021',
        notes='2 bags moved to damaged area'
    )
    InboundQCRecord.objects.create(
        qc_id='QC-00122',
        inbound_no='INB-00124',
        item_name='Fresh Milk 1L',
        sku='MILK-1L',
        batch_no='MILK-0905',
        inspected_qty=300,
        accepted_qty=298,
        rejected_qty=0,
        damaged_qty=2,
        qc_status='Passed with Exceptions',
        damage_type='Leakage',
        rejection_reason='—',
        inspector='Priya',
        inspection_time='11:28',
        evidence_photos='IMG-1022',
        notes='Keep accepted stock chilled'
    )
    InboundQCRecord.objects.create(
        qc_id='QC-00123',
        inbound_no='INB-00124',
        item_name='Coca-Cola 750ml',
        sku='COKE-750',
        batch_no='COKE-A82',
        inspected_qty=200,
        accepted_qty=200,
        rejected_qty=0,
        damaged_qty=0,
        qc_status='Passed',
        damage_type='—',
        rejection_reason='—',
        inspector='Priya',
        inspection_time='11:35',
        evidence_photos='—',
        notes='Ready for storage'
    )

    # 4. Inbound Scan History
    InboundScanHistory.objects.all().delete()
    InboundScanHistory.objects.create(
        scan_id='SC-98211',
        inbound_no='INB-00124',
        scanner_id='SCN-014',
        user='Arjun',
        scan_type='Product Receive',
        barcode='8901234567890',
        item_name='Basmati Rice 5kg',
        sku='RICE-BAS-5KG',
        batch_no='BTH-R2408',
        quantity=1,
        location='Dock-03',
        scan_time='10:53:12',
        result='Valid'
    )
    InboundScanHistory.objects.create(
        scan_id='SC-98212',
        inbound_no='INB-00124',
        scanner_id='SCN-014',
        user='Arjun',
        scan_type='Product Receive',
        barcode='8909876543210',
        item_name='Fresh Milk 1L',
        sku='MILK-1L',
        batch_no='MILK-0905',
        quantity=1,
        location='Dock-03',
        scan_time='10:57:15',
        result='Valid'
    )
    InboundScanHistory.objects.create(
        scan_id='SC-98213',
        inbound_no='INB-00124',
        scanner_id='SCN-014',
        user='Arjun',
        scan_type='Product Receive',
        barcode='8905555555555',
        item_name='Coca-Cola 750ml',
        sku='COKE-750',
        batch_no='COKE-A82',
        quantity=1,
        location='Dock-03',
        scan_time='11:03:21',
        result='Valid'
    )

    # 5. Putaway Tasks
    PutawayTask.objects.all().delete()
    PutawayTask.objects.create(
        putaway_id='PUT-00982',
        inbound_no='INB-00124',
        item_name='Basmati Rice 5kg',
        sku='RICE-BAS-5KG',
        barcode='8901234567890',
        batch_no='BTH-R2408',
        serial_no='—',
        accepted_qty=495,
        putaway_qty=495,
        pending_qty=0,
        warehouse='RJY-DS-001',
        source_location='Dock-03',
        zone='Grocery-A',
        aisle='A04',
        rack='R12',
        shelf='S03',
        bin='B04',
        destination_location='A04-R12-S03-B04',
        location_barcode='LOC-A04-R12-S03-B04',
        storage_type='Rack',
        capacity=500,
        occupied_qty=495,
        available_capacity=5,
        storage_condition='Ambient',
        temperature='26°C',
        expiry_date=date(2027, 8, 15),
        fefo_priority='Medium',
        scanner_id='SCN-014',
        operator='Arjun',
        status='Completed',
        started_at='11:50',
        completed_at='12:05'
    )
    PutawayTask.objects.create(
        putaway_id='PUT-00983',
        inbound_no='INB-00124',
        item_name='Fresh Milk 1L',
        sku='MILK-1L',
        barcode='8909876543210',
        batch_no='MILK-0905',
        serial_no='—',
        accepted_qty=298,
        putaway_qty=298,
        pending_qty=0,
        warehouse='RJY-DS-001',
        source_location='QC-Chilled',
        zone='Chilled-A',
        aisle='A01',
        rack='R02',
        shelf='S01',
        bin='B08',
        destination_location='A01-R02-S01-B08',
        location_barcode='LOC-A01-R02-S01-B08',
        storage_type='Cold Rack',
        capacity=300,
        occupied_qty=298,
        available_capacity=2,
        storage_condition='Chilled',
        temperature='4°C',
        expiry_date=date(2026, 9, 8),
        fefo_priority='High',
        scanner_id='SCN-014',
        operator='Arjun',
        status='Completed',
        started_at='11:55',
        completed_at='12:12'
    )
    PutawayTask.objects.create(
        putaway_id='PUT-00984',
        inbound_no='INB-00124',
        item_name='Coca-Cola 750ml',
        sku='COKE-750',
        barcode='8905555555555',
        batch_no='COKE-A82',
        serial_no='—',
        accepted_qty=200,
        putaway_qty=120,
        pending_qty=80,
        warehouse='RJY-DS-001',
        source_location='Dock-03',
        zone='Beverage-A',
        aisle='A07',
        rack='R03',
        shelf='S02',
        bin='B12',
        destination_location='A07-R03-S02-B12',
        location_barcode='LOC-A07-R03-S02-B12',
        storage_type='Rack',
        capacity=400,
        occupied_qty=320,
        available_capacity=80,
        storage_condition='Ambient',
        temperature='25°C',
        expiry_date=date(2027, 2, 1),
        fefo_priority='Low',
        scanner_id='SCN-014',
        operator='Arjun',
        status='In Progress',
        started_at='12:00',
        completed_at='—'
    )

    # 6. Location Inventory
    LocationInventory.objects.all().delete()
    LocationInventory.objects.create(
        location='A04-R12-S03-B04',
        warehouse='RJY-DS-001',
        zone='Grocery-A',
        aisle='A04',
        rack='R12',
        shelf='S03',
        bin='B04',
        location_barcode='LOC-A04-R12-S03-B04',
        sku='RICE-BAS-5KG',
        item_name='Basmati Rice 5kg',
        batch_no='BTH-R2408',
        serial_no='—',
        available_qty=493,
        reserved_qty=2,
        picked_qty=0,
        quarantine_qty=0,
        damaged_qty=2,
        capacity=500,
        occupancy_pct='99%',
        mfg_date=date(2026, 8, 15),
        expiry_date=date(2027, 8, 15),
        storage_condition='Ambient',
        temperature='26°C',
        stock_status='Available'
    )
    LocationInventory.objects.create(
        location='A01-R02-S01-B08',
        warehouse='RJY-DS-001',
        zone='Chilled-A',
        aisle='A01',
        rack='R02',
        shelf='S01',
        bin='B08',
        location_barcode='LOC-A01-R02-S01-B08',
        sku='MILK-1L',
        item_name='Fresh Milk 1L',
        batch_no='MILK-0905',
        serial_no='—',
        available_qty=296,
        reserved_qty=2,
        picked_qty=0,
        quarantine_qty=0,
        damaged_qty=2,
        capacity=300,
        occupancy_pct='99%',
        mfg_date=date(2026, 9, 5),
        expiry_date=date(2026, 9, 8),
        storage_condition='Chilled',
        temperature='4°C',
        stock_status='Available'
    )
    LocationInventory.objects.create(
        location='A07-R03-S02-B12',
        warehouse='RJY-DS-001',
        zone='Beverage-A',
        aisle='A07',
        rack='R03',
        shelf='S02',
        bin='B12',
        location_barcode='LOC-A07-R03-S02-B12',
        sku='COKE-750',
        item_name='Coca-Cola 750ml',
        batch_no='COKE-A82',
        serial_no='—',
        available_qty=200,
        reserved_qty=0,
        picked_qty=0,
        quarantine_qty=0,
        damaged_qty=0,
        capacity=400,
        occupancy_pct='50%',
        mfg_date=date(2026, 8, 1),
        expiry_date=date(2027, 2, 1),
        storage_condition='Ambient',
        temperature='25°C',
        stock_status='Available'
    )

    # 7. Picking Tasks
    PickingTask.objects.all().delete()
    PickingTask.objects.create(
        pick_task_id='PICK-009821',
        order_id='ORD-00124',
        wave_id='WAVE-00452',
        order_type='Customer Order',
        priority='High',
        warehouse='RJY-DS-001',
        picker='Rahul',
        zone='Mixed',
        pick_route='A01 → A04 → A07',
        sequence=1,
        total_items=8,
        total_units=14,
        picked_items=8,
        picked_units=14,
        exceptions=0,
        started_at='12:30',
        completed_at='12:48',
        status='Completed'
    )
    PickingTask.objects.create(
        pick_task_id='PICK-009822',
        order_id='ORD-00125',
        wave_id='WAVE-00452',
        order_type='Customer Order',
        priority='Normal',
        warehouse='RJY-DS-001',
        picker='Priya',
        zone='Chilled-A',
        pick_route='A01 → A02',
        sequence=2,
        total_items=5,
        total_units=7,
        picked_items=4,
        picked_units=6,
        exceptions=1,
        started_at='12:32',
        completed_at='—',
        status='In Progress'
    )
    PickingTask.objects.create(
        pick_task_id='PICK-009823',
        order_id='ORD-00126',
        wave_id='WAVE-00453',
        order_type='Customer Order',
        priority='Urgent',
        warehouse='RJY-DS-001',
        picker='Arjun',
        zone='Mixed',
        pick_route='A03 → A04 → A07',
        sequence=1,
        total_items=12,
        total_units=21,
        picked_items=6,
        picked_units=10,
        exceptions=0,
        started_at='12:40',
        completed_at='—',
        status='Picking'
    )

    # 8. Picking Item Details
    PickingItemDetail.objects.all().delete()
    PickingItemDetail.objects.create(
        pick_task='PICK-009821',
        order_id='ORD-00124',
        sequence=1,
        item_name='Fresh Milk 1L',
        sku='MILK-1L',
        barcode='8909876543210',
        batch_no='MILK-0905',
        expiry_date=date(2026, 9, 8),
        required_qty=2,
        available_qty=296,
        reserved_qty=2,
        picked_qty=2,
        short_qty=0,
        damaged_qty=0,
        source_location='A01-R02-S01-B08',
        location_barcode='LOC-A01-R02-S01-B08',
        scanner_id='SCN-021',
        picker='Rahul',
        scan_time='12:35',
        fefo_applied='Yes',
        pick_method='Wave',
        status='Picked'
    )
    PickingItemDetail.objects.create(
        pick_task='PICK-009821',
        order_id='ORD-00124',
        sequence=2,
        item_name='Basmati Rice 5kg',
        sku='RICE-BAS-5KG',
        barcode='8901234567890',
        batch_no='BTH-R2408',
        expiry_date=date(2027, 8, 15),
        required_qty=1,
        available_qty=493,
        reserved_qty=1,
        picked_qty=1,
        short_qty=0,
        damaged_qty=0,
        source_location='A04-R12-S03-B04',
        location_barcode='LOC-A04-R12-S03-B04',
        scanner_id='SCN-021',
        picker='Rahul',
        scan_time='12:40',
        fefo_applied='Yes',
        pick_method='Wave',
        status='Picked'
    )
    PickingItemDetail.objects.create(
        pick_task='PICK-009821',
        order_id='ORD-00124',
        sequence=3,
        item_name='Coca-Cola 750ml',
        sku='COKE-750',
        barcode='8905555555555',
        batch_no='COKE-A82',
        expiry_date=date(2027, 2, 1),
        required_qty=3,
        available_qty=200,
        reserved_qty=3,
        picked_qty=3,
        short_qty=0,
        damaged_qty=0,
        source_location='A07-R03-S02-B12',
        location_barcode='LOC-A07-R03-S02-B12',
        scanner_id='SCN-021',
        picker='Rahul',
        scan_time='12:44',
        fefo_applied='Yes',
        pick_method='Wave',
        status='Picked'
    )

    # 9. Picking Scan History
    PickingScanHistory.objects.all().delete()
    PickingScanHistory.objects.create(
        scan_id='PS-10021',
        pick_task='PICK-009821',
        order='ORD-00124',
        scanner='SCN-021',
        picker='Rahul',
        scan_type='Location Scan',
        sku='—',
        barcode='LOC-A01-R02-S01-B08',
        batch='—',
        location='A01-R02-S01-B08',
        quantity=0,
        result='Valid',
        scan_time='12:34:20'
    )
    PickingScanHistory.objects.create(
        scan_id='PS-10022',
        pick_task='PICK-009821',
        order='ORD-00124',
        scanner='SCN-021',
        picker='Rahul',
        scan_type='Product Scan',
        sku='MILK-1L',
        barcode='8909876543210',
        batch='MILK-0905',
        location='A01-R02-S01-B08',
        quantity=2,
        result='Valid',
        scan_time='12:35:12'
    )
    PickingScanHistory.objects.create(
        scan_id='PS-10023',
        pick_task='PICK-009821',
        order='ORD-00124',
        scanner='SCN-021',
        picker='Rahul',
        scan_type='Product Scan',
        sku='RICE-BAS-5KG',
        barcode='8901234567890',
        batch='BTH-R2408',
        location='A04-R12-S03-B04',
        quantity=1,
        result='Valid',
        scan_time='12:40:25'
    )

    # 10. Packing Records
    PackingRecord.objects.all().delete()
    PackingRecord.objects.create(
        packing_id='PACK-00981',
        order_id='ORD-00124',
        pick_task_id='PICK-009821',
        package_id='PKG-009821',
        packing_station='PACK-04',
        packer='Priya',
        items_expected=8,
        items_verified=8,
        units=14,
        package_count=2,
        weight='7.8 kg',
        dimensions='40×30×25 cm',
        package_type='Standard Box',
        package_barcode='PKG890123',
        seal_no='SEAL-48219',
        qc_status='Passed',
        packed_at='13:05',
        status='Packed'
    )
    PackingRecord.objects.create(
        packing_id='PACK-00982',
        order_id='ORD-00125',
        pick_task_id='PICK-009822',
        package_id='PKG-009822',
        packing_station='PACK-02',
        packer='Kiran',
        items_expected=5,
        items_verified=4,
        units=6,
        package_count=1,
        weight='3.2 kg',
        dimensions='30×20×20 cm',
        package_type='Cold Bag',
        package_barcode='PKG890124',
        seal_no='SEAL-48220',
        qc_status='Pending',
        packed_at='—',
        status='Packing'
    )

    # 11. Shipping / Dispatch Master
    ShipmentMaster.objects.all().delete()
    ShipmentMaster.objects.create(
        shipment_id='SHP-000821',
        order_id='ORD-00124',
        package_id='PKG-009821',
        warehouse='RJY-DS-001',
        customer='Jay',
        delivery_zone='RJY-Z03',
        items=8,
        units=14,
        packages=2,
        weight='7.8 kg',
        transporter='Internal Fleet',
        rider='Suresh',
        vehicle='AP05CD4521',
        route='RT-00421',
        tracking_id='TRK-982145',
        dispatch_dock='DOCK-02',
        eta='14:35',
        dispatch_time='13:18',
        delivery_time='14:31',
        status='Delivered'
    )
    ShipmentMaster.objects.create(
        shipment_id='SHP-000822',
        order_id='ORD-00125',
        package_id='PKG-009822',
        warehouse='RJY-DS-001',
        customer='Anil',
        delivery_zone='RJY-Z02',
        items=5,
        units=7,
        packages=1,
        weight='3.2 kg',
        transporter='Internal Fleet',
        rider='Ravi',
        vehicle='AP05EF7812',
        route='RT-00422',
        tracking_id='TRK-982146',
        dispatch_dock='DOCK-02',
        eta='15:10',
        dispatch_time='—',
        delivery_time='—',
        status='Ready for Dispatch'
    )

    # 12. Shipping / Delivery Details
    ShipmentDeliveryDetail.objects.all().delete()
    ShipmentDeliveryDetail.objects.create(
        shipment_id='SHP-000821',
        customer='Jay',
        delivery_address='Rajahmundry Main Road, Door #4-21',
        delivery_slot='14:00–15:00',
        order_value='₹1,245',
        payment_method='UPI',
        payment_status='Paid',
        cod_amount='0',
        package_barcode='PKG890123',
        shipping_label='LAB-009821',
        dispatcher='Kiran',
        scanner_id='SCN-031',
        transporter='Internal Fleet',
        rider_id='DP-00152',
        rider_name='Suresh',
        vehicle_type='Bike',
        vehicle_number='AP05CD4521',
        route_sequence=5,
        dispatch_scan_time='13:15',
        delivery_otp='Verified',
        pod='POD-8921',
        failed_reason='—',
        return_required='No',
        status='Delivered'
    )
    ShipmentDeliveryDetail.objects.create(
        shipment_id='SHP-000822',
        customer='Anil',
        delivery_address='Danavaipeta 2nd Cross, Rajahmundry',
        delivery_slot='15:00–16:00',
        order_value='₹875',
        payment_method='COD',
        payment_status='Pending',
        cod_amount='₹875',
        package_barcode='PKG890124',
        shipping_label='LAB-009822',
        dispatcher='Kiran',
        scanner_id='SCN-031',
        transporter='Internal Fleet',
        rider_id='DP-00153',
        rider_name='Ravi',
        vehicle_type='Bike',
        vehicle_number='AP05EF7812',
        route_sequence=3,
        dispatch_scan_time='—',
        delivery_otp='Pending',
        pod='—',
        failed_reason='—',
        return_required='No',
        status='Ready'
    )

    # 13. Shipping Scan History
    ShippingScanHistory.objects.all().delete()
    ShippingScanHistory.objects.create(
        scan_id='SS-00121',
        shipment_id='SHP-000821',
        package_id='PKG-009821',
        scanner_id='SCN-031',
        user='Kiran',
        scan_type='Package Verification',
        location='PACK-04',
        result='Valid',
        scan_time='13:10'
    )
    ShippingScanHistory.objects.create(
        scan_id='SS-00122',
        shipment_id='SHP-000821',
        package_id='PKG-009821',
        scanner_id='SCN-031',
        user='Kiran',
        scan_type='Dispatch Scan',
        location='DOCK-02',
        result='Valid',
        scan_time='13:15'
    )
    ShippingScanHistory.objects.create(
        scan_id='SS-00123',
        shipment_id='SHP-000821',
        package_id='PKG-009821',
        scanner_id='SCN-031',
        user='Kiran',
        scan_type='Vehicle Assignment',
        location='AP05CD4521',
        result='Valid',
        scan_time='13:17'
    )

    print("✓ All 13 Operational Tables successfully seeded into PostgreSQL!")

if __name__ == '__main__':
    seed()
