# Zippzo WMS, Dark Store, Rider and Consumer build checklist

## Product-boundary correction (current direction)

- [x] Hide physical stock execution routes from WMS management web navigation
  and block stale/direct tab selections with an app-only task screen.
- [x] Hide receiving, putaway, picking, packing, shelf movement, return intake,
  and rider handoff routes from Dark Store management web navigation and block
  stale/direct tab selections.
- [x] Keep app-only routing tied to the explicit operations-app surface rather
  than treating every narrow browser viewport as the floor app.
- [x] Remove camera/barcode scanning controls from replenishment order planning
  and transfer-order setup; web users select and search planned order lines.
- [x] Make warehouse relocation controls available only in the floor app;
  management web inventory views are read-only.
- [x] Route the WMS web home to its management dashboard and keep the task
  launcher in the operations app.
- [ ] Split mixed web views into separate management actions and mobile task
  execution APIs/screens; audit every web button for writes to physical stock.
- [x] Replace the separate WMS/DS staff login entry flow with one employee
  identity, OTP verification, assignment/site chooser, role-based routing, and
  backend-enforced facility scope for both web and app.
- [x] Implement the staff mobile client in React Native / Expo with shared
  iOS/Android code, login, facility selection, OTP, My Work, camera scan and
  pending-sync queue. Native builds and device acceptance remain open below.
- [ ] Run a complete role/site permission and software-versus-app workflow
  audit after the surfaces are split.

This checklist tracks the separate WMS and Dark Store staff products, plus the
rider and consumer applications. WMS and Dark Store share one staff identity
and backend inventory records, with distinct app entry points, facility-scoped
login, navigation, and task queues.

## Completed in the current build

- [x] Separate operations web and floor-app entry points in React/Vite.
- [x] Facility-aware floor home with direct entry to warehouse and dark-store
  work queues.
- [x] Backend tests for warehouse receiving/QC/putaway/bin sorting/LPN packing,
  dark-store receiving/shelf/returns/handoff, staff assignments, and order pick.
- [x] Add isolated SQLite regression coverage for GRN completion, putaway-task
  repair/idempotency, post-receipt QC acceptance, and re-QC after stock placement.
- [x] Browser routing checks for the warehouse putaway and dark-store picking
  floor surfaces.
- [x] Fix relative `/api` WebSocket URL creation and remove remote font loading
  from the operations web entry.
- [x] Add durable in-app order placement/lifecycle and delivery OTP
  notifications, plus a Notifications inbox in the operations apps.
- [x] Notify customers and riders when a rider accepts a job, and notify
  customers when the rider starts delivery or arrives.
- [x] Notify workers when putaway, dark-store pick, or pack work is assigned.
- [x] Publish outbox events after the source transaction commits, with inbox
  reads remaining as the recovery path.
- [x] Show unread notification counts in WMS, rider, and customer navigation.
- [x] Complete recipient coverage for QC, dispatch, exception, and task
  lifecycle events (`warehouse.qc.assigned`, `warehouse.qc.exception`,
  `warehouse.transfer.dispatched`, `warehouse.grn.completed`,
  `warehouse.inbound.discrepancy`, `warehouse.putaway.completed`), including
  site supervisor routing and idempotent dispatch.
- [x] Generate accepted-stock putaway tasks after GRN completion and repair
  missing tasks safely when the completion endpoint is replayed.
- [x] Hub transfer through destination dark-store receipt and shelf putaway end-to-end
  regression with outbox event persistence and string/UUID aggregate ID coercion.
- [x] Verify operations floor application facility routing and dark-store fulfillment
  stepper navigation.
- [x] Close `PackSealView` UI ↔ backend gap: transfer-associated tote creation
  (`POST /inventory/lpns/` with `transfer` param), per-unit scan commit to stock
  ledger via `LpnContentViewSet._validate_and_commit()` (OUT from source bin, IN to
  LPN), pick-qty ceiling enforcement, overpack rejection (400), partial-transfer
  `PACKING` state, empty-tote seal refusal (400), retry/idempotency on duplicate
  scan POST, and transfer status promoted to `PACKED` on seal — all proven by
  `TransferPackingUiWorkflowTests` (8/8, SQLite). Tests create the LPN-to-transfer
  relationship through the API; completed pick tasks are setup fixtures.
- [x] Lot resolution for multi-lot picks: `PackSealView.resolveLot()` calls
  `GET /catalog/lots/` — proven by `TransferPackingUiWorkflowTests` (8/8, SQLite,
  no direct DB edits). Tests prove: (1) `GET /catalog/lots/?sku=...&site=...&status=AVAILABLE`
  filters strictly by SKU, site, and status with FEFO ordering (earliest expiry first);
  (2) When `PickTask.lot` is null/unassigned, UI resolves the lot via the catalog API,
  scans/commits units under the resolved lot to LpnContent, correctly moves bin stock to LPN,
  and freezes the lot/batch in the tote manifest upon sealing; (3) Totes spanning multiple lots
  of the same SKU commit separate LpnContent lines, deduce stock accurately from the specific
  source bins, enforce the total SKU pick-qty ceiling across lots (rejecting overpacks with 400),
  and freeze all lots in the sealed manifest.
- [x] Extend the UI-created tote journey through outbound dispatch, destination dark-store receipt,
  and shelf putaway: reconcile source, in-transit, and destination stock so
  receipt cannot duplicate network inventory; clear source LPN custody on dispatch and ensure
  idempotent re-clearing on receipt; support partial receipt across multiple LPNs with transfer status
  advancing from PACKING -> PACKED -> IN_TRANSIT -> RECEIVED; enforce destination store matching with
  transactional rollback on receipt/shelving errors; publish `TRANSFER_DISPATCHED` and `LPN_RECEIVED`
  outbox notifications to store supervisors — all proven by `TransferStockAccountingLifecycleTests`
  (3/3, 35/35 scan-first warehouse suite, SQLite, no direct DB edits for transfer/LPN linkage).
- [x] Close Supplier Inbound Receipt -> QC Inspection -> Putaway live UI/API journey end-to-end:
  trace ASN creation (`POST /supply/asns/`, `/supply/asn-lines/`), receipt opening (`POST /supply/grns/`,
  `/supply/grn-lines/`, `PATCH /supply/asns/{id}/`), unit scanning (`PATCH /supply/grn-lines/{id}/`),
  lot registration (`POST /catalog/lots/`), lot linking, GRN completion (`POST /supply/grns/{id}/complete/`)
  with uninspected units creating 0 tasks and 0 balances; QC inspection (`POST /supply/qc-inspections/`,
  `/supply/qc-inspections/{id}/verify/`) generating `PutawayTask` only for accepted units and quarantining
  damaged units with `warehouse.qc.exception` outbox events; worker task assignment (`POST /supply/putaway-tasks/{id}/assign/`);
  split bin placement with capacity enforcement (`POST /supply/putaway-tasks/{id}/place/`); and putaway
  confirmation (`POST /supply/putaway-tasks/{id}/complete/`) live-posting sellable stock to bins and dispatching
  `PUTAWAY_COMPLETED` notifications to supervisors; verify retry idempotency and atomic rollback on
  invalid/overcapacity requests — proven by `SupplierInboundPutawayUiWorkflowTests` (3/3, 38/38 scan-first
  warehouse suite, SQLite, no direct DB edits).
- [x] Finish customer order pick through packing and rider handoff live UI/API journey.
     Proven by `CustomerOrderFulfillmentWorkflowTests` (3/3, SQLite, no direct DB edits):
     checkout → pick assignment/scan → COMPLETE_PICK → pack/seal (tote+staging) →
     rider accept → tote pickup → EN_ROUTE/ARRIVED → POD OTP flow → DELIVERED + COD
     settlement + tote recycle; 11 safety guards (oversell, cross-store access, wrong-bin
     scan, premature complete, busy-tote pack, rider conflict, wrong-tote pickup, OTP
     snoop/mismatch, negative COD); full idempotency/replay safety (scan, complete, pack,
     accept, pickup, POD — all idempotent). Fixed: `already_applied` guard reordered before
     `outstanding <= 0` in `pick_scan.py`; `order.picked_up → ORDER_ON_THE_WAY` mapping
     restored in `notifications/publish.py`.
- [x] Verify realtime and offline/polling recovery on each app surface.
     Proven by:
     - RealtimeAndOfflineRecoveryTests (7/7, SQLite):
       1. Disconnect & outbox queuing: events persist durably in OutboxEvent while clients are offline.
       2. Reconnect inbox catch-up: GET /api/notifications/notifications/ and unread_count/ trigger _drain_outbox(), delivering all missed updates across WMS floor staff, rider, and customer apps.
       3. Duplicate event delivery protection: repeatedly publishing or draining outbox generates 0 duplicate notifications (deduplicated by idempotency_key = {event_id}:{user_id}:{channel}).
       4. Inbox read state idempotency: single-item mark_read and batch mark_all_read update timestamps cleanly without error on re-call.
       5. Offline scan replay: dark store pick scan replay with identical scan_id via POST /api/ds-ops/pick-line returns lready_applied: True with 0 duplicate shelf deductions; pack scan replay via POST /api/inventory/lpn-contents/ returns 200 without duplicate LpnContent rows; rider task accept and advance replays are idempotent; rider pickup and POD OTP submission replays refuse duplicates with 409 without double-counting COD or custody balances.
       6. Atomic rollback on conflict: rejected scans (wrong bin, overpick) leave physical inventory untouched and return 409 conflict errors for operator resolution.
     - rontend/tests/offline-queue.test.mjs (7/7, Node.js):
       1. Durability: queued scans survive client reload/restart via localStorage.
       2. FIFO ordering: queued actions flush sequentially in order of creation.
       3. Idempotent replay: HTTP 409 / lready_applied marks queued items processed without error.
       4. Rejection handling: validation failures mark items as REJECTED for review.
       5. Operator retry: rejected actions can be retried or dismissed individually.
       6. Network resilience: network/5xx errors halt the queue without dropping pending items.
       7. Event broadcasting: queue mutations trigger zippzo:offline-queue-updated and notify UI listeners.
     - Realtime & polling recovery wiring:
       - AuthContext.jsx: WebSocket onopen broadcasts { type: 'reconnected' } event; window.ononline triggers immediate reconnect and queue flush.
       - useDarkStore.js: floor app views refresh state automatically on zippzo:live-event, online, and isibilitychange events.
       - ScanInput.jsx: renders pending queue counter and rejected scan badges with Retry/Dismiss buttons.
- [ ] Validate barcode camera and Bluetooth scanner behavior on supported
  Android and iOS devices at a real facility.
- [ ] Verify offline scan queue/retry semantics and conflict recovery on-device.
- [ ] Complete production WMS sign-off: role/facility access review, audit trace,
  exception recovery, and backup/restore rehearsal.

## Native operations app acceptance

- [x] Create the React Native / Expo operations app for shared iOS and Android
  source code; see `mobile/` and `docs/MOBILE_BUILD_AND_ACCEPTANCE.md`.
- [ ] Build and install on an iOS simulator/device using macOS and Xcode.
- [ ] Configure Apple bundle signing, app icons/splash assets, and release
  provisioning before TestFlight/App Store distribution.
- [ ] Test login, notification recovery, camera scanning, keyboard scanner
  input, offline reconciliation, and task completion on iOS hardware.

## Remaining product milestones

- [ ] Verify and sign off separate WMS and Dark Store facility login, UI
  boundaries, facility-level API authorization, and device workflows.
- [ ] Complete rider app build and device validation after WMS sign-off.
- [ ] Complete consumer web/app checkout and device validation after rider
  handoff is stable.
- [ ] Set up production payment, push, email/SMS, monitoring, and support
  providers with real credentials and operational runbooks.
