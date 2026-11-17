"""The shopper's leg, which used not exist.

Every order in this system had been written into the database by hand, so no
code ever checked whether the stock existed before promising it, and no price
was ever decided by the server. These cases pin the four things checkout has to
get right, each of which is a way to sell something that cannot be sold:

  * the price comes from the store's listing, not from the request;
  * the units are reserved in the same transaction, so the last unit on a shelf
    can only be sold once;
  * a short basket leaves nothing behind - no order, no allocation, no event;
  * the buyer is whoever is logged in, not whoever the request body names.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.catalog.models import InventoryLot, Listing, Sku
from bounded.delivery.models import DeliveryTask, RiderProfile
from bounded.ds_ops.allocation import allocations_for_order
from bounded.ds_ops.models import OrderLineAllocation
from bounded.iam.models import User
from bounded.inventory.models import StockBalance
from bounded.network.models import EmployeeSiteAssignment, Location, Site
from bounded.routing.models import DeliveryArea
from bounded.orders.models import (
    Cart, CartLine, Customer, CustomerAddress, CustomerOrder,
    CustomerOrderLine, OrderStatusHistory,
)
from bounded.outbox.models import OutboxEvent

CHECKOUT = '/api/orders/checkout'
STOREFRONT = '/api/orders/storefront'


class CheckoutBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.shopper = User.objects.create(
            email='shopper@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        cls.other = User.objects.create(
            email='nosy@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        cls.staff = User.objects.create(
            email='staffer@zippzo.in', password_hash=make_password('Shop123!'),
            role='WAREHOUSE_STAFF', status='ACTIVE')

        cls.site = Site.objects.create(
            code='DS-SHOP', site_type='DARK_STORE', name='Shop Dark Store',
            address='shop road', is_accepting_orders=True, status='ACTIVE')
        DeliveryArea.objects.create(site=cls.site, pincode='560001', band='CORE')
        DeliveryArea.objects.create(site=cls.site, pincode='560002', band='CORE')
        DeliveryArea.objects.create(site=cls.site, pincode='560003', band='CORE')
        DeliveryArea.objects.create(site=cls.site, pincode='560004', band='CORE')
        cls.warehouse = Site.objects.create(
            code='WH-SHOP', site_type='WAREHOUSE', name='Shop Warehouse',
            address='warehouse road')
        EmployeeSiteAssignment.objects.create(
            employee='SHOPSTAFF', user=cls.staff, site=cls.site,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)

        cls.bin_a = Location.objects.create(
            site=cls.site, location_id='BIN-SHOP-A', location_type='BIN',
            aisle='A1', rack='R1', level='L1', position='P1',
            barcode='BIN-SHOP-A', is_sellable_bin=True, created_by='test')
        cls.bin_b = Location.objects.create(
            site=cls.site, location_id='BIN-SHOP-B', location_type='BIN',
            aisle='B2', rack='R2', level='L2', position='P2',
            barcode='BIN-SHOP-B', is_sellable_bin=True, created_by='test')

        cls.cereal = Sku.objects.create(
            sku_code='SHOP-CEREAL', name='Cereal', sub_category='Grocery',
            brand='Zippzo', pack_size='1', hsn_code='1904', weight_g=400,
            status='ACTIVE', mrp=Decimal('35.00'))
        cls.milk = Sku.objects.create(
            sku_code='SHOP-MILK', name='Milk', sub_category='Dairy',
            brand='Zippzo', pack_size='1', hsn_code='0401', weight_g=1000,
            status='ACTIVE', mrp=Decimal('65.00'))

        # The earliest-expiring cereal batch sits on two shelves with 3 and 2
        # units, so a 4-unit line must span both. A later batch shares a shelf,
        # so choosing the wrong batch is a visible difference rather than a
        # theoretical one.
        cls.cereal_old = InventoryLot.objects.create(
            sku=cls.cereal, site=cls.site, batch_number='LOT-OLD',
            inbound_type='PURCHASE', inbound_ref='PO-1',
            expiry_date=timezone.now().date().replace(day=1))
        cls.cereal_new = InventoryLot.objects.create(
            sku=cls.cereal, site=cls.site, batch_number='LOT-NEW',
            inbound_type='PURCHASE', inbound_ref='PO-2',
            expiry_date=timezone.now().date() + timezone.timedelta(days=90))
        cls.milk_lot = InventoryLot.objects.create(
            sku=cls.milk, site=cls.site, batch_number='LOT-MILK',
            inbound_type='PURCHASE', inbound_ref='PO-3')

        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin_b.location_id,
            sku=cls.cereal, lot=cls.cereal_old, qty=3)
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin_a.location_id,
            sku=cls.cereal, lot=cls.cereal_old, qty=2)
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin_a.location_id,
            sku=cls.cereal, lot=cls.cereal_new, qty=4)
        StockBalance.objects.create(
            site=cls.site, container='BIN', container_ref=cls.bin_a.location_id,
            sku=cls.milk, lot=cls.milk_lot, qty=3)

        Listing.objects.create(sku=cls.cereal, site=cls.site, price=Decimal('30.00'),
                              mrp=Decimal('35.00'), is_listed=True,
                              is_available=True)
        Listing.objects.create(sku=cls.milk, site=cls.site, price=Decimal('60.00'),
                              mrp=Decimal('65.00'), is_listed=True,
                              is_available=True)
        # Priced and stocked, but the store has switched it off. It must not be
        # sellable just because the price row survived.
        cls.biscuit = Sku.objects.create(
            sku_code='SHOP-BISCUIT', name='Biscuit', status='ACTIVE')
        cls.biscuit_lot = InventoryLot.objects.create(
            sku=cls.biscuit, site=cls.site, batch_number='LOT-BIS',
            inbound_type='PURCHASE', inbound_ref='PO-4')
        StockBalance.objects.create(
            site=cls.site, container='BIN',
            container_ref=cls.bin_a.location_id,
            sku=cls.biscuit, lot=cls.biscuit_lot, qty=5)
        Listing.objects.create(sku=cls.biscuit, site=cls.site,
                              price=Decimal('25.00'), mrp=Decimal('30.00'),
                              is_listed=True, is_available=False)

        cls.customer = Customer.objects.create(user=cls.shopper, name='Shopper')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Basket Road',
            pincode='560001', city='Bengaluru', is_default=True)

        cls.other_customer = Customer.objects.create(user=cls.other, name='Nosy')
        cls.other_address = CustomerAddress.objects.create(
            customer=cls.other_customer, label='Home', line1='9 Nosy Road',
            pincode='560002', city='Bengaluru', is_default=True)

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.shopper)

    def basket(self, cereal=1, milk=1):
        items = []
        if cereal:
            items.append({'sku_id': str(self.cereal.sku_id), 'qty': cereal})
        if milk:
            items.append({'sku_id': str(self.milk.sku_id), 'qty': milk})
        return items

    def checkout(self, **overrides):
        payload = {
            'site': self.site.code,
            'address_id': str(self.address.address_id),
            'items': self.basket(),
            'payment_method': 'COD',
        }
        payload.update(overrides)
        return self.api.post(CHECKOUT, payload, format='json')


class CheckoutHappyPathTests(CheckoutBase):

    def test_an_order_is_placed_paid_on_delivery_and_reserved(self):
        response = self.checkout()

        self.assertEqual(201, response.status_code, response.data)
        data = response.data
        self.assertEqual('CONFIRMED', data['status'])
        self.assertEqual('COD', data['payment_method'])

        order = CustomerOrder.objects.get(order_no=data['order_no'])
        self.assertEqual(self.customer, order.customer)
        self.assertEqual(self.site, order.site)
        self.assertEqual(self.address, order.address)
        # Priced by the server: 30 + 60 = 90, plus 20 delivery.
        self.assertEqual(Decimal('90.00'), order.subtotal)
        self.assertEqual(Decimal('20.00'), order.delivery_fee)
        self.assertEqual(Decimal('110.00'), order.grand_total)
        self.assertEqual(2, order.lines.count())

    def test_the_price_comes_from_the_store_not_the_request(self):
        response = self.checkout(items=[
            {'sku_id': str(self.cereal.sku_id), 'qty': 2, 'unit_price': '1.00'},
            {'sku_id': str(self.milk.sku_id), 'qty': 1, 'price': '0.01'},
        ])

        self.assertEqual(201, response.status_code, response.data)
        order = CustomerOrder.objects.get(order_no=response.data['order_no'])
        prices = {l.sku.sku_code: l.unit_price for l in order.lines.all()}
        self.assertEqual(Decimal('30.00'), prices['SHOP-CEREAL'])
        self.assertEqual(Decimal('60.00'), prices['SHOP-MILK'])
        self.assertEqual(Decimal('140.00'), order.grand_total)

    def test_the_earliest_expiring_lot_is_chosen(self):
        response = self.checkout(items=self.basket(cereal=1, milk=0))

        self.assertEqual(201, response.status_code, response.data)
        order = CustomerOrder.objects.get(order_no=response.data['order_no'])
        line = order.lines.get()
        self.assertEqual(self.cereal_old.lot_id, line.lot_id)

    def test_stock_is_reserved_so_a_picker_opens_a_route(self):
        response = self.checkout(items=self.basket(cereal=4, milk=0))

        self.assertEqual(201, response.status_code, response.data)
        order = CustomerOrder.objects.get(order_no=response.data['order_no'])
        line = order.lines.get()

        allocations = allocations_for_order(order)[str(line.line_id)]
        self.assertEqual(4, sum(a.qty for a in allocations))
        # The oldest batch is 3 on one shelf and 2 on the other, so a 4-unit
        # line has to span both bins for the picker to finish it in one walk.
        self.assertEqual({self.bin_a.location_id, self.bin_b.location_id},
                         {a.location_id for a in allocations})
        # Reserved, not moved: the shelves still hold everything they did.
        self.assertEqual(
            9, sum(StockBalance.objects.filter(
                site=self.site, container='BIN', sku=self.cereal
            ).values_list('qty', flat=True)))

    def test_the_history_and_the_event_are_written(self):
        rider_user = User.objects.create(
            email='online-rider@zippzo.in',
            password_hash=make_password('Rider123!'),
            role='RIDER',
            status='ACTIVE',
        )
        rider = RiderProfile.objects.create(
            user=rider_user, name='Online Rider', phone='9000000001',
            vehicle_type='BIKE', kyc_status='VERIFIED', is_online=True,
            current_site=self.site,
        )
        response = self.checkout()

        order = CustomerOrder.objects.get(order_no=response.data['order_no'])
        history = OrderStatusHistory.objects.get(order=order)
        self.assertIsNone(history.from_status)
        self.assertEqual('CONFIRMED', history.to_status)

        event = OutboxEvent.objects.get(event_type='order.placed')
        self.assertEqual(str(order.order_id), event.payload_json['order_id'])
        self.assertEqual('PENDING', event.status)

        picker_event = OutboxEvent.objects.get(event_type='warehouse.pick.assigned')
        self.assertEqual(str(self.staff.user_id), picker_event.payload_json['recipient_user_id'])
        self.assertEqual(str(order.order_id), picker_event.payload_json['order_id'])

        delivery_task = DeliveryTask.objects.get(order=order)
        self.assertEqual(rider.rider_id, delivery_task.rider_id)
        self.assertEqual('ACCEPTED', delivery_task.status)
        rider_event = OutboxEvent.objects.get(event_type='delivery.rider_assigned')
        self.assertEqual(str(rider_user.user_id), rider_event.payload_json['rider_user_id'])
        self.assertEqual(str(order.order_id), rider_event.payload_json['order_id'])

    def test_a_repeated_sku_becomes_one_line(self):
        response = self.checkout(items=[
            {'sku_id': str(self.cereal.sku_id), 'qty': 1},
            {'sku_id': str(self.cereal.sku_id), 'qty': 2},
        ])

        self.assertEqual(201, response.status_code, response.data)
        order = CustomerOrder.objects.get(order_no=response.data['order_no'])
        self.assertEqual(1, order.lines.count())
        self.assertEqual(3, order.lines.get().qty)

    def test_a_basket_is_converted_rather_than_left_active(self):
        cart = Cart.objects.create(customer=self.customer, site=self.site)
        CartLine.objects.create(cart=cart, line_no=1, sku=self.cereal, qty=2,
                                unit_price=Decimal('1.00'))

        response = self.checkout(items=None, cart_id=str(cart.cart_id))

        self.assertEqual(201, response.status_code, response.data)
        cart.refresh_from_db()
        self.assertEqual('CONVERTED', cart.status)
        self.assertEqual(Decimal('60.00'), cart.subtotal)

    def test_an_empty_basket_is_refused(self):
        response = self.checkout(items=[])

        self.assertEqual(400, response.status_code)
        self.assertEqual(0, CustomerOrder.objects.count())

    def test_a_zero_quantity_is_refused_rather_than_silently_dropped(self):
        response = self.checkout(items=[{'sku_id': str(self.cereal.sku_id), 'qty': 0}])

        self.assertEqual(400, response.status_code)
        self.assertEqual(0, CustomerOrder.objects.count())


class CheckoutRefusalTests(CheckoutBase):

    def test_short_stock_is_refused_and_nothing_is_left_behind(self):
        response = self.checkout(items=self.basket(cereal=99))

        self.assertEqual(409, response.status_code)
        self.assertIn('cereal'.lower(), response.data['error'].lower())
        self.assertEqual(0, CustomerOrder.objects.count())
        self.assertEqual(0, OutboxEvent.objects.count())
        # The shelf is untouched: a failed checkout must not have reserved a unit.
        self.assertEqual(9, sum(
            StockBalance.objects.filter(
                site=self.site, container='BIN', sku=self.cereal
            ).values_list('qty', flat=True)))

    def test_an_item_not_listed_at_that_store_is_refused(self):
        ghost = Sku.objects.create(
            sku_code='SHOP-GHOST', name='Ghost', status='ACTIVE')
        Listing.objects.create(sku=ghost, site=self.warehouse,
                              price=Decimal('10.00'), mrp=Decimal('12.00'),
                              is_listed=True, is_available=True)

        response = self.checkout(items=self.basket(cereal=0, milk=0) + [
            {'sku_id': str(ghost.sku_id), 'qty': 1}])

        self.assertEqual(409, response.status_code)
        self.assertIn('unavailable', response.data)
        self.assertEqual(0, CustomerOrder.objects.count())

    def test_an_item_the_store_has_switched_off_is_not_sold(self):
        """Stock on the shelf and a price row are not enough.

        `is_available=False` means the store has taken it off sale. A shopper
        must not be able to buy it, and it must not be advertised.
        """
        response = self.checkout(items=self.basket(cereal=0, milk=0) + [
            {'sku_id': str(self.biscuit.sku_id), 'qty': 1}])

        self.assertEqual(409, response.status_code)
        self.assertIn('unavailable', response.data)
        self.assertEqual(0, CustomerOrder.objects.count())

    def test_an_unlisted_sku_cannot_be_ordered_even_with_stock(self):
        """Same test for a SKU that has stock but no listing at all."""
        ghost = Sku.objects.create(
            sku_code='SHOP-GHOST', name='Ghost', status='ACTIVE')
        lot = InventoryLot.objects.create(
            sku=ghost, site=self.site, batch_number='LOT-GHOST',
            inbound_type='PURCHASE', inbound_ref='PO-5')
        StockBalance.objects.create(
            site=self.site, container='BIN',
            container_ref=self.bin_b.location_id, sku=ghost, lot=lot, qty=4)

        response = self.checkout(items=self.basket(cereal=0, milk=0) + [
            {'sku_id': str(ghost.sku_id), 'qty': 1}])

        self.assertEqual(409, response.status_code)
        self.assertEqual(0, CustomerOrder.objects.count())

    def test_prepaid_is_refused_rather_than_faked(self):
        """PREPAID is not a method this build can honestly settle.

        The enum no longer offers it at all, so a request naming it is turned
        away at the door with the methods that do exist - and, as ever, no
        order is left behind against money that was never taken.
        """
        response = self.checkout(payment_method='PREPAID')

        self.assertEqual(400, response.status_code)
        self.assertIn('payment', response.data['error'].lower())
        self.assertEqual(0, CustomerOrder.objects.count(),
                         'an order was placed against money never taken')

    def test_someone_elses_address_is_refused(self):
        response = self.checkout(address_id=str(self.other_address.address_id))

        self.assertEqual(403, response.status_code)
        self.assertEqual(0, CustomerOrder.objects.count())

    def test_a_warehouse_cannot_take_a_shopper_order(self):
        response = self.checkout(site=self.warehouse.code)

        self.assertEqual(409, response.status_code)
        self.assertIn('dark store', response.data['error'].lower())

    def test_staff_cannot_order_on_a_customers_behalf(self):
        """Staff have no basket and no address, and must not borrow somebody's."""
        self.api.force_authenticate(self.staff)

        response = self.checkout()

        self.assertEqual(403, response.status_code)
        self.assertEqual(0, CustomerOrder.objects.count())

    def test_an_admin_cannot_place_an_order_either(self):
        """An admin has network-wide read access but still owns no basket."""
        admin = User.objects.create(
            email='admin-shop@zippzo.in', password_hash=make_password('Shop123!'),
            role='ADMIN', status='ACTIVE')
        self.api.force_authenticate(admin)

        response = self.checkout()

        self.assertEqual(400, response.status_code)
        self.assertIn('shopper', response.data['error'].lower())
        self.assertEqual(0, CustomerOrder.objects.count())

    def test_a_customer_login_with_no_account_cannot_order(self):
        """A shopper account that was never provisioned has nothing to order as."""
        orphan = User.objects.create(
            email='orphan@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        self.api.force_authenticate(orphan)

        response = self.checkout()

        self.assertEqual(403, response.status_code)
        self.assertIn('customer account', response.data['error'].lower())
        self.assertEqual(0, CustomerOrder.objects.count())

    def test_someone_elses_login_cannot_read_your_basket(self):
        cart = Cart.objects.create(customer=self.customer, site=self.site)
        self.api.force_authenticate(self.other)

        response = self.checkout(items=None, cart_id=str(cart.cart_id))

        self.assertEqual(403, response.status_code)

    def test_ordering_needs_a_login(self):
        self.api.force_authenticate(None)

        response = self.checkout()

        self.assertIn(response.status_code, (401, 403))


class CheckoutReservationTests(CheckoutBase):
    """The last unit on a shelf can only be sold once."""

    def rival_client(self):
        """A second logged-in shopper with a saved address of their own."""
        rival = User.objects.create(
            email=f'rival-{uuid.uuid4().hex[:8]}@zippzo.in',
            password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        rival_customer = Customer.objects.create(user=rival, name='Rival')
        rival_address = CustomerAddress.objects.create(
            customer=rival_customer, label='Home', line1='2 Rival Road',
            pincode='560003', city='Bengaluru', is_default=True)
        client = APIClient()
        client.force_authenticate(rival)
        return client, rival_address

    def last_two_units(self):
        """A SKU with exactly 2 units of one lot on one shelf."""
        sku = Sku.objects.create(
            sku_code=f'SHOP-LAST-{uuid.uuid4().hex[:6]}', name='Last Two',
            sub_category='Grocery', brand='Zippzo', pack_size='1',
            hsn_code='1904', weight_g=200, status='ACTIVE',
            mrp=Decimal('40.00'))
        lot = InventoryLot.objects.create(
            sku=sku, site=self.site, batch_number='LOT-LAST',
            inbound_type='PURCHASE', inbound_ref='PO-LAST',
            expiry_date=timezone.now().date() + timezone.timedelta(days=30))
        Listing.objects.create(
            sku=sku, site=self.site, price=Decimal('40.00'),
            mrp=Decimal('40.00'), is_listed=True, is_available=True)
        StockBalance.objects.create(
            site=self.site, container='BIN',
            container_ref=self.bin_a.location_id, sku=sku, lot=lot, qty=2)
        return sku

    def test_two_shoppers_cannot_both_be_promised_the_same_last_units(self):
        """The reservation has to bind at checkout, not only at picking.

        Two units are on the shelf. The first shopper takes one. Nothing has
        physically moved yet, so the shelf still reads 2 and a naive check would
        happily promise both remaining units to a second order - three promised
        against two that exist. The second checkout has to be refused.
        """
        sku = self.last_two_units()

        first = self.checkout(items=[{'sku_id': str(sku.sku_id), 'qty': 1}])
        self.assertEqual(201, first.status_code, first.data)

        rival_api, rival_address = self.rival_client()
        second = rival_api.post(CHECKOUT, {
            'site': self.site.code,
            'address_id': str(rival_address.address_id),
            'items': [{'sku_id': str(sku.sku_id), 'qty': 2}],
            'payment_method': 'COD',
        }, format='json')

        self.assertEqual(409, second.status_code,
                         f'two orders were promised three units of a two-unit lot: '
                         f'{second.data}')
        self.assertEqual(1, CustomerOrder.objects.count())

        promised = sum(
            OrderLineAllocation.objects.filter(line__sku_id=sku.sku_id)
            .values_list('qty', flat=True))
        self.assertLessEqual(promised, 2, 'more units were allocated than exist')

    def test_two_shoppers_cannot_both_buy_the_last_unit(self):
        first = self.checkout(items=self.basket(cereal=2, milk=0))
        self.assertEqual(201, first.status_code, first.data)

        # 2 left on the shelf, and the first order just took them.
        rival = User.objects.create(
            email='rival@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        rival_customer = Customer.objects.create(user=rival, name='Rival')
        rival_address = CustomerAddress.objects.create(
            customer=rival_customer, label='Home', line1='2 Rival Road',
            pincode='560003', city='Bengaluru', is_default=True)

        self.api.force_authenticate(rival)
        second = self.api.post(CHECKOUT, {
            'site': self.site.code,
            'address_id': str(rival_address.address_id),
            'items': [{'sku_id': str(self.cereal.sku_id), 'qty': 7}],
            'payment_method': 'COD',
        }, format='json')

        self.assertEqual(409, second.status_code)
        self.assertEqual(1, CustomerOrder.objects.count())

    def test_reserved_units_are_not_offered_to_a_second_buyer(self):
        """Reserved is not yet picked, but it is already spoken for.

        Nothing has physically moved, so `StockBalance` still counts the units
        the first order is holding. This test used to assert the raw figure,
        with the reasoning that only a pick takes a unit off the shelf - but
        that made `available` mean "physically present" when a shopper reads it
        as "you may buy this", so the catalogue promised units checkout was
        going to refuse a second later. `available` is now the balance less the
        unpicked remainder every confirmed order has reserved, which is the same
        rule checkout and `allocate_order` enforce. A released order gives its
        units straight back.
        """
        first = self.checkout(items=self.basket(cereal=2, milk=0))
        self.assertEqual(201, first.status_code, first.data)

        storefront = self.api.get(f'{STOREFRONT}?site={self.site.code}&pincode=560001').data
        cereal = next(i for i in storefront['items'] if i['sku_code'] == 'SHOP-CEREAL')
        # 9 physically on the shelf, of which the first order holds 2.
        self.assertEqual(7, cereal['available'])

    def test_fully_reserved_stock_leaves_the_catalogue(self):
        """A shelf every order already owns is not a shelf with stock.

        The catalogue is the shopper's only view of availability. Leaving an
        item listed once all of it is promised invites a checkout that is going
        to be refused, so it drops out the moment the last free unit goes.
        """
        # The earliest batch holds 5 units and the next holds 4, and a single
        # line may not span two batches, so it takes two orders to take them.
        first = self.checkout(items=[
            {'sku_id': str(self.cereal.sku_id), 'qty': 5}])
        self.assertEqual(201, first.status_code, first.data)
        second = self.checkout(items=[
            {'sku_id': str(self.cereal.sku_id), 'qty': 4}])
        self.assertEqual(201, second.status_code, second.data)

        storefront = self.api.get(f'{STOREFRONT}?site={self.site.code}&pincode=560001').data
        codes = {i['sku_code'] for i in storefront['items']}
        self.assertNotIn(
            'SHOP-CEREAL', codes,
            'every cereal unit is reserved but the catalogue still offers it')
        # Milk was never touched, so it stays for sale.
        self.assertIn('SHOP-MILK', codes)

    def test_a_refusal_counts_only_units_nobody_is_holding(self):
        """The number in the refusal is what the shopper could still have got.

        Saying "9 on the shelf" when 5 belong to somebody else's order blames
        the customer for losing a race they were never shown. The refusal
        reports the balance less what other confirmed orders hold - the same
        figure the catalogue and `allocate_order` work from.
        """
        held = self.checkout(items=[
            {'sku_id': str(self.cereal.sku_id), 'qty': 5}])
        self.assertEqual(201, held.status_code, held.data)

        rival = User.objects.create(
            email='late@zippzo.in', password_hash=make_password('Shop123!'),
            role='CUSTOMER', status='ACTIVE')
        rival_customer = Customer.objects.create(user=rival, name='Late')
        rival_address = CustomerAddress.objects.create(
            customer=rival_customer, label='Home', line1='3 Late Road',
            pincode='560004', city='Bengaluru', is_default=True)

        self.api.force_authenticate(rival)
        late = self.api.post(CHECKOUT, {
            'site': self.site.code,
            'address_id': str(rival_address.address_id),
            'items': [{'sku_id': str(self.cereal.sku_id), 'qty': 5}],
            'payment_method': 'COD',
        }, format='json')

        self.assertEqual(409, late.status_code, late.data)
        short = late.data['short_lines'][0]
        # 9 units are physically shelved; 5 of them are the first order's.
        self.assertEqual(4, short['available'])
        self.assertEqual(0, CustomerOrder.objects.count() - 1)


class StorefrontTests(CheckoutBase):

    def test_only_sold_and_stocked_items_are_offered(self):
        response = self.api.get(f'{STOREFRONT}?site={self.site.code}&pincode=560001')

        self.assertEqual(200, response.status_code)
        codes = {i['sku_code'] for i in response.data['items']}
        # Biscuits are stocked and priced but switched off, so they stay out.
        self.assertEqual({'SHOP-CEREAL', 'SHOP-MILK'}, codes)

    def test_prices_come_from_the_listing(self):
        response = self.api.get(f'{STOREFRONT}?site={self.site.code}&pincode=560001').data
        cereal = next(i for i in response['items'] if i['sku_code'] == 'SHOP-CEREAL')

        self.assertEqual('30.00', cereal['price'])
        self.assertEqual(9, cereal['available'])

    def test_an_unlisted_but_stocked_item_is_not_offered(self):
        ghost = Sku.objects.create(
            sku_code='SHOP-GHOST', name='Ghost', status='ACTIVE')
        lot = InventoryLot.objects.create(
            sku=ghost, site=self.site, batch_number='LOT-GHOST',
            inbound_type='PURCHASE', inbound_ref='PO-5')
        StockBalance.objects.create(
            site=self.site, container='BIN',
            container_ref=self.bin_b.location_id, sku=ghost, lot=lot, qty=4)

        response = self.api.get(f'{STOREFRONT}?site={self.site.code}&pincode=560001').data

        self.assertNotIn('SHOP-GHOST', {i['sku_code'] for i in response['items']})

    def test_bad_quality_stock_does_not_inflate_customer_availability(self):
        quarantined = Sku.objects.create(
            sku_code='SHOP-QUARANTINED', name='Quarantined', status='ACTIVE')
        Listing.objects.create(
            sku=quarantined, site=self.site, price=Decimal('10.00'),
            mrp=Decimal('10.00'), is_listed=True, is_available=True)
        lot = InventoryLot.objects.create(
            sku=quarantined, site=self.site, batch_number='LOT-BAD',
            bucket='BAD', inbound_type='PURCHASE', inbound_ref='PO-BAD')
        StockBalance.objects.create(
            site=self.site, container='BIN',
            container_ref=self.bin_a.location_id, sku=quarantined, lot=lot, qty=7)

        response = self.api.get(f'{STOREFRONT}?site={self.site.code}&pincode=560001')

        self.assertEqual(200, response.status_code)
        self.assertNotIn(
            'SHOP-QUARANTINED',
            {item['sku_code'] for item in response.data['items']})

    def test_the_store_is_required(self):
        self.assertEqual(400, self.api.get(STOREFRONT).status_code)


class CustomerDrawerScopingTests(CheckoutBase):
    """A shopper's drawer holds only their own rows.

    The order list had already fenced itself to the caller's own orders. The
    rest of the shopper's data went out unfiltered, so any login could read -
    and on the writable endpoints, rewrite - another person's rows just by
    paging to them or guessing an id. Every case here keeps two shoppers, each
    with their own rows, and asks what the other one can reach.
    """

    ADDRESSES = '/api/orders/addresses/'
    CARTS = '/api/orders/carts/'
    CART_LINES = '/api/orders/cart-lines/'
    ORDER_LINES = '/api/orders/order-lines/'
    HISTORY = '/api/orders/order-history/'
    CUSTOMERS = '/api/orders/customers/'

    @staticmethod
    def _ids(response, key):
        """The values of one field across a list response, paged or not."""
        data = response.data
        rows = data['results'] if isinstance(data, dict) and 'results' in data else data
        return [row[key] for row in rows]

    def setUp(self):
        super().setUp()
        # One order, so the order-line and history cases protect a real row
        # rather than a placeholder, and a basket each so those cases are
        # symmetric instead of one-sided.
        placed = self.checkout()
        self.assertEqual(201, placed.status_code, placed.data)
        self.order = CustomerOrder.objects.get(order_no=placed.data['order_no'])
        self.line = self.order.lines.first()
        self.history = OrderStatusHistory.objects.filter(order=self.order).first()
        self.mine_cart = Cart.objects.create(customer=self.customer, site=self.site)
        self.mine_line = CartLine.objects.create(
            cart=self.mine_cart, line_no=1, sku=self.cereal, qty=2,
            unit_price=Decimal('30.00'))
        self.theirs_cart = Cart.objects.create(
            customer=self.other_customer, site=self.site)

    def test_addresses_are_the_callers_only(self):
        self.api.force_authenticate(self.other)

        listing = self.api.get(self.ADDRESSES)
        detail = self.api.get(f'{self.ADDRESSES}{self.address.address_id}/')

        self.assertEqual(200, listing.status_code, listing.data)
        ids = self._ids(listing, 'address_id')
        self.assertIn(str(self.other_address.address_id), ids)
        self.assertNotIn(str(self.address.address_id), ids)
        self.assertEqual(404, detail.status_code, detail.data)

    def test_baskets_are_the_callers_only(self):
        self.api.force_authenticate(self.other)

        listing = self.api.get(self.CARTS)
        detail = self.api.get(f'{self.CARTS}{self.mine_cart.cart_id}/')

        self.assertNotIn(str(self.mine_cart.cart_id),
                         self._ids(listing, 'cart_id'))
        self.assertEqual(404, detail.status_code, detail.data)

    def test_basket_lines_are_the_callers_only(self):
        self.api.force_authenticate(self.other)

        listing = self.api.get(self.CART_LINES)
        detail = self.api.get(f'{self.CART_LINES}{self.mine_line.id}/')

        self.assertNotIn(str(self.mine_cart.cart_id),
                         self._ids(listing, 'cart'))
        self.assertEqual(404, detail.status_code, detail.data)

    def test_order_lines_are_the_callers_only(self):
        self.api.force_authenticate(self.other)

        listing = self.api.get(self.ORDER_LINES)
        detail = self.api.get(f'{self.ORDER_LINES}{self.line.line_id}/')

        self.assertNotIn(str(self.line.line_id),
                         self._ids(listing, 'line_id'))
        self.assertEqual(404, detail.status_code, detail.data)

    def test_order_history_is_the_callers_only(self):
        self.api.force_authenticate(self.other)

        listing = self.api.get(self.HISTORY)
        detail = self.api.get(f'{self.HISTORY}{self.history.history_id}/')

        # History ids are sequential integers, so they are guessed as often as
        # they are leaked. Both the list and the direct read have to be fenced.
        self.assertNotIn(self.history.history_id,
                         self._ids(listing, 'history_id'))
        self.assertEqual(404, detail.status_code, detail.data)

    def test_the_profile_row_is_the_callers_only(self):
        self.api.force_authenticate(self.other)

        listing = self.api.get(self.CUSTOMERS)
        detail = self.api.get(f'{self.CUSTOMERS}{self.customer.customer_id}/')

        self.assertNotIn(str(self.customer.customer_id),
                         self._ids(listing, 'customer_id'))
        self.assertEqual(404, detail.status_code, detail.data)

    def test_a_staff_login_sees_an_empty_drawer_not_everyones(self):
        """Operators hold no Customer row, and that means none, not all."""
        self.api.force_authenticate(self.staff)

        for path, key in ((self.ADDRESSES, 'address_id'),
                          (self.CARTS, 'cart_id'),
                          (self.ORDER_LINES, 'line_id'),
                          (self.CUSTOMERS, 'customer_id')):
            with self.subTest(path=path):
                response = self.api.get(path)
                self.assertEqual(200, response.status_code, response.data)
                self.assertEqual([], self._ids(response, key),
                                 f'{path} leaked rows to a staff login')

    def test_a_shoppers_drawer_needs_a_login(self):
        self.api.force_authenticate(None)

        for path in (self.ADDRESSES, self.CARTS, self.CART_LINES,
                     self.ORDER_LINES, self.HISTORY, self.CUSTOMERS):
            with self.subTest(path=path):
                self.assertIn(self.api.get(path).status_code, (401, 403))

    def test_a_shopper_cannot_promote_their_own_trust_tier(self):
        """`trust_tier` is a platform judgement about this account."""
        self.api.force_authenticate(self.other)

        response = self.api.patch(
            f'{self.CUSTOMERS}{self.other_customer.customer_id}/',
            {'trust_tier': 'T3', 'name': 'Nosy Two'}, format='json')

        self.other_customer.refresh_from_db()
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual('T0', self.other_customer.trust_tier,
                         'a shopper escalated their own trust tier')
        # A genuine profile edit still lands.
        self.assertEqual('Nosy Two', self.other_customer.name)

    def test_a_new_address_is_filed_under_the_callers_account(self):
        """The body may name another customer; the row must not follow it."""
        self.api.force_authenticate(self.other)

        response = self.api.post(self.ADDRESSES, {
            'customer': str(self.customer.customer_id),
            'label': 'Work', 'line1': '2 Sneak Lane',
            'pincode': '560003', 'city': 'Bengaluru',
        }, format='json')

        self.assertEqual(201, response.status_code, response.data)
        created = CustomerAddress.objects.get(
            address_id=response.data['address_id'])
        self.assertEqual(self.other_customer, created.customer,
                         'an address was filed into somebody else\'s list')

    def test_your_own_address_does_not_open_a_foreign_basket(self):
        """The address check alone used to catch this, which is why it survived:
        the basket itself was never asked whose it was."""
        response = self.checkout(
            items=None, cart_id=str(self.theirs_cart.cart_id))

        self.assertEqual(403, response.status_code, response.data)
        self.assertEqual(1, CustomerOrder.objects.count(),
                         'a basket belonging to another shopper was converted')

    def test_a_basket_line_cannot_point_at_a_foreign_basket(self):
        self.api.force_authenticate(self.other)

        response = self.api.post(self.CART_LINES, {
            'cart': str(self.mine_cart.cart_id),
            'sku': str(self.cereal.sku_id), 'qty': 5,
        }, format='json')

        self.assertEqual(400, response.status_code, response.data)
        self.assertIn('account', str(response.data['cart']).lower())

    def test_a_priced_basket_line_is_not_repriceable_by_its_owner(self):
        """The price comes from the listing, so the client never supplies one."""
        self.api.force_authenticate(self.other)
        their_line = CartLine.objects.create(
            cart=self.theirs_cart, line_no=1, sku=self.cereal, qty=1,
            unit_price=Decimal('30.00'))

        response = self.api.patch(
            f'{self.CART_LINES}{their_line.id}/',
            {'unit_price': '0.01'}, format='json')

        their_line.refresh_from_db()
        self.assertEqual(200, response.status_code, response.data)
        self.assertEqual(Decimal('30.00'), their_line.unit_price)

    def test_an_order_line_cannot_be_re_priced_or_re_quantified(self):
        """Checkout approved these numbers; nobody rewrites them afterwards.

        The line is snapshotted rather than assumed to be a particular SKU:
        `order.lines` is unordered, so which of the two lines comes first is
        not something this case should depend on.
        """
        before = (self.line.qty, self.line.unit_price, self.line.line_total)

        response = self.api.patch(
            f'{self.ORDER_LINES}{self.line.line_id}/',
            {'qty': 1, 'unit_price': '0.01', 'line_total': '0.01'},
            format='json')

        self.line.refresh_from_db()
        self.assertEqual(405, response.status_code, response.data)
        self.assertEqual(
            before, (self.line.qty, self.line.unit_price, self.line.line_total),
            'an order line was re-priced after checkout approved it')


class ShopperOrderCancellationTests(CheckoutBase):

    def test_early_cancellation_releases_reservations_and_records_real_prior_state(self):
        created = self.checkout(items=[{
            'sku_id': str(self.cereal.sku_id), 'qty': 1,
        }])
        self.assertEqual(201, created.status_code, created.data)
        order = CustomerOrder.objects.get(order_no=created.data['order_no'])

        response = self.api.post(
            f'/api/orders/orders/{order.order_id}/cancel/',
            {'reason': 'Changed my mind'}, format='json')

        self.assertEqual(200, response.status_code, response.data)
        order.refresh_from_db()
        self.assertEqual('CANCELLED', order.status)
        history = OrderStatusHistory.objects.get(order=order, to_status='CANCELLED')
        self.assertEqual('CONFIRMED', history.from_status)
        self.assertTrue(
            OrderLineAllocation.objects.filter(order=order, status='RELEASED').exists(),
            'the cancelled order must release its store stock reservation')
