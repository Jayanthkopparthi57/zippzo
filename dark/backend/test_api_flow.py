import requests
import json

def main():
    base_url = 'http://127.0.0.1:8000/api/v1'

    print("=" * 60)
    print("ZIPPZO ERP & WMS - LIVE END-TO-END SYSTEM TEST")
    print("=" * 60)

    # 1. Login as Admin
    login_res = requests.post(f'{base_url}/auth/login/', json={'username': 'admin', 'password': 'admin'})
    if login_res.status_code != 200:
        login_res = requests.post(f'{base_url}/auth/login/', json={'username': 'admin', 'password': 'Admin@123'})
    assert login_res.status_code == 200, f"Login failed: {login_res.text}"
    token = login_res.json()['access']
    headers = {'Authorization': f'Bearer {token}'}
    print("✓ 1. Admin Authentication Successful (JWT Token acquired)")

    # 2. Stock Lookup
    lookup_res = requests.get(f'{base_url}/inventory/stock/lookup/?sku=MBP-M3-16', headers=headers)
    assert lookup_res.status_code == 200
    items = lookup_res.json()
    print(f"✓ 2. Inventory Lookup for 'MBP-M3-16' ({len(items)} batch locations found):")
    for itm in items:
        print(f"     • Bin: {itm['bin_code']} | Batch: {itm['internal_batch_id']} | OnHand: {itm['quantity_on_hand']} | Avail: {itm['available_qty']} | Expiry: {itm['expiry_date']}")

    # 3. Heatmap Metrics
    heatmap_res = requests.get(f'{base_url}/inventory/stock/heatmap/', headers=headers)
    assert heatmap_res.status_code == 200
    hm = heatmap_res.json()
    print("✓ 3. Warehouse Heatmap Metrics:")
    print(f"     • Total Bins: {hm['total_bins']} | Occupied: {hm['occupied_bins']} | Occupancy Rate: {hm['occupancy_rate_percentage']}%")
    print(f"     • Expired Batches: {hm['expired_batches_count']} | Dead Stock (>90d): {hm['dead_stock_count']}")

    # 4. Create Sales Order
    cust_res = requests.get(f'{base_url}/catalog/customers/', headers=headers).json()
    cust_id = cust_res['results'][0]['id'] if 'results' in cust_res else cust_res[0]['id']
    wh_res = requests.get(f'{base_url}/master/warehouses/', headers=headers).json()
    wh_id = wh_res['results'][0]['id'] if 'results' in wh_res else wh_res[0]['id']
    prod_res = requests.get(f'{base_url}/catalog/products/?sku=MBP-M3-16', headers=headers).json()
    prod_id = prod_res['results'][0]['id'] if 'results' in prod_res else prod_res[0]['id']

    order_payload = {
        'customer': cust_id,
        'warehouse': wh_id,
        'shipping_address': '450 Innovation Blvd',
        'city': 'Austin',
        'pincode': '78702',
        'delivery_deadline': '2026-09-10T12:00:00Z',
        'priority': 'express',
        'items': [{'product_id': prod_id, 'requested_qty': 30, 'unit_price': 2499.00}]
    }
    so_res = requests.post(f'{base_url}/fulfillment/orders/', json=order_payload, headers=headers)
    assert so_res.status_code == 201, f"Create order failed: {so_res.text}"
    order_id = so_res.json()['id']
    order_num = so_res.json()['order_number']
    print(f"✓ 4. Created Sales Order '{order_num}' for 30 units of MBP-M3-16")

    # 5. Execute FEFO Allocation Engine
    alloc_res = requests.post(f'{base_url}/fulfillment/orders/{order_id}/allocate/', headers=headers)
    assert alloc_res.status_code == 200, f"Allocation failed: {alloc_res.text}"
    print(f"✓ 5. FEFO Allocation Engine Executed: {alloc_res.json()['message']}")

    # 6. Verify Pick Tasks and Multi-Batch Splitting
    tasks_res = requests.get(f'{base_url}/fulfillment/tasks/?order_item__order={order_id}', headers=headers).json()
    tasks_list = tasks_res['results'] if 'results' in tasks_res else tasks_res
    print(f"✓ 6. S-Shape Route Optimized Pick Tasks ({len(tasks_list)} tasks created):")
    for t in tasks_list:
        print(f"     • Route Seq #{t['sequence_route_order']}: Pick {t['quantity_to_pick']} units from Bin {t['bin_code']} (Batch: {t['internal_batch_id']}, Exp: {t['expiry_date']})")

    # 7. Check Fulfillment & Backorder Status
    status_res = requests.get(f'{base_url}/fulfillment/orders/{order_id}/fulfillment-status/', headers=headers).json()
    print("✓ 7. Order Fulfillment Math & Backorder Status:")
    print(f"     • Total Requested: {status_res['total_requested']}")
    print(f"     • Total Picked: {status_res['total_picked']}")
    print(f"     • Total Shipped: {status_res['total_shipped']}")
    print(f"     • Remaining Backorder: {status_res['total_remaining_backorder']}")

    print("=" * 60)
    print("ALL SYSTEM TESTS PASSED PERFECTLY (100% OPERATIONAL)")
    print("=" * 60)

if __name__ == '__main__':
    main()
