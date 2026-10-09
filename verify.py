import os
os.environ['DJANGO_SETTINGS_MODULE'] = 'zippzo_wms.settings'
import django
django.setup()
from django.test import Client
import json

c = Client()
r = json.loads(c.get('/api/network/overview').content)
print(f"WH={r['total_warehouses']}, DS={r['total_dark_stores']}, Total={r['total_sites']}")
print(f"Warehouses: {[w['code'] for w in r['warehouses']]}")
print(f"Dark Stores: {[w['code'] for w in r['dark_stores']]}")
print(f"Total facilities: {len(r['all_facilities'])}")

# Test POST to create a site
r2 = c.post('/api/network/sites/', json.dumps({'code':'TEST-001','site_type':'MH','name':'Test','address':'test','status':'ACTIVE'}), content_type='application/json')
print(f"POST sites: {r2.status_code}")
