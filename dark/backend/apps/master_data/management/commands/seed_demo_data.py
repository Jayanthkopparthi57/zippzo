from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta
from apps.authentication.models import UserProfile, UserRole, UserRoleChoices
from apps.hr_tracking.models import Employee, DepartmentChoices
from apps.master_data.models import Warehouse, Category, Zone, ZoneTypeChoices, Location
from apps.catalog.models import Vendor, Customer, Product, Batch
from apps.inventory.models import Inventory, InventoryStatusChoices
from apps.inventory.services import InventoryService

class Command(BaseCommand):
    help = 'Seeds complete demo data for Zippzo ERP & WMS system.'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE("Seeding Zippzo ERP & WMS Demo Data..."))

        # 1. Admin User
        admin_user, created = User.objects.get_or_create(
            username='admin',
            defaults={
                'email': 'admin@zippzo.com',
                'first_name': 'System',
                'last_name': 'Administrator',
                'is_staff': True,
                'is_superuser': True,
                'is_active': True
            }
        )
        if created:
            admin_user.set_password('Admin@123')
            admin_user.save()
            UserProfile.objects.create(user=admin_user, is_approved_by_admin=True, approval_status='approved')
            UserRole.objects.create(user=admin_user, role=UserRoleChoices.ADMIN)
            Employee.objects.create(user=admin_user, employee_code='MGT-0001', department=DepartmentChoices.ADMIN, is_clocked_in=None)

        # 2. Floor Picker User
        picker_user, p_created = User.objects.get_or_create(
            username='picker_raj',
            defaults={
                'email': 'raj@zippzo.com',
                'first_name': 'Raj',
                'last_name': 'Kumar',
                'is_active': True
            }
        )
        if p_created:
            picker_user.set_password('Picker@123')
            picker_user.save()
            UserProfile.objects.create(user=picker_user, is_approved_by_admin=True, approval_status='approved')
            UserRole.objects.create(user=picker_user, role=UserRoleChoices.PICKER)
            Employee.objects.create(user=picker_user, employee_code='EMP-0001', department=DepartmentChoices.PICKING, is_clocked_in=False, forklift_certified=True)

        # 3. Warehouse
        wh, _ = Warehouse.objects.get_or_create(
            code='WH-01',
            defaults={
                'name': 'Austin Central Fulfillment Hub',
                'address_line1': '100 Logistics Parkway',
                'city': 'Austin',
                'state': 'TX',
                'pincode': '78701',
                'country': 'USA'
            }
        )

        # 4. Categories
        cat_elec, _ = Category.objects.get_or_create(warehouse=wh, code='ELEC', defaults={'name': 'Electronics'})
        cat_lap, _ = Category.objects.get_or_create(warehouse=wh, code='LAP', defaults={'name': 'Laptops', 'parent_category': cat_elec})
        cat_furn, _ = Category.objects.get_or_create(warehouse=wh, code='FURN', defaults={'name': 'Office Furniture'})

        # 5. Zones
        z_pick, _ = Zone.objects.get_or_create(warehouse=wh, code='Z-PICK', defaults={'name': 'Pick Face Zone', 'zone_type': ZoneTypeChoices.PICK})
        z_bulk, _ = Zone.objects.get_or_create(warehouse=wh, code='Z-BULK', defaults={'name': 'Bulk Pallet Storage', 'zone_type': ZoneTypeChoices.BULK})
        z_quar, _ = Zone.objects.get_or_create(warehouse=wh, code='Z-QUAR', defaults={'name': 'Quarantine Inbound', 'zone_type': ZoneTypeChoices.QUARANTINE})
        z_pack, _ = Zone.objects.get_or_create(warehouse=wh, code='Z-PACK', defaults={'name': 'Packing Station', 'zone_type': ZoneTypeChoices.PACKING})
        z_ship, _ = Zone.objects.get_or_create(warehouse=wh, code='Z-SHIP', defaults={'name': 'Shipping Bay', 'zone_type': ZoneTypeChoices.SHIPPING})

        # 6. Locations (Bins)
        locations = []
        for aisle in [1, 2]:
            for rack in range(1, 4):
                for shelf in ['A', 'B']:
                    bin_code = f"A{aisle}-R{rack}-S{shelf}"
                    barcode = f"LOC-WH01-{bin_code}"
                    loc, _ = Location.objects.get_or_create(
                        bin_code=bin_code,
                        defaults={
                            'zone': z_pick,
                            'aisle': str(aisle),
                            'rack_number': str(rack),
                            'shelf_level': shelf,
                            'barcode_label': barcode,
                            'max_weight_kg': 500.00,
                            'is_occupied': True
                        }
                    )
                    locations.append(loc)

        # Quarantine Dock Location
        q_loc, _ = Location.objects.get_or_create(
            bin_code='DOCK-Q1',
            defaults={
                'zone': z_quar,
                'aisle': '0',
                'rack_number': '0',
                'shelf_level': '0',
                'barcode_label': 'LOC-WH01-DOCK-Q1'
            }
        )

        # 7. Vendors & Customers
        vendor, _ = Vendor.objects.get_or_create(
            vendor_code='VEND-APPLE',
            defaults={
                'name': 'Apple Direct Wholesale',
                'contact_person': 'Tim Supplier',
                'email': 'wholesale@apple.com',
                'phone': '+1-800-692-7753',
                'currency': 'USD'
            }
        )

        cust, _ = Customer.objects.get_or_create(
            customer_code='CUST-1001',
            defaults={
                'name': 'Acme Global Enterprises',
                'email': 'procurement@acmeglobal.com',
                'phone': '+1-512-555-0199',
                'shipping_address': '450 Innovation Blvd, Suite 200',
                'billing_address': '450 Innovation Blvd, Suite 200',
                'city': 'Austin',
                'pincode': '78702'
            }
        )

        # 8. Products
        p1, _ = Product.objects.get_or_create(
            sku='MBP-M3-16',
            defaults={
                'name': 'MacBook Pro 16" M3 Max 36GB/1TB',
                'category': cat_lap,
                'barcode': '195949012345',
                'uom': 'PCS',
                'gross_weight_kg': 2.160,
                'reorder_point': 10,
                'reorder_quantity': 25
            }
        )

        p2, _ = Product.objects.get_or_create(
            sku='CHAIR-ERG-01',
            defaults={
                'name': 'Herman Miller Aeron Ergonomic Chair',
                'category': cat_furn,
                'barcode': '088765432109',
                'uom': 'PCS',
                'gross_weight_kg': 18.500,
                'reorder_point': 5,
                'reorder_quantity': 15
            }
        )

        # 9. Batches & Inventory
        today = timezone.now().date()
        b1, _ = Batch.objects.get_or_create(
            internal_batch_id='BAT-202609-0001',
            defaults={
                'product': p1,
                'vendor_batch_code': 'APL-LOT-9921',
                'mfg_date': today - timedelta(days=30),
                'expiry_date': today + timedelta(days=365),
                'unit_cost': 2499.00,
                'currency': 'USD'
            }
        )

        b2, _ = Batch.objects.get_or_create(
            internal_batch_id='BAT-202609-0002',
            defaults={
                'product': p1,
                'vendor_batch_code': 'APL-LOT-9922',
                'mfg_date': today - timedelta(days=10),
                'expiry_date': today + timedelta(days=730),
                'unit_cost': 2499.00,
                'currency': 'USD'
            }
        )

        # Populate Inventory in Bins
        inv1, _ = Inventory.objects.get_or_create(
            warehouse=wh,
            batch=b1,
            location=locations[0],
            defaults={'quantity_on_hand': 25, 'quantity_reserved': 0, 'status': InventoryStatusChoices.AVAILABLE}
        )

        inv2, _ = Inventory.objects.get_or_create(
            warehouse=wh,
            batch=b2,
            location=locations[1],
            defaults={'quantity_on_hand': 40, 'quantity_reserved': 0, 'status': InventoryStatusChoices.AVAILABLE}
        )

        # Record Initial Stock Inward Ledger
        InventoryService.record_stock_movement(
            warehouse=wh,
            batch=b1,
            quantity=25,
            transaction_type='GRN_RECEIPT',
            reference_doc_type='SEED',
            reference_doc_id='INIT_SEED',
            dest_location=locations[0],
            notes='Initial Seed Stock'
        )

        self.stdout.write(self.style.SUCCESS("✓ Successfully seeded Zippzo ERP & WMS Demo Data!"))
        self.stdout.write(self.style.SUCCESS("Admin Login: admin / Admin@123"))
        self.stdout.write(self.style.SUCCESS("Picker Login: picker_raj / Picker@123"))
