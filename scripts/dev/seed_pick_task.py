"""Create one open pick task so the guided pick UI can be verified in a browser.

Without a task the Playwright specs skip, which silently turns "the workflow was
never tested" into a green run.
"""
import os
import sys
import uuid

import _bootstrap

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'zippzo_wms.settings')

import django
django.setup()
_bootstrap.require_local_database()

from bounded.catalog.models import Sku
from bounded.ds_ops.models import PickTask

sku = Sku.objects.first()
if not sku:
    print('NO_SKU: cannot seed a pick task')
    raise SystemExit(1)

existing = PickTask.objects.filter(status__in=['NOT_STARTED', 'IN_PROGRESS']).count()
if existing:
    print(f'OK: {existing} open pick task(s) already present')
    raise SystemExit(0)

task = PickTask.objects.create(
    picklist_id=uuid.uuid4(),
    batch=uuid.uuid4(),
    zone='AMBIENT',
    sku=sku.id,
    qty=3,
    picked_qty=0,
    bin='A-01-02-01',
    status='NOT_STARTED',
)
print(f'OK: created pick task {task.id} for SKU {sku.sku_code} (EAN {sku.ean}) qty=3')
