# Zippzo WMS & DS — React Native ops app

One Expo app for both warehouse (MH) and dark-store (DS) staff, iOS + Android.

## Start

```bash
cd mobile
npm install
# Point at the Laravel/Django API (default http://10.0.2.2:8000/api for Android emulator)
# Set in .env: EXPO_PUBLIC_API_BASE=https://your-api.example.com/api
npm start           # QR code → Expo Go, or press a for Android / i for iOS
npm run android     # native Android (Expo dev build)
npm run ios         # native iOS (macOS)
npm run typecheck
```

Camera permission strings for iOS and the `expo-camera` plugin are declared in
`app.json` (`com.zippzo.operations`).

## Sign-in (existing IAM)

1. **Credentials** — the email/password registered in the WMS & DS software
   (`POST /iam/auth/login`, app `WMS`, surface `mobile`).
2. **Facility** — if you have assignments at more than one site, pick the site
   for this shift (`POST /iam/auth/facility`).
3. **OTP** — enter the one-time code (`POST /iam/auth/otp/verify`). Tokens are
   kept in `expo-secure-store`; refresh is automatic on 401.

The server scopes **every** later request to the session facility, so a DS
picker never sees MH work (and vice versa). Switch sites from the header via
`POST /iam/auth/switch-facility` (Facilities list already used by login).

## Screens (2-column home grid)

| Home tile | What it does |
|---|---|
| **My Tasks** | Today's todo list: *Assigned to me* vs *Team queue*, today's items pinned at top. Work is server-scoped by role + assignment (`GET /iam/auth/my-work`). |
| **Inbound** | 1 · **Create Consignment** → 2 · **Q.C.** → 3 · **Putaway**. |
| **Inventory** | Stock balances by bin (SKU, lot/batch, expiry, sellable) with scan-to-search. |
| **Outbound** | Pick → Pack → Transfers for MH (*Warehouse*) or DS (*Dark store*). |

### Inbound 1 — Create consignment (scan-first)

- **Scan consignment** the vendor / transfer barcode (or ASN no.). Known ASN →
  resume it; unknown → create `POST /supply/asns/` (`type VENDOR_PO`,
  `dest_site` = session facility, auto-numbered server-side) + open a GRN
  (`POST /supply/grns/` `mode LPN_SCAN`).
- **Scan product** (barcode/EAN/SKU). Each scan resolves the SKU from
  `/catalog/skus/?search=` (then `/catalog/barcodes/`), declares an ASN line,
  and adds/bumps the GRN line `received_qty` (`POST /supply/grn-lines/` or
  `PATCH`). Qty-per-scan is adjustable.
- **Close receiving** (`POST /supply/grns/{id}/complete/`) closes the ASN and
  the GRN; stock is still not sellable until QC + putaway.

### Inbound 2 — Q.C. (one by one)

Queue = GRN lines where `received > accepted + damaged`. Tap a product →
**scan it** (must match the expected SKU) → **✓ Pass / ✕ Fail** (set the whole
pending qty, or partial with +/−) → **Save & Next** finds/creates the
`QcInspection` and calls `POST /supply/qc-inspections/{id}/verify/`, then
advances to the next product. Only Pass units become `accepted_qty` and flow
to putaway.

### Inbound 3 — Putaway (QC-passed)

Queue = `PutawayTask`s not `CONFIRMED` with units remaining. Tap one:

- Product + inventory data (SKU, category, storage zone, lot/batch, GRN/ASN,
  remaining qty) is shown.
- **Suggested bin** is ranked by category / storage zone against live bins
  (`GET /supply/putaway-bins/` with occupancy + contents), with free space
  preferred. Tap to override. Server `suggested_bin` wins when present.
- **Scan product** → **scan location bin** (both verified) → qty → **Put away**
  (`POST /supply/putaway-tasks/{id}/place/`, moves stock + bin occupancy
  immediately), then **Put away & Next** (auto-confirms with
  `POST …/complete/` when `placed == qty`) to continue through the queue.

### Inventory

`GET /inventory/balances/` grouped by `container_ref` (bin), w/ sellable flag,
lot/batch and expiry. Search or scan to jump to a bin/SKU.

### Outbound

- **Pick**: scan bin → scan product → `POST /ds-ops/pick-line` (+ qty, `scan_id`
  per scan). Tap a pick task to pre-fill bin/order.
- **Pack**: scan tote/LPN + staging bin → `POST /ds-ops/pack-order`.
- **Transfers**: MH→DS transfer orders list (`GET /ds-ops/transfer-orders/`).

## Backend notes (already wired)

- Auth/OTP/facility: `bounded/iam/`
- Consignment/GRN/QC/Putaway: `bounded/supply/` (ASNs, GRNs, GRN lines,
  QC inspections + verify, putaway tasks + place/complete, putaway-bins)
- Catalog (SKU/barcode resolution): `bounded/catalog/`
- Inventory: `bounded/inventory/` (balances)
- DS ops (pick/pack/transfers): `bounded/ds_ops/`
- Network (bins/locations/zones): `bounded/network/`
