from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from apps.master_data.models import Warehouse, Zone, Location, Category
from apps.catalog.models import Product, Batch, Customer
from apps.inventory.models import Inventory, InventoryStatusChoices
from apps.fulfillment.models import SalesOrder, OrderItem, PickTaskStatusChoices
from apps.fulfillment.fefo_engine import FEFOAllocationEngine

class FEFOAllocationTest(TestCase):
    def setUp(self):
        self.warehouse = Warehouse.objects.create(code='WH-TEST', name='Test Warehouse', city='Austin', state='TX', pincode='78701')
        self.zone = Zone.objects.create(warehouse=self.warehouse, code='Z-PICK', name='Pick Zone')
        self.category = Category.objects.create(warehouse=self.warehouse, code='CAT1', name='Electronics')
        
        self.loc1 = Location.objects.create(zone=self.zone, aisle='1', rack_number='1', shelf_level='A', bin_code='A1-R1-SA', barcode_label='LOC-001')
        self.loc2 = Location.objects.create(zone=self.zone, aisle='1', rack_number='2', shelf_level='A', bin_code='A1-R2-SA', barcode_label='LOC-002')
        
        self.customer = Customer.objects.create(customer_code='CUST-1', name='Acme Inc', email='acme@test.com', shipping_address='123 Road', city='Austin', pincode='78701')
        self.product = Product.objects.create(sku='SKU-FEFO', barcode='BAR-FEFO-01', name='FEFO Test Product', category=self.category)

        today = timezone.now().date()
        # Batch 1 expires in 30 days (earlier)
        self.batch_expiring_first = Batch.objects.create(
            product=self.product,
            internal_batch_id='BAT-EARLY',
            expiry_date=today + timedelta(days=30),
            unit_cost=100.00
        )
        # Batch 2 expires in 180 days (later)
        self.batch_expiring_later = Batch.objects.create(
            product=self.product,
            internal_batch_id='BAT-LATER',
            expiry_date=today + timedelta(days=180),
            unit_cost=100.00
        )

        # 10 units in Bin 1 (earlier expiry)
        self.inv1 = Inventory.objects.create(
            warehouse=self.warehouse,
            batch=self.batch_expiring_first,
            location=self.loc1,
            quantity_on_hand=10,
            status=InventoryStatusChoices.AVAILABLE
        )
        # 20 units in Bin 2 (later expiry)
        self.inv2 = Inventory.objects.create(
            warehouse=self.warehouse,
            batch=self.batch_expiring_later,
            location=self.loc2,
            quantity_on_hand=20,
            status=InventoryStatusChoices.AVAILABLE
        )

    def test_fefo_picks_earliest_expiry_first(self):
        """Order of 15 units should exhaust all 10 from BAT-EARLY and take remaining 5 from BAT-LATER."""
        order = SalesOrder.objects.create(
            order_number='SO-TEST-001',
            customer=self.customer,
            warehouse=self.warehouse,
            shipping_address='123 Road',
            city='Austin',
            pincode='78701',
            delivery_deadline=timezone.now() + timedelta(days=2)
        )
        order_item = OrderItem.objects.create(order=order, product=self.product, requested_qty=15)

        tasks = FEFOAllocationEngine.allocate_order_items(order.id)
        self.assertEqual(len(tasks), 2)

        # First task should be for earliest expiring batch
        task1 = tasks[0]
        self.assertEqual(task1.batch, self.batch_expiring_first)
        self.assertEqual(task1.quantity_to_pick, 10)

        # Second task should take the remainder
        task2 = tasks[1]
        self.assertEqual(task2.batch, self.batch_expiring_later)
        self.assertEqual(task2.quantity_to_pick, 5)

        # Verify reservations
        self.inv1.refresh_from_db()
        self.inv2.refresh_from_db()
        self.assertEqual(self.inv1.quantity_reserved, 10)
        self.assertEqual(self.inv2.quantity_reserved, 5)
        self.assertEqual(self.inv1.available_qty, 0)
        self.assertEqual(self.inv2.available_qty, 15)
