"""Query parameters the front end sends that the API used to drop.

`filterset_fields = ['status']` builds an *exact* match and nothing else, so a
request for `?status__in=EMPTY,CREATED` matched no declared filter at all.
django-filter ignores unknown parameters rather than erroring, so the call
came back 200 with every row for the site and nobody noticed:

  * the pack screen's "totes to fill" list offered totes that were already
    sealed onto another order, or out with a rider, as if they were empty;
  * the rider handoff counter asked for a handful of live task states and was
    given the store's entire delivery history every 30 seconds.

Both are declared as real `in` filters now. These cases fail loudly if either
declaration is quietly dropped back to an exact-only list.
"""
from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bounded.delivery.models import DeliveryTask
from bounded.iam.models import User
from bounded.inventory.models import LpnMaster
from bounded.network.models import EmployeeSiteAssignment, Site
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder

LPNS = '/api/inventory/lpns/'
TASKS = '/api/delivery/delivery-tasks/'


class FilterBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(
            email='filters-admin@zippzo.in',
            password_hash=make_password('Filters123!'),
            role='SUPER_ADMIN', status='ACTIVE')
        cls.customer_user = User.objects.create(
            email='filters-cust@zippzo.in',
            password_hash=make_password('Filters123!'),
            role='CUSTOMER', status='ACTIVE')

        cls.site = Site.objects.create(
            code='DS-FILTERS', site_type='DARK_STORE', name='Filters DS',
            address='test')
        cls.other_site = Site.objects.create(
            code='DS-FILTERS-OTHER', site_type='DARK_STORE',
            name='Other Filters DS', address='test')
        EmployeeSiteAssignment.objects.create(
            employee='FILTADM01', user=cls.admin, site=cls.site,
            mode='DARKHOUSE', role_at_site='MANAGER', is_primary=True)

        # Two totes at this store the packer is allowed to fill, one that is
        # not, and one empty tote that belongs to somebody else's store.
        cls.empty = LpnMaster.objects.create(
            lpn_id='LPN-FILT-EMPTY', barcode='TOTE-FILT-EMPTY',
            lpn_type='TOTE', current_site=cls.site, status='EMPTY',
            created_by='test')
        cls.created = LpnMaster.objects.create(
            lpn_id='LPN-FILT-CREATED', barcode='TOTE-FILT-CREATED',
            lpn_type='TOTE', current_site=cls.site, status='CREATED',
            created_by='test')
        cls.busy = LpnMaster.objects.create(
            lpn_id='LPN-FILT-BUSY', barcode='TOTE-FILT-BUSY',
            lpn_type='TOTE', current_site=cls.site, status='STAGED',
            created_by='test')
        cls.elsewhere = LpnMaster.objects.create(
            lpn_id='LPN-FILT-OTHER', barcode='TOTE-FILT-OTHER',
            lpn_type='TOTE', current_site=cls.other_site, status='EMPTY',
            created_by='test')

        cls.customer = Customer.objects.create(
            user=cls.customer_user, name='Filters Customer')
        cls.address = CustomerAddress.objects.create(
            customer=cls.customer, label='Home', line1='1 Filter Road',
            pincode='560001', city='Bengaluru')
        cls.order = CustomerOrder.objects.create(
            order_no='ORD-FILTERS-1', customer=cls.customer, site=cls.site,
            address=cls.address, status='PACKED', payment_method='COD',
            payment_status='PENDING', subtotal='10.00', grand_total='10.00',
            placed_at=timezone.now())
        cls.live = DeliveryTask.objects.create(
            order=cls.order, site=cls.site, status='PICKED_UP')
        cls.closed = DeliveryTask.objects.create(
            order=cls.order, site=cls.site, status='DELIVERED')

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def rows(self, url):
        response = self.api.get(url)
        self.assertEqual(200, response.status_code, response.data)
        payload = response.data
        if isinstance(payload, dict) and 'results' in payload:
            return list(payload['results'])
        return list(payload)


class LpnStatusFilterTests(FilterBase):

    def test_an_exact_status_still_works(self):
        got = {r['lpn_id'] for r in self.rows(f'{LPNS}?status=EMPTY')}
        self.assertEqual({self.empty.lpn_id, self.elsewhere.lpn_id}, got)

    def test_status_in_returns_only_the_states_asked_for(self):
        got = {r['lpn_id'] for r in self.rows(f'{LPNS}?status__in=EMPTY,CREATED')}
        self.assertEqual(
            {self.empty.lpn_id, self.created.lpn_id, self.elsewhere.lpn_id},
            got)
        self.assertNotIn(self.busy.lpn_id, got,
                         'status__in was ignored and the busy tote came back')

    def test_the_pack_screen_is_offered_exactly_the_usable_totes(self):
        """The literal URL `emptyLpns()` sends for its tote list."""
        url = (f'{LPNS}?current_site={self.site.site_id}'
               f'&status__in=EMPTY,CREATED&page_size=100')
        got = {r['lpn_id'] for r in self.rows(url)}

        self.assertIn(self.empty.lpn_id, got)
        self.assertIn(self.created.lpn_id, got)
        self.assertNotIn(self.busy.lpn_id, got,
                         'a sealed tote would be offered to the packer')
        self.assertNotIn(self.elsewhere.lpn_id, got,
                         'a tote at another store is not this store\'s to fill')

    def test_status_in_on_a_single_value_is_harmless(self):
        got = {r['lpn_id'] for r in self.rows(f'{LPNS}?status__in=STAGED')}
        self.assertEqual({self.busy.lpn_id}, got)


class DeliveryTaskStatusFilterTests(FilterBase):

    def test_status_in_returns_only_the_states_asked_for(self):
        """The literal shape the handoff counter polls with."""
        url = (f'{TASKS}?site={self.site.site_id}'
               f'&status__in=PICKED_UP,EN_ROUTE,ARRIVED,POD_PENDING'
               f'&page_size=100')
        got = {r['status'] for r in self.rows(url)}
        self.assertEqual({'PICKED_UP'}, got)

    def test_the_closed_jobs_are_not_in_the_live_poll(self):
        url = (f'{TASKS}?site={self.site.site_id}'
               f'&status__in=PICKED_UP,EN_ROUTE,ARRIVED,POD_PENDING'
               f'&page_size=100')
        got = [r['task_id'] for r in self.rows(url)]
        self.assertNotIn(str(self.closed.task_id), got)

    def test_status_in_still_admits_the_closed_side_of_the_queue(self):
        """The same screen shows finished jobs below, in its own request."""
        url = f'{TASKS}?site={self.site.site_id}&status__in=DELIVERED,FAILED&page_size=100'
        got = {r['status'] for r in self.rows(url)}
        self.assertEqual({'DELIVERED'}, got)
