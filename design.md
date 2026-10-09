# Zippzo Quick-Commerce Platform
## Complete System Design & Architecture

**Version:** v3.7 (final)
**Document type:** Master architecture reference
**Audience:** Engineers, architects, ops

---

# 1. Executive Summary

Zippzo is a **hybrid quick-commerce platform** delivering groceries and FMCG to customers within 10–40 minutes via a network of Mother Hubs (MH) and Dark Stores (DS), served by a fleet of gig riders.

**The system comprises:**

- **6 client applications** (customer, rider, staff, admin, support, partner portal)
- **1 modular-monolith backend** with 19 bounded contexts
- **1 event-driven integration layer** (outbox → Redis Streams → handlers)
- **1 real-time layer** (WebSocket + push)
- **1 data platform** (PostgreSQL + PostGIS, TimescaleDB, Redis, S3)
- **1 immutable stock ledger** with hash-chained auditability

**Core architectural principles:**

| Principle | Consequence |
|---|---|
| MH controls, DS fulfils, rider delivers | Clear separation of concerns across network |
| Every physical touch is a scan | Barcode master is a launch blocker |
| Stock is not sellable until putaway confirms | Receipt ≠ availability |
| Custody is always recorded; task actions are CAS-gated | Physical truth can't be lost |
| POD is evidence; state is server-authoritative | Fraud-resistant delivery |
| COD is an operating mode, not a payment method | Cash ledger is a first-class citizen |
| WS carries hints; REST carries truth | Offline resilience is inherent |

---

# 2. System Context (C4 Level 1)

```mermaid
graph TB
    subgraph Users["Users"]
        CU[Customer]
        RI[Rider]
        ST[DS / MH Staff]
        OP[Ops / Finance]
        SU[Support Agent]
        VE[Vendor / Seller]
    end

    subgraph Zippzo["Zippzo Platform"]
        SYS[Quick-Commerce Platform<br/>6 apps + 1 backend + data platform]
    end

    subgraph External["External Systems"]
        PG[Payment Gateway<br/>Razorpay-class]
        MAP[Maps / ETA<br/>Google/OSRM]
        SMS[SMS / Push<br/>FCM, APNs, WhatsApp]
        GW[GST / e-Invoice]
        OTP[OTP Provider]
        MON[Monitoring<br/>Sentry, PagerDuty]
    end

    CU -->|order, track, return| SYS
    RI -->|shift, deliver, POD| SYS
    ST -->|scan, pick, pack, receive| SYS
    OP -->|config, reports, holds| SYS
    SU -->|cancel, refund, override| SYS
    VE -->|ASN, listings, settlements| SYS

    SYS -->|capture, refund| PG
    SYS -->|routes, ETA| MAP
    SYS -->|notify| SMS
    SYS -->|invoice| GW
    SYS -->|verify| OTP
    SYS -->|errors, alerts| MON
```

**What Zippzo is not:** not a marketplace-only, not a traditional e-comm, not a 3PL aggregator. It owns the fulfilment network end-to-end.

---

# 3. Container Architecture (C4 Level 2)

```mermaid
graph TB
    subgraph Clients["Client Applications"]
        Z[Zippzo<br/>React Native customer]
        ZG[Zippzo Go<br/>React Native rider]
        ZH[Zippzo Hub<br/>React + PWA RF scanner]
        ZA[Zippzo Admin<br/>React web]
        ZS[Zippzo Support<br/>React web]
        PP[Partner Portal<br/>React web]
    end

    subgraph Edge["Edge Layer"]
        CDN[CDN<br/>static + images]
        WAF[WAF + DDoS]
        LB[Load Balancer]
        WSG[WS Gateway<br/>Django Channels]
    end

    subgraph API["API Layer"]
        NGINX[Nginx ingress]
        AUTHMW[Auth middleware<br/>JWT verify]
        POL[Policy engine<br/>RBAC + ABAC]
    end

    subgraph App["Application Layer"]
        HTTP[api-http<br/>Django + DRF<br/>3-20 replicas]
        ASGI[api-ws<br/>Daphne + Channels<br/>2-10 replicas]
        WORKER[celery-worker<br/>domain + events]
        BEAT[celery-beat<br/>scheduled jobs]
        OUTW[outbox-worker]
    end

    subgraph Data["Data Layer"]
        PG[(PostgreSQL 16 + PostGIS<br/>primary + replica)]
        TSDB[(TimescaleDB<br/>GPS breadcrumbs)]
        RD[(Redis 7.2<br/>cache + broker + streams)]
        S3[(Object Storage<br/>S3 / R2 / MinIO)]
        WORM[(WORM Storage<br/>S3 Object Lock<br/>ledger anchor)]
    end

    subgraph External["External Services"]
        PGW[Payment gateway]
        MAPS[Maps / geocoding]
        PUSH[FCM / APNs]
        OTPS[OTP / SMS]
    end

    Z & ZG & ZH & ZA & ZS & PP --> CDN --> WAF --> LB
    ZG & Z & ZH --> WSG --> ASGI
    LB --> NGINX --> AUTHMW --> POL --> HTTP
    HTTP --> PG & RD & S3
    HTTP --> OUTW
    OUTW --> WORKER
    WORKER --> PG & RD & S3
    BEAT --> WORKER
    ASGI --> RD & PG
    WORKER --> TSDB
    HTTP --> PGW & MAPS & PUSH & OTPS
    PG --> WORM
```

**Key architectural decisions:**

| Decision | Rationale |
|---|---|
| Modular monolith (not microservices) | Team size, transaction boundaries, single DB transaction for ledger writes |
| Separate `api-http` and `api-ws` | WS needs long-lived connections; HTTP needs fast scaling |
| Redis Streams for replay | Pub/sub loses events on reconnect; streams preserve cursor |
| Separate TimescaleDB instance | GPS write volume would pollute OLTP; invariant #26 |
| WORM anchor for hash chain | Tamper-evidence requires immutable external store |

---

# 4. Bounded Context Architecture (C4 Level 3)

The backend is organized into **19 bounded contexts**, each with clear ownership. No shared tables across contexts; cross-context communication is via events or explicit service calls.

## 4.1 Context Map

```mermaid
graph TB
    subgraph Platform["Platform Core"]
        IAM[iam<br/>users, sessions, roles, devices]
        AUDIT[audit<br/>hash-chained log]
        OUTBOX[outbox<br/>transactional event publisher]
        NOTIF[notifications<br/>push, SMS, email]
        IDEM[idempotency<br/>request dedup]
        HC[ledger_hash_chain<br/>tamper evidence]
    end

    subgraph Net["Network"]
        SITES[sites<br/>zones, bins, QR, devices]
        SERV[serviceability<br/>bands, hours, polygons]
        CAT[catalog<br/>SKUs, barcodes, UoM]
    end

    subgraph Supply["Supply Chain"]
        VEND[vendors<br/>PO, 3-way match]
        INB[inbound<br/>ASN, GRN, QC]
        PUT[putaway<br/>GATED]
        INV[inventory<br/>ledger, ownership]
        SORT[sorting<br/>wave, chutes]
        OUT[outbound]
        SHIP[shipping<br/>trips, manifests]
        CNT[cycle_count]
    end

    subgraph Demand["Demand"]
        CART[cart]
        ORD[orders]
        PRICE[price_finalization]
        ROUTE[routing<br/>DS selection, ETA]
        PROMO[promotions]
        SEARCH[search]
    end

    subgraph Fulfil["Fulfilment"]
        DSIN[ds_inbound]
        DSPUT[ds_putaway<br/>GATED]
        DSOP[ds_ops<br/>pick, pack, stage]
        AGING[staged_aging]
    end

    subgraph LastMile["Last Mile"]
        DEL[delivery<br/>tasks, routes]
        POD[pod<br/>evidence, age verify]
        GPS[gps_ingest<br/>Redis GEO]
        REV[reverse<br/>returns, RTO, RTV, RTS]
    end

    subgraph Money["Money"]
        PAY[payments]
        COD[cod_custody]
        WAL[wallet]
        REF[refunds]
        INVN[invoicing<br/>GST]
        EARN[earnings]
        PO[payouts]
        SET[settlements]
        REC[reconciliation]
    end

    subgraph People["People"]
        WF[workforce]
        SELL[sellers]
        FRAUD[fraud_risk]
        ADDR[address_hygiene]
    end

    IAM -.->|provides auth| Demand & Fulfil & Supply & Money
    OUTBOX -.->|publishes| NOTIF & FRAUD & ADDR
    INV --> HC
    ORD --> ROUTE --> DSOP --> DEL --> POD
    DSOP --> INV
    INB --> PUT --> INV
    COD --> PAY
    POD --> EARN --> PO
    REV --> REF & INV
```

## 4.2 Context Ownership Table

| Context | Owns | Consumes |
|---|---|---|
| `iam` | Users, sessions, roles, devices, QR codes | — |
| `audit` | Immutable action log | Events from all contexts |
| `outbox` | Transactional event queue | Writes from all contexts |
| `inventory` | Stock ledger, movements, balances, LPNs, ownership, holds | Putaway, transfer, pick, sort, ship events |
| `inbound` | ASN, GRN, QC | Vendor data, barcode master |
| `putaway` | Putaway tasks (GATED) | Inbound, site config |
| `orders` | Customer orders, cart, lines | Catalog, routing, payments |
| `routing` | DS selection, ETA | Serviceability, inventory, GPS |
| `ds_ops` | Pick tasks, pack tasks, staging | Orders, inventory, rider bins |
| `delivery` | Delivery tasks, routes, rider shifts | Orders, DS ops, GPS |
| `pod` | POD evidence (never discarded) | Delivery, orders |
| `cod_custody` | Cash ledger, ceiling, remittance | Delivery, payments |
| `payments` | Payments, capture, gateway integration | Orders, COD |
| `refunds` | Refund state machine, cap enforcement | Payments, returns |
| `reverse` | Return orders, RTO, RTV, RTS, QC | Delivery, inventory |
| `sellers` | Seller lifecycle, listings, settlements | Catalog, money |
| `vendors` | Vendor master, PO, 3-way match | Inbound, money |
| `fraud_risk` | Trust scores, fraud signals | All order/payment events |
| `gps_ingest` | Real-time positions (Redis GEO) | Rider app stream |

**Rule:** one context = one owner. No context reads another context's tables directly. Cross-context reads go through service interfaces; writes go through events.

---

# 5. Data Architecture

## 5.1 Data Store Topology

```mermaid
graph LR
    subgraph OLTP["OLTP — PostgreSQL 16 + PostGIS"]
        M[Primary]
        R1[Read replica<br/>analytics, reports]
        R2[Read replica<br/>standby]
    end

    subgraph TS["TimescaleDB — Separate Instance"]
        GPS[gps_pings<br/>hypertable, 90d retention]
    end

    subgraph Cache["Redis 7.2"]
        C1[cache keys<br/>catalog, listings]
        C2[cache keys<br/>sessions, permissions]
        C3[pub/sub<br/>Channels fanout]
        C4[streams<br/>WS replay 24h]
        C5[GEO<br/>rider positions]
    end

    subgraph Blob["Object Storage"]
        S1[S3 private buckets<br/>POD photos, invoices]
        S2[WORM bucket<br/>ledger anchor]
    end

    subgraph Search["Search — Phase 2"]
        OS[OpenSearch]
    end

    M --> R1 & R2
    M -.->|GPS reads| TS
    M --> C1 & C2
    C3 & C4 --> M
    C5 --> M
    M --> S1
    M --> S2
    M -.->|catalog| OS
```

## 5.2 Core Data Model — Inventory Ledger

The **single source of truth** for all stock.

```mermaid
erDiagram
    stock_movements ||--o{ stock_balances : "projects to"
    stock_movements ||--|| stock_movements_chain : "appends to"
    movement_preconditions ||--o{ stock_movements : "whitelists"
    stock_reservations }o--|| customer_orders : "belongs to"
    lpn_master ||--o{ lpn_contents : "contains"
    stock_balances }o--|| lpn_master : "may reside in"
    stock_balances }o--|| locations : "located at"

    stock_movements {
        bigint entry_id PK
        text movement_type
        text sku_id
        text lot_id
        int qty
        text from_container
        text from_ref_id
        text to_container
        text to_ref_id
        text owner_type
        text owner_id
        smallint sellable_delta
        smallint site_custody_delta
        bytea prev_hash
        bytea row_hash
        bigint site_seq
        timestamptz created_at
    }

    stock_balances {
        text site_id PK
        text container PK
        text container_ref PK
        text sku_id PK
        text lot_id PK
        text owner_type PK
        text owner_id PK
        int qty
        boolean sellable
        timestamptz updated_at
    }

    movement_preconditions {
        text movement_type PK
        text from_container PK
        text to_container PK
        smallint[] sellable_delta_allowed
        smallint[] site_custody_delta_allowed
        text transition_type
    }

    stock_reservations {
        uuid reservation_id PK
        uuid order_id FK
        uuid order_line_id
        int qty_reserved
        int qty_consumed
        int qty_released
        text status
        timestamptz expires_at
    }

    lpn_master {
        text lpn_id PK
        text barcode UK
        text lpn_type
        text current_site_id
        text current_container
        boolean is_insulated
        text status
    }

    lpn_contents {
        text lpn_id PK
        text sku_id PK
        text lot_id PK
        int qty
    }
```

## 5.3 Data Flow: How Stock Updates

```mermaid
sequenceDiagram
    participant App as Any app
    participant API as API
    participant INV as Inventory service
    participant TRG as DB triggers
    participant BAL as stock_balances
    participant LED as stock_movements
    participant CH as hash chain
    participant OUT as outbox

    App->>API: scan event (e.g., putaway confirm)
    API->>INV: apply_movement(triple, qty, deltas)
    INV->>INV: validate against precondition whitelist
    INV->>LED: INSERT movement
    LED->>CH: compute row_hash from prev_hash
    CH->>CH: update chain head (transactional)
    LED->>TRG: AFTER INSERT trigger
    TRG->>BAL: apply delta (upsert)
    TRG->>BAL: CHECK qty >= 0
    INV->>OUT: INSERT outbox_event (same tx)
    INV->>INV: COMMIT
    Note over LED,BAL: Ledger is truth; balances are projection
```

**Rule:** no app writes `stock_balances` directly. Only the trigger does, on every `stock_movements` insert.

## 5.4 Data Classes & Retention

| Data class | Store | Retention | Driver |
|---|---|---|---|
| Stock movements | PostgreSQL (partitioned monthly) | 7 years | Financial compliance |
| Hash chain anchors | S3 WORM | 7 years | Audit tamper-evidence |
| GPS pings | TimescaleDB | 90 days | DPDP, ops |
| POD photos | S3 | 180 days | Dispute, chargeback |
| Invoices | S3 + PG | 8 years | GST statutory |
| Audit log | PostgreSQL (partitioned) | 7 years | Compliance |
| Notifications | PostgreSQL | 90 days | Ops |
| Support tickets | PostgreSQL | 3 years | Ops |
| Customer PII | PostgreSQL (encrypted) | Active + 3 years | DPDP |
| Sessions | Redis + PG | Active + 30 days | Security |

---

# 6. Integration Architecture

## 6.1 Event-Driven Backbone

```mermaid
graph LR
    subgraph Producers["Producers (write path)"]
        P1[orders]
        P2[inventory]
        P3[ds_ops]
        P4[delivery]
        P5[payments]
        P6[cod_custody]
    end

    subgraph Outbox["Transactional Outbox"]
        OB[(outbox_events<br/>same tx as write)]
    end

    subgraph Publisher["Outbox Worker"]
        OW[celery-worker<br/>polls outbox]
    end

    subgraph Streams["Redis Streams"]
        S1[ws:orders:*]
        S2[ws:rider:*]
        S3[ws:ds:*]
        S4[ws:wh:*]
        S5[internal.events.*]
    end

    subgraph Consumers["Consumers (read side)"]
        C1[notifications]
        C2[fraud_risk]
        C3[analytics]
        C4[WS fanout]
        C5[cross-context handlers]
    end

    P1 & P2 & P3 & P4 & P5 & P6 --> OB
    OB --> OW
    OW --> S1 & S2 & S3 & S4 & S5
    S1 & S2 & S3 & S4 --> C4
    S5 --> C1 & C2 & C3 & C5
```

**Guarantees:**

| Property | Mechanism |
|---|---|
| At-least-once delivery | Streams retain until ack; worker retries |
| Ordering per aggregate | `(aggregate_id, sequence)` monotonic in stream |
| Idempotent handlers | Handler uses `client_event_id` / `outbox_id` for dedup |
| No events for uncommitted writes | Outbox insert in same DB transaction |
| Replay for reconnecting clients | Redis Streams with 24h cursor window |

## 6.2 Synchronous API Layer

```mermaid
sequenceDiagram
    participant C as Client
    participant LB as Load balancer
    participant MW as Auth middleware
    participant PE as Policy engine
    participant V as View
    participant S as Service
    participant DB as PostgreSQL
    participant RD as Redis
    participant OB as Outbox

    C->>LB: HTTPS + JWT
    LB->>MW: route
    MW->>MW: verify token (Redis session check)
    MW->>PE: resolve role + scope + ABAC
    PE-->>MW: allow / deny
    MW->>V: pass with context
    V->>V: validate (serializer)
    V->>S: call service
    S->>RD: acquire lock if aggregate
    S->>DB: SELECT ... FOR UPDATE
    S->>DB: INSERT / UPDATE
    S->>OB: INSERT outbox (same tx)
    S->>DB: COMMIT
    S->>RD: invalidate cache keys
    S-->>V: result
    V-->>C: 200 JSON (with Idempotency-Key echoed)
```

**Rules:**

- Every write includes an outbox row in the same transaction
- Every aggregate-invariant write takes an advisory lock before read
- Every cache key has a defined invalidation event

## 6.3 Real-Time Layer

```mermaid
graph TB
    subgraph App["Client"]
        WC[WS client<br/>cursor store]
        REST[REST client]
        BUF[Offline buffer<br/>SQLite]
    end

    subgraph Server["Server"]
        WSG[WS gateway<br/>Daphne]
        CH[Channel layer<br/>Redis pub/sub]
        ST[Redis Streams<br/>replay log]
        RESTAPI[REST API]
    end

    WC -->|subscribe + resume_from| WSG
    WSG --> CH
    WSG --> ST
    ST -->|replay| WC
    CH -->|live| WC
    WC -->|ack + cursor| WSG
    BUF -->|replay on reconnect| RESTAPI
    RESTAPI -->|response| BUF
```

**Channel taxonomy:**

| Channel | Subscribers | Events |
|---|---|---|
| `ws/orders/{id}` | Customer (per active order) | Status, rider location, ETA, POD trigger |
| `ws/rider/{id}/tasks` | Rider | Offers, task updates, withdrawals |
| `ws/rider/{id}/custody` | Rider | Threshold alerts, remittance due |
| `ws/ds/{id}/pick-queue` | Pickers | New orders, priority changes |
| `ws/ds/{id}/arrivals` | DS staff | Rider approaching |
| `ws/ds/{id}/alerts` | DS staff | Low stock, holds, aging |
| `ws/wh/{id}/tasks` | WH staff | Inbound, putaway, outbound |
| `ws/admin/live-ops` | Admin | Snapshot + tail |
| `ws/admin/holds` | Admin | Holds aging |

## 6.4 External Integrations

| Integration | Direction | Protocol | Frequency |
|---|---|---|---|
| Payment gateway | Out (initiate), In (webhook) | REST + webhook | Per order |
| Maps / routing | Out | REST | Per route decision |
| Push (FCM/APNs) | Out | REST | Per notification |
| SMS / WhatsApp | Out | REST | Per OTP / alert |
| OTP provider | Out | REST | Per auth |
| GST / e-invoice | Out | REST | Per delivered order |
| Weather feed | In | REST | Every 15 min per DS |
| Weighbridge | In | Serial/TCP adapter → REST | Per vehicle |
| Label printer | Out | ZPL over network | Per label |
| RF scanner | In | Native app → REST | Continuous |

---

# 7. Deployment Architecture

## 7.1 Kubernetes Topology

```mermaid
graph TB
    subgraph Ingress["Ingress"]
        ING[Nginx ingress<br/>TLS termination]
    end

    subgraph Cluster["Kubernetes Cluster"]
        subgraph HTTP["HTTP Tier"]
            H1[api-http-1]
            H2[api-http-2]
            H3[api-http-3]
        end

        subgraph WS["WS Tier"]
            W1[api-ws-1]
            W2[api-ws-2]
        end

        subgraph Worker["Worker Tier"]
            CW1[celery-worker-1]
            CW2[celery-worker-2]
            CB[celery-beat]
            OW[outbox-worker]
        end

        subgraph CronJobs["Scheduled Jobs"]
            J1[expiry-job]
            J2[staged-aging]
            J3[payout-batch]
            J4[hash-chain-verify]
            J5[invariant-checks]
        end
    end

    subgraph Data["Data Tier"]
        PGP[(PostgreSQL primary)]
        PGR[(PostgreSQL replica)]
        RDS[(Redis)]
        TS[(TimescaleDB)]
        S3[(S3 buckets)]
    end

    ING --> H1 & H2 & H3
    ING --> W1 & W2
    H1 & H2 & H3 --> PGP & RDS & S3
    H2 -.-> PGR
    W1 & W2 --> RDS & PGP
    CW1 & CW2 --> PGP & RDS & TS
    CB --> CW1 & CW2
    OW --> RDS
    J1 & J2 & J3 & J4 & J5 --> PGP & RDS
```

## 7.2 Environment Strategy

| Env | Purpose | Deploy trigger | Data |
|---|---|---|---|
| `local` | Dev machines | Manual | Seeded fixtures |
| `dev` | Integration | Every merge to `main` | Anonymized seed |
| `staging` | Pre-prod | Release tag | Weekly prod copy (anonymized) |
| `prod` | Live | Manual approval after staging | Real |

**Parity rule:** same Docker image across all environments; only config differs.

## 7.3 Deployment Flow

```mermaid
flowchart LR
    PR[PR] --> CI[CI pipeline]
    CI -->|green| MAIN[main]
    MAIN --> DEV[dev auto]
    DEV --> TAG[tag release]
    TAG --> STG[staging auto]
    STG --> TEST[E2E + perf]
    TEST -->|pass| APP{Approval}
    APP -->|yes| PROD[prod blue-green]
    PROD --> CAN[canary 5%]
    CAN -->|healthy| FULL[100% rollout]
    CAN -->|unhealthy| RB[auto rollback]
```

## 7.4 Autoscaling

| Service | Metric | Min | Max |
|---|---|---|---|
| api-http | CPU 70% OR RPS | 3 | 20 |
| api-ws | active connections | 2 | 10 |
| celery-worker | queue depth | 2 | 15 |
| outbox-worker | outbox lag | 1 | 5 |

---

# 8. Security Architecture

## 8.1 Defense in Depth

```mermaid
graph TB
    subgraph L1["Layer 1 — Edge"]
        WAF[WAF, DDoS, rate limit]
    end
    subgraph L2["Layer 2 — Transport"]
        TLS[TLS 1.3, HSTS, cert pinning mobile]
    end
    subgraph L3["Layer 3 — Auth"]
        JWT[JWT RS256, refresh rotation, MFA, QR-bound shifts]
    end
    subgraph L4["Layer 4 — Authz"]
        RBAC[RBAC + data scope + ABAC]
    end
    subgraph L5["Layer 5 — App"]
        VAL[Input validation, ORM only]
    end
    subgraph L6["Layer 6 — Data"]
        ENC[Encryption at rest, PII masking, SQLCipher]
    end
    subgraph L7["Layer 7 — Secrets"]
        VLT[Vault, 90d rotation]
    end
    subgraph L8["Layer 8 — Audit"]
        AU[Hash-chained immutable log]
    end
    subgraph L9["Layer 9 — Runtime"]
        RT[Non-root, read-only FS, network policies]
    end
    subgraph L10["Layer 10 — Supply"]
        SBOM[Signed images, SBOM, dep scanning]
    end

    L1 --> L2 --> L3 --> L4 --> L5 --> L6 --> L7 --> L8 --> L9 --> L10
```

## 8.2 Authentication by Client

| Client | Method | Access TTL | Refresh | Device bind |
|---|---|---|---|---|
| Customer | Phone + OTP | 15 min | 30 days | No (OTP is factor) |
| Rider | Phone OTP + device bind + QR shift | 15 min | 30 days | Yes |
| Staff | Badge + PIN | **30 min shift-bound** | **None** | Yes (scanner) |
| Admin | Email + MFA | 15 min | 8h | Yes |
| Service | mTLS + API key | — | Rotated 90d | Yes |

## 8.3 Authorization Model

```mermaid
graph TB
    R[Request] --> A[Authenticated?]
    A -->|no| DENY[401]
    A -->|yes| B[Role → permissions]
    B --> C[Data scope check]
    C -->|site/zone/seller| D[ABAC rules]
    D -->|thresholds, MFA, geo, device| E{Allow?}
    E -->|yes| GRANT[Proceed + field masking]
    E -->|no| DENY2[403 with reason]
```

**Three layers enforced server-side, always.** UI hides; API enforces.

## 8.4 PII Handling

- Phone, email, address, bank → encrypted at column level (KMS)
- Logs redact PII via middleware
- Analytics uses hashed user IDs
- Right to erasure: soft-delete + anonymize after retention window
- PII access itself is logged in the audit trail

---

# 9. Observability Architecture

## 9.1 Three Pillars + Tracing

```mermaid
graph LR
    subgraph App["Application"]
        API[api-http]
        WS[api-ws]
        CW[celery-worker]
    end
    subgraph Metrics["Metrics"]
        PROM[Prometheus] --> GRAF[Grafana]
    end
    subgraph Logs["Logs"]
        LOKI[Loki] --> GRAF
    end
    subgraph Traces["Traces"]
        OTEL[OTel Collector] --> JAEGER[Jaeger]
    end
    subgraph Errors["Errors"]
        SENT[Sentry]
    end
    API & WS & CW -->|push| PROM
    API & WS & CW -->|structured JSON| LOKI
    API & WS & CW -->|spans| OTEL
    API & WS & CW -->|exceptions| SENT
    PROM --> PD[PagerDuty]
```

## 9.2 Golden Signals (per context)

| Context | Primary metric | Alert threshold |
|---|---|---|
| routing | p99 route decision | > 500 ms |
| ds_ops | pick queue depth | > 20 for 5 min |
| delivery | active riders / demand | < 1.2 |
| payments | capture success rate | < 95% over 5 min |
| cod_custody | rider cash / ceiling | > 90% |
| refunds | open refunds > T+2 | any |
| inventory | ledger mismatch | any (P1) |
| outbox | pending events | > 1000 |
| ws | drop rate | > 20% |
| gps_ingest | ingest lag | > 10 s |
| holds | unescalated > 72h | any |

## 9.3 Business KPIs (live dashboards)

- Orders/min (vs 1h avg)
- Fill rate (lines shipped complete)
- On-time dispatch %
- Dock-to-stock time
- Pick accuracy %
- Delivery SLA compliance %
- COD collection rate
- Rider utilization

---

# 10. Operational Workflows (End-to-End)

## 10.1 Vendor → MH → Shelf

```mermaid
sequenceDiagram
    participant V as Vendor
    participant MH as MH Staff
    participant QC as QC Inspector
    participant PA as Putaway Op
    participant INV as Inventory Ledger

    V->>MH: ASN (PO + lines)
    MH->>MH: Dock slot, gate check-in
    MH->>MH: Scan LPN → SKU → qty (batch, expiry)
    QC->>MH: Sample inspect (AQL, FSSAI if food)
    alt Accepted
        MH->>INV: Movement: EXT → QC_PASSED_STAGING
        PA->>MH: Scan destination bin + SKU
        MH->>INV: Movement: QC_PASSED_STAGING → RESERVE/PICK_FACE
        Note over INV: Sellable +, ATP updated
    else Rejected
        MH->>INV: Movement: → DAMAGE / EXPIRY / RTV_STAGING
    end
```

## 10.2 MH → DS Replenishment

```mermaid
sequenceDiagram
    participant JOB as Replen Job
    participant MH as MH
    participant SORT as Sorting
    participant TR as Transport
    participant DS as Dark Store

    JOB->>MH: DS stock < min → transfer order
    MH->>MH: FEFO allocation, picklists created
    MH->>MH: Wave pick (2-scan)
    MH->>SORT: Chute per DS destination
    SORT->>SORT: Scan tote → chute → mis-sort check
    SORT->>SORT: Chute ↔ manifest reconciliation
    MH->>MH: Pack station (scan tote → SKU → seal)
    MH->>TR: Trip created, vehicle assigned
    TR->>MH: Load scan → SEALED_BAG → IN_TRANSIT
    TR->>DS: Arrive, unload
    DS->>DS: Receipt scan → RECEIVED_STAGING
    DS->>DS: Putaway → SHELF (sellable)
```

## 10.3 Customer Order (Core Revenue Flow)

```mermaid
sequenceDiagram
    participant C as Customer
    participant API as Backend
    participant RT as Routing
    participant P as Picker
    participant PK as Pack
    participant R as Rider
    participant POD as POD
    participant INV as Invoicing
    participant E as Earnings

    C->>API: Place order (idempotency key)
    API->>RT: route (band + hours + stock)
    RT->>API: DS selected, reservation HELD
    API->>API: payment webhook → CONFIRMED
    par ETA-aware parallel dispatch
        API->>P: pick task (immediate)
    and
        API->>R: offer when now + ride_eta ≥ pick_eta − 60s
    end
    R-->>API: ACCEPT (atomic claim)
    P->>API: 2-scan pick → DROPOUT
    P->>PK: pack + seal (+ insulated if cold)
    PK->>API: PRICE_FINALIZED
    API->>API: COD amount synced to rider
    PK->>API: STAGED at bin
    R->>API: per-bag handover scan
    Note over R: 200m → auto-open POD
    R->>POD: OTP / UPI / Cash / Photo
    POD->>API: DELIVERED
    API->>INV: invoice
    API->>E: rider earning accrued
```

## 10.4 Return / RTO / RTV

```mermaid
sequenceDiagram
    participant C as Customer
    participant API as Backend
    participant R as Rider
    participant DS as DS
    participant MH as MH

    C->>API: Raise return
    API->>R: Pickup task
    R->>C: Pickup at doorstep
    R->>DS: Drop at DS
    DS->>API: Receipt + QC inspection
    alt Restock
        API->>API: Movement RETURN_STAGING → SHELF
    else Damage
        API->>API: Movement → DAMAGE
    else RTV
        API->>API: Movement → RTV_STAGING
        API->>MH: Reverse transit
        MH->>API: Reverse receipt
    end
    API->>C: Refund initiated
```

## 10.5 Cancel Arbiter

```mermaid
stateDiagram-v2
    [*] --> Requested: customer / support
    Requested --> CheckState: lock order row
    CheckState --> PaymentInFlight: payment INITIATED/PROCESSING
    CheckState --> PickerActive: PICKING
    CheckState --> Sealed: PACKED/STAGED
    CheckState --> RiderActive: RIDER_ASSIGNED
    CheckState --> PickedUp: PICKED_UP/OUT_FOR_DELIVERY
    CheckState --> Delivered: DELIVERED

    PaymentInFlight --> WaitPayment: register intent (15 min TTL)
    PickerActive --> Interrupt: pick.interrupt → return-to-bin
    Sealed --> Unseal: non-cold → unseal → return
    Sealed --> HoldAudit: cold → HOLD_AUDIT
    RiderActive --> Withdraw: withdraw task, no penalty
    PickedUp --> Recall: recall to DS → refund
    Delivered --> [*]: reject (raise return)

    WaitPayment --> [*]: payment terminal → decide
    Interrupt --> [*]: ack → CANCELLED
    Unseal --> [*]: ack → CANCELLED
    Withdraw --> [*]: ack → CANCELLED
    Recall --> [*]: receipt → CANCELLED
```

---

# 11. Non-Functional Requirements

| Category | Metric | Target |
|---|---|---|
| **Performance** | Order API p99 | < 300 ms |
| | Routing decision p99 | < 500 ms |
| | WS message latency | < 500 ms |
| | GPS ingest lag | < 5 s |
| **Scale** | Order throughput | 10k/hour/cluster |
| | Concurrent riders | 500/city |
| | Concurrent pickers | 200/DS |
| | WS connections | 50k/cluster |
| **Reliability** | Availability | 99.9% monthly |
| | RPO (PostgreSQL) | 5 min |
| | RTO (PostgreSQL) | 1 hour |
| | Outbox lag | < 5 min |
| **Security** | Auth TTL | 15 min access |
| | Audit retention | 7 years |
| | PII encryption | At rest + transit |
| **Compliance** | GST invoicing | Per delivered order |
| | DPDP retention | Enforced per data class |
| | FSSAI | Hard block on food |

---

# 12. Build & Delivery

## 12.1 Roadmap (49 weeks, 8–12 engineers)

| Phase | Weeks | Delivers |
|---|---|---|
| 0 | 2 | Foundation: IAM, outbox, idempotency, audit, hash-chained ledger, ownership columns |
| 1 | 2 | Multi-site, serviceability (bands + hours), barcode master, scanner registration |
| 2 | 3 | Vendor PO/ASN/GRN + gated putaway (MH) + license registry + bin/zone QR |
| 3 | 3 | DS inbound + gated putaway + go-live checklist |
| 4 | 4 | Hub: pick, pack, price finalization, bin transfer, staff shifts |
| 5 | 3 | Sorting + MH pack + TO lifecycle |
| 6 | 4 | Customer app + routing + COD flow + substitution prefs |
| 7 | 4 | Go app: QR shift, per-bag handover, POD, custody, earnings screen |
| 8 | 3 | Arbiter + ETA dispatch + batching + staged-aging |
| 9 | 3 | Wallet + refunds + clawback |
| 10 | 3 | GST invoicing + reconciliation |
| 11 | 3 | Reverse: returns/RTO/RTV/RTS |
| 12 | 2 | Holds + audit + DPDP + expiry sweep + cycle count |
| 13 | 2 | Support console + fraud + address hygiene |
| 14 | 4 | Single-DS pilot |
| 15 | 4 | Hardening + load + security + DR drill |

## 12.2 Launch Blockers

**Must ship:** gated putaway (MH + DS) · barcode master + scan resolution · bin/scanner/LPN masters · price finalization at pack · COD custody ledger + ceiling + exact-amount sync · cancel arbiter (lock ordering + advisory locks + mirror CAS) · return entity + RTV/RTS · GPS ingest (not outbox) · invoicing at DELIVERED · per-bag handover scan · penny-drop COD refunds · staged-aging engine · ledger ownership columns · movement preconditions + PENDING_CUSTODY · POD-evidence table · DB enum as single source + registry↔DB CI · minimal support console · earnings screen in rider app.

**Never defer:** ownership columns, barcode master, per-bag handover, arbiter, COD ledger, gated putaway, earnings screen.

## 12.3 Verification Mechanism

- **Matrix-as-data:** `matrix.yaml` → `matrix_expected` table; CI asserts seed ≡ matrix
- **Registry-as-law:** event schemas as JSON Schema; CI asserts producers/consumers exist
- **Scripted self-checks:** no prose assertions; all counts and checks are executed and pasted
- **Test suite:** 10 new cases + standing suite; PR-fast / nightly-slow / pre-release-chaos

---

# 13. Summary

**Zippzo is a fully specified quick-commerce platform with:**

| Element | Count |
|---|---|
| Client applications | 6 |
| Bounded contexts | 19 |
| Container types | 21 (14 physical, 3 virtual, 2 money, 2 terminal) |
| Movement matrix | 33 logical movements → 46 seed rows |
| Invariants | 33 |
| Pipelines | 26 |
| Event types | 48 |
| Companion specs | 16 |
| Build phases | 16 |
| Roadmap | 49 weeks |

**Architecture principles in one line each:**

1. **MH controls, DS fulfils, rider delivers** — clear separation
2. **Stock is not sellable until putaway confirms** — receipt ≠ availability
3. **Every physical touch is a scan** — barcode master is law
4. **Ledger is truth; balances are projection** — append-only, hash-chained
5. **Custody records are always accepted; task actions are CAS-gated** — physical reality can't be lost
6. **POD is evidence; state is server-authoritative** — fraud-resistant
7. **WS carries hints; REST carries truth** — offline resilience by design
8. **COD is an operating mode, not a payment method** — cash ledger is first-class
9. **Events written in the DB transaction that made the change** — no lost events
10. **Every aggregate invariant takes a lock before read** — no concurrent violations

**The design is complete. The next step is `make migrate` against real Postgres 16.**

---