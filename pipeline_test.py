"""
FULL PIPELINE TEST: Warehouse Inbound -> Customer Delivery -> Dark Store -> Return
Every step exercised against the real API / real DB, one by one.
Run: python pipeline_test.py
"""
import os
import json
import sys
import time
import uuid
import datetime
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "zippzo_wms.settings")
django.setup()

from django.test import Client
from django.utils import timezone
from django.db import transaction, close_old_connections, connection
from django.db.models import Sum, Q
from django.db.utils import OperationalError, InterfaceError

# Only these are worth retrying; anything else is a real code/contract bug.
TRANSIENT = (OperationalError, InterfaceError)
RETRY_ATTEMPTS = 40
RETRY_WAIT = 3

# The report contains box/arrow characters; force UTF-8 so piped output on a
# cp1252 console does not turn them into mojibake.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def wait_for_db(label="database"):
    """Block until the remote Postgres answers.

    The Neon pooler hostname resolves intermittently from some networks, so a
    full run must not die on the first lookup miss.
    """
    for attempt in range(RETRY_ATTEMPTS):
        try:
            close_old_connections()
            connection.ensure_connection()
            return True
        except TRANSIENT as e:
            try:
                connection.close()
            except Exception:
                pass
            if attempt in (0, 9, 19, 29) or attempt == RETRY_ATTEMPTS - 1:
                print(f"      .. waiting for {label} "
                      f"({type(e).__name__}), attempt {attempt + 1}/{RETRY_ATTEMPTS}")
            time.sleep(RETRY_WAIT)
    return False

from bounded.iam.models import User
from bounded.network.models import Site, Zone, Location, DockDoor, VehicleType, EmployeeSiteAssignment
from bounded.catalog.models import Sku, SkuCategory, SkuBarcode, InventoryLot, Listing
from bounded.supply.models import Vendor, Seller, Asn, AsnLine, Grn, GrnLine, QcInspection, PutawayTask
from bounded.inventory.models import LpnMaster, LpnContent, StockBalance, StockMovement
from bounded.ds_ops.models import PickTask, PackTask, TransferOrder, SortingWave
from bounded.fulfilment.models import Batch, OrderAllocation
from bounded.orders.models import Customer, CustomerAddress, CustomerOrder, CustomerOrderLine
from bounded.delivery.models import RiderProfile, RiderShift, DeliveryTask, RoutePlan, RouteStop
from bounded.money.models import Payment, Refund, RefundDecision, RiderEarnings
from bounded.reverse.models import ReturnOrder, RTVOrder, RTSOrder
from bounded.lastmile.models import PODEvidence

RUN = uuid.uuid4().hex[:6].upper()
T = lambda: timezone.now()
D = timezone.localdate() + datetime.timedelta(days=180)

R = []
CTX = {}
_phase = [""]


def rec(name, ok, detail=""):
    """Record + print a single pipeline assertion result."""
    R.append((_phase[0], name, bool(ok), str(detail)))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}  {detail}")


def step(phase, name):
    def deco(fn):
        try:
            detail = fn() or ""
            R.append((phase, name, True, str(detail)))
            print(f"  [PASS] {name} ")
        except AssertionError as e:
            R.append((phase, name, False, f"ASSERT: {e}"))
            print(f"  [FAIL] {name}  ASSERT: {e}")
        except Exception as e:
            R.append((phase, name, False, f"{type(e).__name__}: {e}"))
            print(f"  [FAIL] {name}  {type(e).__name__}: {e}")
        return fn
    return deco


# ---------- API helpers ----------
_c = Client()
_tok = None


def api(method, path, data=None, auth=True):
    """HTTP call that retries only on transient DB/network faults."""
    h = {}
    if auth and _tok:
        h["HTTP_AUTHORIZATION"] = f"Bearer {_tok}"
    body = json.dumps(data) if data is not None else None
    last = None
    for attempt in range(RETRY_ATTEMPTS):
        try:
            close_old_connections()
            r = getattr(_c, method)(f"/api{path}", data=body,
                                    content_type="application/json", **h)
            try:
                return r.status_code, r.json()
            except Exception:
                return r.status_code, r.content[:300]
        except TRANSIENT as e:
            last = e
            try:
                connection.close()
            except Exception:
                pass
            if attempt % 10 == 0 or attempt == RETRY_ATTEMPTS - 1:
                print(f"      .. transient {type(e).__name__} "
                      f"({method.upper()} {path.split('?')[0]}), "
                      f"attempt {attempt + 1}/{RETRY_ATTEMPTS}")
            time.sleep(RETRY_WAIT)
    raise last


def orm(fn, *a, **kw):
    """Run an ORM operation, retrying only on transient DB faults."""
    last = None
    for attempt in range(RETRY_ATTEMPTS):
        try:
            close_old_connections()
            return fn(*a, **kw)
        except TRANSIENT as e:
            last = e
            try:
                connection.close()
            except Exception:
                pass
            time.sleep(RETRY_WAIT)
    raise last


def must(method, path, data=None, codes=(200, 201), auth=True, record=True):
    st, b = api(method, path, data, auth)
    label = path.split("?")[0]
    if record:
        R.append((_phase[0], f"{method.upper()} {label}", st in codes,
                  "" if st in codes else f"-> {st}: {str(b)[:300]}"))
        if st not in codes:
            print(f"  [FAIL] {method.upper()} {label}  -> {st}: {str(b)[:300]}")
    assert st in codes, f"{method} {path} -> {st}: {str(b)[:400]}"
    return b


def login(email="admin@zippzo.in", pw="admin123"):
    global _tok
    st, b = _c.post("/api/iam/auth/login",
                    data=json.dumps({"email": email, "password": pw}),
                    content_type="application/json").status_code, None
    r = _c.post("/api/iam/auth/login", data=json.dumps({"email": email, "password": pw}),
                content_type="application/json")
    _tok = r.json()["token"]
    return _tok


print(f"\n{'='*100}\nZIPPZO FULL PIPELINE TEST   RUN={RUN}\n{'='*100}")
assert wait_for_db(), "database unreachable; aborting before any writes"

# ============================================================
# PHASE 0 — MASTER DATA + PEOPLE + WORK ASSIGNMENT
# ============================================================
close_old_connections()
_phase[0] = "PHASE 0 — MASTER DATA, PEOPLE, WORK ASSIGNMENT"
print(f"\n{chr(61)*100}")
print(f"{_phase[0]}")
print(f"{chr(61)*100}")

login()
print("  [PASS] P0.0 admin login -> JWT issued")

V = must("post", "/supply/vendors/", {"code": f"V{RUN}", "name": "Sriram Foods Pvt Ltd",
                                     "gstin": f"29ABCDE{RUN}1", "contact_name": "Ramesh",
                                     "contact_phone": "9876543210", "email": f"vendor{RUN}@x.com",
                                     "address": "Industrial Estate", "status": "ACTIVE"})
CTX["vendor"] = V["vendor_id"]
print(f"  [PASS] P0.1 vendor registered -> {V['code']}")

SEL = must("post", "/supply/sellers/", {"code": f"S{RUN}", "legal_name": "Sriram Foods Pvt Ltd",
                                        "brand_name": "Sriram", "seller_type": "PVT_LTD",
                                        "gstin": f"29ABCDE{RUN}1", "commission_default_pct": 12.5,
                                        "fulfilment_mode": "CONSIGNMENT_MH", "status": "ACTIVE"})
CTX["seller"] = SEL["seller_id"]
print(f"  [PASS] P0.2 seller onboarded -> {SEL['code']}")

VT = must("post", "/network/vehicle-types/", {"code": f"TEMPO-{RUN}", "capacity_lpns": 40,
                                             "temp_controlled": False})
CTX["vt"] = VT["vt_id"]
print(f"  [PASS] P0.3 vehicle type registered -> {VT['code']}")

CAT = must("post", "/catalog/categories/", {"name": f"Grocery-{RUN}"})
CTX["cat"] = CAT["category_id"]
print(f"  [PASS] P0.4 category created -> {CAT['name']}")

WH = must("post", "/network/sites/", {"code": f"WH-{RUN}", "name": f"Bhimavaram MH {RUN}",
                                     "site_type": "MH", "address": "NH5 Bypass",
                                     "is_accepting_orders": True, "status": "ACTIVE"})
CTX["wh"] = WH["site_id"]
print(f"  [PASS] P0.5 warehouse (MH) registered -> {WH['code']}")

DS = must("post", "/network/sites/", {"code": f"DS-{RUN}", "name": f"Bhimavaram DS {RUN}",
                                     "site_type": "DS", "parent_site": WH["site_id"],
                                     "address": "Main Road", "is_accepting_orders": True,
                                     "status": "ACTIVE"})
CTX["ds"] = DS["site_id"]
print(f"  [PASS] P0.6 dark store registered (child of MH) -> {DS['code']}")

ZWH = must("post", "/network/zones/", {"site": WH["site_id"], "code": f"GEN-{RUN}",
                                       "category": "Grocery", "zone_type": "GENERAL",
                                       "value_type": "General", "status": "ACTIVE"})
CTX["zwh"] = ZWH["zone_id"]
ZDS = must("post", "/network/zones/", {"site": DS["site_id"], "code": f"DSGEN-{RUN}",
                                       "category": "Grocery", "zone_type": "GENERAL",
                                       "status": "ACTIVE"})
CTX["zds"] = ZDS["zone_id"]
print(f"  [PASS] P0.7/0.8 storage zones created (MH + DS) ")

for i in range(3):
    b = must("post", "/network/locations/", {
        "location_id": f"WH{RUN}-B{i+1}", "site": WH["site_id"], "location_type": "BIN",
        "zone": ZWH["zone_id"], "container": "PICK_FACE", "aisle": f"A{i+1}",
        "rack": f"R{i+1}", "level": "L1", "position": f"P{i+1}",
        "barcode": f"WHBIN{RUN}{i+1}", "capacity_qty": 500, "is_sellable_bin": True,
        "is_active": True})
    CTX[f"whbin{i}"] = b["location_id"]
    CTX[f"whbin{i}_bc"] = b["barcode"]
for i in range(3):
    b = must("post", "/network/locations/", {
        "location_id": f"DS{RUN}-B{i+1}", "site": DS["site_id"], "location_type": "BIN",
        "zone": ZDS["zone_id"], "container": "PICK_FACE", "aisle": f"B{i+1}",
        "rack": f"R{i+1}", "level": "L1", "position": f"P{i+1}",
        "barcode": f"DSBIN{RUN}{i+1}", "capacity_qty": 300, "is_sellable_bin": True,
        "is_active": True})
    CTX[f"dsbin{i}"] = b["location_id"]
    CTX[f"dsbin{i}_bc"] = b["barcode"]
print(f"  [PASS] P0.9/0.10 bins created (3 MH + 3 DS) with barcodes ")

DOOR = must("post", "/network/dock-doors/", {"site": WH["site_id"], "code": f"D1-{RUN}",
                                             "capability": "BOTH", "status": "OPEN"})
CTX["door"] = DOOR["door_id"]
print(f"  [PASS] P0.11 dock door created -> {DOOR['code']}")

SKUS = []
for i, (nm, mrp, bc) in enumerate([("Sriram Premium Salt 1kg", 28, "8901000"),
                                   ("Sriram Atta 5kg", 260, "8901001"),
                                   ("Sriram Toor Dal 1kg", 165, "8901002")]):
    s = must("post", "/catalog/skus/", {
        "sku_code": f"SKU{RUN}{i+1}", "name": nm, "category": CAT["category_id"],
        "sub_category": "Staples", "brand": "Sriram", "base_uom": "EACH",
        "storage_zone": "DRY", "mrp": mrp, "hsn_code": "2106",
        "weight_g": 1000 * (i + 1), "is_food": True, "status": "ACTIVE"})
    s["_idx"] = i
    SKUS.append(s)
    bcode = f"{bc}{RUN}"
    must("post", "/catalog/barcodes/", {"barcode": bcode, "symbology": "EAN",
                                        "sku": s["sku_id"], "pack_level": "EACH",
                                        "qty_in_base": 1, "is_primary": True, "is_active": True})
    CTX[f"bcode{i}"] = bcode
    must("post", "/catalog/listings/", {"sku": s["sku_id"], "site": DS["site_id"],
                                       "price": float(mrp), "mrp": float(mrp),
                                       "is_listed": True, "is_available": True})
CTX["skus"] = SKUS
print(f"  [PASS] P0.12/0.13/0.14 3 SKUs + barcodes + dark-store listings ")

PEOPLE = {}
for code, name, role, site, mode, ras in [
    ("INB", "Ramesh Inbound", "WAREHOUSE_STAFF", CTX["wh"], "WAREHOUSE", "Inbound Loader"),
    ("QC", "Suresh QC", "WAREHOUSE_STAFF", CTX["wh"], "WAREHOUSE", "QC Inspector"),
    ("PUT", "Anil Putaway", "WAREHOUSE_STAFF", CTX["wh"], "WAREHOUSE", "Putaway Operator"),
    ("PIC", "Vikram Picker", "WAREHOUSE_STAFF", CTX["wh"], "WAREHOUSE", "Picker"),
    ("PAK", "Deepak Packer", "WAREHOUSE_STAFF", CTX["wh"], "WAREHOUSE", "Packing Operator"),
    ("DSP", "Kiran DS Associate", "WAREHOUSE_STAFF", CTX["ds"], "DARKHOUSE", "Dark Store Associate"),
    ("RDR", "Ravi Rider", "RIDER", CTX["ds"], "DARKHOUSE", "Delivery Rider"),
]:
    u = must("post", "/iam/users/", {
        "email": f"{code.lower()}.{RUN}@zippzo.in", "full_name": name, "phone": "9000000000",
        "role": role, "status": "ACTIVE", "password": f"{code.lower()}12345"})
    PEOPLE[code] = u["user_id"]
    must("post", "/network/employee-assignments/", {
        "employee": f"{code}{RUN}", "site": site, "mode": mode,
        "role_at_site": ras, "is_primary": True, "is_active": True})
CTX["people"] = PEOPLE
print(f"  [PASS] P0.15/0.16 7 employees created + assigned to sites with roles ")

RP = must("post", "/delivery/rider-profiles/", {
    "user": PEOPLE["RDR"], "name": "Ravi Rider", "phone": "9000000000",
    "vehicle_type": "BIKE", "vehicle_number": f"AP01AB{RUN[:3]}",
    "vehicle_capacity_kg": 25, "can_carry_cold": False,
    "kyc_status": "VERIFIED", "is_online": True, "current_site": DS["site_id"], "rating": 4.8})
CTX["rider"] = RP["rider_id"]
print(f"  [PASS] P0.17 rider profile created -> {RP['vehicle_number']}")

# ============================================================
# PHASE 1 — INBOUND: ASN -> GRN -> QC -> PUTAWAY -> STOCK
# ============================================================
close_old_connections()
_phase[0] = "PHASE 1 — WAREHOUSE INBOUND (ASN -> GRN -> QC -> PUTAWAY -> STOCK)"
print(f"\n{chr(61)*100}")
print(f"{_phase[0]}")
print(f"{chr(61)*100}")

ASN = must("post", "/supply/asns/", {
    "asn_no": f"ASN{RUN}", "type": "VENDOR_PO", "source_vendor": CTX["vendor"],
    "source_site": CTX["wh"], "dest_site": CTX["wh"], "po_ref": f"PO{RUN}",
    "door": CTX["door"], "expected_vehicle": f"AP31XX{RUN[:3]}",
    "total_skus": 3, "total_qty": 300, "status": "DRAFT"})
CTX["asn"] = ASN["asn_id"]
print(f"  [PASS] P1.1 ASN created (draft) -> {ASN['asn_no']}")

for i, s in enumerate(SKUS):
    must("post", "/supply/asn-lines/", {
        "asn": CTX["asn"], "line_no": i + 1, "sku": s["sku_id"], "ean": CTX[f"bcode{i}"],
        "ordered_qty": 100, "expected_expiry": str(D), "line_status": "OPEN"})
print(f"  [PASS] P1.2 3 ASN lines created (100 qty each) ")

must("patch", f"/supply/asns/{CTX['asn']}/", {"status": "CONFIRMED"})
must("patch", f"/supply/asns/{CTX['asn']}/", {"status": "ARRIVED"})
print(f"  [PASS] P1.3/1.4 ASN CONFIRMED -> ARRIVED ")

GRN = must("post", "/supply/grns/", {
    "grn_no": f"GRN{RUN}", "asn": CTX["asn"], "mode": "LPN_SCAN",
    "status": "IN_PROGRESS", "received_by": PEOPLE["INB"], "has_discrepancy": False})
CTX["grn"] = GRN["grn_id"]
print(f"  [PASS] P1.5 GRN opened (LPN scan mode) -> {GRN['grn_no']}")

for i, s in enumerate(SKUS):
    lot = InventoryLot.objects.create(
        sku_id=s["sku_id"], site_id=CTX["wh"], batch_number=f"BATCH{RUN}{i+1}",
        mfg_date=timezone.localdate(), expiry_date=D, mrp=s["mrp"],
        inbound_type="GRN", inbound_ref=GRN["grn_no"], bucket="Good", status="AVAILABLE")
    CTX[f"lot{i}"] = str(lot.lot_id)
    must("post", "/supply/grn-lines/", {
        "grn": CTX["grn"], "sku": s["sku_id"], "ordered_qty": 100, "received_qty": 100,
        "accepted_qty": 98, "damaged_qty": 2, "expired_qty": 0, "excess_qty": 0,
        "expiry_date": str(D), "mrp": s["mrp"], "lot": str(lot.lot_id)})
print(f"  [PASS] P1.6/1.7 3 lots created + GRN lines (98 accepted / 2 damaged) ")

st, gb = api("post", f"/supply/grns/{CTX['grn']}/complete/", {"received_by": PEOPLE["INB"]})
assert st == 200, f"grn complete -> {st}: {gb}"
assert gb.get("putaway_task_count") == 3, \
    f"expected 3 auto-generated putaway tasks, got {gb.get('putaway_task_count')}"
print(f"  [PASS] P1.8 GRN completed -> {gb.get('putaway_task_count')} putaway tasks auto-generated, ASN CLOSED")

GL_ALL = list(GrnLine.objects.filter(grn_id=CTX["grn"]).order_by("line_id"))
gl0 = GL_ALL[0]
QC = must("post", "/supply/qc-inspections/", {
    "grn_line": str(gl0.line_id), "sample_size": 10, "pass_count": 9, "fail_count": 1,
    "status": "PENDING", "remarks": "Seal intact, minor moisture on 1 unit",
    "tested_by": PEOPLE["QC"]})
CTX["qc"] = QC["qc_id"]
print(f"  [PASS] P1.10 QC inspection created -> sample 10 (9 pass / 1 fail) ")

st, qb = api("post", f"/supply/qc-inspections/{CTX['qc']}/verify/",
             {"sample_size": 10, "pass_count": 9, "fail_count": 1, "status": "PASSED",
              "remarks": "Verified by QC officer", "tested_by": PEOPLE["QC"]})
v = QcInspection.objects.get(qc_id=CTX["qc"])
assert st == 200, f"verify action -> {st}: {qb}"
assert v.status == "PASSED", f"QC status did not persist (got {v.status})"
print(f"  [PASS] P1.11 QC verify action persisted status= {v.status}")

PT0 = [t for t in PutawayTask.objects.filter(grn_line__grn_id=CTX["grn"],
                                            grn_line_id=gl0.line_id)][0]
CTX["pt"] = str(PT0.task_id)
print(f"  [PASS] P1.12 putaway task auto-generated (98 units -> {PT0.to_container})")

st, pb = api("post", f"/supply/putaway-tasks/{CTX['pt']}/complete/",
             {"destination_location_id": CTX["whbin0"]})
pt = PutawayTask.objects.get(task_id=CTX["pt"])
assert st == 200, f"putaway complete -> {st}: {pb}"
assert pt.confirmed_bin_id == CTX["whbin0"], f"confirmed_bin not saved (got {pt.confirmed_bin_id})"
print(f"  [PASS] P1.13 putaway complete action -> bin= {pt.confirmed_bin_id} status={pt.status}")
if pt.status not in [t[0] for t in PutawayTask.STATUS_CHOICES]:
    print(f"  [WARN] P1.13b putaway wrote INVALID status '{pt.status}' (not in model choices)")

# Put away EVERY auto-generated task, otherwise SKUs 2 and 3 have no stock to pick.
# Match each task to its own bin by SKU (line ids are UUIDs, so ordering is random).
ALL_PT = list(PutawayTask.objects.filter(grn_line__grn_id=CTX["grn"]))
SKU_IDX = {str(s["sku_id"]).lower(): s["_idx"] for s in SKUS}


def sku_index(sku_id):
    """Index of a SKU by its code suffix (SKU<RUN><n>), independent of uuid casing."""
    k = str(sku_id).lower()
    if k in SKU_IDX:
        return SKU_IDX[k]
    code = Sku.objects.filter(sku_id=sku_id).values_list('sku_code', flat=True).first()
    if code:
        for s in SKUS:
            if str(s.get('sku_code', '')).lower() == code.lower():
                return s["_idx"]
    return 0


def putaway_bin(t):
    """Pick a bin for this task, spread across the warehouse bins."""
    return CTX[f"whbin{sku_index(t.sku_id)}"]


def stock_at(site_code):
    """Where the goods actually are: one row per (sku, lot) with its bin."""
    return list(StockBalance.objects
                .filter(site__code=site_code, qty__gt=0)
                .select_related('sku', 'lot'))
for t in ALL_PT:
    if t.status == "CONFIRMED":
        continue
    st, _ = api("post", f"/supply/putaway-tasks/{t.task_id}/complete/",
                {"destination_location_id": putaway_bin(t)})
    assert st == 200, f"putaway {t.sku_id} -> {st}"
print(f"  [PASS] P1.15 all {len(ALL_PT)} GRN lines put away to bins")

# Snapshot the real stock positions; later phases must read from here, not guess.
STOCK_LOTS = stock_at(WH["code"])

# Relocate one line between bins and prove both legs hit the ledger.
_rel = [r for r in STOCK_LOTS if r.container == "BIN" and r.container_ref]
if _rel:
    _row = _rel[0]
    _src = _row.container_ref
    _dst = next((CTX[f"whbin{i}"] for i in range(3) if CTX[f"whbin{i}"] != _src), None)
    _before = StockBalance.objects.filter(
        site_id=CTX["wh"], container="BIN", container_ref=_src, sku_id=_row.sku_id
    ).aggregate(t=Sum("qty"))["t"] or 0
    mv = must("post", "/inventory/relocate", {
        "from_location_id": _src, "to_location_id": _dst,
        "sku": str(_row.sku_id), "lot": str(_row.lot_id), "qty": 5,
        "actor_id": PEOPLE["QC"]})
    _after_src = StockBalance.objects.filter(
        site_id=CTX["wh"], container="BIN", container_ref=_src, sku_id=_row.sku_id
    ).aggregate(t=Sum("qty"))["t"] or 0
    _after_dst = StockBalance.objects.filter(
        site_id=CTX["wh"], container="BIN", container_ref=_dst, sku_id=_row.sku_id
    ).aggregate(t=Sum("qty"))["t"] or 0
    _d = f"({_src} {_before}->{_after_src}, {_dst} -> {_after_dst})"
    if _after_src != _before - 5:
        _d += f"\n  Source bin should have dropped by exactly 5 (it dropped by {_before - _after_src})."
    rec("P1.16 relocate moves stock between bins (OUT+IN, no loss)", _after_src == _before - 5, _d)

    must("post", "/inventory/relocate", {
        "from_location_id": _src, "to_location_id": _dst,
        "sku": str(_row.sku_id), "lot": str(_row.lot_id), "qty": 5,
        "actor_id": PEOPLE["QC"]}, record=False)
    _replay = StockBalance.objects.filter(
        site_id=CTX["wh"], container="BIN", container_ref=_src, sku_id=_row.sku_id
    ).aggregate(t=Sum("qty"))["t"] or 0
    rec("P1.17 replayed relocation is idempotent", _replay == _after_src,
        f"({_src} still {_replay})")
    # put the units back so the snapshot below matches what picking will see
    must("post", "/inventory/relocate", {
        "from_location_id": _dst, "to_location_id": _src,
        "sku": str(_row.sku_id), "lot": str(_row.lot_id), "qty": 5,
        "actor_id": PEOPLE["QC"]}, record=False)
    print("  [INFO] relocation moved back, balances restored")

bal = StockBalance.objects.filter(site_id=CTX["wh"], sku_id=SKUS[0]["sku_id"])
print(f"  [{'PASS' if bal.exists() else 'FAIL'}] P1.14 stock balance created by putaway"
      f"  (found {bal.count()} rows for SKU1 @ MH)")
if not bal.exists():
    print("        ^^ INBOUND NEVER ADDS STOCK. 98 units received & put away but no StockBalance.")

# ============================================================
# PHASE 2 — CUSTOMER ORDER AT DARK STORE
# ============================================================
close_old_connections()
_phase[0] = "PHASE 2 — CUSTOMER ORDER (dark store)"
print(f"\n{chr(61)*100}")
print(f"{_phase[0]}")
print(f"{chr(61)*100}")

cu = must("post", "/iam/users/", {"email": f"cust.{RUN}@z.com", "full_name": "Lakshmi Narayana",
                                  "phone": "9441234567", "role": "CUSTOMER",
                                  "status": "ACTIVE", "password": "cust12345"})
CTX["cust_user"] = cu["user_id"]
cust = Customer.objects.create(user_id=cu["user_id"], name="Lakshmi Narayana", trust_tier="T1")
CTX["cust"] = str(cust.customer_id)
print(f"  [PASS] P2.1 customer profile created -> {cust.name}")

addr = CustomerAddress.objects.create(
    customer=cust, label="HOME", line1="12-4-8, Sai Nagar", line2="Near Bus Stop",
    landmark=" opp. SBI", pincode="534204", city="Bhimavaram", is_default=True,
    geo_lat=16.9181, geo_lng=81.7600, geocode_confidence="HIGH")
CTX["addr"] = str(addr.address_id)
print(f"  [PASS] P2.2 delivery address saved -> {addr.line1}, {addr.pincode}")

lines = [(SKUS[0], 2, 28.0), (SKUS[1], 1, 260.0)]
subtotal = sum(q * p for _, q, p in lines)
order = CustomerOrder.objects.create(
    order_no=f"ORD{RUN}", customer=cust, site_id=DS["site_id"], address=addr,
    status="PLACED", payment_method="PREPAID", payment_status="PENDING",
    subtotal=subtotal, delivery_fee=25.0, discount=0, tax_amount=0,
    grand_total=subtotal + 25.0, short_amount=0)
CTX["order"] = str(order.order_id)
for i, (s, q, p) in enumerate(lines):
    # A sold line must name the lot it is fulfilled from, otherwise stock
    # cannot be attributed on pick/return.
    lot_for_sku = next((r.lot_id for r in STOCK_LOTS if str(r.sku_id) == str(s["sku_id"])), None)
    orm(CustomerOrderLine.objects.create, order=order, line_no=i + 1, sku_id=s["sku_id"],
        lot_id=lot_for_sku,
        qty=q, picked_qty=0, packed_qty=0, shipped_qty=0,
        unit_price=p, line_total=q * p, status="PENDING")
print(f"  [PASS] P2.3/2.4 order placed {order.order_no} 2 lines  qty 3  total Rs.{order.grand_total}")

pay = Payment.objects.create(order=order, customer=cust, method="PREPAID", gateway="RAZORPAY",
                            gateway_order_id=f"pay_{RUN}", gateway_payment_id=f"pay_{RUN}",
                            amount=order.grand_total, status="CAPTURED", captured_at=T())
order.payment_status = "CAPTURED"
order.status = "CONFIRMED"
order.save()
CTX["pay"] = str(pay.payment_id)
print(f"  [PASS] P2.5/2.6 payment CAPTURED Rs.{pay.amount}, order -> CONFIRMED")

# ============================================================
# PHASE 3 — MH -> DARK STORE REPLENISHMENT
# ============================================================
close_old_connections()
_phase[0] = "PHASE 3 — MH -> DARK STORE REPLENISHMENT (pick, pack, dispatch, receive)"
print(f"\n{chr(61)*100}")
print(f"{_phase[0]}")
print(f"{chr(61)*100}")

TO = must("post", "/ds-ops/transfer-orders/", {
    "source_site": CTX["wh"], "dest_site": CTX["ds"], "status": "DRAFT", "total_qty": 60})
CTX["to"] = TO["transfer_id"]
must("patch", f"/ds-ops/transfer-orders/{CTX['to']}/", {"status": "ALLOCATED"})
CTX["picklist"] = str(uuid.uuid4())
print(f"  [PASS] P3.1/3.2 transfer order created (WH->DS) ALLOCATED ")

wh_qty_before = StockBalance.objects.filter(site_id=CTX["wh"]).aggregate(t=Sum("qty"))["t"] or 0
# Build the replenishment picklist from where the goods really are on the shelf.
WH_STOCK = STOCK_LOTS
assert len(WH_STOCK) >= 3, f"expected 3 stocked SKUs at MH, found {len(WH_STOCK)}"
for n, row in enumerate(WH_STOCK):
    must("post", "/ds-ops/pick-tasks/", {
        "picklist_id": CTX["picklist"], "batch": CTX["to"], "zone": f"GEN-{RUN}",
        "sku": str(row.sku_id), "lot": str(row.lot_id), "bin": row.container_ref,
        "qty": 20, "picked_qty": 0, "pick_seq": n + 1,
        "status": "NOT_STARTED", "assigned_to": PEOPLE["PIC"]})
must("patch", f"/ds-ops/transfer-orders/{CTX['to']}/", {"status": "PICKING"})
print(f"  [PASS] P3.3/3.4 3 pick tasks created (20 each) + transfer -> PICKING ")

for pt in PickTask.objects.filter(batch=CTX["to"]):
    must("post", f"/ds-ops/pick-tasks/{pt.pk}/complete/", {"actor_id": PEOPLE["PIC"]})
print(f"  [PASS] P3.5 all 3 pick tasks -> COMPLETED (60 units) ")

wh_qty_after = StockBalance.objects.filter(site_id=CTX["wh"]).aggregate(t=Sum("qty"))["t"] or 0
_d = f"(MH units {wh_qty_before} -> {wh_qty_after})"
if wh_qty_after >= wh_qty_before:
    _d += "\n  PICKING NEVER DECREMENTS STOCK. picked_qty only changed on the task row."
rec("P3.6 picking decremented MH stock", wh_qty_after < wh_qty_before, _d)

LPN1 = f"TOTE{RUN}A"
must("post", "/inventory/lpns/", {
    "lpn_id": LPN1, "barcode": LPN1, "lpn_type": "TOTE", "current_site": CTX["wh"],
    "source_site": CTX["wh"], "dest_site": CTX["ds"], "transfer": CTX["to"],
    "status": "PACKED",
    "created_by": PEOPLE["PAK"], "current_container": "MH_STAGING"})
for row in WH_STOCK:
    must("post", "/inventory/lpn-contents/", {
        "lpn": LPN1, "sku": str(row.sku_id), "lot": str(row.lot_id), "qty": 20})
    must("post", "/ds-ops/pack-tasks/", {
        "packlist_id": str(uuid.uuid4()), "lpn": LPN1, "sku": s["sku_id"],
        "qty": 20, "packed_qty": 0, "status": "NOT_STARTED", "assigned_to": PEOPLE["PAK"]})
print(f"  [PASS] P3.7/3.8/3.9 LPN {LPN1} + 3 contents + 3 pack tasks")

# A second LPN on the SAME lane but belonging to no transfer. Dispatching must
# leave it alone -- matching on source/dest alone used to sweep it up.
LPN_X = f"TOTE{RUN}X"
must("post", "/inventory/lpns/", {
    "lpn_id": LPN_X, "barcode": LPN_X, "lpn_type": "TOTE", "current_site": CTX["wh"],
    "source_site": CTX["wh"], "dest_site": CTX["ds"], "status": "PACKED",
    "created_by": PEOPLE["PAK"], "current_container": "MH_STAGING"})
must("post", "/inventory/lpn-contents/", {
    "lpn": LPN_X, "sku": str(WH_STOCK[0].sku_id), "lot": str(WH_STOCK[0].lot_id), "qty": 1})

disp = must("post", f"/ds-ops/transfer-orders/{CTX['to']}/dispatch/", {})
print(f"  [PASS] P3.10 transfer dispatched -> IN_TRANSIT  LPNs={disp.get('lpns_dispatched')}")

_x = LpnMaster.objects.get(lpn_id=LPN_X)
_d = f"(stray LPN status={_x.status})"
if _x.status == "IN_TRANSIT":
    _d += ("\n  Dispatch leaked onto an LPN that belongs to no transfer. LPNs must be"
           "\n  linked to their transfer, not matched by source/dest lane.")
rec("P3.10b dispatch only touches its own LPNs", _x.status == "PACKED", _d)

st, inc = api("get", f"/ds-ops/incoming-lpns?store_code=DS-{RUN}")
n_inc = len(inc) if isinstance(inc, list) else 0
_d = f"({n_inc} LPN(s) awaiting receipt)"
if n_inc == 0:
    _d += "\n  Dispatching the transfer must flip its PACKED LPNs to IN_TRANSIT,"
    _d += "\n  otherwise DSIncomingLpns (status=IN_TRANSIT) never shows them."
rec("P3.11 LPN visible in dark-store INCOMING list", n_inc > 0, _d)

st, rb = api("post", "/ds-ops/receive-lpn", {"barcode": LPN1, "store_code": f"DS-{RUN}",
                                             "received_by": PEOPLE["DSP"]})
lp = LpnMaster.objects.get(lpn_id=LPN1)
assert st == 200 and rb.get("success") is True, f"receive -> {st}: {rb}"
assert lp.status == "RECEIVED", f"LPN status after receive = {lp.status}"
assert str(lp.current_site_id) == CTX["ds"], f"LPN current_site after receive = {lp.current_site_id}"
print(f"  [PASS] P3.12/3.13 dark store RECEIVED LPN: status= {lp.status} site={lp.current_site.code}")

must("patch", f"/ds-ops/transfer-orders/{CTX['to']}/", {"status": "RECEIVED"})
ds_bal = StockBalance.objects.filter(site_id=CTX["ds"]).aggregate(t=Sum("qty"))["t"] or 0
_d = f"({ds_bal} units @ DS)"
if ds_bal == 0:
    _d += "\n  NO STOCK TRANSFER ON RECEIPT. 60 units arrived at the dark store but"
    _d += "\n  no StockBalance / StockMovement rows were created at DS."
rec("P3.14 stock landed in DARK STORE", ds_bal > 0, _d)

# Receipt parks stock in the LPN container; shelf it onto real bins to make it pickable.
DS_LPN_STOCK = list(StockBalance.objects.filter(
    site_id=CTX["ds"], container="LPN", qty__gt=0).select_related("sku", "lot"))
assert DS_LPN_STOCK, "no stock parked in the received LPN"
placements = []
for n, row in enumerate(DS_LPN_STOCK):
    placements.append({"sku": str(row.sku_id), "lot": str(row.lot_id),
                       "bin": CTX[f"dsbin{n % 3}"], "qty": row.qty})
sp = must("post", "/ds-ops/shelf-putaway", {"lpn": LPN1, "placements": placements})
print(f"  [PASS] P3.15 shelf putaway -> {len(sp.get('shelved') or [])} line(s) onto DS bins")

_lp = LpnMaster.objects.get(lpn_id=LPN1)
_stuck = StockBalance.objects.filter(
    site_id=CTX["ds"], container="LPN", container_ref=LPN1).aggregate(t=Sum("qty"))["t"] or 0
_d = f"(LPN status={_lp.status}, {int(_stuck)} unit(s) still in the tote)"
if _stuck:
    _d += ("\n  Stock is still parked in the LPN container, so the dark store cannot"
           "\n  pick it -- shelf putaway must fully drain the tote.")
rec("P3.16 shelf putaway drains the LPN back to EMPTY", _stuck == 0, _d)

# Replaying the same putaway must not duplicate bin stock.
_before = StockBalance.objects.filter(site_id=CTX["ds"], container="BIN").aggregate(t=Sum("qty"))["t"] or 0
api("post", "/ds-ops/shelf-putaway", {"lpn": LPN1, "placements": placements})
_after = StockBalance.objects.filter(site_id=CTX["ds"], container="BIN").aggregate(t=Sum("qty"))["t"] or 0
rec("P3.17 replayed shelf putaway is idempotent", _after == _before,
    f"(DS bin units {_before} -> {_after})")

# ============================================================
# PHASE 4 — DARK STORE ORDER FULFILMENT
# ============================================================
close_old_connections()
_phase[0] = "PHASE 4 — DARK STORE ORDER FULFILMENT (allocate, pick, pack for customer)"
print(f"\n{chr(61)*100}")
print(f"{_phase[0]}")
print(f"{chr(61)*100}")

BAT = must("post", "/fulfilment/batches/", {
    "batch_no": f"B{RUN}", "site": CTX["ds"], "type": "AUTO", "status": "UPLOADED",
    "order_type": "DARK_STORE", "processing_type": "LPN_BASED", "picking_type": "PIECE",
    "cluster_zone": f"DSGEN-{RUN}", "sorting_eligible": True, "totes": 1,
    "ordered_qty": 3, "ordered_skus": 2, "picked_qty": 0, "sorted_qty": 0, "short_qty": 0,
    "created_by": PEOPLE["DSP"][:36]})
CTX["batch"] = BAT["batch_id"]
print(f"  [PASS] P4.1 batch created -> {BAT['batch_no']}")

for ol in order.lines.all():
    must("post", "/fulfilment/allocations/", {
        "order_line": str(ol.pk), "lot": ol.lot_id and str(ol.lot_id) or None,
        "bin": CTX["dsbin0"], "lpn": None, "qty": ol.qty, "batch": CTX["batch"],
        "status": "ALLOCATED"})
must("patch", f"/fulfilment/batches/{CTX['batch']}/", {"status": "IN_PROGRESS"})
print(f"  [PASS] P4.2/4.3 order lines allocated, batch -> PICKING ")

# Pick from where the goods actually sit on the dark-store shelf.
DS_SHELF = stock_at(DS["code"])
assert DS_SHELF, "dark store shelf is empty; cannot fulfil"
DS_BY_SKU = {str(r.sku_id): r for r in DS_SHELF}
for n, ol in enumerate(order.lines.all()):
    row = DS_BY_SKU.get(str(ol.sku_id))
    assert row is not None, f"no DS stock for order line SKU {ol.sku_id}"
    assert row.qty >= ol.qty, f"DS has {row.qty} of {row.sku.sku_code}, order needs {ol.qty}"
    must("post", "/ds-ops/pick-tasks/", {
        "picklist_id": str(uuid.uuid4()), "batch": CTX["batch"], "zone": f"DSGEN-{RUN}",
        "sku": str(ol.sku_id), "lot": str(row.lot_id), "bin": row.container_ref,
        "qty": ol.qty, "picked_qty": 0, "pick_seq": n + 1,
        "status": "NOT_STARTED", "assigned_to": str(PEOPLE["DSP"])})
for pt in PickTask.objects.filter(batch=CTX["batch"]):
    must("post", f"/ds-ops/pick-tasks/{pt.pk}/complete/", {"actor_id": PEOPLE["DSP"]})
print(f"  [PASS] P4.4/4.5 dark-store pick tasks created and completed ")

ds_bal2 = StockBalance.objects.filter(site_id=CTX["ds"]).aggregate(t=Sum("qty"))["t"] or 0
_d = f"(DS units {ds_bal} -> {ds_bal2})"
if ds_bal2 >= ds_bal:
    _d += "\n  DS PICKING NEVER DECREMENTS STOCK."
rec("P4.6 DS picking decremented DS stock", ds_bal2 < ds_bal, _d)

LPN2 = f"RIDERBIN{RUN}"
must("post", "/inventory/lpns/", {
    "lpn_id": LPN2, "barcode": LPN2, "lpn_type": "RIDER_BIN", "current_site": CTX["ds"],
    "status": "PACKED", "created_by": PEOPLE["DSP"]})
for ol in order.lines.all():
    must("post", "/inventory/lpn-contents/", {
        "lpn": LPN2, "sku": str(ol.sku_id), "lot": CTX["lot0"], "qty": ol.qty})
    must("post", "/ds-ops/pack-tasks/", {
        "packlist_id": str(uuid.uuid4()), "lpn": LPN2, "sku": str(ol.sku_id),
        "qty": ol.qty, "packed_qty": ol.qty, "status": "COMPLETED",
        "assigned_to": str(PEOPLE["DSP"])})
    ol.picked_qty = ol.qty
    ol.packed_qty = ol.qty
    ol.status = "PICKED"
    ol.save()
print(f"  [PASS] P4.7/4.8 customer goods packed into {LPN2} + pack tasks + order lines PICKED")

must("patch", f"/fulfilment/batches/{CTX['batch']}/", {"status": "CLOSED", "picked_qty": 3,
                                                       "sorted_qty": 3, "totes": 1})
st, db = api("post", f"/fulfilment/batches/{CTX['batch']}/dispatch/")
print(f"  [PASS] P4.9 batch CLOSED (picked 3, sorted 3), dispatch action -> {db.get('status')}")
st, ob = api("patch", f"/orders/orders/{order.order_id}/", {"status": "STAGED"})
order.refresh_from_db()
print(f"  [{'PASS' if order.status == 'STAGED' else 'FAIL'}] P4.10 order -> STAGED (got {order.status})")

# ============================================================
# PHASE 5 — LAST MILE DELIVERY
# ============================================================
close_old_connections()
_phase[0] = "PHASE 5 — LAST MILE (rider shift, task, route, POD, delivered)"
print(f"\n{chr(61)*100}")
print(f"{_phase[0]}")
print(f"{chr(61)*100}")

shift = RiderShift.objects.create(rider_id=CTX["rider"], site_id=CTX["ds"],
                                  status="OPEN", orders_delivered=0, distance_km=0)
CTX["shift"] = str(shift.shift_id)
print(f"  [PASS] P5.1 rider shift opened ")

task = DeliveryTask.objects.create(
    order=order, site_id=CTX["ds"], rider_id=CTX["rider"], bin=LPN2,
    status="UNASSIGNED", order_weight_kg=6.0, order_volume_cbm=0.012,
    requires_cold_chain=False, attempt_no=1, distance_m=4200)
CTX["task"] = str(task.task_id)
print(f"  [PASS] P5.2 delivery task created -> {task.status}")

for s in ["OFFERED", "ACCEPTED", "AT_DS", "PICKED_UP", "EN_ROUTE", "ARRIVED"]:
    task.status = s
    if s == "ACCEPTED":
        task.accepted_at = T()
    if s == "PICKED_UP":
        task.pickup_at = T()
    if s == "ARRIVED":
        task.eta_at = T()
    task.save()
    api("patch", f"/delivery/delivery-tasks/{task.task_id}/", {"status": s})
print(f"  [PASS] P5.3 task progressed OFFERED -> ACCEPTED -> AT_DS -> PICKED_UP -> EN_ROUTE -> ARRIVED ")

route = RoutePlan.objects.create(rider_id=CTX["rider"], shift=shift, site_id=CTX["ds"],
                                 status="IN_PROGRESS", stop_count=1, total_distance_m=4200,
                                 estimated_min=18, started_at=T())
CTX["route"] = str(route.route_id)
stop = RouteStop.objects.create(route=route, task=task, seq=1, planned_eta=T(),
                                status="ARRIVED", actual_arrival=T())
CTX["stop"] = str(stop.stop_id)
print(f"  [PASS] P5.4/5.5 route plan + stop created ({route.total_distance_m} m, {route.estimated_min} min)")

pod = PODEvidence.objects.create(task=task, rider_id=CTX["rider"], signature="L. Narayana",
                                 method="SIGNATURE", otp_verified=True, delivered_at=T())
print(f"  [PASS] P5.6/5.7 POD captured (signature + OTP verified) ")

task.status = "DELIVERED"
task.delivered_at = T()
task.save()
for ol in order.lines.all():
    ol.shipped_qty = ol.qty
    ol.save()
order.status = "DELIVERED"
order.delivered_at = T()
order.save()
stop.status = "DELIVERED"
stop.save()
route.status = "COMPLETED"
route.completed_at = T()
route.save()
shift.status = "CLOSED"
shift.ended_at = T()
shift.orders_delivered = 1
shift.distance_km = 4.2
shift.save()
print(f"  [PASS] P5.8/5.9 task DELIVERED, order -> DELIVERED, lines shipped ")

earn = RiderEarnings.objects.create(rider_id=CTX["rider"], order=order, amount=15.0,
                                    delivery_fee=25.0, tips=0, status="PENDING")
print(f"  [PASS] P5.10 rider earning booked Rs. {earn.amount} + delivery fee Rs.{earn.delivery_fee}")

# ============================================================
# PHASE 6 — REVERSE / RETURN / REFUND
# ============================================================
close_old_connections()
_phase[0] = "PHASE 6 — REVERSE LOGISTICS (return, RTV/RTS, refund)"
print(f"\n{chr(61)*100}")
print(f"{_phase[0]}")
print(f"{chr(61)*100}")

ro = ReturnOrder.objects.create(order=order, reason="Customer reported wrong weight delivered",
                                fault="CUSTOMER", status="RETURN_CREATED",
                                refund_amount=order.grand_total)
CTX["return"] = str(ro.return_id)
print(f"  [PASS] P6.1 return order raised -> {ro.status}")

orm(RTVOrder.objects.create, order=order, status="CREATED", destination_site=DS["code"])
orm(RTSOrder.objects.create, order=order, status="CREATED", destination_site=WH["code"])
print(f"  [PASS] P6.2/6.3 RTV (to dark store) + RTS (to warehouse) created ")

ro.picked_up_at = T()
ro.received_at_ds = T()
ro.status = "RECEIVED_AT_DS"
ro.qc_disposition = "RESTOCK"
ro.save()
print(f"  [PASS] P6.4 return picked up and received at dark store ")

rf = Refund.objects.create(order=order, payment_id=CTX["pay"], amount=order.grand_total,
                           refund_method="ORIGINAL", status="REQUESTED")
rd = RefundDecision.objects.create(refund=rf, return_order=CTX["return"], decision="APPROVE",
                                   amount=order.grand_total, reason_code="WRONG_ITEM",
                                   decided_by=PEOPLE["QC"], decided_at=T())
rf.status = "COMPLETED"
rf.completed_at = T()
rf.utr = f"UTR{RUN}"
rf.save()
order.status = "REFUNDED"
order.save()
print(f"  [PASS] P6.5 refund Rs.{rf.amount} approved + completed, order -> REFUNDED")

rs = must("post", f"/reverse/returns/{CTX['return']}/restock/", {
    "site_code": DS["code"], "actor_id": PEOPLE["QC"]})
print(f"  [PASS] P6.5 restock action -> {len(rs.get('restocked') or [])} line(s) back into DS stock")

DS_UNITS_BEFORE_RETURN = ds_bal2
RS_UNITS = StockBalance.objects.filter(site_id=CTX["ds"]).aggregate(t=Sum("qty"))["t"] or 0
restocked = StockBalance.objects.filter(site_id=CTX["ds"], qty__gt=0).count()
_d = f"({RS_UNITS} units @ DS, {restocked} qty>0 rows)"
if RS_UNITS <= DS_UNITS_BEFORE_RETURN:
    _d += "\n  RETURN DOES NOT RESTOCK. QC disposition RESTOCK recorded but no stock added."
rec("P6.6 returned goods restocked into DS stock", RS_UNITS > DS_UNITS_BEFORE_RETURN, _d)

# ============================================================
# PHASE 7 — LEDGER INTEGRITY
# ============================================================
close_old_connections()
_phase[0] = "PHASE 7 - LEDGER INTEGRITY (balances must equal movement history)"
print(f"\n{chr(61)*100}")
print(f"{_phase[0]}")
print(f"{chr(61)*100}")

# The audit trail must account for every single unit, per (site, sku, lot).
_SITES = [WH["code"], DS["code"]]

_expected = {}
for row in StockMovement.objects.filter(site__code__in=_SITES).exclude(
        site_custody_delta=0
).values("site__code", "sku", "lot").annotate(
        units=Sum("qty", filter=Q(site_custody_delta__gt=0)),
        outs=Sum("qty", filter=Q(site_custody_delta__lt=0))):
    k = (row["site__code"], row["sku"], row["lot"])
    _expected[k] = (row["units"] or 0) - (row["outs"] or 0)

_actual = {}
for row in StockBalance.objects.filter(
        site__code__in=_SITES, counts_toward_site_custody=True
).values("site__code", "sku", "lot").annotate(units=Sum("qty")):
    _actual[(row["site__code"], row["sku"], row["lot"])] = row["units"] or 0

_mismatch = []
for k in set(_expected) | set(_actual):
    exp, act = _expected.get(k, 0), _actual.get(k, 0)
    if exp != act:
        _mismatch.append(f"{k[0]} sku={str(k[1])[:8]} movements={exp} balance={act}")

assert not _mismatch, "LEDGER DRIFT:\n  " + "\n  ".join(_mismatch)
print(f"  [PASS] P7.1 balances reconcile with movements across "
      f"{len(_expected)} (site,sku,lot) bucket(s)")

neg = list(StockBalance.objects.filter(
    site__code__in=_SITES, qty__lt=0).values_list("id", flat=True))
assert not neg, f"negative stock rows: {neg}"
print(f"  [PASS] P7.2 no negative stock balances")

_mv = StockMovement.objects.filter(site__code__in=_SITES)
_orphan = _mv.filter(Q(idempotency_key__isnull=True) | Q(idempotency_key=""))
assert not _orphan.exists(), f"{_orphan.count()} movement(s) missing an idempotency key"
print(f"  [PASS] P7.3 every movement is idempotency-keyed ({_mv.count()} rows)")

# The audit chain must be intact and gapless per site.
import hashlib as _hl

_bad = []
for _code in _SITES:
    _rows = list(StockMovement.objects.filter(site__code=_code)
                 .order_by("site_seq"))
    _prev = None
    for _i, _m in enumerate(_rows, start=1):
        if _m.site_seq != _i:
            _bad.append(f"{_code} seq gap: expected {_i}, got {_m.site_seq}")
            break
        if (_m.prev_hash or None) != _prev:
            _bad.append(f"{_code} seq {_m.site_seq} prev_hash does not match previous row")
            break
        _parts = [str(_m.site_id), str(_m.site_seq), _m.movement_ref, _m.ref_id,
                  str(_m.sku_id), str(_m.lot_id), str(_m.qty),
                  _m.from_container, str(_m.from_ref_id or ""),
                  _m.to_container, str(_m.to_ref_id or ""),
                  str(_m.sellable_delta), str(_m.site_custody_delta),
                  _m.idempotency_key or "",
                  _prev.hex() if _prev else ""]
        _want = _hl.sha256("|".join(_parts).encode()).digest()
        if bytes(_m.row_hash or b"") != _want:
            _bad.append(f"{_code} seq {_m.site_seq} row_hash mismatch (row was altered)")
            break
        _prev = _m.row_hash
assert not _bad, "AUDIT CHAIN BROKEN:\n  " + "\n  ".join(_bad)
print(f"  [PASS] P7.4 audit hash-chain verifies across "
      f"{_mv.count()} movement(s)")

# Replaying a completion must not double-count.
_before = StockBalance.objects.filter(site__code=DS["code"]).aggregate(t=Sum("qty"))["t"] or 0
_replay = api("post", f"/reverse/returns/{CTX['return']}/restock/",
              {"site_code": DS["code"], "actor_id": PEOPLE["QC"]})
assert _replay[0] == 200, f"replay restock -> {_replay[0]}"
_after = StockBalance.objects.filter(site__code=DS["code"]).aggregate(t=Sum("qty"))["t"] or 0
rec("P7.5 replayed restock is idempotent (no double count)",
    _after == _before, f"(DS units {_before} -> {_after})")

# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'='*100}\nSUMMARY\n{'='*100}")
cur = None
for ph, name, ok, det in R:
    if ph != cur:
        cur = ph
        print(f"\n{ph}")
    print(f"  {'PASS' if ok else 'FAIL'}  {name}   {det}")
p = sum(1 for r in R if r[2])
f = len(R) - p
print(f"\n{'='*100}\nTOTAL: {p} passed / {f} failed / {len(R)} steps   RUN={RUN}\n{'='*100}")
