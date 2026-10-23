"""Manpower + payroll: the staffing board and the rates that price it.

P2 pins four rules:

  1. /network/payroll/ is admin-only in both directions — pay rates are not
     staff-visible — and creation stamps created_by from the token.
  2. Compensation rows are validated as reference data: positive amount,
     a sane effective window, and no duplicate rate for the same person,
     site, basis and start date.
  3. /network/manpower/ answers "who is rostered where, and who is clocked
     in RIGHT NOW" by joining active EmployeeSiteAssignments to open
     StaffShifts — on_shift only when the open shift matches BOTH the user
     and that assignment's site.
  4. Manpower fences non-admins to their own rows plus their operator sites,
     mirroring StaffShiftViewSet; unlinked seeded rows (employee code with
     no user) stay visible as linked=false staffing gaps.
"""
from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from bounded.iam.models import User
from bounded.network.models import (
    EmployeeCompensation, EmployeeSiteAssignment, Site, StaffShift,
)

API = '/api'


def _mk_user(email, role='SUPER_ADMIN', full_name=''):
    return User.objects.create(
        email=email, password_hash=make_password('Test123!'),
        role=role, status='ACTIVE', full_name=full_name)


def _mk_site(code, name='Pay DS'):
    return Site.objects.create(
        code=code, site_type='DARK_STORE', name=name, address='test')


class PayrollTests(TestCase):
    """EmployeeCompensation CRUD — admin-only, stamped, validated."""

    def setUp(self):
        self.admin = _mk_user('pay-admin@zippzo.in', full_name='Pay Admin')
        self.staff = _mk_user(
            'pay-staff@zippzo.in', role='WAREHOUSE_STAFF', full_name='Staff Sue')
        self.site = _mk_site('DS-PAY')
        self.site2 = _mk_site('DS-PAY2')
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _payload(self, **over):
        base = {
            'user': str(self.staff.user_id),
            'site': str(self.site.site_id),
            'basis': 'MONTHLY',
            'amount': '50000.00',
            'effective_from': '2026-10-01',
        }
        base.update(over)
        return base

    def test_create_stamps_created_by_and_denormalizes(self):
        r = self.client.post(f'{API}/network/payroll/', self._payload(),
                             format='json')
        self.assertEqual(r.status_code, 201, r.data)
        # Server-stamped attribution, not whatever a client might claim.
        self.assertEqual(r.data['created_by'], str(self.admin.user_id))
        self.assertEqual(r.data['user_name'], 'Staff Sue')
        self.assertEqual(r.data['user_email'], 'pay-staff@zippzo.in')
        self.assertEqual(r.data['site_code'], 'DS-PAY')
        row = EmployeeCompensation.objects.get(comp_id=r.data['comp_id'])
        self.assertEqual(row.created_by, str(self.admin.user_id))

    def test_staff_are_denied_both_read_and_write(self):
        c = APIClient()
        c.force_authenticate(user=self.staff)
        self.assertEqual(
            c.get(f'{API}/network/payroll/').status_code, 403)
        self.assertEqual(
            c.post(f'{API}/network/payroll/', self._payload(),
                   format='json').status_code, 403)
        self.assertEqual(
            c.get(f'{API}/network/manpower').status_code, 200,
            'manpower itself is roster data and stays staff-readable')

    def test_non_positive_amount_rejected(self):
        r = self.client.post(f'{API}/network/payroll/',
                             self._payload(amount='0.00'), format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('amount', str(r.data).lower())

    def test_inverted_effective_window_rejected(self):
        r = self.client.post(
            f'{API}/network/payroll/',
            self._payload(effective_from='2026-10-05',
                          effective_to='2026-10-01'),
            format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('effective', str(r.data).lower())

    def test_duplicate_rate_rejected(self):
        first = self.client.post(f'{API}/network/payroll/', self._payload(),
                                 format='json')
        self.assertEqual(first.status_code, 201, first.data)
        again = self.client.post(f'{API}/network/payroll/', self._payload(),
                                 format='json')
        self.assertEqual(again.status_code, 400)
        self.assertEqual(
            EmployeeCompensation.objects.filter(
                user=self.staff, site=self.site).count(), 1)

    def test_filters_site_basis_and_active(self):
        self.client.post(f'{API}/network/payroll/', self._payload(),
                         format='json')
        self.client.post(
            f'{API}/network/payroll/',
            self._payload(basis='HOURLY', amount='250.00',
                          effective_from='2026-09-01'),
            format='json')
        self.client.post(
            f'{API}/network/payroll/',
            self._payload(site=str(self.site2.site_id),
                          effective_from='2026-10-01'),
            format='json')

        r = self.client.get(f'{API}/network/payroll/?site={self.site.site_id}')
        self.assertEqual(r.data['count'], 2)
        r = self.client.get(f'{API}/network/payroll/?basis=HOURLY')
        self.assertEqual(r.data['count'], 1)
        r = self.client.get(
            f'{API}/network/payroll/?site={self.site.site_id}&basis=MONTHLY')
        self.assertEqual(r.data['count'], 1)

    def test_patch_amount_updates_and_keeps_attribution(self):
        created = self.client.post(f'{API}/network/payroll/', self._payload(),
                                   format='json')
        comp_id = created.data['comp_id']
        r = self.client.patch(f'{API}/network/payroll/{comp_id}/',
                              {'amount': '55000.00'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        row = EmployeeCompensation.objects.get(comp_id=comp_id)
        self.assertEqual(row.amount, 55000)
        self.assertEqual(row.created_by, str(self.admin.user_id))


class ManpowerTests(TestCase):
    """Staffing board: active assignments joined to open shifts."""

    def setUp(self):
        self.admin = _mk_user('man-admin@zippzo.in', full_name='Man Admin')
        self.staff = _mk_user(
            'man-staff@zippzo.in', role='WAREHOUSE_STAFF', full_name='Staff Sam')
        self.other = _mk_user(
            'man-other@zippzo.in', role='WAREHOUSE_STAFF', full_name='Other Otta')
        self.site = _mk_site('DS-MAN')
        self.site2 = _mk_site('DS-MAN2')

        self.here = EmployeeSiteAssignment.objects.create(
            employee='MAN01', user=self.staff, site=self.site,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)
        self.unlinked = EmployeeSiteAssignment.objects.create(
            employee='MAN02', user=None, site=self.site,
            mode='DARKHOUSE', role_at_site='PACKER')
        self.inactive = EmployeeSiteAssignment.objects.create(
            employee='MAN03', user=self.other, site=self.site,
            mode='DARKHOUSE', role_at_site='QC', is_active=False)
        self.elsewhere = EmployeeSiteAssignment.objects.create(
            employee='MAN04', user=self.other, site=self.site2,
            mode='DARKHOUSE', role_at_site='PICKER', is_primary=True)

        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _rows(self, response):
        return {r['employee']: r for r in response.data['results']}

    def test_active_rows_with_shift_state(self):
        shift = StaffShift.objects.create(
            user=self.staff, site=self.site, role_at_site='PICKER',
            status='OPEN')
        r = self.client.get(f'{API}/network/manpower')
        self.assertEqual(r.status_code, 200)
        rows = self._rows(r)

        self.assertNotIn('MAN03', rows, 'inactive assignment excluded')
        self.assertEqual(r.data['count'], 3)

        here = rows['MAN01']
        self.assertTrue(here['linked'])
        self.assertTrue(here['on_shift'])
        self.assertEqual(here['shift_id'], str(shift.shift_id))
        self.assertEqual(here['name'], 'Staff Sam')
        self.assertEqual(here['site_code'], 'DS-MAN')

        gap = rows['MAN02']
        self.assertFalse(gap['linked'])
        self.assertFalse(gap['on_shift'])
        self.assertIsNone(gap['shift_id'])
        self.assertEqual(gap['name'], '')

        off = rows['MAN04']
        self.assertFalse(off['on_shift'], 'no open shift for this person')

    def test_on_shift_requires_matching_site(self):
        # Staff is clocked in at the OTHER site: the DS-MAN row must not
        # claim them as on shift there.
        StaffShift.objects.create(
            user=self.staff, site=self.site2, status='OPEN')
        rows = self._rows(self.client.get(f'{API}/network/manpower'))
        self.assertFalse(rows['MAN01']['on_shift'])
        self.assertIsNone(rows['MAN01']['shift_id'])

    def test_site_filter_by_code(self):
        r = self.client.get(f'{API}/network/manpower?site=DS-MAN2')
        rows = self._rows(r)
        self.assertEqual(r.data['count'], 1)
        self.assertIn('MAN04', rows)

    def test_admin_sees_every_site(self):
        r = self.client.get(f'{API}/network/manpower')
        codes = {row['site_code'] for row in r.data['results']}
        self.assertEqual(codes, {'DS-MAN', 'DS-MAN2'})

    def test_staff_fenced_to_own_site_and_rows(self):
        c = APIClient()
        c.force_authenticate(user=self.staff)
        r = c.get(f'{API}/network/manpower')
        self.assertEqual(r.status_code, 200)
        rows = self._rows(r)
        # Their own site's rows (assignment-by-site) ...
        self.assertIn('MAN01', rows)
        self.assertIn('MAN02', rows)
        # ... but not another operator's site.
        self.assertNotIn('MAN04', rows)
        self.assertEqual({row['site_code'] for row in r.data['results']},
                         {'DS-MAN'})
