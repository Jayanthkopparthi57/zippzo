"""Seed demo dark-store replenishment data via real backend APIs.

Products (user's example): 500g salt x100, 500g atta x100, 200ml cola x20.
Creates: SKUs -> barcodes -> lots -> transfer order -> pick tasks.
Idempotent: skips anything that already exists.
"""
import os
import json

import _bootstrap

os.environ['DJANGO_SETTINGS_MODULE'] = 'zippzo_wms.settings'
import django

django.setup()
_bootstrap.require_local_database()
from django.test import Client

c = Client()
PICKLIST_ID = '11111111-2222-4333-8444-555555555555'


def get(url):
    r = c.get(url)
    assert r.status_code == 200, f'GET {url} -> {r.status_code}: {r.content[:200]}'
    data = json.loads(r.content)
    if isinstance(data, dict) and isinstance(data.get('results'), list):
        return data['results']
    return data


def post(url, payload):
    r = c.post(url, json.dumps(payload), content_type='application/json')
    body = json.loads(r.content) if r.content else {}
    return r.status_code, body


# --- sites ---
sites = get('/api/network/sites/')
wh = next(s for s in sites if s['code'] == 'WH-BH-001')
ds = next(s for s in sites if s['code'] == 'DS-BH-001')
print(f"WH={wh['code']} DS={ds['code']}")

# --- SKUs ---
wanted = [
    {'sku_code': 'SALT-500G', 'name': 'Tata Salt 500g', 'brand': 'Tata', 'pack_size': '500g',
     'ean': '8901234567001', 'mrp': '28.00'},
    {'sku_code': 'ATTA-500G', 'name': 'Aashirvaad Atta 500g', 'brand': 'Aashirvaad', 'pack_size': '500g',
     'ean': '8901234567002', 'mrp': '42.00'},
    {'sku_code': 'COLA-200ML', 'name': 'Coca-Cola 200ml', 'brand': 'Coca-Cola', 'pack_size': '200ml',
     'ean': '8901234567003', 'mrp': '20.00'},
]
existing_skus = {s['sku_code']: s for s in get('/api/catalog/skus/')}
for w in wanted:
    if w['sku_code'] not in existing_skus:
        st, body = post('/api/catalog/skus/', {
            **w, 'base_uom': 'EACH', 'storage_zone': 'DRY', 'is_food': True, 'status': 'ACTIVE'})
        assert st == 201, f"SKU {w['sku_code']} -> {st}: {body}"
        existing_skus[w['sku_code']] = body
        print(f"SKU created: {w['sku_code']}")
    else:
        print(f"SKU exists: {w['sku_code']}")
skus = existing_skus

# --- barcodes ---
existing_barcodes = {b['barcode'] for b in get('/api/catalog/barcodes/')}
for code, barcode in [('SALT-500G', '8901234567001'), ('ATTA-500G', '8901234567002'), ('COLA-200ML', '8901234567003')]:
    if barcode not in existing_barcodes:
        st, body = post('/api/catalog/barcodes/', {
            'barcode': barcode, 'symbology': 'EAN', 'sku': skus[code]['sku_id'],
            'pack_level': 'EACH', 'qty_in_base': 1, 'is_primary': True, 'is_active': True})
        assert st == 201, f"barcode {barcode} -> {st}: {body}"
        print(f"barcode created: {barcode}")
    else:
        print(f"barcode exists: {barcode}")

# --- lots at warehouse ---
lots = get(f"/api/catalog/lots/?site={wh['site_id']}")
lots_by_sku = {l['sku']: l for l in lots}
for code in ['SALT-500G', 'ATTA-500G', 'COLA-200ML']:
    sid = skus[code]['sku_id']
    if sid not in lots_by_sku:
        st, body = post('/api/catalog/lots/', {
            'sku': sid, 'site': wh['site_id'], 'batch_number': f"B-DEMO-{code}",
            'bucket': 'Good', 'status': 'AVAILABLE'})
        assert st == 201, f"lot {code} -> {st}: {body}"
        print(f"lot created: {code}")
    else:
        print(f"lot exists: {code}")

# --- bins ---
locs = [l for l in get('/api/network/locations/') if str(l['site']) == str(wh['site_id'])]
assert len(locs) >= 3, f'need >=3 locations at WH, found {len(locs)}'
bins = [locs[0]['barcode'], locs[1]['barcode'], locs[2]['barcode']]
print(f"bins: {bins}")

# --- transfer order ---
transfers = get('/api/ds-ops/transfer-orders/')
transfer = next((t for t in transfers
                 if str(t['source_site']) == str(wh['site_id']) and str(t['dest_site']) == str(ds['site_id'])), None)
if transfer is None:
    st, transfer = post('/api/ds-ops/transfer-orders/', {
        'source_site': wh['site_id'], 'dest_site': ds['site_id'],
        'status': 'ALLOCATED', 'total_qty': 220})
    assert st == 201, f"transfer -> {st}: {transfer}"
    print(f"transfer created: {transfer['transfer_id']}")
else:
    print(f"transfer exists: {transfer['transfer_id']}")

# --- pick tasks ---
tasks = get('/api/ds-ops/pick-tasks/')
have = {(t['picklist_id'], t['sku']) for t in tasks}
plan = [('SALT-500G', 100, bins[0]), ('ATTA-500G', 100, bins[1]), ('COLA-200ML', 20, bins[2])]
for code, qty, bin_code in plan:
    sid = skus[code]['sku_id']
    if (PICKLIST_ID, sid) in have:
        print(f"pick task exists: {code}")
        continue
    st, body = post('/api/ds-ops/pick-tasks/', {
        'picklist_id': PICKLIST_ID, 'batch': transfer['transfer_id'],
        'sku': sid, 'bin': bin_code, 'qty': qty,
        'picked_qty': 0, 'status': 'NOT_STARTED'})
    assert st == 201, f"pick task {code} -> {st}: {body}"
    print(f"pick task created: {code} x{qty} @ {bin_code}")

print('SEED DONE')
