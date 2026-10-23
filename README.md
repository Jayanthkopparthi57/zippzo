# Zippzo Quick-Commerce Platform

A full-stack warehouse management system built with **Django REST Framework** and **React**, featuring a modular monolith backend with **19 bounded contexts**, an immutable hash-chained stock ledger, and real-time WebSocket delivery.

## Architecture

- **Backend**: Django 5.x + DRF + Celery + Django Channels
- **Database**: PostgreSQL 16 + PostGIS + TimescaleDB + Redis
- **Frontend**: React 18 + Vite + Tailwind CSS
- **Deployment**: Docker + Render.com

## Bounded Contexts (19)

| Context | Description |
|---------|-------------|
| `iam` | Users, sessions, roles, devices, QR codes, idempotency |
| `audit` | Immutable hash-chained action log |
| `outbox` | Transactional event publisher |
| `notifications` | Push, SMS, WebSocket, Email |
| `holds` | Stock holds and invariant monitoring |
| `network` | Sites, zones, bins, dock doors, vehicle types |
| `catalog` | SKUs, categories, barcodes, listings, inventory lots |
| `supply` | Vendors, sellers, ASN, GRN, QC, putaway |
| `inventory` | LPN master, stock movements, balances, hash chain |
| `orders` | Customer orders, cart, order lines, status machine |
| `routing` | DS selection, ETA, serviceability |
| `ds_ops` | Pick tasks, pack tasks, sorting waves, transfers |
| `fulfilment` | Batches, order allocations |
| `delivery` | Rider profiles, shifts, delivery tasks, routes |
| `lastmile` | POD evidence |
| `money` | Payments, refunds, COD custody, wallet, earnings |
| `reverse` | Returns, RTO, RTV, RTS |

## Quick Start

### Prerequisites
- Python 3.13+
- PostgreSQL 16
- Redis 7.x
- Node.js 18+

### Backend Setup
```bash
# Install dependencies
pip install -r requirements.txt

# Configure .env with PostgreSQL credentials
# Run migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Run development server
python manage.py runserver
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

## API Documentation
- **Swagger UI**: `http://localhost:8000/api/docs/`
- **OpenAPI Schema**: `http://localhost:8000/api/schema/`

## Database Schema
- 45+ tables across 19 bounded contexts
- Hash-chained immutable stock ledger
- 33 invariants enforced at DB level
- See `schema.sql` for complete DDL

## Key Features
- Immutable stock ledger with hash-chain auditability
- CAS-gated task actions (no concurrent violations)
- Event-driven architecture (outbox → Redis Streams)
- Real-time WebSocket updates
- FEFO inventory management
- Gated putaway (stock not sellable until confirmed)
- COD custody ledger with ceiling enforcement

## Testing

```bash
python manage.py test bounded --keepdb     # backend suite (reuses the test DB)
cd frontend && npm run lint && npm run build
cd frontend && npx playwright test          # end-to-end, ~30 min
```

Playwright drives a **seeded** development database: the five fixed accounts
(`admin` / `ops` / `warehouse` / `rider` / `customer`), one dark store with its
bins and stock, an 80+ SKU catalogue, open pick tasks and at least one
delivered order. No command creates that dataset yet (it was built up by
`pipeline_test.py` and manual runs), so the E2E suite runs locally against the
development database and is deliberately **not** a job in
`.github/workflows/ci.yml` — a run from an empty Postgres would fail on every
spec that reads pre-existing data. CI covers the backend suite, lint, both
bundles and the Capacitor API-base guard; wire an E2E job once a
`manage.py seed_demo` exists.

## Android: three apps from one web tree

```bash
cd frontend
node scripts/build-android.mjs           # all three (store, shopper, rider)
node scripts/build-android.mjs rider     # one app
node scripts/build-android.mjs --release # release instead of debug
```

Each run builds one Vite bundle, lets Capacitor sync it, then assembles the
matching Gradle flavor. APKs land in
`frontend/android/app/build/outputs/apk/<flavor>/<build>/`.

Gradle is resolved in this order: `GRADLE_CMD`, `GRADLE_HOME`, `gradle` on
`PATH`, the newest `~/.jdks/gradle-*` install, and finally the checked-in
`gradlew`. Prefer a local Gradle: the wrapper has to download its distribution
from `services.gradle.org`, which some networks block (the build then hangs
before Gradle ever starts).
