"""
Seed management command — populates the WMS database with realistic demo data.
Run with: python manage.py seed_data
"""
import random
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from wms_platform.models import User, ReasonCode
from wms_master.models import (Site, SkuCategory, Sku, Vendor, Zone, Bin,
                                ClusterZone, DockDoor, VehicleType, Transporter)
from wms_inventory.models import Lpn, InventoryLot, InventoryTx, Droplist
from wms_inbound.models import Asn, AsnLine, Grn, GrnLine, PutawayTask, InboundDiscrepancy
from wms_outbound.models import (DispatchPlan, Batch, Order, OrderLine,
                                  OrderAllocation, Picklist, PicklistLine,
                                  Sortlist, SortlistLine, Manifest, ManifestLine,
                                  CancellationPutaway)
from wms_transport.models import Trip, VehicleCheckin, TripReturnLeg
from wms_crossdock.models import CrossDockBatch, CrossDockLine
from wms_optional.models import CycleCount, CycleCountLine, ReplenishmentTask


def rnd(lst): return random.choice(lst)
def now(): return timezone.now()
def days_ago(n): return timezone.now() - timedelta(days=n)
def days_ahead(n): return timezone.now() + timedelta(days=n)


class Command(BaseCommand):
    help = 'Seed the WMS database with realistic demo data'

    def handle(self, *args, **options):
        self.stdout.write('[seed] Starting seed...')
        self.create_platform()
        self.create_master()
        self.create_inventory()
        self.create_inbound()
        self.create_outbound()
        self.create_transport()
        self.create_crossdock()
        self.create_optional()
        self.stdout.write(self.style.SUCCESS('[seed] Seed complete!'))

    def create_platform(self):
        self.stdout.write('  [+] Platform (users, reason codes)...')
        # Users
        users_data = [
            ('751703098', 'Uppada Bhasreenivasa', 'PICKER', '9876543210'),
            ('812190908', 'Jude Anil K', 'PACKER', '9876543211'),
            ('900001001', 'Ramesh Supervisor', 'SUPERVISOR', '9876543212'),
            ('900001002', 'Priya QC', 'QC', '9876543213'),
            ('900001003', 'Admin User', 'ADMIN', '9876543214'),
            ('900001004', 'Sorter One', 'SORTER', '9876543215'),
            ('900001005', 'GRN Operator', 'GRN_OP', '9876543216'),
        ]
        self.users = []
        for emp, name, role, phone in users_data:
            u, _ = User.objects.get_or_create(emp_code=emp, defaults={
                'name': name, 'role': role, 'phone': phone, 'status': 'ACTIVE'
            })
            self.users.append(u)

        # Reason codes
        rcs = [
            ('PICK_SHORT', 'SHORT_PICK', 'Item not available at pick location', False, True),
            ('DAMAGE_RCV', 'DAMAGE', 'Item received in damaged condition', True, True),
            ('DISC_QTY', 'DISCREPANCY', 'Quantity mismatch at receiving', False, True),
            ('BREACH_LATE', 'CHECK_IN_BREACH', 'Vehicle arrived after cutoff', False, True),
            ('CANCEL_CUST', 'CANCEL', 'Customer cancellation', False, True),
        ]
        self.reason_codes = []
        for code, cat, desc, photo, remark in rcs:
            rc, _ = ReasonCode.objects.get_or_create(code=code, defaults={
                'category': cat, 'description': desc,
                'requires_photo': photo, 'requires_remark': remark
            })
            self.reason_codes.append(rc)

    def create_master(self):
        self.stdout.write('   Master data (sites, skus, vendors, zones, bins)...')

        # Sites
        sites_data = [
            ('HYD080M', 'MH', 'Hyderabad Mother Hub', None),
            ('HYD-DRY-MH2', 'MH', 'Hyderabad Dry MH2', None),
            ('HYD078S', 'DS', 'Hyderabad Dark Store 78', 'HYD080M'),
            ('HYD068S', 'DS', 'Hyderabad Dark Store 68', 'HYD080M'),
            ('CHN-DRY-MH2', 'MH', 'Chennai Dry MH2', None),
            ('HYD023S', 'DS', 'Hyderabad Begumpet', 'HYD080M'),
        ]
        self.sites = {}
        for code, stype, name, parent_code in sites_data:
            s, _ = Site.objects.get_or_create(code=code, defaults={
                'type': stype, 'name': name, 'status': 'ACTIVE'
            })
            self.sites[code] = s

        # Set parents
        for code, stype, name, parent_code in sites_data:
            if parent_code:
                s = self.sites[code]
                s.parent_site = self.sites[parent_code]
                s.save()

        self.primary_site = self.sites['HYD080M']

        # Update user site_ids
        for u in self.users:
            u.site_id = self.primary_site.site_id
            u.save()

        # SKU Categories
        cat_grocery, _ = SkuCategory.objects.get_or_create(name='Grocery')
        cat_atta, _ = SkuCategory.objects.get_or_create(name='Atta Rice Dals & Pulses', defaults={'parent': cat_grocery})
        cat_masala, _ = SkuCategory.objects.get_or_create(name='Masala Dry Fruits', defaults={'parent': cat_grocery})
        self.categories = [cat_grocery, cat_atta, cat_masala]

        # Vendors
        vendors_data = [
            ('KK-000100', 'sap_testing', 'KK', True, True),
            ('COLMAN-001', 'Colman Traders', 'KIRA', False, True),
            ('SMART-SHP', 'Smartship Logistics', 'KIRA', False, False),
            ('FASHION-01', 'Fashion House', 'KK', True, True),
            ('SHAKTHI-01', 'Shakthi Enterprises', 'KIRA', True, True),
        ]
        self.vendors = []
        for code, name, entity, is_cust, is_sku in vendors_data:
            v, _ = Vendor.objects.get_or_create(code=code, defaults={
                'name': name, 'org_entity': entity,
                'is_customer': is_cust, 'is_sku_vendor': is_sku, 'status': 'Active'
            })
            self.vendors.append(v)

        # SKUs
        skus_data = [
            ('SKU-001', 'Aashirvaad Atta 5kg', '8906007500001', cat_atta, 'Atta', 275, 'DRY', 365),
            ('SKU-002', 'Tata Salt 1kg', '8901372002503', cat_grocery, 'Salt', 24, 'DRY', 730),
            ('SKU-003', 'Fortune Sunflower Oil 1L', '8906004880012', cat_grocery, 'Oil', 140, 'DRY', 180),
            ('SKU-004', 'MDH Chilli Powder 100g', '8901057001011', cat_masala, 'Masala', 85, 'DRY', 365),
            ('SKU-005', 'Toor Dal 1kg', '8906098001523', cat_atta, 'Dals', 110, 'DRY', 365),
            ('SKU-006', 'Basmati Rice 5kg', '8904069001254', cat_atta, 'Rice', 469, 'DRY', 730),
            ('SKU-007', 'Amul Butter 500g', '8901030001086', cat_grocery, 'Dairy', 275, 'COLD', 30),
            ('SKU-008', 'Chicken Breast 1kg', '8906001500254', cat_grocery, 'Meat', 320, 'COLD', 7),
            ('SKU-009', 'Almonds 500g', '8906098001001', cat_masala, 'Dry Fruits', 450, 'DRY', 180),
            ('SKU-010', 'Moong Dal 1kg', '8901372050023', cat_atta, 'Dals', 95, 'DRY', 365),
            ('SKU-011', 'Rajma 1kg', '8906004880099', cat_atta, 'Pulses', 120, 'DRY', 365),
            ('SKU-012', 'Turmeric Powder 200g', '8901057002022', cat_masala, 'Masala', 65, 'DRY', 365),
            ('SKU-013', 'Coconut Oil 1L', '8901030500011', cat_grocery, 'Oil', 195, 'DRY', 365),
            ('SKU-014', 'Coriander Powder 100g', '8901057003033', cat_masala, 'Masala', 45, 'DRY', 365),
            ('SKU-015', 'Sunflower Seeds 250g', '8906098002001', cat_masala, 'Dry Fruits', 180, 'DRY', 180),
        ]
        self.skus = []
        for code, name, ean, cat, subcat, mrp, zone, shelf in skus_data:
            sku, _ = Sku.objects.get_or_create(sku_code=code, defaults={
                'name': name, 'ean': ean, 'category': cat, 'sub_category': subcat,
                'mrp': Decimal(str(mrp)), 'storage_zone': zone, 'shelf_life_days': shelf,
                'is_food': True, 'wac': Decimal(str(mrp * 0.85)), 'status': 'ACTIVE'
            })
            self.skus.append(sku)

        # Vehicle types
        vt_data = [('10FT_TRUCK', 200, False), ('14FT_TRUCK', 400, False), ('32FT_TRUCK_SX', 1000, False),
                   ('COLD_VAN', 150, True)]
        self.vehicle_types = []
        for code, cap, cold in vt_data:
            vt, _ = VehicleType.objects.get_or_create(code=code, defaults={'capacity_lpns': cap, 'temp_controlled': cold})
            self.vehicle_types.append(vt)

        # Transporters
        trans_data = [('SMARTSHIP', 'Smartship Logistics', '24hours_2t'), ('BLUEDART', 'Blue Dart Express', '48hours_1t')]
        self.transporters = []
        for code, name, billing in trans_data:
            t, _ = Transporter.objects.get_or_create(code=code, defaults={'name': name, 'billing_basis': billing})
            self.transporters.append(t)

        # Zones
        zones_data = [
            ('HDR_FOOD', 'Grocery', 'GENERAL'), ('HDR_COLD', 'Cold', 'GENERAL'),
            ('LSO_FOOD', 'Grocery', 'GENERAL'), ('ADV_ZONE', 'Grocery', 'FLEXI_FORWARD'),
            ('MRP_ZONE', 'Grocery', 'MRP'),
        ]
        self.zones = []
        for code, cat, ztype in zones_data:
            z, _ = Zone.objects.get_or_create(code=code, defaults={
                'site': self.primary_site, 'category': cat, 'zone_type': ztype,
                'commingled_allowed': True, 'max_commingled': 5, 'status': 'ACTIVE'
            })
            self.zones.append(z)

        # Bins
        self.bins = []
        aisles = ['L01', 'L02', 'L03', 'L04']
        racks = ['R01', 'R02', 'R03', 'R04', 'R05']
        levels = [1, 2, 3]
        for aisle in aisles:
            for rack in racks:
                for level in levels:
                    code = f"LSO-{aisle}-{rack}-{level}"
                    b, _ = Bin.objects.get_or_create(code=code, defaults={
                        'site': self.primary_site, 'zone': rnd(self.zones),
                        'aisle': aisle, 'rack': rack, 'level': level,
                        'bin_type': 'MTS_0.8x0', 'putaway_max': 100,
                        'condition': 'GOOD', 'is_pickzone': level == 1, 'status': 'ACTIVE'
                    })
                    self.bins.append(b)

        # Stage bins
        for code in ['RECV-STAGE-1', 'RECV-STAGE-2', 'DISPATCH-STAGE-1', 'XDOCK-BIN-1']:
            b, _ = Bin.objects.get_or_create(code=code, defaults={
                'site': self.primary_site, 'zone': self.zones[0],
                'bin_type': 'STAGE', 'putaway_max': 500, 'condition': 'GOOD', 'status': 'ACTIVE'
            })
            self.bins.append(b)

        # Cluster zones
        self.cluster_zones = []
        for i in range(1, 4):
            cz, _ = ClusterZone.objects.get_or_create(code=f"CZ-0{i}", defaults={
                'site': self.primary_site, 'slot_count': 20, 'status': 'ACTIVE'
            })
            self.cluster_zones.append(cz)

        # Dock doors
        self.dock_doors = []
        for i in range(1, 5):
            d, _ = DockDoor.objects.get_or_create(code=f"DOCK-0{i}", defaults={
                'site': self.primary_site,
                'capability': 'BOTH', 'status': 'OPEN'
            })
            self.dock_doors.append(d)

    def create_inventory(self):
        self.stdout.write('   Inventory (LPNs, lots, transactions)...')

        # LPNs
        self.lpns = []
        statuses = ['EMPTY', 'PICKING', 'SORT_DONE', 'QC_DONE', 'PACKED']
        for i in range(1, 51):
            barcode = f"{100000 + i}"
            lpn, _ = Lpn.objects.get_or_create(barcode=barcode, defaults={
                'type': 'TOTE', 'current_site': self.primary_site,
                'current_bin': rnd(self.bins).code,
                'status': statuses[i % len(statuses)],
                'is_superstore': False,
            })
            self.lpns.append(lpn)

        # Pallets
        self.pallets = []
        for i in range(1, 11):
            barcode = f"PL-HYD{i:02d}"
            pallet, _ = Lpn.objects.get_or_create(barcode=barcode, defaults={
                'type': 'PALLET', 'current_site': self.primary_site,
                'current_bin': rnd(self.bins).code,
                'status': 'EMPTY',
            })
            self.pallets.append(pallet)

        # Inventory lots
        self.lots = []
        for sku in self.skus:
            for _ in range(3):
                lot_code = f"LOT-{sku.sku_code}-{uuid.uuid4().hex[:6].upper()}"
                expiry = date.today() + timedelta(days=random.randint(30, 365))
                lot, _ = InventoryLot.objects.get_or_create(lot_code=lot_code, defaults={
                    'sku': sku, 'site': self.primary_site,
                    'bin': rnd(self.bins), 'lpn': rnd(self.lpns),
                    'expiry_date': expiry, 'mrp': sku.mrp,
                    'box_size': rnd([1, 6, 12, 24]),
                    'inbound_type': 'EXTERNAL', 'inbound_ref': f"GRN-{uuid.uuid4().hex[:8].upper()}",
                    'bucket': 'Good', 'qty': random.randint(10, 500),
                    'status': 'AVAILABLE',
                })
                self.lots.append(lot)

        # Inventory transactions
        for lot in self.lots[:20]:
            InventoryTx.objects.get_or_create(
                site=self.primary_site, sku=lot.sku, from_lot=lot,
                qty=lot.qty, flow='GRN', ref_type='GRN',
                defaults={
                    'from_bin': 'RECV-STAGE-1', 'to_bin': lot.bin.code if lot.bin else '',
                    'user': rnd(self.users), 'created_at': days_ago(random.randint(1, 30))
                }
            )

        # Droplists
        for i in range(1, 6):
            code = f"DZPHYD{i:02d}"
            Droplist.objects.get_or_create(code=code, defaults={
                'lpn': rnd(self.lpns), 'totes': 3, 'dropped_count': rnd([0, 1, 2, 3]),
                'in_spider_count': 0, 'status': rnd(['OPEN', 'IN_PROGRESS', 'COMPLETED']),
                'completed_by': rnd(self.users),
            })

    def create_inbound(self):
        self.stdout.write('   Inbound (ASNs, GRNs, putaway)...')

        statuses = ['ARRIVED', 'CHECKED_IN', 'UNLOADED', 'QC_PENDING', 'PUTAWAY_PENDING', 'CLOSED']
        self.asns = []
        for i in range(1, 8):
            asn_no = f"ASN-HYD{i:04d}"
            asn, _ = Asn.objects.get_or_create(asn_no=asn_no, defaults={
                'type': rnd(['VENDOR_PO', 'MH_TRANSFER']),
                'source_vendor': rnd(self.vendors),
                'dest_site': self.primary_site,
                'door': rnd(self.dock_doors),
                'slot_start': days_ago(1),
                'slot_end': days_ago(1) + timedelta(hours=2),
                'expected_vehicle': f"TS{random.randint(10,99):02d}UC{random.randint(1000,9999)}",
                'total_lpns': random.randint(10, 50),
                'total_skus': random.randint(5, 15),
                'total_qty': random.randint(100, 1000),
                'status': statuses[i % len(statuses)],
            })
            self.asns.append(asn)

            # ASN lines
            for sku in random.sample(self.skus, min(5, len(self.skus))):
                AsnLine.objects.get_or_create(asn=asn, sku=sku, defaults={
                    'ean': sku.ean, 'ordered_qty': random.randint(10, 100),
                    'expected_expiry': date.today() + timedelta(days=180),
                    'line_status': rnd(['OPEN', 'PARTIAL', 'RECEIVED']),
                })

            # GRN
            grn_no = f"GRN-HYD{i:04d}"
            grn, _ = Grn.objects.get_or_create(grn_no=grn_no, defaults={
                'asn': asn, 'mode': 'LPN_SCAN',
                'status': rnd(['COMPLETED', 'IN_PROGRESS', 'PARTIAL']),
                'has_discrepancy': random.choice([True, False]),
                'received_by': rnd(self.users),
                'completed_at': days_ago(1) if random.random() > 0.3 else None,
            })

            for asn_line in asn.lines.all()[:3]:
                recv = asn_line.ordered_qty - random.randint(0, 5)
                lot = rnd(self.lots)
                GrnLine.objects.get_or_create(grn=grn, sku=asn_line.sku, defaults={
                    'asn_line': asn_line, 'ordered_qty': asn_line.ordered_qty,
                    'received_qty': recv, 'damaged_qty': random.randint(0, 2),
                    'expired_qty': 0, 'excess_qty': 0,
                    'expiry_date': asn_line.expected_expiry, 'mrp': asn_line.sku.mrp,
                    'lot': lot,
                })

            # Putaway tasks
            for asn_line in asn.lines.all()[:2]:
                grn_line = grn.lines.filter(sku=asn_line.sku).first()
                if grn_line:
                    PutawayTask.objects.get_or_create(grn_line=grn_line, defaults={
                        'lpn': rnd(self.lpns), 'from_location': 'RECV-STAGE-1',
                        'to_bin': rnd(self.bins), 'priority': random.randint(1, 10),
                        'status': rnd(['CREATED', 'ASSIGNED', 'COMPLETED']),
                        'assigned_to': rnd(self.users),
                    })

        # Discrepancies
        for i in range(3):
            asn = rnd(self.asns)
            InboundDiscrepancy.objects.get_or_create(
                asn=asn, sku=rnd(self.skus),
                defaults={
                    'type': rnd(['SHORT', 'EXCESS', 'DAMAGE']),
                    'claimed_qty': 100, 'found_qty': random.randint(80, 110),
                    'value': Decimal('500.00'), 'status': rnd(['OPEN', 'RESOLVED']),
                    'maker': rnd(self.users), 'checker': rnd(self.users),
                }
            )

    def create_outbound(self):
        self.stdout.write('   Outbound (dispatch plans, batches, orders, picklists, sortlists, manifests)...')

        # Dispatch plans
        self.dispatch_plans = []
        for i in range(1, 4):
            code = f"DPHYD{i:02d}"
            dp, _ = DispatchPlan.objects.get_or_create(code=code, defaults={
                'site': self.primary_site,
                'mh_locations': 'HYD-DRY-MH2',
                'status': rnd(['ACTIVE', 'COMPLETED']),
                'creation_time': days_ago(2),
                'expiry_time': days_ahead(1),
                'start_date': date.today() - timedelta(days=1),
                'end_date': date.today() + timedelta(days=1),
                'total_trips': random.randint(50, 150),
                'trips_with_vehicles': random.randint(40, 100),
                'updated_by': 'admin@zepto.in',
            })
            self.dispatch_plans.append(dp)

        # Batches
        self.batches = []
        for i in range(1, 6):
            batch_no = f"BHYD{i:04d}"
            batch, _ = Batch.objects.get_or_create(batch_no=batch_no, defaults={
                'site': self.primary_site,
                'type': 'MANUAL',
                'status': rnd(['ALLOCATED', 'IN_PROGRESS', 'CLOSED', 'UPLOADED']),
                'order_type': 'REGULAR',
                'processing_type': 'LPN_BASED',
                'picking_type': 'REDISTRIBUTION',
                'cluster_zone': rnd(self.cluster_zones),
                'sorting_eligible': True,
                'dispatch_plan': rnd(self.dispatch_plans),
                'destinations': rnd(list(self.sites.values())).code,
                'totes': random.randint(5, 30),
                'ordered_qty': random.randint(200, 2000),
                'ordered_skus': random.randint(20, 100),
                'picked_qty': random.randint(100, 500),
                'sorted_qty': random.randint(50, 400),
                'short_qty': random.randint(0, 10),
                'cutoff': days_ahead(1),
                'created_by': rnd(self.users),
            })
            self.batches.append(batch)

        # Orders
        order_types = ['REGULAR', 'STO', 'RETURN', 'SECONDARY_SALES']
        order_statuses = ['CREATED', 'ALLOCATED', 'PICKING', 'SORTED', 'PACKED', 'SHIPPED']
        self.orders = []
        dest_sites = list(self.sites.values())
        for i in range(1, 21):
            order_no = f"OHYD080{i:04d}"
            order, _ = Order.objects.get_or_create(order_no=order_no, defaults={
                'type': rnd(order_types),
                'processing_type': 'LPN_BASED',
                'inventory_type': 'GOOD',
                'shipment_type': rnd(['SELF_DISPATCH', 'LINEHAUL', 'VENDOR_PICKUP']),
                'source_site': self.primary_site,
                'next_dest': rnd(dest_sites),
                'final_dest': rnd(dest_sites),
                'ordered_qty': random.randint(10, 200),
                'ordered_skus': random.randint(3, 20),
                'allocated_qty': random.randint(5, 150),
                'picked_qty': random.randint(0, 100),
                'shipped_qty': random.randint(0, 80),
                'status': order_statuses[i % len(order_statuses)],
                'created_by': rnd(self.users),
            })
            self.orders.append(order)

            # Order lines
            for sku in random.sample(self.skus, min(4, len(self.skus))):
                qty = random.randint(5, 50)
                OrderLine.objects.get_or_create(order=order, sku=sku, defaults={
                    'ordered_qty': qty, 'allocated_qty': qty - random.randint(0, 3),
                    'picked_qty': qty - random.randint(0, 5), 'short_qty': random.randint(0, 2),
                    'shipped_qty': qty - random.randint(0, 5),
                    'line_status': rnd(['CREATED', 'ALLOCATED', 'PICKING', 'SHIPPED']),
                })

        # Allocations
        for order in self.orders[:10]:
            for line in order.lines.all()[:2]:
                lot = rnd(self.lots)
                OrderAllocation.objects.get_or_create(order_line=line, defaults={
                    'lot': lot, 'bin': lot.bin, 'lpn': rnd(self.lpns),
                    'qty': line.ordered_qty, 'batch': rnd(self.batches),
                    'status': rnd(['ALLOCATED', 'PICKED', 'PENDING']),
                })

        # Picklists
        self.picklists = []
        for i, batch in enumerate(self.batches):
            code = f"PL{batch.batch_no}"
            pl, _ = Picklist.objects.get_or_create(code=code, defaults={
                'batch': batch, 'zone': rnd(self.zones), 'type': 'LPN',
                'status': rnd(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']),
                'assigned_to': rnd(self.users),
                'assigned_qty': random.randint(100, 500), 'assigned_skus': random.randint(10, 50),
                'picked_qty': random.randint(50, 400), 'pending_qty': random.randint(0, 50),
                'short_qty': random.randint(0, 5),
            })
            self.picklists.append(pl)
            for sku in random.sample(self.skus, min(3, len(self.skus))):
                lot = rnd(self.lots)
                PicklistLine.objects.get_or_create(picklist=pl, sku=sku, defaults={
                    'alloc': None, 'bin': rnd(self.bins), 'lot': lot,
                    'qty': random.randint(5, 30), 'picked_qty': random.randint(0, 25),
                    'short_qty': 0, 'pick_seq': random.randint(1, 100),
                    'status': rnd(['PENDING', 'PICKED', 'SHORT']),
                })

        # Sortlists
        self.sortlists = []
        for batch in self.batches:
            code = f"SL{batch.batch_no}"
            sl, _ = Sortlist.objects.get_or_create(code=code, defaults={
                'batch': batch, 'type': 'CLUSTER',
                'cluster_zone': rnd(self.cluster_zones),
                'assigned_qty': random.randint(100, 500), 'assigned_skus': random.randint(10, 50),
                'sorted_qty': random.randint(50, 400), 'pending_qty': random.randint(0, 50),
                'short_qty': 0, 'sorter': 'PTL Packer',
                'status': rnd(['CREATED', 'IN_PROGRESS', 'COMPLETED']),
                'started_at': days_ago(1),
            })
            self.sortlists.append(sl)
            for sku in random.sample(self.skus, min(3, len(self.skus))):
                order = rnd(self.orders)
                SortlistLine.objects.get_or_create(sortlist=sl, sku=sku, defaults={
                    'order': order, 'dest_tote': f"PL-HYD{random.randint(1,10):02d}",
                    'qty': random.randint(5, 30), 'sorted_qty': random.randint(0, 25),
                    'status': rnd(['PENDING', 'SORTED']),
                })

        # Manifests
        self.manifests = []
        dest_list = [self.sites['HYD078S'], self.sites['HYD068S'], self.sites['HYD023S']]
        for i in range(1, 6):
            mf_no = f"MFHYD{i:04d}"
            mf, _ = Manifest.objects.get_or_create(manifest_no=mf_no, defaults={
                'site': self.primary_site, 'type': 'LPN_BASED',
                'status': rnd(['CREATED', 'SEALED', 'DISPATCHED']),
                'vehicle_no': f"TG{random.randint(10,99):02d}T{random.randint(1000,9999)}",
                'dest_store': rnd(dest_list),
                'shipments_count': random.randint(1, 5),
                'packed_qty': random.randint(50, 500),
                'packed_totes': random.randint(5, 30),
                'created_by': rnd(self.users),
            })
            self.manifests.append(mf)
            for j in range(3):
                order = rnd(self.orders)
                ManifestLine.objects.get_or_create(manifest=mf, order=order, defaults={
                    'tote_lpn': rnd(self.lpns).barcode,
                    'qty': random.randint(5, 30),
                })

        # Cancellation putaways
        for order in self.orders[:3]:
            CancellationPutaway.objects.get_or_create(order=order, defaults={
                'status': rnd(['CREATED', 'IN_PROGRESS', 'COMPLETED']),
                'pending_skus': random.randint(0, 10),
                'remaining_qty': random.randint(0, 50),
                'pending_lpns': random.randint(0, 5),
            })

    def create_transport(self):
        self.stdout.write('   Transport (trips, vehicle check-ins, return legs)...')
        trip_statuses = ['PLANNED', 'VEHICLE_ASSIGNED', 'CHECKED_IN', 'DOCKED_IN', 'LOADING', 'IN_TRANSIT', 'COMPLETED']
        self.trips = []
        dest_names = ['HYD-NCB', 'HYD-KOTI', 'HYD-Begumpet', 'HYD-KPH', 'HYD-Chin']
        for i in range(1, 16):
            trip_no = f"ZMT-{2026000 + i}"
            trip, _ = Trip.objects.get_or_create(trip_no=trip_no, defaults={
                'site': self.primary_site,
                'direction': rnd(['FORWARD', 'RETURN', 'INBOUND_MH']),
                'dest_site': rnd(dest_names),
                'trip_date': date.today() - timedelta(days=random.randint(0, 3)),
                'batch_slot': f"Batch_{random.randint(1,3)} {random.choice(['10:00 AM', '2:00 PM', '6:00 PM'])}",
                'vehicle_type': rnd(self.vehicle_types),
                'transporter': rnd(self.transporters),
                'vehicle_no': f"TS{random.randint(10,99):02d}UC{random.randint(1000,9999)}",
                'driver_name': rnd(['Nikhil', 'Ramesh', 'Nitin', 'Parag', 'Suresh']),
                'driver_phone': f"7{random.randint(100000000,999999999)}",
                'reporting_cutoff': days_ago(1),
                'dock_in_at': days_ago(1) + timedelta(hours=2),
                'dock_out_cutoff': days_ago(1) + timedelta(hours=4),
                'lpns_loaded': random.randint(5, 50),
                'load_weight': f"~{random.randint(50,500)}kg",
                'forward_lpns_total': random.randint(0, 150),
                'delay_status': rnd(['ON_TRACK', 'DELAYED']),
                'gps_status': rnd(['LIVE', 'STALE', 'OFF']),
                'billing_basis': '24hours_2t',
                'billing_status': rnd(['PLANNED', 'BILLED']),
                'source_system': 'Dhanalaxmi - Zepto',
                'status': trip_statuses[i % len(trip_statuses)],
            })
            self.trips.append(trip)

            # Vehicle checkin
            VehicleCheckin.objects.get_or_create(trip=trip, defaults={
                'direction': 'OUTBOUND',
                'vehicle_no': trip.vehicle_no,
                'driver_name': trip.driver_name,
                'driver_phone': trip.driver_phone,
                'checkin_at': trip.dock_in_at,
                'checkin_cutoff': days_ago(1) + timedelta(hours=1),
                'dl_valid': True, 'rc_valid': True, 'six_sided': True,
                'security_person': rnd(['SIBA SUNAR', 'RAJESH K', 'MOHAN LAL']),
                'delay_status': trip.delay_status,
                'breach_type': 'CHECK_IN_BREACH' if trip.delay_status == 'DELAYED' else '',
            })

            # Return leg
            if trip.direction in ['RETURN', 'FORWARD']:
                TripReturnLeg.objects.get_or_create(trip=trip, defaults={
                    'return_lpns': random.randint(50, 300),
                    'lpns_unloaded': random.randint(0, 200),
                    'dock_in_cutoff': days_ahead(1) + timedelta(hours=22),
                    'dock_out_cutoff': days_ahead(1) + timedelta(hours=23),
                    'status': rnd(['PENDING', 'RETURN_IN_TRANSIT', 'RETURNED']),
                })

    def create_crossdock(self):
        self.stdout.write('   Cross Dock batches...')
        self.xdock_batches = []
        for i in range(1, 4):
            batch_no = f"XHYD{i:03d}"
            xdb, _ = CrossDockBatch.objects.get_or_create(batch_no=batch_no, defaults={
                'site': self.primary_site,
                'status': rnd(['UPLOADED', 'INWARDING', 'SORTING', 'COMPLETED']),
                'processing_type': 'LPN_BASED',
                'orders_count': random.randint(3, 10),
                'ordered_qty': random.randint(500, 2000),
                'ordered_skus': random.randint(10, 50),
                'inwarded_qty': random.randint(0, 1000),
                'sorted_qty': random.randint(0, 800),
                'xdock_allocable_qty': random.randint(100000, 2000000),
                'created_by': rnd(self.users),
            })
            self.xdock_batches.append(xdb)

            # XDock lines
            for sku in random.sample(self.skus, min(5, len(self.skus))):
                asn = rnd(self.asns) if self.asns else None
                order = rnd(self.orders) if self.orders else None
                CrossDockLine.objects.get_or_create(xdb=xdb, sku=sku, defaults={
                    'asn': asn, 'order': order,
                    'qty': random.randint(50, 500),
                    'xdock_bin': rnd(self.bins).code,
                    'allocatable_qty': random.randint(10, 300),
                    'status': rnd(['PENDING', 'ALLOCATED', 'SORTED', 'SHIPPED']),
                })

    def create_optional(self):
        self.stdout.write('   Optional (cycle counts, replenishments)...')

        # Cycle counts
        for i in range(3):
            cc, _ = CycleCount.objects.get_or_create(
                site=self.primary_site,
                type=rnd(['BIN', 'SKU', 'BLIND']),
                defaults={
                    'scope': ', '.join([b.code for b in random.sample(self.bins, 5)]),
                    'status': rnd(['PLANNED', 'IN_PROGRESS', 'COMPLETED']),
                    'created_by': rnd(self.users),
                }
            )
            for sku in random.sample(self.skus, min(4, len(self.skus))):
                sys_qty = random.randint(50, 200)
                counted = sys_qty + random.randint(-5, 5)
                CycleCountLine.objects.get_or_create(count=cc, sku=sku, defaults={
                    'bin': rnd(self.bins), 'system_qty': sys_qty,
                    'counted_qty': counted, 'variance': counted - sys_qty,
                    'status': 'MATCHED' if counted == sys_qty else 'VARIANCE',
                })

        # Replenishments
        for sku in random.sample(self.skus, 8):
            from_bin = rnd(self.bins)
            to_bin = rnd(self.bins)
            ReplenishmentTask.objects.get_or_create(site=self.primary_site, sku=sku, defaults={
                'from_bin': from_bin, 'to_bin': to_bin,
                'qty': random.randint(10, 100),
                'trigger': rnd(['ALLOCATION', 'THRESHOLD']),
                'status': rnd(['CREATED', 'ASSIGNED', 'DONE']),
                'assigned_to': rnd(self.users),
            })
