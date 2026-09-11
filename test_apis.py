"""
WMS API Test Script
Run with: python test_apis.py
Requires the server to be running on http://localhost:8000
"""
import json
import sys
import urllib.request
import urllib.error

BASE = 'http://localhost:8000/api'
PASS = 0
FAIL = 0

def get(path):
    url = BASE + path
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read())
            return r.status, data
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as ex:
        return 0, {'error': str(ex)}

def check(name, path, expected_min=0):
    global PASS, FAIL
    status, data = get(path)
    count = data.get('count', len(data.get('results', data if isinstance(data, list) else [])))
    ok = status == 200 and count >= expected_min
    icon = 'PASS' if ok else 'FAIL'
    print("  [{}] [{:>3}] {:<45} count={}".format(icon, status, name, count))
    if ok:
        PASS += 1
    else:
        FAIL += 1
        if status != 200:
            print("       Error: {}".format(data))

print("\nZippzo WMS -- API Test Suite")
print("=" * 62)

print("\nPlatform APIs")
check('Users',                '/platform/users/',                1)
check('Reason Codes',         '/platform/reason-codes/',         1)

print("\nMaster Data APIs")
check('Sites',                '/master/sites/',                  1)
check('SKU Categories',       '/master/sku-categories/',         1)
check('SKUs',                 '/master/skus/',                   1)
check('Vendors',              '/master/vendors/',                1)
check('Zones',                '/master/zones/',                  1)
check('Bins',                 '/master/bins/',                   1)
check('Cluster Zones',        '/master/cluster-zones/',          1)
check('Dock Doors',           '/master/dock-doors/',             1)
check('Vehicle Types',        '/master/vehicle-types/',          1)
check('Transporters',         '/master/transporters/',           1)

print("\nInventory APIs")
check('LPNs',                 '/inventory/lpns/',                1)
check('Inventory Lots',       '/inventory/lots/',                1)
check('Inventory Transactions','/inventory/transactions/',       1)
check('Droplists',            '/inventory/droplists/',           1)

print("\nInbound APIs")
check('ASNs',                 '/inbound/asns/',                  1)
check('ASN Lines',            '/inbound/asn-lines/',             1)
check('GRNs',                 '/inbound/grns/',                  1)
check('GRN Lines',            '/inbound/grn-lines/',             1)
check('Putaway Tasks',        '/inbound/putaway-tasks/',         1)
check('Discrepancies',        '/inbound/discrepancies/',         1)

print("\nOutbound APIs")
check('Dispatch Plans',       '/outbound/dispatch-plans/',       1)
check('Batches',              '/outbound/batches/',              1)
check('Orders',               '/outbound/orders/',               1)
check('Order Lines',          '/outbound/order-lines/',          1)
check('Order Allocations',    '/outbound/allocations/',          1)
check('Picklists',            '/outbound/picklists/',            1)
check('Picklist Lines',       '/outbound/picklist-lines/',       1)
check('Sortlists',            '/outbound/sortlists/',            1)
check('Sortlist Lines',       '/outbound/sortlist-lines/',       1)
check('Manifests',            '/outbound/manifests/',            1)
check('Manifest Lines',       '/outbound/manifest-lines/',       1)
check('Cancellation Putaways','/outbound/cancellation-putaways/',1)

print("\nTransport APIs")
check('Trips',                '/transport/trips/',               1)
check('Vehicle Check-ins',    '/transport/vehicle-checkins/',    1)
check('Trip Return Legs',     '/transport/trip-return-legs/',    1)

print("\nCross Dock APIs")
check('XDock Batches',        '/crossdock/batches/',             1)
check('XDock Lines',          '/crossdock/lines/',               1)

print("\nOptional APIs")
check('Cycle Counts',         '/optional/cycle-counts/',         1)
check('Cycle Count Lines',    '/optional/cycle-count-lines/',    1)
check('Replenishments',       '/optional/replenishments/',       1)

print("\n" + "=" * 62)
total = PASS + FAIL
pct = int(PASS / total * 100) if total else 0
print("  Results: {}/{} passed ({}%)".format(PASS, total, pct))
if FAIL == 0:
    print("  All APIs passing!")
else:
    print("  {} APIs failing -- check server logs".format(FAIL))
print("=" * 62 + "\n")
sys.exit(0 if FAIL == 0 else 1)
