import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'zippzo_wms.settings')
os.environ['DJANGO_ALLOW_ASYNC'] = 'true'
os.environ['DJANGO_ALLOW_ASYNC_UNSAFE'] = 'true'

django.setup()

from wms_master.models import Site
print('=== SITES ===')
for s in Site.objects.all():
    print(f'Site: {s.code} type={s.type} parent={s.parent_site.code if s.parent_site else None} status={s.status}')

print('\n=== WAREHOUSES ===')
from dark.backend.apps.master_data.models import Warehouse
for w in Warehouse.objects.all():
    print(f'Warehouse: {w.code} is_dark_store={w.is_dark_store} parent={w.parent_hub.code if w.parent_hub else None}')

print('\n=== USERS ===')
from wms_platform.models import User
for u in User.objects.all()[:5]:
    print(f'User: {u.user_id} emp_code={u.emp_code} name={u.name} role={u.role} site={u.site_id.code if u.site_id else None} status={u.status}')

print('\n=== EMPLOYEES ===')
from dark.backend.apps.hr_tracking.models import Employee
for e in Employee.objects.all()[:5]:
    print(f'Employee: {e.employee_code} user={e.user.user_id if e.user else None} dept={e.department} shift={e.shift_start}-{e.shift_end} clocked={e.is_clocked_in}')