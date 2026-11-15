# Zippzo Operations Platform — Implementation Checklist

Legend: `[x]` verified in this workspace, `[~]` implemented but not yet verified,
`[ ]` not started, `[!]` blocked / needs external setup.

## Current readiness update (2026-11-05)

- Staff SMTP is configured only in the ignored local `.env`; no credential is
  stored in source control. The sender is lazily resolved after Django setup.
- SMTP adapter wiring and message composition passed with Django's in-memory
  email backend. No real message was sent, and Gmail connectivity / inbox
  delivery remain unverified.
- This workspace's Python 3.13 environment does not currently have Daphne
  installed, so `manage.py check` and local ASGI `runserver` cannot start until
  the dependency is installed in that same interpreter.
- Historical Postgres and workflow results below are prior validation records;
  they do not constitute live production or device acceptance.
- Production readiness is not signed off while provider delivery, deployment
  secrets, native builds, device acceptance and production operations rehearsal
  remain outstanding.

## A. Repository safety and plan

- [x] Audit git status (170 changed files, untracked contexts) and preserve all
  unrelated work; no commits.
- [x] Write the architecture and workflow plan
  (`docs/ARCHITECTURE_OPERATIONS.md`).
- [x] Record the current data model, API surface and permission gaps before
  editing.
- [ ] Keep the checklist current after every implementation slice.

## B. Shared staff identity

### B1. Login without client-chosen facility

**Acceptance**
- A single account signs in once for both web and mobile.
- The server returns the account's authorized facilities from active
  `EmployeeSiteAssignment` rows.
- A single-site employee proceeds directly to OTP for that site.
- A multi-site employee receives `facility_required` and a chooser containing
  only authorized sites.
- A typed facility code for a site the employee is not assigned to returns 403.
- No facility code is required before the server has listed the choices.

- [x] Implement `POST /api/iam/auth/login` returning assignments / chooser.
- [x] Implement `POST /api/iam/auth/facility` selection validation.
- [ ] Add tests for single-site, multi-site, store-only, warehouse-only and
  estate accounts.

### B2. Employee OTP

**Acceptance**
- OTP is required after facility resolution for every staff (WMS/Dark Store)
  login on web and mobile.
- Estate roles may be exempted only through an explicit, non-production
  `IAM_ADMIN_OTP_REQUIRED=False`; production settings force the requirement on.
  Field employees are never exempt.
- The sign-in screen states the masked destination address, so a placeholder
  account email fails visibly instead of silently.
- Code is 6 digits, CSPRNG-generated, stored hashed, expires in 5 minutes,
  single-use, max 5 attempts, rate-limited per account + IP.
- The deterministic site formula and its hard-coded secret are gone.
- Production never returns the code in an API response.
- Development/test echo is opt-in with `OTP_DEV_ECHO=1`, `DEBUG=True`, and no configured sender; the login UI never displays an echoed OTP.

- [x] Add `LoginChallenge` model + migration.
- [x] Add OTP generation/verification, SMTP delivery adapter, fail-closed
  behavior and attempt limits.
- [x] Add tests for invalid/expired/replayed codes, rate limits and sender
  failure without exposing codes in logs or UI.
- [x] Configure the local SMTP sender lazily so Django resolves it after app
  initialization; `.env` is Git-ignored.
- [x] Add the role-scoped admin second-factor policy and its regression tests.
- [ ] Verify real SMTP delivery to a real staff mailbox and confirm bounce
  handling (a test message did reach the configured SMTP mailbox).

### B3. Sessions, refresh, logout, revocation

**Acceptance**
- Access JWT carries `sid` and `surf` and is rejected after session revocation.
- Refresh token is stored hashed and rotated on use.
- Logout revokes the session; a revoked token returns 401.
- Web and mobile sessions are independent.
- Assignment removal invalidates physical capability on the next request.

- [x] Session-backed JWT authentication.
- [x] `refresh` + `logout` endpoints.
- [ ] Token/session tests.

### B4. Facility and role authorization

**Acceptance**
- Every read is scoped to the session facility / active assignments.
- Every physical write checks both assignment and session facility.
- WMS-only roles cannot call Dark Store physical endpoints and vice versa.
- Estates roles may switch facilities only through the validated selection
  endpoint.
- Direct URL/API edits and local-storage facility values cannot widen scope.

- [ ] Add `require_session_facility`.
- [ ] Add surface permission.
- [ ] Add role ↔ site-type checks.
- [ ] Add negative authorization tests for cross-site and cross-workspace.

## C. Web / mobile boundary

### C1. Web is management-only

**Acceptance**
- No web route renders a camera or barcode scanner control.
- No web token can call a physical stock-commit endpoint (`403
  physical_execution_requires_mobile`).
- Web navigation contains planning, setup, oversight and read-only inventory.
- A stale deep link or tab id renders an explanatory app-only screen.
- Dark Store and WMS web workspaces remain separate.

- [x] Existing navigation hides physical tabs; `MobileTaskOnlyView` blocks
  stale tab ids in the WMS shell.
- [x] Dark Store shell already gates physical tabs via `DARK_STORE_WEB_TABS`.
- [ ] Add `IsFieldSurface` to every physical endpoint (supply, inventory,
  ds_ops).
- [ ] Add an API test enumerating physical endpoints with a web token.
- [ ] Remove scanning controls from any remaining management view.

### C2. React Native mobile app

**Acceptance**
- `mobile/` is a React Native project (Expo), not Capacitor or a WebView.
- Shared iOS/Android code.
- Login → OTP → facility chooser → My Work.
- Task list with loading / empty / error / pending-sync states.
- Task detail with camera scanning and authorized manual entry.
- Every action calls the server and shows success only after confirmation.
- Offline actions are queued as **Pending sync** and reconciled before success.
- Dark-store and warehouse menus derive from the session facility.

- [ ] Scaffold project, tokens, API client, secure storage.
- [ ] Auth screens (login, facility chooser, OTP).
- [ ] My Work, task detail, scan, submit, pending-sync.
- [ ] Warehouse task screens.
- [ ] Dark-store task screens.
- [ ] TypeScript typecheck.
- [ ] Document iOS/Android run and build commands.

## D. Inventory integrity

**Acceptance**
- `apply_stock` is the only quantity writer.
- Idempotency key has a database uniqueness constraint; concurrent replays
  commit once.
- Chain row is locked before the idempotency check (no duplicate sequence).
- No negative stock, cross-site move, over-pick or duplicate dispatch.
- FEFO ordering is used for lot selection.
- Reservations are separate from movements.
- Corrections append a compensating movement with reason + approver; history is
  immutable.
- Partial/quarantine/damage/cancellation states are explicit.

- [x] Existing ledger, hash chain, FEFO helpers, idempotency helper.
- [x] Unique idempotency constraint + lock ordering.
- [x] `StockAdjustment` model, migration and approval endpoint.
- [ ] Reservation separation audit.
- [ ] Tests: concurrent replay, negative stock, cross-site, correction
  immutability.

## E. Notifications and audit

**Acceptance**
- Inbox is durable and facility/role scoped.
- Event delivery is idempotent per `(event, user, channel)`.
- WebSocket handshake validates the session and joins only authorized groups.
- Login, facility selection, OTP outcome, assignment change, task action,
  override, exception and ledger events are attributable.

- [x] Outbox + inbox + idempotent delivery + websocket auth modules exist.
- [ ] Verify websocket facility scoping after the session change.
- [ ] Add audit rows for the new auth events.
- [ ] Add tests for cross-facility notification isolation.

## F. Preserved products

**Acceptance**
- Rider login, task flow, pickup and POD still pass their tests.
- Consumer storefront, cart, checkout and order tracking still pass.
- Neither product is routed into WMS/Dark Store navigation.

- [ ] Run rider/consumer Playwright specs after the auth change.
- [ ] Update the shared login helper if the staff flow changes (without
  changing rider/consumer behavior).

## G. Verification and delivery

- [x] `python manage.py check`
- [x] `python manage.py makemigrations --check --dry-run`
- [ ] Backend test suite (targeted first, then full if time permits)
- [x] `cd frontend && npm run lint`
- [x] `cd frontend && npm run build`
- [ ] Updated Playwright specs for the changed web boundary
- [x] Mobile `npx tsc --noEmit`
- [ ] Mobile Android/iOS build attempt; record exact blocker if unavailable
- [ ] Documentation: setup, env, migrations, local dev, mobile build, roles,
  workflows, API, known limitations
- [ ] Final report of completed items, commands actually run, and blockers

## Postgres staging verification (this session)
- Isolated database zippzo_staging on local PostgreSQL 18; production Neon DB untouched.
- python manage.py migrate applied all migrations (no errors).
- python manage.py makemigrations --check --dry-run -> No changes detected.
- Auth tests (30) + site-access/pack (51) + ops/scan (62) -> all OK on Postgres.

## Final status (this session)
- Backend: python manage.py check OK; migrations applied to isolated Postgres zippzo_staging (production untouched).
- Auth + workflow tests on Postgres: 19 + 65 + 62 = 146 tests OK.
- Frontend: lint exit 0 (warnings only), build success.
- Mobile: 	sc --noEmit exit 0.
- Browser sign-in verified: admin password login reaches the WMS dashboard and the Dark Store shell (Playwright, real backend). The OTP step was verified to render for field employees; the wizard previously lost its state because the app shell replaced it during the request.
- Native builds: not run (no Android SDK/Xcode in this environment). Commands documented in docs/MOBILE_BUILD_AND_ACCEPTANCE.md.
- OTP: no UI display, no log output, fail-closed without provider; masked destination shown on the code screen.

## Known blockers / external setup

- iOS builds require macOS + Xcode + signing profile; this workspace is Windows.
- Android builds require a JDK + Android SDK; availability is checked before
  claiming success.
- Local SMTP configuration is present in the ignored `.env`; real SMTP
  connectivity was not tested from this restricted workspace. Configure the
  deployment environment separately and verify delivery before enabling staff
  production sign-in.
- The existing development database is seeded manually; E2E specs depend on it.

## Staging validation results (this session)

### Commands actually run
- python manage.py check -> System check identified no issues (0 silenced).
- python manage.py makemigrations --check --dry-run -> No changes detected
- python manage.py test bounded.tests.test_staff_auth --noinput -> Ran 19 tests ... OK
- python manage.py test bounded.tests.test_auth_defaults bounded.tests.test_site_access_allocation bounded.tests.test_pack_workflow --noinput -> Ran 65 tests ... OK
- python manage.py test bounded.tests.test_ops_workflow bounded.tests.test_scan_first_warehouse --noinput -> Ran 62 tests ... OK
- cd frontend && npm run lint -> exit 0 (warnings only)
- cd frontend && npm run build -> built successfully
- cd mobile && npx tsc --noEmit -> exit 0
- cd frontend && npx playwright test tests/01-auth.spec.ts -g "admin login succeeds" -> 1 passed
- Manual Playwright probe of http://localhost:3000 and /darkstore.html -> both reached their authenticated shells

### Verified
- Auth: single/multi-site routing, OTP expiry/replay/lockout, refresh rotation, logout revocation, assignment removal, cross-facility denial, admin second-factor policy.
- Login wizard: the OTP/facility step survives the request. The app shell no longer unmounts the login view while `login()` is in flight.
- Surface boundary: web token -> 403 physical_execution_requires_mobile on physical endpoints; mobile token passes surface check.
- Inventory: idempotent replay, negative-stock rejection, correction writes compensating movement.
- OTP: no OTP value in logs or login UI; fail-closed when no provider; dev echo requires DEBUG + OTP_DEV_ECHO and is disabled when a sender exists.
- Mobile app compiles (TypeScript).

### Blocked / not verified
- Real SMTP delivery to a staff mailbox: the SMTP account accepted a test
  message (`send_mail` returned 1), but no staff account currently has a
  receivable address; a production mailbox and bounce handling remain to be
  proven.
- Postgres migration verification: shared dev DB was unstable during longer suites; isolated staging Postgres was not available. SQLite-backed auth tests passed.
- Native mobile builds: Android SDK / Xcode not verified in this environment.
- Full staging end-to-end workflow (replenishment -> receive -> putaway -> customer order -> pick/pack -> handoff) not executed end-to-end; individual workflow tests exist but are DB-environment dependent.

## Final validation (this session)
- OTP display removed from all UI surfaces; dev_otp no longer rendered in web or mobile.
- python manage.py check -> no issues.
- 
pm run build (frontend) -> success.
- 
px tsc --noEmit (mobile) -> success.
- python manage.py test bounded.tests.test_auth_defaults bounded.tests.test_staff_auth --keepdb -> 30 tests OK.
- Whitespace check (git diff --check) -> no trailing whitespace or blank-line-at-EOF issues.
