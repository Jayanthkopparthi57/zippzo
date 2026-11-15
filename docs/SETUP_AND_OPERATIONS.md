# Zippzo Operations Platform — Setup, Environment and Operations Guide

## Prerequisites

- Python 3.11+ with Django 5.x
- PostgreSQL 16 (with PostGIS/TimescaleDB optional for full feature set)
- Redis (for Channels/Celery; optional in single-process dev via `CHANNELS_IN_MEMORY=1`)
- Node 20+ and npm (frontend + mobile)
- For mobile: Expo CLI (`npx expo`), and for native builds Xcode (iOS) or Android Studio (Android)

## Backend setup

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
cp .env.example .env              # then edit
python manage.py migrate
python manage.py createsuperuser   # or load seed data
set CHANNELS_IN_MEMORY=1           # PowerShell: $env:CHANNELS_IN_MEMORY="1" (local only, if Redis is not running)
python manage.py runserver 0.0.0.0:8000
```

`daphne` is included in `requirements.txt` and enabled in `INSTALLED_APPS`, so
Django's local `runserver` uses Daphne's ASGI integration for the notification
WebSocket route. For production, start the ASGI app with Daphne (as configured
in `render.yaml` and the Docker image), not Gunicorn's WSGI entry point.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DJANGO_ENV` | `development` | Set to `production` on Render. Disables dev-only behaviour. |
| `DEBUG` | `True` | Must be `False` in production. |
| `DJANGO_SECRET_KEY` | (placeholder) | Required in production. |
| `DATABASE_URL` / `POSTGRES_*` | local | PostgreSQL connection. |
| `REDIS_URL` | `redis://localhost:6379/0` | Used by Channels and Celery. |
| `CHANNELS_IN_MEMORY` | `False` | Single-process dev without Redis. |
| `OTP_DEV_ECHO` | `False` | Set to `1` only for development/tests with `DEBUG=True` and no configured OTP sender. Never enabled in production; when an SMTP sender exists, the code is not echoed to the client. |
| `IAM_ADMIN_OTP_REQUIRED` | `True` | Estate roles (`SUPER_ADMIN`, `ADMIN`, `OPS_MANAGER`) always need a one-time code by default. Setting it to `False` lets them sign in with password + facility in a local environment only; `DJANGO_ENV=production` forces it back on. Field employees are never exempt. |
| `IAM_OTP_SENDER` | SMTP sender when email credentials exist | Optional dotted callable path for a custom approved SMS/email provider. SMTP is auto-wired from `EMAIL_USER` / `EMAIL_PASS`. |
| `VITE_API_BASE` | (same origin) | Frontend API base for native shells. |

## Migrations

```bash
python manage.py makemigrations --check --dry-run   # must report "No changes detected"
python manage.py migrate
```

Key migrations added by this work:

- `bounded/iam/migrations/0003_session_facility_session_last_used_at_and_more.py`
  (`Session` gains `surface`, `facility`, `revoked_at`, `last_used_at`; adds `LoginChallenge`.)
- `bounded/inventory/migrations/0007_stock_adjustment_and_unique_idempotency.py`
  (unique `StockMovement.idempotency_key`; new `StockAdjustment` model.)
- `bounded/inventory/migrations/0008_stock_adjustment_replay_key.py`
  (replay key on `StockAdjustment`.)

## Frontend (web console)

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
npm run lint
npm run build
```

Products are selected by HTML entry point (`index.html` WMS, `darkstore.html`
Dark Store, `shopper.html`, `rider.html`, `operations-app.html` floor app).
The web console is management-only: no camera/scanner controls and no physical
stock-commit actions.

## Mobile app (React Native / Expo)

```bash
cd mobile
npm install
npm run typecheck    # tsc --noEmit
npx expo start       # scan the QR code with Expo Go
npx expo run:android # native Android build (requires Android SDK)
npx expo run:ios     # native iOS build (requires macOS + Xcode)
```

The mobile app is a React Native project, not a Capacitor/WebView shell. It
shares the same employee login, OTP and facility chooser as the web console,
but runs on `surface=mobile`, which is the only surface allowed to call
physical stock endpoints.

Default API base for the Android emulator is `http://10.0.2.2:8000/api`;
override with `EXPO_PUBLIC_API_BASE`.

## Roles and workspaces

- `SUPER_ADMIN`, `ADMIN`, `OPS_MANAGER` — estate roles; administer all sites and
  may switch facilities through the validated selection endpoint.
- `WAREHOUSE_STAFF` — pinned to their active `EmployeeSiteAssignment` rows;
  selects one facility at sign-in.
- `RIDER`, `CUSTOMER`, `SENDER` — unchanged products, immediate token login.

WMS (`Site.site_type = MH`) and Dark Store (`DS`) keep separate navigation,
queues and dashboards, but share identity, catalog, ledger and notifications.

## Physical stock boundary

- Web tokens carry `surf=web`; physical endpoints require `surf=mobile` and
  return `403 physical_execution_requires_mobile`.
- Every physical write also checks `require_site_access` and
  `require_session_facility`, so a facility-A session cannot move stock at
  facility B.
- Inventory changes go through `bounded.inventory.stock.apply_stock` only.

## Known limitations

- iOS builds require macOS/Xcode/signing; not possible from this Windows
  workspace.
- Android builds require JDK + Android SDK; availability is environment-specific.
- OTP delivery needs an approved provider. SMTP is auto-configured from
  `EMAIL_USER` / `EMAIL_PASS`; production must set those in its secret store
  because the ignored local `.env` is not deployed. A custom SMS provider can
  be selected with `IAM_OTP_SENDER`. Login screens never display development
  codes. Verify real provider delivery before production use.
- A code is sent to the address stored on the staff record, not to the SMTP
  account. Seeded demo accounts use placeholder addresses such as
  `warehouse@zippzo.in`, which cannot receive mail; assign a real mailbox before
  expecting a code. The OTP screen now shows the masked destination
  (`w***@zippzo.in`) so a wrong address is visible instead of silent.
- The existing Playwright suite targets the web management surface; physical
  flows moved to mobile and are verified by TypeScript + API tests here.
- Some long-running backend tests depend on the shared development database and
  may be slow or flaky on managed Postgres.
