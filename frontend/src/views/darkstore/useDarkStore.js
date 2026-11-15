import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchApi, postApi, patchApi, deleteApi, unwrapList } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

/**
 * Shared plumbing for the dark store console.
 *
 * Two problems every dark store screen would otherwise re-solve badly:
 *
 *  1. Resolving *which* store the operator is standing in. The login response
 *     only carries a guessed `facility.code` (the email local-part, uppercased),
 *     which is not a real `Site.code` in most deployments, and the order queue
 *     is filtered by the site's UUID rather than its code. So the active store is
 *     resolved from the real /network/sites list, and when it cannot be resolved
 *     the screens say so instead of rendering an empty queue that looks like
 *     "no work today".
 *
 *  2. Telling "the endpoint returned nothing" apart from "the endpoint is
 *     broken". `asList` throws on an unrecognised payload shape for exactly this
 *     reason — a dead endpoint must never read as an empty store.
 */

/** Throw unless `payload` is a list, so a broken endpoint never reads as empty. */
/* ── shopper side ──────────────────────────────────────────────────────────
 *
 * These are the only calls a customer makes. They are separate from the
 * operator helpers on purpose: a shopper must never be able to reach a dark
 * store endpoint just because they can see the same app.
 */

/** What this store has on its shelves, at this store's prices.
 *
 * Passing the shopper's pincode makes the shelf answer the serviceability
 * question too: a store with published delivery areas says whether this
 * address is one of them, so a basket is never filled for a door that cannot
 * be reached.
 */
export const storefront = (siteCode, q = '', pincode = '') =>
  fetchApi(`/orders/storefront?site=${encodeURIComponent(siteCode)}`
    + (q ? `&q=${encodeURIComponent(q)}` : '')
    + (pincode ? `&pincode=${encodeURIComponent(pincode)}` : ''));

/** Stores that have explicitly published delivery coverage for this pincode. */
export const deliveryCoverage = (pincode) =>
  fetchApi(`/routing/coverage?pincode=${encodeURIComponent(pincode)}`);

/**
 * Place an order. Prices are decided by the server from `Listing`; anything
 * price-shaped sent here is ignored, which is deliberate.
 */
export const placeOrder = (payload) => postApi('/orders/checkout', payload);

/** Server-verified Cashfree result for one of the signed-in shopper's orders. */
export const cashfreePaymentStatus = (orderId) =>
  fetchApi(`/orders/payments/${encodeURIComponent(orderId)}/status`);

/** Drop an unpaid online order after the shopper stops at the payment screen. */
export const abandonPayment = (orderId) =>
  postApi(`/orders/payments/${encodeURIComponent(orderId)}/abandon/`, {});

/** The signed-in shopper's own orders, newest first. */
export const myOrders = () => fetchApi('/orders/orders/');

/**
 * Where the parcel is right now, for one of the shopper's own orders.
 *
 * The server answers `{live: false, rider: null, ...}` once the order is no
 * longer moving, so the screen can ask on every open without having to know
 * the state machine itself.
 */
export const orderTracking = (orderId) =>
  fetchApi(`/orders/orders/${encodeURIComponent(orderId)}/tracking/`);

/** The signed-in shopper's own addresses. */
export const myAddresses = () => fetchApi('/orders/addresses/');

/**
 * Save an address. The owner is taken from the login by the server, so
 * `customer` is deliberately not sent - a shopper posting a foreign customer id
 * gets their own row back regardless.
 */
export const saveAddress = (payload) => postApi('/orders/addresses/', payload);

/** Point this shopper's default delivery address at `id`. */
export const setDefaultAddress = (id) =>
  patchApi(`/orders/addresses/${encodeURIComponent(id)}/`, { is_default: true });

/** Remove one of this shopper's saved addresses. */
export const removeAddress = (id) =>
  deleteApi(`/orders/addresses/${encodeURIComponent(id)}/`);

/**
 * The pickup code for one of the shopper's own orders.
 *
 * Readable only while the code is live, and only by the customer the order
 * belongs to - the rider's handoff deliberately does not receive it. Returns
 * `{code, state}` where state is `not_requested`, `ready`, `issued` or `used`.
 */
export const deliveryCode = (orderId) =>
  fetchApi(`/orders/orders/${encodeURIComponent(orderId)}/delivery-code/`);

/** Active coupons a shopper can apply at the selected store. */
export const activeCoupons = (siteCode = '') =>
  fetchApi(`/catalog/coupons/${siteCode ? `?site=${encodeURIComponent(siteCode)}` : ''}`);

/** Cancel one of the shopper's own orders, while it is still before picking. */
export const cancelOrder = (orderId, reason = '') =>
  postApi(`/orders/orders/${encodeURIComponent(orderId)}/cancel/`, { reason });

/** Reviews for one SKU. */
export const skuReviews = (skuId) =>
  fetchApi(`/catalog/reviews/?sku=${encodeURIComponent(skuId)}`);

/** Leave a review for a SKU the shopper has received. */
export const postReview = (skuId, rating, comment = '') =>
  postApi('/catalog/reviews/', { sku: skuId, rating, comment });

/** The shopper's wishlist. */
export const myWishlist = () => fetchApi('/catalog/wishlist/');

/** Add a SKU to the wishlist. */
export const addWishlist = (skuId) => postApi('/catalog/wishlist/', { sku: skuId });

export function asList(payload, what) {
  // `unwrapList` returns an array for list responses, including empty ones.
  // An empty list ([]) is a valid server response (queue genuinely empty) and
  // must never be treated as an error — otherwise every operator with no tasks
  // sees an error banner instead of a tidy empty state.
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) {
    throw new Error(`${what} returned an unrecognised payload shape.`);
  }
  return rows;
}

/** Decode a DRF decimal that arrives as a string (COEFFICIENT-style payloads). */
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `2026-09-30T04:12:00Z` -> `04:12`. Empty for missing/invalid values. */
export function clockOf(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Seconds elapsed since `value`, floored at 0. null when the date is missing. */
export function secondsSince(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
}

/** `m:ss` for a duration in seconds, or `--:--` when there is no duration. */
export function mmss(seconds) {
  if (seconds == null) return '--:--';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The store the operator is currently working in, plus the real dark store
 * list so a screen can offer a picker when the session's facility is unknown.
 *
 * `siteId` is a UUID because /orders/orders/ filters on `site` (the FK id),
 * while every /ds-ops/ endpoint filters on `store_code`. Both are needed, and
 * conflating them is why a scoped request silently returned every order.
 */
export function useDarkStore() {
  const { facility, facilitiesList, switchFacility } = useAuth();
  // Memoised: `facilitiesList.dark_stores` keeps its identity between renders,
  // but `|| []` allocates a fresh array every render, which would make the
  // `site` memo below re-evaluate (and re-resolve the store) on every render.
  const darkStores = useMemo(
    () => facilitiesList?.dark_stores || [],
    [facilitiesList?.dark_stores]
  );
  const loaded = (facilitiesList?.all_facilities || []).length > 0;

  const site = useMemo(() => {
    const wanted = String(facility?.code || '').trim().toUpperCase();
    if (wanted) {
      const exact = darkStores.find(
        (s) => String(s.code || '').trim().toUpperCase() === wanted
      );
      if (exact) return exact;
    }
    // A single dark store in the network is unambiguous, so an operator whose
    // session never picked one still lands in the right place.
    if (darkStores.length === 1) return darkStores[0];
    return null;
  }, [facility?.code, darkStores]);

  const storeCode = site?.code || '';
  const siteId = site?.site_id || '';
  const storeName = site?.name || storeCode || '';

  const reason = useMemo(() => {
    if (!loaded) return 'Loading the site directory…';
    if (darkStores.length === 0) {
      return 'No dark store is registered. A dark store is a network.Site with site_type="DS".';
    }
    if (!site) {
      return 'Pick a dark store to work in. The session facility does not match a registered dark store.';
    }
    return '';
  }, [loaded, darkStores.length, site]);

  return {
    site,
    darkStores,
    storeCode,
    siteId,
    storeName,
    reason,
    canPick: loaded && darkStores.length > 0,
    pick: (s) => switchFacility(s),
  };
}

/**
 * Load a payload, distinguishing "loading" from "failed" from "loaded empty".
 *
 * `fn` is only re-run when `deps` change, so callers can pass an inline loader
 * without triggering a render loop.
 */
export function useAsyncData(fn, deps, { pollMs = 0 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const next = await fnRef.current();
      if (!mounted.current) return;
      setData(next);
      setError('');
    } catch (err) {
      if (!mounted.current) return;
      // Keep the last good data visible next to the error rather than blanking
      // the screen: an operator mid-tally still needs to see the queue.
      setError(err?.message || 'Request failed');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!pollMs) return undefined;
    const id = setInterval(() => load({ quiet: true }), pollMs);
    return () => clearInterval(id);
  }, [pollMs, load]);

  // Realtime & Online Recovery: catch live updates, WebSocket reconnects,
  // and returning online without waiting for the slow polling timer.
  useEffect(() => {
    const onLive = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load({ quiet: true });
    };
    window.addEventListener('zippzo:live-event', onLive);
    window.addEventListener('online', onLive);
    document.addEventListener('visibilitychange', onLive);
    return () => {
      window.removeEventListener('zippzo:live-event', onLive);
      window.removeEventListener('online', onLive);
      document.removeEventListener('visibilitychange', onLive);
    };
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/* ───────────────────── endpoint loaders ───────────────────── */

export const dsOverview = (storeCode) =>
  fetchApi(`/ds-ops/overview?store_code=${encodeURIComponent(storeCode)}`);

/** LPNs the mother hub has dispatched to this store and are still in transit. */
export const dsIncomingLpns = async (storeCode) =>
  asList(
    await fetchApi(`/ds-ops/incoming-lpns?store_code=${encodeURIComponent(storeCode)}`),
    '/ds-ops/incoming-lpns'
  );

/** Lot-level shelf position for this store. */
export const dsShelfInventory = async (storeCode) =>
  asList(
    await fetchApi(`/ds-ops/inventory?store_code=${encodeURIComponent(storeCode)}`),
    '/ds-ops/inventory'
  );

/**
 * Received-but-not-yet-shelved totes.
 *
 * `/ds-ops/incoming-lpns` only returns IN_TRANSIT LPNs, so once a tote is
 * received it drops out of that queue and the putaway screen would show
 * nothing to do. Received totes are read from the LPN master instead, filtered
 * by this store, because "received" is the only state putaway accepts.
 */
export const receivedLpns = async (siteId) =>
  asList(
    await fetchApi(
      `/inventory/lpns/?current_site=${encodeURIComponent(siteId)}&status=RECEIVED&page_size=100`
    ),
    '/inventory/lpns'
  );

/** A tote's manifest, for the putaway line list. */
export const lpnManifest = async (lpnId) =>
  asList(
    await fetchApi(`/inventory/lpn-contents/?lpn=${encodeURIComponent(lpnId)}`),
    '/inventory/lpn-contents'
  );

/**
 * SKU lookup table.
 *
 * Order lines and tote manifests only carry `sku` as a UUID, so a scan has to be
 * matched against a real sku_code/ean client-side. Fetched with a raised
 * page_size because a barcode must never fail to resolve just because it sorted
 * onto page two.
 */
export async function loadSkuIndex() {
  const rows = asList(
    await fetchApi('/catalog/skus/?page_size=1000'),
    '/catalog/skus'
  );
  const byId = new Map();
  const byCode = new Map();
  const norm = (v) => String(v || '').trim().toUpperCase();
  for (const s of rows) {
    const rec = { sku_id: s.sku_id, sku_code: s.sku_code, name: s.name, ean: s.ean };
    byId.set(String(s.sku_id), rec);
    for (const key of [s.sku_code, s.ean, s.sku_id]) {
      const k = norm(key);
      if (k && !byCode.has(k)) byCode.set(k, rec);
    }
  }
  return { byId, byCode, skuFor: (code) => byCode.get(norm(code)) || null };
}

/**
 * Orders for this store, one request per status.
 *
 * CustomerOrder orders by -placed_at, so a single unfiltered page shows the
 * newest orders and nothing else — an operator filtering client-side would see
 * a queue that is missing every order they actually have to pick. Server-side
 * filtering is a correctness requirement here, not an optimisation.
 *
 * `statuses` has no safe default for the caller to forget: an undefined value
 * used to throw on `for…of` and leave the whole picking screen blank. The
 * default below is the server's own pickable set (`PICKABLE_STATUSES`), so a
 * caller that omits it still asks the right question.
 */
export const ORDER_QUEUE_STATUSES = [
  'CONFIRMED', 'PICKING', 'INTERRUPTED', 'PARTIALLY_FULFILLED',
  'PICKED', 'RACK_DROPPED',
];

export async function loadOrderQueue(siteId, statuses = ORDER_QUEUE_STATUSES) {
  const wanted = Array.isArray(statuses) && statuses.length
    ? statuses
    : ORDER_QUEUE_STATUSES;
  const seen = new Map();
  for (const status of wanted) {
    const rows = asList(
      await fetchApi(
        `/orders/orders/?site=${encodeURIComponent(siteId)}` +
          `&status=${encodeURIComponent(status)}&page_size=100`
      ),
      `/orders/orders?status=${status}`
    );
    for (const r of rows) seen.set(String(r.order_id), r);
  }
  return [...seen.values()].sort(
    (a, b) => new Date(b.placed_at || 0) - new Date(a.placed_at || 0)
  );
}

export const orderLines = async (orderId) =>
  asList(
    await fetchApi(`/orders/order-lines/?order=${encodeURIComponent(orderId)}`),
    '/orders/order-lines'
  );

/**
 * The picking worklist for one order: which bin each lot is shelved in, how
 * many units that bin actually holds, and how many the line still needs.
 *
 * This replaces reading `/orders/order-lines/` on the pick screen. That
 * endpoint is a plain ModelViewSet, so it carries no bin and no shelf quantity,
 * and PATCHing `picked_qty` on it would mark lines picked without a single unit
 * leaving stock. Everything the picker needs to act has to come from the scan
 * endpoints instead.
 */
export async function loadPickLines(orderId) {
  const data = await fetchApi(
    `/ds-ops/pick-lines?order_id=${encodeURIComponent(orderId)}`
  );
  if (!data || !Array.isArray(data.lines)) {
    throw new Error('/ds-ops/pick-lines returned an unrecognised payload shape.');
  }
  return data;
}

/**
 * Translate a scanned bin label into the Location.location_id that stock is
 * keyed by, scoped to one store.
 *
 * `resolveBin()` in utils/bins.js uses /network/locations, which is admin-only,
 * so a picker calling it gets a 403 and no bin at all. This goes through
 * /ds-ops/resolve-bin, which is fenced to the operator's store and returns
 * only the id and a label.
 *
 * @returns {Promise<{location_id: string, label: string}[]>}
 */
export async function resolveStoreBin(storeCode, scanned) {
  const data = await fetchApi(
    `/ds-ops/resolve-bin?store_code=${encodeURIComponent(storeCode)}` +
      `&q=${encodeURIComponent(String(scanned || '').trim())}`
  );
  if (!data || !Array.isArray(data.matches)) {
    throw new Error('/ds-ops/resolve-bin returned an unrecognised payload shape.');
  }
  return data.matches;
}

/**
 * Close an order's pick once every line is picked.
 *
 * `COMPLETE_PICK` is the only order transition the dark-store order-action
 * endpoint exposes; packing, handoff, and POD each own their own state moves.
 */
export async function completePick(orderId) {
  return postApi('/ds-ops/order-action', {
    order_id: orderId,
    action: 'COMPLETE_PICK',
  });
}

/**
 * Execute one scan against an allocated order line.
 *
 * This is the physical pick write. The bin must be one of the line's allocated
 * bins; the server refuses a scan against any other shelf and replays are
 * keyed by scan_id.
 */
export async function pickLine({
  orderId, lineId, binLocationId, productBarcode, qty = 1, scanId,
}) {
  return postApi('/ds-ops/pick-line', {
    order_id: orderId,
    line_id: lineId,
    bin_location_id: binLocationId,
    ...(productBarcode ? { product_barcode: productBarcode } : {}),
    qty,
    ...(scanId ? { scan_id: scanId } : {}),
  });
}

/**
 * Receive one mother-hub tote into this dark store's custody.
 *
 * The backend resolves by barcode, not by LPN id: the label on the tote is
 * the only thing the operator can guarantee they are holding.
 */
export const receiveLpn = (barcode, storeCode, sealNumber = '') =>
  postApi('/ds-ops/receive-lpn', {
    barcode,
    store_code: storeCode,
    ...(sealNumber ? { seal_number: sealNumber } : {}),
  });

/**
 * Break a received tote onto shelf bins.
 *
 * The backend takes one atomic word of placements — `{sku, lot, bin, qty}` —
 * not one request per line; a partial response can never leave half a tote
 * shelved and half in LPN custody.
 */
export const shelfPutaway = (lpnId, placements) =>
  postApi('/ds-ops/shelf-putaway', {
    lpn: lpnId,
    placements,
  });

/**
 * Fix the route for an order: which bin each line comes from, and how many units
 * from each. Idempotent on the server, so a retry after a dropped response is
 * safe.
 *
 * This has to happen before picking. Without it the work list has no bin to walk
 * to, and the server refuses any scan against a bin the order was not allocated.
 *
 * @returns {Promise<{created: number, kept: number, allocations: object[]}>}
 */
export async function allocateOrder(orderId) {
  const data = await postApi('/ds-ops/allocate-order', { order_id: orderId });
  if (!data || !Array.isArray(data.allocations)) {
    throw new Error('/ds-ops/allocate-order returned an unrecognised payload shape.');
  }
  return data;
}

/**
 * Seal a fully picked order into a tote and stage it for the rider.
 *
 * Both the tote barcode and the staging slot are required: the slot is what the
 * rider notification says, so a pack that did not record one would leave the
 * rider with a job it cannot act on.
 *
 * @returns {Promise<object>} the packed order, its tote and its delivery task.
 */
export async function packOrder(orderId, { lpnBarcode, stagingBin }) {
  return postApi('/ds-ops/pack-order', {
    order_id: orderId,
    lpn_barcode: lpnBarcode,
    staging_bin: stagingBin,
  });
}

/**
 * Chart's Rack Drop step: the picker has carried the picked units to the
 * packing rack and confirmed the drop.
 *
 * This is deliberately not packing. The order becomes RACK_DROPPED, the rack
 * label is recorded, and the pack station still has to seal a tote before a
 * rider job exists. Sending the same order twice is safe: the server answers
 * `already_dropped` instead of moving the order again.
 */
export const rackDrop = (orderId, rackLocation) =>
  postApi('/ds-ops/rack-drop', {
    order_id: orderId,
    rack_location: rackLocation,
  });

/** Assign one order to the picker with the fewest open tasks. */
export const assignOrder = (orderId, pickerId) =>
  postApi('/ds-ops/assign-order', {
    order_id: orderId,
    ...(pickerId ? { picker_id: pickerId } : {}),
  });

/** Orders whose pick tasks nobody owns yet. */
export const pendingPicks = (storeCode) =>
  fetchApi(`/ds-ops/pending-picks?site_code=${encodeURIComponent(storeCode)}`);

/** One assignment pass over the pending queue. */
export const assignPendingPicks = (storeCode) =>
  postApi(`/ds-ops/pending-picks?site_code=${encodeURIComponent(storeCode)}`, {});

/** Packed totes waiting for a rider (chart: Ready for Rider). */
export const dsDeliveryQueue = (storeCode) =>
  fetchApi(`/ds-ops/delivery-queue?site_code=${encodeURIComponent(storeCode)}`);

/** Pending work per department, for the manager overview. */
export const dsDepartmentStatus = (storeCode) =>
  fetchApi(`/ds-ops/department-status?site_code=${encodeURIComponent(storeCode)}`);

/** Order tracking board, optionally narrowed to one status. */
export const dsOrderTracking = (storeCode, status = '') =>
  fetchApi(
    `/ds-ops/order-tracking?site_code=${encodeURIComponent(storeCode)}`
    + (status ? `&status=${encodeURIComponent(status)}` : '')
  );

/** Today's shared store code; one per calendar day. */
export const rotatingStoreOtp = (storeCode) =>
  fetchApi(`/iam/auth/store-code?site_code=${encodeURIComponent(storeCode)}`);

/** Empty totes at this store, to offer the packer something to fill. */
export const emptyLpns = async (siteId) =>
  asList(
    await fetchApi(
      `/inventory/lpns/?current_site=${encodeURIComponent(siteId)}` +
        `&status__in=EMPTY,CREATED&page_size=100`
    ),
    '/inventory/lpns'
  );

/**
 * Delivery tasks at this store, for the counter.
 *
 * The handoff endpoints key on `task_id`, not `order_id` - a pickup verifies the
 * tote against the task's own `bin`, and a POD is closed against the task that
 * actually carries the order. Listing orders here and guessing the task back
 * was how the old screen ended up calling a status transition that moved nothing.
 *
 * The backend scopes this to the caller's own site for anyone without a rider
 * profile, so an operator sees the totes staged at their store and nobody else's.
 *
 * `statuses` must be explicit: `status__in=` with an empty value matches
 * nothing. Active handoff work and delivered history are requested separately
 * so completed deliveries do not inflate the live queue.
 */
export const ACTIVE_HANDOFF_STATUSES = [
  'UNASSIGNED', 'OFFERED', 'ACCEPTED', 'AT_DS', 'STAGED',
  'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'POD_PENDING',
];

export const HANDOFF_STATUSES = [
  ...ACTIVE_HANDOFF_STATUSES, 'DELIVERED',
];

export const deliveryTasks = async (siteId, statuses = HANDOFF_STATUSES) =>
  asList(
    await fetchApi(
      // The router registers `delivery-tasks`; `/delivery/tasks/` is not a
      // route at all and returned 404, so the rider handoff queue was always
      // empty for the store operator.
      `/delivery/delivery-tasks/?site=${encodeURIComponent(siteId)}` +
        `&status__in=${encodeURIComponent((statuses || []).join(','))}` +
        `&page_size=100`
    ),
    '/delivery/delivery-tasks'
  );

/**
 * Hand a staged tote to a rider.
 *
 * Requires the tote barcode: the server checks it against the task's recorded
 * bin and refuses a mismatch, so two orders' totes cannot be swapped at the
 * collection point.
 */
export const riderPickup = (taskId, lpnBarcode) =>
  postApi('/delivery/handoff/pickup', {
    task_id: taskId,
    lpn_barcode: lpnBarcode,
  });

/**
 * Close a delivery against the customer's pickup code.
 *
 * A 409 with `otp_required` is the normal first response - it means the code was
 * just minted and sent to the customer, not that anything is wrong. The code is
 * never in the response; the operator has to read it off the customer's phone.
 */
export const deliveryPod = (taskId, { otp, codAmount } = {}) =>
  postApi('/delivery/handoff/pod', {
    task_id: taskId,
    otp,
    cod_amount: codAmount,
  });

/**
 * Hand a staged, unassigned job to a rider by scanning their personal QR.
 *
 * The scan at the counter is the rider's consent: the server moves the task
 * straight to ACCEPTED, the same state the rider's own Accept reaches. It does
 * not require the rider to be online — being physically present at the counter
 * is stronger than a flag — and it refuses anyone who already has a rider
 * profile (their path is the console) and any task not at the caller's store.
 */
export const assignRiderQr = (taskId, qrCode) =>
  postApi('/delivery/delivery-tasks/assign-by-rider/', {
    task_id: taskId,
    qr_code: qrCode,
  });

/**
 * Order ids belonging to a site.
 *
 * `ReturnOrder` has no site column and `ReturnOrderViewSet` only exposes
 * `filterset_fields = ['status', 'fault']`, so there is no server-side way to
 * ask "returns for this store". Returns carry a bare `order` uuid, so the only
 * correct scoping is to intersect them with this site's orders client-side.
 *
 * This is a bounded read, not an index: it is capped at one page, so a store
 * with more orders than that will silently drop the older ones. The alternative
 * — showing every return in the network — is worse, because an operator would
 * then be offered bins at a site that is not theirs.
 */
export async function siteOrderIds(siteId) {
  const rows = asList(
    await fetchApi(`/orders/orders/?site=${encodeURIComponent(siteId)}&page_size=200`),
    '/orders/orders'
  );
  return new Set(rows.map((r) => String(r.order_id)));
}

/** Every return in the network; filter with `siteOrderIds` to get a store's. */
export const allReturns = async () =>
  asList(await fetchApi('/reverse/returns/?page_size=200'), '/reverse/returns');

/**
 * The stock ledger for one store: every movement that changed a balance here.
 *
 * `site` is the Site UUID because StockMovement.site is a foreign key, unlike
 * the /ds-ops endpoints which take `store_code`. Mixing the two up returns an
 * empty list that reads as "nothing moved today".
 *
 * The list is bounded at one page: the ledger is append-only and grows forever,
 * so an unbounded read would eventually stop returning at all.
 */
export const stockMovements = async (siteId) =>
  asList(
    await fetchApi(
      `/inventory/movements/?site=${encodeURIComponent(siteId)}&page_size=100`
    ),
    '/inventory/movements'
  );

/**
 * Packed orders waiting for a rider, and how long they have waited.
 *
 * `site` here is the Site *code* (StagedAging.site is a plain char column),
 * which is the opposite of `stockMovements` above.
 */
export const stagedAging = async (storeCode) =>
  asList(
    await fetchApi(
      `/ds-ops/staged-aging/?site=${encodeURIComponent(storeCode)}&page_size=100`
    ),
    '/ds-ops/staged-aging'
  );

/**
 * The status sets that define each stage of the dark store's own flow.
 *
 * These mirror DSOrderActionView.ORDER_ACTIONS on the server. The server
 * answers 409 for a transition it does not allow, so a stale client cannot
 * corrupt state — but showing an operator a button that will always fail is
 * still a broken screen, so the sets live here too.
 */
export const DS_ORDER_STAGES = {
  PICK_QUEUE: ['CONFIRMED', 'PICKING', 'PICKED', 'PARTIALLY_FULFILLED'],
  HANDOFF_QUEUE: ['PACKED', 'PRICE_FINALIZED', 'STAGED', 'RIDER_ASSIGNED'],
  ON_THE_ROAD: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED'],
};

export const ALL_LIVE_ORDER_STATUSES = [
  ...new Set([
    ...DS_ORDER_STAGES.PICK_QUEUE,
    ...DS_ORDER_STAGES.HANDOFF_QUEUE,
    ...DS_ORDER_STAGES.ON_THE_ROAD,
  ]),
];
