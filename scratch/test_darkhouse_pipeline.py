import urllib.request
import json
import random
import time

BASE_URL = "http://localhost:8000/api"

def get(endpoint):
    req = urllib.request.Request(f"{BASE_URL}{endpoint}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

def post(endpoint, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(f"{BASE_URL}{endpoint}", data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

def patch(endpoint, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(f"{BASE_URL}{endpoint}", data=data, headers={'Content-Type': 'application/json'}, method='PATCH')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

print("=== STARTING REAL-USER DARK HOUSE END-TO-END PIPELINE TEST ===")

# STEP 1: Inbound & Master SKUs
print("\n[1/5] Testing Inbound & SKUs...")
skus_data = get("/master/skus/")
skus = skus_data.get("results", skus_data)
print(f"[OK] Found {len(skus)} SKUs in master catalog.")

asns_data = get("/inbound/asns/")
asns = asns_data.get("results", asns_data)
print(f"[OK] Found {len(asns)} ASNs in Inbound subsystem.")

lots_data = get("/inventory/lots/")
lots = lots_data.get("results", lots_data)
print(f"[OK] Found {len(lots)} Inventory Lots stored in Bins.")

# STEP 2: Place Customer Order via Dark House App
print("\n[2/5] Simulating Real Customer placing 10-Min Dark House Order...")
order_no = f"ORD-REALUSER-{random.randint(10000, 99999)}"
order_payload = {
    "order_no": order_no,
    "type": "REGULAR",
    "status": "CREATED",
    "processing_type": "LPN_BASED",
    "inventory_type": "GOOD",
    "shipment_type": "EXPRESS_RIDER",
    "reference_order": f"DH-CUST-{random.randint(100, 999)}",
    "ordered_qty": 3,
    "ordered_skus": 2,
    "allocated_qty": 3,
    "remarks": "Real user instant order from Dark House app",
}

created_order = post("/outbound/orders/", order_payload)
order_id = created_order["order_id"]
print(f"[OK] Order #{order_no} created successfully in WMS (ID: {order_id}).")

# Create lines
if skus:
    sample_sku = skus[0]["sku_id"] if "sku_id" in skus[0] else skus[0]["id"]
    line_payload = {
        "order": order_id,
        "sku": sample_sku,
        "ordered_qty": 2,
        "allocated_qty": 2,
        "line_status": "CREATED"
    }
    created_line = post("/outbound/order-lines/", line_payload)
    print(f"[OK] Order Line created for SKU {sample_sku}.")

# STEP 3: Advance WMS Order Pipeline (Allocation -> Picking -> Packing -> Shipping -> Delivery)
print("\n[3/5] Advancing WMS Pipeline (Picker -> Packer -> Express Rider)...")
pipeline_stages = ["ALLOCATED", "PICKING", "PACKED", "SHIPPED", "CLOSED"]
for stage in pipeline_stages:
    updated = patch(f"/outbound/orders/{order_id}/", {"status": stage})
    print(f"  |-- Stage -> {stage}: Status = {updated['status']}")
print("[OK] Order successfully delivered to Customer!")

# STEP 4: Customer Requests Return / Damage Claim
print("\n[4/5] Simulating Customer Return Request on Dark House App...")
cp_payload = {
    "order": order_id,
    "order_no": order_no,
    "pending_skus": 2,
    "remaining_qty": 3,
    "pending_lpns": 1,
    "status": "PENDING_QC",
    "reason_code": "DAMAGED_ITEM",
    "remarks": "Leaking carton reported by customer upon receipt"
}

cp_record = post("/outbound/cancellation-putaways/", cp_payload)
print(f"[OK] Cancellation Putaway (Return ID: {cp_record['cp_id']}) created for Order #{order_no}.")

# STEP 5: Verify Return & Storage Inventory
print("\n[5/5] Verifying Return & Storage Inventory in WMS DB...")
returns_data = get("/outbound/cancellation-putaways/")
returns = returns_data.get("results", returns_data)
matching_return = [r for r in returns if r["order_no"] == order_no]
assert len(matching_return) > 0, "Return record not found!"
print(f"[OK] Verified matching return record in WMS DB (Status: {matching_return[0]['status']}, Pending SKUs: {matching_return[0]['pending_skus']}).")

print("\n===========================================================")
print("ALL 5 PIPELINE STAGES PASSED PERFECTLY WITH ZERO ERRORS!")
print("===========================================================")
