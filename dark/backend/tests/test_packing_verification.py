from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from apps.master_data.models import Warehouse, Zone, Location, Category
from apps.catalog.models import Product, Batch, Customer
from apps.fulfillment.models import SalesOrder, OrderItem, PickTask, PickTaskStatusChoices
from apps.packing.models import PackingTask, PackingStatusChoices
from apps.packing.views import PackingTaskViewSet
from rest_framework.test import APIRequestFactory, force_authenticate
from django.contrib.auth.models import User
from apps.hr_tracking.models import Employee

class PackingVerificationTest(TestCase):
    def setUp(self):
        self.warehouse = Warehouse.objects.create(code='WH-PACK', name='Pack Warehouse', city='Austin', state='TX', pincode='78701')
        self.zone = Zone.objects.create(warehouse=self.warehouse, code='Z-PICK', name='Pick Zone')
        self.category = Category.objects.create(warehouse=self.warehouse, code='CAT1', name='Hardware')
        self.location = Location.objects.create(zone=self.zone, aisle='1', rack_number='1', shelf_level='A', bin_code='A1-R1-SA', barcode_label='LOC-001')
        self.customer = Customer.objects.create(customer_code='CUST-PACK', name='Pack Customer', email='pack@test.com', shipping_address='123 Road', city='Austin', pincode='78701')
        
        self.product = Product.objects.create(sku='SKU-PROD-A', barcode='BARCODE-AAA', name='Product A', category=self.category)
        self.batch = Batch.objects.create(product=self.product, internal_batch_id='BAT-AAA-1')
        
        self.order = SalesOrder.objects.create(order_number='SO-PACK-01', customer=self.customer, warehouse=self.warehouse, shipping_address='123 Road', city='Austin', pincode='78701', delivery_deadline=timezone.now() + timedelta(days=2))
        self.order_item = OrderItem.objects.create(order=self.order, product=self.product, requested_qty=2)

        self.pick_task = PickTask.objects.create(
            order_item=self.order_item,
            batch=self.batch,
            source_location=self.location,
            quantity_to_pick=2,
            quantity_picked=2,
            status=PickTaskStatusChoices.COMPLETED
        )

        self.packing_task = PackingTask.objects.create(
            pick_task=self.pick_task,
            order=self.order,
            status=PackingStatusChoices.PENDING
        )

        self.user = User.objects.create_user('packer_jim', 'jim@zippzo.com', 'Pass123')
        self.employee = Employee.objects.create(user=self.user, employee_code='EMP-0099', department='packing')

    def test_packing_scan_verification_and_mismatch(self):
        # 1. Scanned wrong barcode -> should reject and put on mismatch hold
        view = PackingTaskViewSet.as_view({'post': 'verify_scan'})
        factory = APIRequestFactory()

        request = factory.post(f'/api/v1/packing/tasks/{self.packing_task.id}/verify-scan/', {
            'scanned_barcode': 'WRONG-BARCODE-XYZ',
            'box_type': 'Box M'
        }, format='json')
        force_authenticate(request, user=self.user)
        response = view(request, pk=str(self.packing_task.id))
        self.assertEqual(response.status_code, 400)

        self.packing_task.refresh_from_db()
        self.assertEqual(self.packing_task.status, PackingStatusChoices.MISMATCH_HOLD)

        # 2. Scanned correct barcode twice -> should verify
        for _ in range(2):
            req = factory.post(f'/api/v1/packing/tasks/{self.packing_task.id}/verify-scan/', {
                'scanned_barcode': 'BARCODE-AAA',
                'box_type': 'Box M',
                'actual_weight_kg': 1.450
            }, format='json')
            force_authenticate(req, user=self.user)
            resp = view(req, pk=str(self.packing_task.id))
            self.assertEqual(resp.status_code, 200)

        self.packing_task.refresh_from_db()
        self.assertEqual(self.packing_task.status, PackingStatusChoices.VERIFIED)
        self.assertEqual(self.packing_task.scan_verified_qty, 2)
