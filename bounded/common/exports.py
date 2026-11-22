"""Reusable Excel/CSV export for the operational data screens.

Each entry in ``EXPORTERS`` describes one downloadable dataset:

    {
      'label': 'Customer Orders',
      'queryset': lambda request: CustomerOrder.objects.select_related(...),
      'columns': [('Order No', 'order_no'), ('Site', lambda o: o.site.code), ...],
      'date_field': 'placed_at',   # optional; enables from/to filtering
      'admin_only': False,         # optional
    }

The ``ExportView`` (``/api/export/?resource=...&from=...&to=...&format=xlsx``)
turns a registry entry into a downloadable workbook. Add a new dataset by
registering it here - no view or URL changes are required.
"""
import io
from datetime import date, datetime

from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response

from bounded.iam.permissions import IsAdminUser

EXPORTERS = {}


def register(name, **config):
    EXPORTERS[name] = config


def _parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None


def _value(obj, accessor):
    if callable(accessor):
        return accessor(obj)
    for part in str(accessor).split('.'):
        obj = getattr(obj, part, None)
        if obj is None:
            return ''
    return obj


def _build_workbook(rows, columns, title):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = (title or 'Export')[:31]
    fill = PatternFill('solid', fgColor='1F3864')
    font = Font(color='FFFFFF', bold=True)
    for ci, (header, _) in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=ci, value=header)
        cell.fill = fill
        cell.font = font
    for ri, row in enumerate(rows, start=2):
        for ci, (_, accessor) in enumerate(columns, start=1):
            value = _value(row, accessor)
            if isinstance(value, (datetime, date)):
                value = value.isoformat()
            ws.cell(row=ri, column=ci, value=value)
    for ci in range(1, len(columns) + 1):
        ws.column_dimensions[get_column_letter(ci)].width = 20
    ws.freeze_panes = 'A2'
    return wb


def export_response(resource, request):
    config = EXPORTERS[resource]
    queryset = config['queryset'](request)
    date_field = config.get('date_field')
    start = _parse_date(request.GET.get('from'))
    end = _parse_date(request.GET.get('to'))
    if date_field and (start or end):
        filters = {}
        if start:
            filters[f'{date_field}__date__gte'] = start
        if end:
            filters[f'{date_field}__date__lte'] = end
        queryset = queryset.filter(**filters)
    rows = list(queryset[:50000])
    wb = _build_workbook(rows, config['columns'], config.get('label', resource))
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f'{resource}_{date.today().isoformat()}.xlsx'
    response = HttpResponse(
        buf.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


class ExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        resource = (request.GET.get('resource') or '').strip()
        if resource not in EXPORTERS:
            return Response(
                {'error': 'Unknown resource.',
                 'available': sorted(EXPORTERS)},
                status=400,
            )
        config = EXPORTERS[resource]
        if config.get('admin_only') and getattr(request.user, 'role', None) not in IsAdminUser.ADMIN_ROLES:
            return Response({'error': 'Admin access required.'}, status=403)
        return export_response(resource, request)


# ---------------------------------------------------------------------------
# Registry. Keep imports lazy so this module stays importable from anywhere.
# ---------------------------------------------------------------------------

def _sites(request):
    from bounded.network.models import Site
    return Site.objects.all().order_by('code')


def _zones(request):
    from bounded.network.models import Zone
    qs = Zone.objects.select_related('site').all()
    site = request.GET.get('site')
    if site:
        qs = qs.filter(site__code=site)
    return qs.order_by('site__code', 'code')


def _locations(request):
    from bounded.network.models import Location
    qs = Location.objects.select_related('site', 'zone').all()
    site = request.GET.get('site')
    if site:
        qs = qs.filter(site__code=site)
    return qs.order_by('site__code', 'barcode')


def _skus(request):
    from bounded.catalog.models import Sku
    return Sku.objects.select_related('category').all().order_by('sku_code')


def _categories(request):
    from bounded.catalog.models import SkuCategory
    return SkuCategory.objects.all().order_by('name')


def _users(request):
    from bounded.iam.models import User
    return User.objects.all().order_by('email')


def _orders(request):
    from bounded.orders.models import CustomerOrder
    qs = CustomerOrder.objects.select_related('site', 'customer').all()
    site = request.GET.get('site')
    if site:
        qs = qs.filter(site__code=site)
    return qs.order_by('-placed_at')


def _movements(request):
    from bounded.inventory.models import StockMovement
    qs = StockMovement.objects.select_related('site', 'sku').all()
    site = request.GET.get('site')
    if site:
        qs = qs.filter(site__code=site)
    return qs.order_by('-created_at')


def _balances(request):
    from bounded.inventory.models import StockBalance
    qs = StockBalance.objects.select_related('site', 'sku').all()
    site = request.GET.get('site')
    if site:
        qs = qs.filter(site__code=site)
    return qs.order_by('site__code', 'sku__sku_code')


register('sites', label='Sites', queryset=_sites, date_field='created_at',
         columns=[('Site ID', 'site_id'), ('Code', 'code'), ('Type', 'site_type'),
                  ('Name', 'name'), ('Address', 'address'), ('Status', 'status'),
                  ('Created', 'created_at')])

register('zones', label='Zones', queryset=_zones,
         columns=[('Zone ID', 'zone_id'), ('Site', lambda z: z.site.code),
                  ('Code', 'code'), ('Category', 'category'),
                  ('Type', 'zone_type'), ('Value Type', 'value_type'),
                  ('Max Commingle', 'max_commingled'), ('Status', 'status')])

register('locations', label='Storage Bins', queryset=_locations, date_field='created_at',
         columns=[('Location ID', 'location_id'), ('Site', lambda l: l.site.code),
                  ('Type', 'location_type'), ('Zone', lambda l: l.zone.code if l.zone else ''),
                  ('Category', 'category'), ('Aisle', 'aisle'), ('Rack', 'rack'),
                  ('Level', 'level'), ('Position', 'position'), ('Barcode', 'barcode'),
                  ('Capacity', 'capacity_qty'), ('Sellable', 'is_sellable_bin'),
                  ('Active', 'is_active'), ('Created', 'created_at')])

register('skus', label='SKUs', queryset=_skus, date_field='created_at',
         columns=[('SKU Code', 'sku_code'), ('Name', 'name'),
                  ('Category', lambda s: s.category.name if s.category else ''),
                  ('Sub-Category', 'sub_category'), ('Brand', 'brand'),
                  ('MRP', 'mrp'), ('Storage Zone', 'storage_zone'),
                  ('Status', 'status'), ('Created', 'created_at')])

register('sku-categories', label='SKU Categories', queryset=_categories,
         columns=[('Category ID', 'category_id'), ('Name', 'name'),
                  ('Parent', lambda c: c.parent.name if c.parent else ''),
                  ('Description', 'description')])

register('users', label='Users', queryset=_users, date_field='created_at', admin_only=True,
         columns=[('User ID', 'user_id'), ('Email', 'email'), ('Name', 'full_name'),
                  ('Phone', 'phone'), ('Role', 'role'), ('Status', 'status'),
                  ('Created', 'created_at')])

register('orders', label='Customer Orders', queryset=_orders, date_field='placed_at',
         columns=[('Order No', 'order_no'), ('Customer', lambda o: o.customer.name if o.customer else ''),
                  ('Site', lambda o: o.site.code if o.site else ''),
                  ('Status', 'status'), ('Payment', 'payment_method'),
                  ('Payment Status', 'payment_status'), ('Grand Total', 'grand_total'),
                  ('Placed', 'placed_at'), ('Delivered', 'delivered_at')])

register('stock-movements', label='Stock Movements', queryset=_movements, date_field='created_at',
         columns=[('Entry ID', lambda m: str(m.entry_id)), ('Site', lambda m: m.site.code if m.site else ''),
                  ('SKU', lambda m: m.sku.sku_code if m.sku else ''),
                  ('Qty', 'qty'), ('Type', 'movement_type'), ('Reference', 'movement_ref'),
                  ('Sellable Delta', 'sellable_delta'), ('Created', 'created_at')])

register('stock-balances', label='Stock Balances', queryset=_balances,
         columns=[('Site', lambda b: b.site.code if b.site else ''),
                  ('SKU', lambda b: b.sku.sku_code if b.sku else ''),
                  ('Container', 'container'), ('Container Ref', 'container_ref'),
                  ('Qty', 'qty'), ('Sellable', 'sellable'), ('Updated', 'updated_at')])
