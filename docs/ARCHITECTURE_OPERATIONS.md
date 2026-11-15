# Zippzo Operations Platform — Architecture & Workflow Plan

Status: implementation in progress. This document describes the target shape of
the WMS / Dark Store operations product and the server contracts that enforce
it. It is deliberately explicit about what is **not** yet true.

## 1. Product surfaces

| Surface | Technology | Who uses it | What it may do |
|---|---|---|---|
| **Operations web** (`index.html`, `darkstore.html`) | React 19 + Vite | Supervisors, planners, admins, auditors | Plan, configure, release work, assign people, review exceptions, inspect read-only inventory, audit. |
| **Operations mobile** (`mobile/`) | React Native (Expo), shared iOS/Android code | Warehouse and dark-store employees | Execute assigned physical tasks: receive, QC, put away, pick, pack, seal, dispatch, hand off, count. |
| **Rider** (unchanged) | React/Capacitor | Delivery partners | Delivery execution. |
| **Consumer** (unchanged) | React/Capacitor | Customers | Shopping, checkout, order tracking. |

Rules:

1. **No physical mutation from web.** The browser never renders a camera or
   scanner control and never reaches a stock-commit endpoint. Enforcement is
   server-side (`surface=web` tokens are rejected by physical endpoints), not
   only hidden in navigation.
2. **No desktop layout on mobile.** The native app has its own screens and
   navigation. It is not a WebView or Capacitor wrapper.
3. **WMS and Dark Store stay separate.** Shared identity, catalog references,
   inventory ledger and notifications; separate navigation, queues, roles and
   dashboards.

## 2. Runtime topology

```
                    ┌──────────────────────────────┐
  Operations web ──▶│                              │
  (surface=web)     │   Django 5 + DRF + Channels  │
                    │                              │
  Operations mobile │  iam / audit / outbox        │
  (surface=mobile)─▶│  network / catalog / supply  │
                    │  inventory / ds_ops / orders │
  Rider app ───────▶│  delivery / lastmile / money │
  Consumer app ────▶│  notifications / reverse     │
                    └──────────────┬───────────────┘
                                   │
                       PostgreSQL + Redis (outbox,
                       websocket fan-out, cache)
```

The backend remains a modular monolith. Every physical quantity change goes
through `bounded.inventory.stock.apply_stock`, which writes both the balance and
the hash-chained movement in one transaction.

## 3. Shared staff identity

### 3.1 Accounts

- One `iam.User` per employee. Roles: `SUPER_ADMIN`, `OPS_MANAGER`,
  `WAREHOUSE_STAFF` (plus `RIDER`, `CUSTOMER`, `SENDER` for the other products).
- Facility rights come from `network.EmployeeSiteAssignment`
  (`user`, `site`, `role_at_site`, `mode`, `is_active`).
- An account never carries a facility password. WMS and Dark Store share the
  same credentials.

### 3.2 Login sequence (web and mobile)

```
POST /api/iam/auth/login            { email, password, surface }
  ├─ 0 authorized sites  → 403 (no assignment)
  ├─ 1 authorized site   → OTP challenge for that site
  └─ >1 authorized sites → { facility_required: true, facilities: [...] }

POST /api/iam/auth/facility         { challenge_id, facility_code }
  └─ validates the code against the account's active assignments only
     → OTP challenge for that site

POST /api/iam/auth/otp/verify       { challenge_id, otp, device? }
  └─ one-time, 5-minute, attempt-limited
     → { access_token, refresh_token, session, user, facility, capabilities }

POST /api/iam/auth/refresh          { refresh_token }  → rotated pair
POST /api/iam/auth/logout           { refresh_token }  → session revoked
GET  /api/iam/auth/me                                  → current context
```

- OTP codes are generated with a CSPRNG, stored only as a salted hash, expire
  after five minutes, allow five attempts, and are single-use. The shared
  deterministic "hourly OTP" formula and its secret are removed.
- Delivery goes through a server-side adapter (SMS/email). Development and the
  automated tests may use an explicit `OTP_DEV_ECHO` flag when no mail sender
  is configured; the login interfaces never display the echoed code, which is never
  exposed when `DJANGO_ENV=production`.
- Every step writes an `audit` row (login attempt, facility selection, OTP
  success/failure, logout, revocation).

### 3.3 Sessions and tokens

- Access token: short-lived JWT with `sub`, `role`, `sid`, `surf`, `exp`, `jti`.
- Refresh token: random opaque value, stored hashed on `iam.Session`.
- `JWTAuthentication` loads the session and rejects it when inactive, expired,
  revoked, or when its refresh token was rotated.
- Logout, device loss (`iam.Device.is_active = False`) and assignment revocation
  invalidate the session. Web and mobile sessions are independent.
- A token's `sid` pins the **selected facility**. A multi-site employee cannot
  use a facility-A session to act on facility B; the server checks the session
  facility in addition to the assignment row.

### 3.4 Capability payload

`GET /auth/me` and the OTP response return:

```json
{
  "user": {...},
  "facility": {"site_id": "...", "code": "WH-BH-001", "site_type": "MH", ...},
  "surface": "mobile",
  "capabilities": {
    "can_plan": true,
    "can_assign": true,
    "can_execute_physical": true,
    "can_adjust_stock": false,
    "can_administer": false
  },
  "allowed_apps": ["WMS"],
  "assignments": [...]
}
```

The client uses capabilities for presentation only. The server re-derives them
on every request.

## 4. Authorization model

| Layer | Control |
|---|---|
| Endpoint class | `IsAuthenticated` + role permission + surface permission. |
| Facility read scope | `operator_site_codes(user)` from active assignments; estate roles may cross sites. |
| Facility write scope | `require_site_access(user, site_code)` **and** `require_session_facility(request, site_code)`. |
| Task scope | Task's order/GRN/transfer site must equal the session facility. |
| Surface scope | Physical endpoints require `surface=mobile`. Web tokens get `403 physical_execution_requires_mobile`. |
| Websocket | Auth handshake validates the same session and joins only facility-scoped groups. |
| Notifications | Recipient is resolved server-side from assignment, role and facility; client-supplied audience is ignored. |

Direct URL edits, a stale bundle, a local-storage facility value, or a typed
facility code cannot grant access because every layer is re-derived server-side.

## 5. Physical workflows

### 5.1 Warehouse (Mother Hub)

```
Web planner                     Mobile worker                     Server
───────────                     ─────────────                     ──────
Create PO / ASN          ──▶     My Work: receive ASN        ──▶   GRN + lines
Release receiving work   ──▶     Scan LPN/batch, product,          qty/lot/expiry,
                                 qty, damage/shortage/overage      discrepancy rows
                                 Submit receipt              ──▶   GRN COMPLETED
Assign QC                ──▶     QC pass / hold / reject     ──▶   accepted/damaged,
                                                                  quarantine balance
Release putaway          ──▶     Scan handling unit + bin    ──▶   PUTAWAY movement
                                                                  (sellable only)
Create replenishment     ──▶     Pick → pack → seal → load  ──▶   PICK/PACK/LOAD
transfer + release               → dispatch                       movements + custody
```

Each submit is idempotent. The app shows "confirmed" only after the server
returns the movement identifiers.

### 5.2 Dark Store

```
Web planner                     Mobile worker                     Server
───────────                     ─────────────                     ──────
Transfer/order visibility ──▶    Receive LPN, record discrepancy ──▶ TRANSFER receipt
Priorities, staffing,            Shelf/backroom putaway        ──▶   BIN movement
availability, exceptions         Pick location/SKU/qty         ──▶   PICK movement
                                 Substitute / short            ──▶   line status
                                 Pack + stage                  ──▶   LPN/staging
                                 Rider handoff (OTP)           ──▶   custody transfer
Returns intake               ──▶ quarantine, never sellable
```

Customer-order **reservation** (`fulfilment.OrderAllocation`) is separate from
physical picking. A reservation never moves `StockBalance`.

## 6. Inventory integrity

- **Single write path**: `apply_stock()`; no view writes `StockBalance` directly.
- **Atomicity**: balance update, movement row and hash-chain head commit in one
  transaction; the chain row is locked first to serialise per site.
- **Idempotency**: deterministic movement key plus a unique database constraint.
  Retries return the prior result instead of moving stock twice.
- **No negative stock**: availability is checked under a row lock; the DB column
  is unsigned.
- **No cross-site movement**: source and destination sites are validated against
  the session facility; transfer legs are explicitly paired.
- **FEFO**: lot selection orders by expiry, then received date.
- **Reservations** are separate rows; cancellation releases them without a
  movement.
- **Corrections are append-only**: a `StockAdjustment` records reason,
  requested-by, approved-by and the compensating movement. Historical movements
  are never edited or deleted.
- **Explicit outcomes**: partial receipt, partial pick, partial pack, transfer
  discrepancy, quarantine, damage and cancellation each have their own state.

## 7. Offline continuity (mobile)

1. Each task action gets a client-generated `idempotency_key` (UUID v4).
2. With no connection, the action is written to a local outbox and the task is
   shown as **Pending sync** — never "confirmed".
3. On reconnect, the queue is replayed in order with the same keys.
4. The server either commits once or returns the original result; the client
   reconciles task state from the server before showing success.
5. Actions that cannot be reconciled are surfaced as exceptions with a manual
   review path.

## 8. Notifications

- Durable inbox per user (`notifications.Notification`).
- Outbox events fan out to recipients resolved from assignment/role/facility.
- Websocket frames are hints; REST inbox is the source of truth.
- Idempotency key per `(event, user, channel)` prevents duplicate delivery.
- Event families: order, task assigned/released, assignment change, handoff,
  delivery OTP, exception, stock/ledger.

## 9. Separation of WMS and Dark Store

| Concern | WMS (MH) | Dark Store (DS) |
|---|---|---|
| Facility type | `Site.site_type = MH` | `Site.site_type = DS` |
| Entry workspace | `WMS` | `DARK_STORE` |
| Work queues | ASN/GRN, QC, putaway, replenishment pick/pack, outbound dispatch | LPN receipt, shelf putaway, customer pick/pack, rider handoff, returns |
| Web navigation | inbound plans, storage, replenishment planning, outbound, master data, audit | orders oversight, availability, staffing, exceptions, ledger, admin |
| Forbidden | DS picking/handoff screens | MH putaway/outbound dispatch screens |

A multi-site employee sees a facility chooser containing only their active
assignments. Selecting a facility fixes the workspace for that session.

## 10. API surface (operations)

Existing namespaces are retained; physical endpoints are now surface-gated.

| Namespace | Read | Planning write | Physical write (mobile only) |
|---|---|---|---|
| `/api/iam/` | me, users, roles, devices | user/role admin, assignments | — |
| `/api/network/` | sites, zones, bins | site/zone/bin setup, shifts | — |
| `/api/catalog/` | SKUs, barcodes, lots | catalog admin | — |
| `/api/supply/` | ASN, GRN, QC, putaway | ASN/PO creation, release, assignment | GRN complete, QC verify, putaway place/complete |
| `/api/inventory/` | positions, feed, balances | — | relocate, bin-sort, pack-lpn, LPN content |
| `/api/ds-ops/` | tasks, transfers, orders, inventory | transfer creation, allocation, priority | receive-lpn, shelf-putaway, pick-line, pack-order, order-action, handoff |
| `/api/orders/` | orders | availability/pricing/cancel | — |
| `/api/notifications/` | inbox | mark read | — |

## 11. Non-goals / preserved systems

- Rider and Consumer apps keep their current login, navigation and delivery /
  shopping flows. They are not merged into staff operations.
- The existing Playwright suite must be updated only where the product boundary
  intentionally changed (web scanning removed, stock commits moved to the
  mobile surface). Business behavior and API contracts remain.
