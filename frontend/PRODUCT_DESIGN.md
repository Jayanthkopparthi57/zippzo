# Zippzo app design

> **Current product boundary (supersedes any older surface notes below):**
> WMS and Dark Store share one staff identity and sign-in. The backend routes
> staff to assigned facility/workspace after OTP and role validation. Management
> software is for setup, orders, work planning/release, workforce, monitoring,
> exceptions and read-only stock/audit views. The operations app is the only
> surface for physical work: receiving, scanning, QC, putaway, bin/shelf moves,
> picking, packing, dispatch, counts, returns and rider handoff. No software
> page may scan or commit a physical stock movement. WMS and DS workflows remain
> separate after routing; each API is scoped to the employee's assigned site.

> **Implementation status:** this repository still has separate WMS and Dark
> Store entry points and uses React web bundled with Capacitor for its current
> mobile builds; it is not yet the requested unified staff login or React Native
> implementation. The web/mobile surface guard is being introduced here, while
> the complete role-aware login and native app migration remain follow-up work.

Zippzo has four operational products built from three customer groups: WMS web
software and WMS floor app for warehouse staff; Dark Store web software and
Dark Store floor app for store staff; Rider app; and Consumer web/app. WMS and
Dark Store have separate login entry points, navigation, facility selection,
and task queues. They share backend identity, catalog, and stock ledger APIs,
but never mix warehouse and store operations in one menu.

| Product | Main users | Best device | Main job |
|---|---|---|---|
| **WMS** | Warehouse staff, supervisors, operations managers | Desktop for planning; phone or handheld scanner for floor tasks | Supplier inbound, QC, putaway, warehouse inventory, replenishment picking, packing, and dispatch |
| **Dark Store** | Dark-store staff and supervisors | Desktop for store control; phone or handheld scanner for floor tasks | Replenishment receipt, shelf putaway, store inventory, customer order pick/pack, rider handoff, returns |
| **Rider** | Delivery partners | Phone | Start a shift, accept work, navigate, deliver, capture proof, reconcile cash |
| **Customer** | Shoppers | Phone | Discover products, place and track orders, manage addresses and payments |

## Facility login and product separation

WMS and Dark Store have dedicated app surfaces and facility-type validation at
login. WMS accepts warehouse facilities; Dark Store accepts dark-store
facilities. An operator must select or enter a facility they are actively
assigned to, and the server rejects cross-facility or wrong-app selection.
Authorized network managers can access both apps, while each session remains
scoped to the selected facility.

The WMS login accepts only an assigned warehouse code. The Dark Store login
accepts only an assigned dark-store code. The facility code is validated by the
server and returned with the session; it is not a free-form UI-only filter.

## WMS

WMS owns supplier inbound (ASN/GRN), QC, warehouse putaway, warehouse stock and
locations, internal bin movement, replenishment order creation, hub picking,
packing, transfer dispatch, and warehouse ledgers. Its menu has separate
**Inbound**, **Inventory & Storage**, and **Outbound to Stores** sections. It
does not contain customer order picking, store shelf receipt, rider handoff,
store cash, or store returns.

## Dark Store

Dark Store owns replenishment tote receipt, store shelf putaway, store
inventory, customer order allocation and picking, packing, rider handoff,
returns, and store-level stock history. Its menu has separate **Inbound ·
Store Stock** and **Outbound · Customer Orders** sections, with exceptions and
store controls separated below. It does not contain supplier ASN/QC, warehouse
bin planning, or hub dispatch planning.

Both products have a desktop surface for supervisors and planners and a floor
surface for workers on phones or scanners. Scanning belongs inside a selected
task; the floor app must not show an unassigned generic scanner. Manual lookup
is the recovery path.

Each staff product has two surfaces over its own operational domain:

- **Desktop software:** plan work, monitor its facility queues, assign staff, review
  exceptions, search stock, and trace movements.
- **Floor app:** the native WMS or Dark Store Android install and the narrow-screen
  staff experience. Start from the facility's stock flow, open a receiving,
  picking, or stock task directly, and scan within that task. Keep the menu
  available for putaway, packing, transfers, counts, and handoff. The floor app
  must not show a generic scanner detached from an operational task.

Each product's web and floor app use the same server-side stock ledger and task
lifecycle. Completing work in either surface updates the same facility data.

### Operating model: every physical movement is a task

The main navigation should lead to **work queues**, not a collection of
unrelated forms. A supervisor creates or releases work; a worker claims or is
assigned a task; the floor app guides scans in physical order; a supervisor
resolves exceptions; the system posts the stock movement and keeps its history.

Every task has a task ID, facility, work type, priority or due time, assignee,
source and destination when relevant, expected quantity, scanned quantity,
status, and exception reason. Workers see **My work**, **Available work**, and
**Blocked work**. Supervisors see all queues, assignment controls, aging, and
exceptions. Task screens keep one next action prominent and show scan progress
and the last accepted scan.

#### Scan and stock rules

- Give every SKU a scannable barcode; every bin/location and handling unit
  (tote, carton, pallet or LPN) has its own unique code. A scan must identify
  which kind of entity it represents.
- A normal movement is source → item/LPN → quantity → destination → review →
  confirm. The exact sequence can vary where the task already identifies the
  source or item, but both the stock and destination must be unambiguous.
- Scanning records task progress; it does **not** by itself commit stock.
  Commit is an explicit server-confirmed action, atomic with the ledger event.
  Show success only after the server accepts it.
- Never silently accept a wrong SKU, wrong facility, wrong bin, unexpected
  quantity, expired lot, or duplicate scan. Explain the mismatch and provide a
  permitted correction, skip, hold, or supervisor escalation.
- Keep a trace from each ledger movement to the task, worker, facility, time,
  reason, source, destination, SKU, lot/serial where applicable, quantity, and
  handling unit. Corrections are new adjustments with reasons, never edits to
  the original movement.
- If connectivity is lost, retain the in-progress task and unsent scan queue,
  visibly mark it **Pending sync**, and prevent the operator from treating an
  unconfirmed movement as complete. On reconnect, validate duplicates and
  current stock before posting.

### End-to-end warehouse and dark-store workflows

#### 0. Facility, item and location setup

Before stock can move, authorized users configure facilities (mother hub or
dark store), zones, bins, receiving and dispatch areas, SKU identifiers and
barcodes, units of measure, lot/expiry rules, storage conditions, and staff
permissions. Print and attach bin and handling-unit labels, then scan each
label in a location verification flow. A bin has a facility, zone, type,
capacity and active/blocked state. A SKU has a base unit and any valid pack or
case conversion. Do not let an operator compensate for missing master data by
creating an untracked stock record during a scan task.

#### 1. Supplier inbound: expected receipt to accepted stock

**Planning:** A manager creates or imports a purchase order/advance shipment
notice (ASN), selects supplier and destination facility, lists SKUs, expected
quantities, expected lots/expiry data if known, and arrival window. Release it
as an inbound appointment/receipt task and assign a receiving team.

**Dock receiving:** The receiver opens the expected receipt and scans its ID,
then scans each carton, pallet or supplier barcode. The app resolves the code
to a SKU or handling unit and displays the expected item, unit, quantity and
any lot rules. The worker enters quantity only when the barcode does not encode
it, scans/records batch and expiry, and repeats per package. The app compares
expected to actual and requires a reason for overage, shortage, substitution,
damaged packaging, unknown item or unreadable barcode. Unknown items go to an
unidentified-goods hold queue; they do not enter sellable stock.

**Close receiving:** The receiver reviews expected, accepted, damaged and
short quantities by SKU, attaches evidence if needed, and submits the receipt.
The server creates receipt/handling-unit records and a receiving ledger event.
New units are **Received / QC pending**, not sellable. Partial receipts remain
open for the remainder or are closed with a reason.

#### 2. Quality inspection and quarantine

The QC worker opens the inspection queue, scans the receipt or handling unit,
then scans/selects the SKU and lot being checked. The screen shows the
inspection checklist for that SKU: packaging, seal, condition, temperature if
required, batch and expiry. Record inspected quantity and outcome:

- **Pass:** eligible for putaway, but not sellable until putaway is confirmed.
- **Hold:** remains quarantined with reason, owner and review deadline.
- **Reject:** excluded from available stock and routed to supplier return or
  authorized disposal.

Partial pass is supported by quantity. Every hold/reject needs a reason code;
photo/evidence is available for damaged or disputed goods. Release from hold is
a separate permissioned action with an audit record.

#### 3. Putaway: staging to storage or shelf

The putaway planner groups eligible receipt units by zone and creates tasks,
optionally suggesting a destination based on capacity, temperature and item
rules. The worker scans the handling unit/item at the staging location, scans
the destination bin label, confirms SKU/lot and quantity, reviews the move, and
commits. If destination capacity or item restrictions fail, suggest a valid
bin or allow a supervisor override with reason. A partial putaway leaves the
remaining quantity in staging and the task open. On successful commit, stock
moves from receiving/staging to the destination; only eligible, putaway stock
becomes available for allocation.

For dark-store shelf replenishment, treat backroom-to-shelf as the same
source/item/quantity/destination flow with a shelf-facing destination. The
shelf balance becomes pickable only after the shelf putaway confirms.

#### 4. Internal bin move and location correction

The worker opens an assigned move or creates a permitted ad-hoc move, scans the
source bin, scans the item or LPN, enters/scans the quantity, scans the target
bin, and reviews the before/after quantities. The app validates source
availability, lot identity, unit conversion, destination capacity and
restrictions. Confirming posts one balanced movement: decrement source and
increment destination for the same item/lot/quantity. For multi-item LPN moves,
show and verify the LPN contents before moving the whole unit. If the LPN is
opened or only partly moved, require item-level scans and preserve the
remaining contents.

Wrong-location stock is not silently relabeled. Scan the physical item and
actual bin, select **Report location mismatch**, and create a correction task
for verification. A supervisor can resolve it with paired movement records and
a reason.

#### 5. Cycle count and stock adjustment

The manager creates a count plan by facility, zone, bin, SKU or lot, with a
blind-count option and assigned counters. The counter scans the bin, then every
item/LPN found and its quantity; an empty bin must be explicitly confirmed.
System expected quantity stays hidden in a blind count until submission. A
second count is required above the configured variance threshold. The review
screen compares system and physical quantity, displays prior count/movement
context to authorized reviewers, and requires a reason for variance. Approval
posts an adjustment ledger event; the original balance history is retained.
Never provide an unrestricted editable on-hand quantity field.

#### 6. Hub-to-dark-store replenishment transfer

**Plan and release:** A store or replenishment planner reviews shelf/backroom
min/max, forecast and open demand, builds a transfer order by source hub and
destination dark store, chooses quantities/lots, and releases work. The task
shows a dispatch cutoff and expected arrival.

**Hub pick and pack:** The picker scans source bin, SKU/lot and quantity for
each line. FEFO suggests the earliest eligible expiry first. Short stock,
blocked lots and substitutions require a recorded exception. Picked units are
scanned into a tote/LPN. At pack, scan the tote, verify contents and quantities,
close/seal it, and print or associate the LPN label. Stock leaves pickable hub
locations and is held in **transfer staging**.

**Dispatch:** At the dock, scan the transfer and each sealed LPN onto the
vehicle/trip. Verify destination, count and seal state; dispatch confirmation
moves the custody state to **in transit**. The stock is no longer available at
the hub and is not yet available at the store.

**Store receipt and putaway:** Store staff scan the arriving trip/transfer and
each LPN. Match expected versus received units and seals. Missing, damaged or
unexpected LPNs create a discrepancy and remain unresolved; accepted units move
to store receiving/staging, then staff scan each item/LPN and shelf/backroom
destination to complete putaway. Only then are quantities available for store
orders. The transfer closes when every line is received, shorted, damaged or
otherwise resolved with an authorized reason.

#### 7. Customer order fulfillment at a dark store

**Allocate:** Once checkout is accepted, the order is routed to a serviceable
store. The system reserves eligible pickable stock by SKU and lot, respecting
expiry and holds. Show the store queue with promise time, order age, item count
and risk state. A reservation reduces available-to-promise; it is not a
physical movement.

**Pick:** A picker claims an order or wave. The task presents an efficient
route, one location at a time. At each location scan the bin/shelf, scan the
SKU barcode, verify the requested variant and quantity, then record picked
quantity. For weighted goods, capture measured weight. If missing, damaged or
expired, record the reason and follow the configured substitute/customer
approval rules. A replacement must be scanned as the replacement SKU; never
change the order line invisibly. Unpicked/reserved stock is released or
reallocated on task completion/cancellation. Picked goods move into order/tote
custody and are no longer available to another order.

**Pack:** Scan the order or tote, verify every picked line and quantity, scan
each unit at pack where required, and record any final damage or correction.
Assign a bag/tote ID, seal it, and attach the order identity. A mismatch returns
the order to a controlled correction step. Completed orders enter **Ready for
handoff** and are staged in a labeled, order-specific location.

**Stage and hand off:** Scan the order/tote at the staging location. When a
rider arrives, scan/verify the rider identity, then scan each order being
handed over. The app blocks wrong-store, wrong-rider, duplicate and already
dispatched orders. Confirm handoff to record custody and timestamp. The
physical stock is now in rider custody; delivery status and proof are owned by
the rider app.

#### 8. Returns, failed delivery and restock

Returned goods enter a dedicated return receiving task, never directly back to
available shelf stock. Scan the order/return reference and each returned item;
record quantity, condition, seal and return reason. QC routes it to **sellable
restock**, **quarantine**, **supplier return**, or **disposal**. Sellable units
must be scanned to a putaway destination before becoming available. Failed
delivery/RTO stock follows the same receipt and inspection path at the assigned
facility. Any refund/customer resolution is outside the stock task but links to
its return record.

#### 9. Expiry, damage, holds and waste

Use lot-level expiry alerts to generate FEFO replenishment/pick suggestions and
near-expiry review tasks. Expired lots are blocked from reservation and picking.
Staff scan the lot/item and quantity, choose a reason-coded action (hold,
write-off, supplier return or approved disposal), and obtain supervisor
approval when policy requires it. Damaged stock is moved to a quarantine or
damage location; it must not be made unavailable by deleting the quantity.
Waste and write-off actions post a ledger movement with actor, approver,
evidence and reason.

### Screens and work surfaces

**Supervisor desktop:**

- **Operations overview:** work due/late, inbound at dock, QC holds, putaway
  backlog, low/near-expiry stock, transfer status, order SLA risk and staffing.
- **Work queues:** filter by facility, type, priority, due time, assignee and
  exception; bulk assign/release where safe.
- **Inventory explorer:** search SKU/barcode, lot, bin, LPN or movement; show
  on-hand by status and location with a traceable movement timeline.
- **Transfer planner:** demand/replenishment suggestions, transfer lines,
  dispatch and receipt reconciliation.
- **People and shifts:** assign workers to receiving, QC, putaway, count, pick,
  pack and dispatch tasks; see workload and completion without editing stock.
- **Exceptions and audit:** mismatches, holds, rejected scans, failed syncs,
  approvals and movement history.

**Worker phone/handheld:**

- **My work:** task cards with type, location, deadline, progress and a large
  **Start / Resume** action.
- **Guided task:** persistent task ID and step progress, large scan target,
  matched item/bin confirmation, quantity control, last scan, undo-before-submit
  where safe, and one clear **Confirm movement** action.
- **Exception flow:** identify what failed, why it matters, permitted actions,
  and whether supervisor review is needed. Preserve valid scans when an
  exception occurs.
- **Task complete:** server-confirmed result, movement reference, next task,
  and a way to report a physical discrepancy.

### Status and custody model

Use explicit stock states and locations instead of one ambiguous “in stock”
number. A useful lifecycle is:

`Expected → Received/QC pending → Quarantined or QC passed → Putaway → Available → Reserved → Picked → Packed/Staged → Handed to rider`

Alternate outcomes include `Rejected`, `Damaged`, `Expired`, `In transit`,
`Returned`, `Restock pending`, `Written off`, and `Disposed`. A unit can be in
only one physical custody/location at a time. Reservations affect availability
but do not pretend a physical move happened. Every custody transition has a
source status/location, destination status/location and quantity, and the
ledger is the audit source of truth.

### Roles and approvals

| Role | Typical access |
|---|---|
| Receiver | Assigned inbound receipts, scan and discrepancy reporting |
| QC operator | Inspection queue, pass/hold/reject within policy |
| Putaway / inventory operator | Assigned putaway, bin moves, shelf replenishment, counts |
| Picker / packer | Assigned order or transfer pick/pack tasks |
| Dispatch / store handoff | LPN loading, trip dispatch, rider/order custody scan |
| Shift lead | Task assignment, exception triage, permitted approvals |
| Operations manager | Facility configuration, plans, policy thresholds, cross-site reports |
| Auditor / support | Read-only movement, order and task trace; restricted correction tools |

Separate task assignment from task execution and approval for high-risk actions
such as stock adjustments, write-offs, hold release, and override of a blocked
destination. Record both operator and approver.

## Rider app

Keep the rider experience separate from inventory administration. Its core
sequence is shift readiness, assigned delivery queue, one active delivery,
navigation and customer contact, delivery proof, and cash/order reconciliation
when required. The active delivery should stay visually dominant and support
large touch targets and unreliable network conditions.

## Customer app

Keep shopping separate from store operations. Its core sequence is serviceable
address, searchable catalogue, cart, clear checkout and payment, live order
status, and support/returns. Show availability and delivery promise for the
selected address and store.

## Product boundary

Orders flow from customer checkout to store picking, packing and rider handoff;
the rider app owns last-mile status and proof of delivery. WMS owns warehouse
stock movement; Dark Store owns store stock and order fulfillment. All clients use the
same backend records and authoritative order/stock states, with role and
facility permissions deciding what each person can see and do.

## In-app notifications

Every user-facing update must be persisted to that signed-in user's
**Notifications** inbox. This includes order placement and packing, rider job
offers, store-to-rider and rider-to-customer handoffs, delivery progress,
delivery verification codes, completion, and exceptions. The inbox is the
durable source of truth; WebSocket events can refresh it immediately, with
polling as recovery when realtime connectivity is unavailable. Each item has
unread/read state and is isolated to its recipient. OTPs are delivered only to
the customer account and shown only in that authenticated inbox. SMS, email,
and operating-system push are optional future transports; they must not replace
the in-app record or be reported as sent unless a provider confirms delivery.
The app navigation shows an unread count. Business events are written in the
same transaction as the order/task change and published after commit; pending
outbox rows remain recoverable from inbox reads or the publisher command.
