import {
  ApiError,
  Asn,
  AuthResponse,
  Facility,
  Grn,
  GrnLine,
  LocationBin,
  LocationRow,
  PackTaskRow,
  PickTaskRow,
  PutawayTaskDetail,
  QcInspection,
  Sku,
  StockBalance,
  Task,
  TransferOrderRow,
  User,
} from './types';

export const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE as string | undefined)?.replace(/\/+$/, '') ||
  'http://192.168.1.100:8001/api';

let accessToken: string | null = null;
export function setAccessToken(token: string | null) { accessToken = token; }
export function getAccessToken() { return accessToken; }

export function isApiError(err: unknown): err is ApiError {
  return !!err && typeof err === 'object' && 'status' in (err as any) && 'body' in (err as any);
}

function toQuery(params?: Record<string, string | number | undefined | null>): string {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// DRF_viewsets return either an array or { results, count }. Normalize both.
export function extractList<T>(body: any): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && Array.isArray(body.results)) return body.results as T[];
  if (body && Array.isArray(body.items)) return body.items as T[];
  if (body && Array.isArray(body.tasks)) return body.tasks as T[];
  if (body && Array.isArray(body.facilities)) return body.facilities as T[];
  return [];
}

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const t = token ?? accessToken;
  if (t) headers.Authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (err) {
    const e = new Error(`Network error: ${(err as Error).message}`) as ApiError;
    e.status = 0;
    e.body = null;
    throw e;
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`) as ApiError;
    e.status = res.status;
    e.body = body;
    throw e;
  }
  return body as T;
}

// Absolute URL for a `/media/...` path the API hands back.
export const mediaUrl = (p?: string | null): string => {
  if (!p) return '';
  if (/^https?:/i.test(p)) return p;
  return `${API_BASE.replace(/\/api$/, '')}${p}`;
};

async function uploadImage(path: string, file: { uri: string; name: string; type: string }): Promise<{ image_url: string }> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const form = new FormData();
  form.append('file', file as any);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: form });
  } catch (err) {
    const e = new Error(`Network error: ${(err as Error).message}`) as ApiError;
    e.status = 0;
    e.body = null;
    throw e;
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`) as ApiError;
    e.status = res.status;
    e.body = body;
    throw e;
  }
  return body as { image_url: string };
}

// Friendly error message from a DRF response body.
export function errMsg(err: any, fallback = 'Something went wrong'): string {
  if (!err) return fallback;
  const b = err.body;
  if (typeof b === 'string' && b.trim()) return b;
  if (b && typeof b === 'object') {
    if (typeof b.detail === 'string' && b.detail) return b.detail;
    if (typeof b.error === 'string' && b.error) return b.error;
    if (typeof b.message === 'string' && b.message) return b.message;
    for (const key of ['non_field_errors', 'error', 'detail']) {
      const v = b[key];
      if (Array.isArray(v) && v.length) return String(v[0]);
      if (typeof v === 'string' && v) return v;
    }
    const keys = Object.keys(b);
    for (const k of keys) {
      const v = b[k];
      if (Array.isArray(v) && v.length) return `${k}: ${v[0]}`;
      if (typeof v === 'string' && v) return v;
    }
  }
  return err.message || fallback;
}

export const api = {
  // ---------- Auth (credentials + OTP) ----------
  // No `app` is forced: the backend resolves the right workspace from the
  // account's assignments (WMS for MH staff, DARK_STORE for DS staff), so a
  // dark-store-only operator can sign in too. Forcing `app: 'WMS'` rejected
  // every DS-only account with 403 "not assigned to the selected operations app".
  login: (email: string, password: string, surface: 'mobile' = 'mobile') =>
    request<AuthResponse>('/iam/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, surface }),
    }, null),

  /**
   * Field-associate sign-in: the number their manager registered plus the
   * shared store code shown on the Authentication screen.
   *
   * One code is issued per calendar day; the server also accepts yesterday's
   * code at midnight boundaries so an evening shift does not lose its run.
   */
  phoneLogin: (phone: string, otp: string, siteCode?: string, surface: 'mobile' = 'mobile') =>
    request<AuthResponse>('/iam/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, otp, ...(siteCode ? { site_code: siteCode } : {}), surface }),
    }, null),

  selectFacility: (challengeId: string, challengeToken: string, facilityCode: string) =>
    request<AuthResponse & { facility_required?: boolean }>(
      '/iam/auth/facility',
      { method: 'POST', body: JSON.stringify({ challenge_id: challengeId, challenge_token: challengeToken, facility_code: facilityCode }) },
      null,
    ),

  verifyOtp: (challengeId: string, challengeToken: string, otp: string) =>
    request<AuthResponse>(
      '/iam/auth/otp/verify',
      { method: 'POST', body: JSON.stringify({ challenge_id: challengeId, challenge_token: challengeToken, otp }) },
      null,
    ),

  resendOtp: (challengeId: string, challengeToken: string) =>
    request<{ dev_otp?: string }>(
      '/iam/auth/otp/resend',
      { method: 'POST', body: JSON.stringify({ challenge_id: challengeId, challenge_token: challengeToken }) },
      null,
    ),

  refresh: (refreshToken: string) =>
    request<AuthResponse>('/iam/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }, null),

  logout: (refreshToken: string | null) =>
    request<{ status: string }>('/iam/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }),

  me: () => request<any>('/iam/auth/me'),

  /** Department dashboard for the signed-in associate / manager. */
  dashboard: () => request<any>('/iam/auth/dashboard'),

  /** The shared store code; one per calendar day. */
  storeCode: (siteCode?: string) =>
    request<any>(`/iam/auth/store-code${toQuery({ site_code: siteCode })}`),

  shopperRegister: (payload: { email: string; name: string; phone: string; password: string }) =>
    request<any>('/iam/auth/shopper/register', { method: 'POST', body: JSON.stringify(payload) }, null),
  shopperVerifyEmail: (email: string, code: string) =>
    request<any>('/iam/auth/shopper/verify-email', { method: 'POST', body: JSON.stringify({ email, code }) }, null),
  shopperPasswordReset: (email: string) =>
    request<any>('/iam/auth/shopper/password-reset', { method: 'POST', body: JSON.stringify({ email }) }, null),
  shopperPasswordResetConfirm: (email: string, code: string, new_password: string) =>
    request<any>('/iam/auth/shopper/password-reset/confirm', { method: 'POST', body: JSON.stringify({ email, code, new_password }) }, null),

  // ---------- Shopper storefront / checkout ----------
  shopperProfile: () => request<any>('/orders/shopper-profile'),
  updateShopperProfile: (payload: { name: string; phone: string }) =>
    request<any>('/orders/shopper-profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  deliveryCoverage: (pincode: string) =>
    request<any>(`/routing/coverage${toQuery({ pincode })}`),
  shopperStorefront: (site: string, pincode: string, q?: string) =>
    request<any>(`/orders/storefront${toQuery({ site, pincode, q })}`),
  shopperAddresses: () =>
    request<any>('/orders/addresses/').then((body) => extractList<any>(body)),
  createShopperAddress: (payload: Record<string, unknown>) =>
    request<any>('/orders/addresses/', { method: 'POST', body: JSON.stringify(payload) }),
  updateShopperAddress: (id: string, payload: Record<string, unknown>) =>
    request<any>(`/orders/addresses/${encodeURIComponent(id)}/`, { method: 'PATCH', body: JSON.stringify(payload) }),
  removeShopperAddress: (id: string) =>
    request<any>(`/orders/addresses/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  shopperOrders: () =>
    request<any>('/orders/orders/').then((body) => extractList<any>(body)),
  cancelShopperOrder: (orderId: string, reason = 'Cancelled by shopper.') =>
    request<any>(`/orders/orders/${encodeURIComponent(orderId)}/cancel/`, { method: 'POST', body: JSON.stringify({ reason }) }),
  shopperNotifications: () =>
    request<any>('/notifications/notifications/').then((body) => extractList<any>(body)),
  markShopperNotificationRead: (id: string) =>
    request<any>(`/notifications/notifications/${encodeURIComponent(id)}/mark_read/`, { method: 'POST' }),
  markAllShopperNotificationsRead: () =>
    request<any>('/notifications/notifications/mark_all_read/', { method: 'POST' }),
  shopperCoupons: (site: string) =>
    request<any>(`/catalog/coupons/${toQuery({ site })}`).then((body) => extractList<any>(body)),
  shopperWishlist: () =>
    request<any>('/catalog/wishlist/').then((body) => extractList<any>(body)),
  addWishlist: (sku: string) =>
    request<any>('/catalog/wishlist/', { method: 'POST', body: JSON.stringify({ sku }) }),
  removeWishlist: (wishlistId: string) =>
    request<any>(`/catalog/wishlist/${encodeURIComponent(wishlistId)}/`, { method: 'DELETE' }),
  orderTracking: (orderId: string) =>
    request<any>(`/orders/orders/${encodeURIComponent(orderId)}/tracking/`),
  shopperDeliveryCode: (orderId: string) =>
    request<any>(`/orders/orders/${encodeURIComponent(orderId)}/delivery-code/`),
  shopperOrderLines: (orderId: string) =>
    request<any>(`/orders/order-lines/${toQuery({ order: orderId })}`).then((body) => extractList<any>(body)),
  shopperOrderHistory: (orderId: string) =>
    request<any>(`/orders/order-history/${toQuery({ order: orderId })}`).then((body) => extractList<any>(body)),
  shopperReturns: () =>
    request<any>('/reverse/returns/').then((body) => extractList<any>(body)),
  requestShopperReturn: (orderId: string, reason: string) =>
    request<any>('/reverse/returns/', { method: 'POST', body: JSON.stringify({ order: orderId, reason }) }),
  placeShopperOrder: (payload: Record<string, unknown>) =>
    request<any>('/orders/checkout', { method: 'POST', body: JSON.stringify(payload) }),
  paymentStatus: (orderId: string) =>
    request<any>(`/orders/payments/${encodeURIComponent(orderId)}/status`),

  myWork: () => request<{ tasks: Task[] } & AuthResponse>('/iam/auth/my-work'),

  facilities: (app?: string) =>
    request<{ facilities: Facility[]; count: number }>(`/iam/auth/facilities${app ? `?app=${app}` : ''}`),

  switchFacility: (facilityCode: string) =>
    request<any>('/iam/auth/switch-facility', {
      method: 'POST',
      body: JSON.stringify({ facility_code: facilityCode }),
    }),

  // Estate roles only — the approval picker on the Add Product screen needs
  // "another administrator" (the backend rejects self-approval). Field staff
  // get a 403, hence the empty list.
  listUsers: () =>
    request<any>('/iam/users/?page_size=500').then((body) => extractList<any>(body)),

  // ---------- Catalog / scan resolution ----------
  searchSku: (term: string, pageSize = 50) =>
    request<any>(`/catalog/skus/${toQuery({ search: term, page_size: pageSize })}`).then(
      (body) => extractList<Sku>(body),
    ),

  getSku: (skuId: string) => request<Sku>(`/catalog/skus/${skuId}/`),

  /**
   * Resolve a scanned barcode to a catalogue SKU.
   *
   * Physical products carry the brand EAN — never our internal SKU code — so the
   * naive "scan === sku_code" check silently fails for every real pack. Look the
   * code up first in the search endpoint (hits sku_code/EAN/name), then fall
   * back to the barcode table, and return the matching sku_id or null.
   */
  resolveBarcodeToSku: async (code: string): Promise<Sku | null> => {
    const c = String(code || '').trim();
    if (!c) return null;
    const hits = await request<any>(`/catalog/skus/${toQuery({ search: c, page_size: 10 })}`)
      .then((body) => extractList<Sku>(body))
      .catch(() => [] as Sku[]);
    if (hits.length === 1) return hits[0];
    const exact = hits.find((h) => [h.sku_code, h.ean].some(
      (v) => String(v || '').trim().toLowerCase() === c.toLowerCase(),
    ));
    if (exact) return exact;
    const barcodes = await request<any>(`/catalog/barcodes/${toQuery({ search: c, page_size: 10 })}`)
      .then((body) => extractList<any>(body))
      .catch(() => [] as any[]);
    for (const row of barcodes) {
      const id = typeof row.sku === 'string' ? row.sku : row.sku?.sku_id;
      if (id) {
        const fetched = await request<Sku>(`/catalog/skus/${id}/`).catch(() => null);
        if (fetched) return fetched;
      }
    }
    return hits[0] || null;
  },

  stockAdjustment: (payload: Record<string, unknown>) =>
    request<any>('/inventory/adjustments/', { method: 'POST', body: JSON.stringify(payload) }),

  listCategories: () =>
    request<any>('/catalog/categories/').then((body) => extractList<any>(body)),

  createSku: (payload: Record<string, unknown>) =>
    request<Sku>('/catalog/skus/', { method: 'POST', body: JSON.stringify(payload) }),

  uploadSkuImage: (file: { uri: string; name: string; type: string }) =>
    uploadImage('/catalog/skus/image-upload/', file),

  updateSku: (skuId: string, payload: Record<string, unknown>) =>
    request<Sku>(`/catalog/skus/${skuId}/`, { method: 'PATCH', body: JSON.stringify(payload) }),

  listSkus: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/catalog/skus/${toQuery({ ...(params || {}), page_size: 100 })}`).then(
      (body) => extractList<Sku>(body),
    ),

  listListings: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/catalog/listings/${toQuery({ ...(params || {}), page_size: 200 })}`).then(
      (body) => extractList<any>(body),
    ),

  createListing: (payload: Record<string, unknown>) =>
    request<any>('/catalog/listings/', { method: 'POST', body: JSON.stringify(payload) }),

  updateListing: (listingId: string, payload: Record<string, unknown>) =>
    request<any>(`/catalog/listings/${listingId}/`, { method: 'PATCH', body: JSON.stringify(payload) }),

  createBarcode: (payload: Record<string, unknown>) =>
    request<any>('/catalog/barcodes/', { method: 'POST', body: JSON.stringify(payload) }),

  createStoreProfile: (payload: Record<string, unknown>) =>
    request<any>('/catalog/store-profiles/', { method: 'POST', body: JSON.stringify(payload) }),

  updateStoreProfile: (profileId: string, payload: Record<string, unknown>) =>
    request<any>(`/catalog/store-profiles/${profileId}/`, { method: 'PATCH', body: JSON.stringify(payload) }),

  searchBarcode: (barcode: string) =>
    request<any>(`/catalog/barcodes/${toQuery({ search: barcode })}`).then((body) => extractList<any>(body)),

  listBins: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/supply/putaway-bins/${toQuery({ ...(params || {}), limit: 500 })}`).then(
      (body) => extractList<LocationBin>(body),
    ),

  listLocations: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/network/locations/${toQuery({ ...(params || {}), page_size: 200 })}`).then(
      (body) => extractList<LocationRow>(body),
    ),

  // ---------- Inbound: consignment (ASN) + GRN ----------
  listAsns: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/supply/asns/${toQuery({ ...(params || {}), page_size: 100 })}`).then(
      (body) => extractList<Asn>(body),
    ),

  createAsn: (payload: Record<string, unknown>) =>
    request<Asn>('/supply/asns/', { method: 'POST', body: JSON.stringify(payload) }),

  getAsn: (asnId: string) => request<Asn>(`/supply/asns/${asnId}/`),

  createAsnLine: (payload: Record<string, unknown>) =>
    request<any>('/supply/asn-lines/', { method: 'POST', body: JSON.stringify(payload) }),

  listAsnLines: (params: Record<string, string | number | undefined | null>) =>
    request<any>(`/supply/asn-lines/${toQuery({ ...(params || {}), page_size: 500 })}`).then(
      (body) => extractList<any>(body),
    ),

  listGrns: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/supply/grns/${toQuery({ ...(params || {}), page_size: 100 })}`).then(
      (body) => extractList<Grn>(body),
    ),

  createGrn: (payload: Record<string, unknown>) =>
    request<Grn>('/supply/grns/', { method: 'POST', body: JSON.stringify(payload) }),

  getGrn: (grnId: string) => request<Grn>(`/supply/grns/${grnId}/`),

  completeGrn: (grnId: string) =>
    request<any>(`/supply/grns/${grnId}/complete/`, { method: 'POST' }),

  listGrnLines: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/supply/grn-lines/${toQuery({ ...(params || {}), page_size: 500 })}`).then(
      (body) => extractList<GrnLine>(body),
    ),

  createGrnLine: (payload: Record<string, unknown>) =>
    request<GrnLine>('/supply/grn-lines/', { method: 'POST', body: JSON.stringify(payload) }),

  updateGrnLine: (lineId: string, payload: Record<string, unknown>) =>
    request<GrnLine>(`/supply/grn-lines/${lineId}/`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Alias for PUT fallback when PATCH is not accepted by a proxy.
  updateGrnLinePut: (lineId: string, payload: Record<string, unknown>) =>
    request<GrnLine>(`/supply/grn-lines/${lineId}/`, { method: 'PUT', body: JSON.stringify(payload) }),

  // ---------- QC ----------
  listQc: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/supply/qc-inspections/${toQuery({ ...(params || {}), page_size: 200 })}`).then(
      (body) => extractList<QcInspection>(body),
    ),

  createQc: (payload: Record<string, unknown>) =>
    request<QcInspection>('/supply/qc-inspections/', { method: 'POST', body: JSON.stringify(payload) }),

  verifyQc: (qcId: string, payload: Record<string, unknown>) =>
    request<any>(`/supply/qc-inspections/${qcId}/verify/`, { method: 'POST', body: JSON.stringify(payload) }),

  // ---------- Putaway ----------
  listPutawayTasks: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/supply/putaway-tasks/${toQuery({ ...(params || {}), page_size: 200 })}`).then(
      (body) => extractList<PutawayTaskDetail>(body),
    ),

  getPutawayTask: (taskId: string) => request<PutawayTaskDetail>(`/supply/putaway-tasks/${taskId}/`),

  placePutaway: (taskId: string, locationId: string, units: number) =>
    request<any>(`/supply/putaway-tasks/${taskId}/place/`, {
      method: 'POST',
      body: JSON.stringify({ destination_location_id: locationId, bin: locationId, location_id: locationId, qty: units, units }),
    }),

  completePutaway: (taskId: string, locationId?: string) =>
    request<any>(`/supply/putaway-tasks/${taskId}/complete/`, {
      method: 'POST',
      body: JSON.stringify(locationId ? { destination_location_id: locationId, bin: locationId, location_id: locationId } : {}),
    }),

  // ---------- Inventory ----------
  listBalances: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/inventory/balances/${toQuery({ ...(params || {}), page_size: 500 })}`).then(
      (body) => extractList<StockBalance>(body),
    ),

  searchBalances: (term: string, siteId?: string) =>
    request<any>(`/inventory/balances/${toQuery({ search: term, site: siteId || undefined, page_size: 200 })}`).then(
      (body) => extractList<StockBalance>(body),
    ),

  // ---------- Inventory lots (required before GRN complete / putaway) ----------
  // A GRN line with no lot never mints a PutawayTask (sync_putaway_task
  // requires lot_id + COMPLETED GRN). Every received SKU needs a lot first.
  listLots: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/catalog/lots/${toQuery({ ...(params || {}), page_size: 50 })}`).then(
      (body) => extractList<any>(body),
    ),

  createLot: (payload: Record<string, unknown>) =>
    request<any>('/catalog/lots/', { method: 'POST', body: JSON.stringify(payload) }),

  // ---------- DS inbound: receive transfer LPN + shelf putaway ----------
  incomingLpns: (storeCode?: string) =>
    request<any>(`/ds-ops/incoming-lpns${storeCode ? `?store_code=${encodeURIComponent(storeCode)}` : ''}`).then(
      (body) => extractList<any>(body),
    ),

  receiveLpn: (payload: Record<string, unknown>) =>
    request<any>('/ds-ops/receive-lpn', { method: 'POST', body: JSON.stringify(payload) }),

  shelfPutaway: (payload: Record<string, unknown>) =>
    request<any>('/ds-ops/shelf-putaway', { method: 'POST', body: JSON.stringify(payload) }),

  // ---------- LPN / tote creation (for packing) ----------
  createLpn: (payload: Record<string, unknown>) =>
    request<any>('/inventory/lpns/', { method: 'POST', body: JSON.stringify(payload) }),

  searchLpns: (term: string) =>
    request<any>(`/inventory/lpns/${toQuery({ search: term, page_size: 10 })}`).then(
      (body) => extractList<any>(body),
    ),

  listLpnContents: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/inventory/lpn-contents/${toQuery({ ...(params || {}), page_size: 200 })}`).then(
      (body) => extractList<any>(body),
    ),

  // ---------- Outbound: DS pick / pack, transfers ----------
  listPickTasks: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/ds-ops/pick-tasks/${toQuery({ ...(params || {}), page_size: 200 })}`).then(
      (body) => extractList<PickTaskRow>(body),
    ),

  listPackTasks: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/ds-ops/pack-tasks/${toQuery({ ...(params || {}), page_size: 200 })}`).then(
      (body) => extractList<PackTaskRow>(body),
    ),

  // Correct pick contract: {order_id, line_id, bin_location_id, qty, scan_id}
  // where bin_location_id is a Location.location_id resolved from a scan.
  pickLine: (payload: Record<string, unknown>) =>
    request<any>('/ds-ops/pick-line', { method: 'POST', body: JSON.stringify(payload) }),

  pickAbandon: (orderId: string) =>
    request<any>('/ds-ops/pick-abandon', { method: 'POST', body: JSON.stringify({ order_id: orderId }) }),

  pickLines: (orderId: string) =>
    request<any>(`/ds-ops/pick-lines${toQuery({ order_id: orderId })}`),

  allocateOrder: (orderId: string) =>
    request<any>('/ds-ops/allocate-order', { method: 'POST', body: JSON.stringify({ order_id: orderId }) }),

  // Resolve a scanned bin label (barcode / coords / qr_payload / location_id)
  // to a Location for the session facility. Network/locations is admin-only;
  // this endpoint is the operator-safe equivalent.
  resolveBin: (storeCode: string, q: string) =>
    request<any>(`/ds-ops/resolve-bin${toQuery({ store_code: storeCode, q })}`),

  packOrder: (payload: Record<string, unknown>) =>
    request<any>('/ds-ops/pack-order', { method: 'POST', body: JSON.stringify(payload) }),

  /** Confirm a fully picked order has reached the packing rack. */
  rackDrop: (orderId: string, rackLocation = 'RACK-01') =>
    request<any>('/ds-ops/rack-drop', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, rack_location: rackLocation }),
    }),

  /** Send one order to the least-loaded picker. */
  assignOrder: (orderId: string, pickerId?: string) =>
    request<any>('/ds-ops/assign-order', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, ...(pickerId ? { picker_id: pickerId } : {}) }),
    }),

  /** Orders whose pick tasks have no owner yet. */
  pendingPicks: (storeCode: string) =>
    request<any>(`/ds-ops/pending-picks${toQuery({ site_code: storeCode })}`),

  /** The picker's own queue plus what is still waiting for an owner. */
  myPicks: (storeCode?: string) =>
    request<any>(`/ds-ops/my-picks${toQuery({ site_code: storeCode })}`),

  /** One assignment pass over the pending pick queue. */
  assignPendingPicks: (storeCode: string) =>
    request<any>(`/ds-ops/pending-picks${toQuery({ site_code: storeCode })}`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Packed totes waiting for a rider. */
  deliveryQueue: (storeCode: string) =>
    request<any>(`/ds-ops/delivery-queue${toQuery({ site_code: storeCode })}`),

  /** Pending work in every department. */
  departmentStatus: (storeCode: string) =>
    request<any>(`/ds-ops/department-status${toQuery({ site_code: storeCode })}`),

  /** Live order tracking board. */
  dsOrderTracking: (storeCode: string, status?: string) =>
    request<any>(`/ds-ops/order-tracking${toQuery({ site_code: storeCode, status })}`),

  /** Chart: Picking Completed. */
  completePick: (orderId: string) =>
    request<any>('/ds-ops/order-action', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, action: 'COMPLETE_PICK' }),
    }),

  // ---------- Rider / last mile ----------
  deliveryTasks: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/delivery/delivery-tasks/${toQuery({ ...(params || {}), page_size: 100 })}`).then(
      (body) => extractList<any>(body),
    ),

  /** Accept a rider job offered to me. */
  acceptDelivery: (taskId: string) =>
    request<any>(`/delivery/delivery-tasks/${encodeURIComponent(taskId)}/accept/`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Move an accepted job to AT_DS / EN_ROUTE / ARRIVED. */
  advanceDelivery: (taskId: string, to: string) =>
    request<any>(`/delivery/delivery-tasks/${encodeURIComponent(taskId)}/advance/`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  /** Collect the staged tote: verifies the tote barcode. */
  pickupDelivery: (taskId: string, lpnBarcode: string) =>
    request<any>('/delivery/handoff/pickup', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId, lpn_barcode: lpnBarcode }),
    }),

  /** Close the job with the customer's pickup code and any cash collected. */
  podDelivery: (taskId: string, otp: string, codAmount?: number) =>
    request<any>('/delivery/handoff/pod', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId, otp, cod_amount: codAmount }),
    }),

  /** Push the rider's current position, used for ETA. */
  riderLocation: (payload: Record<string, unknown>) =>
    request<any>('/delivery/rider-profiles/me/location/', { method: 'POST', body: JSON.stringify(payload) }),

  /** My rider profile (the viewset returns only my row for a rider account). */
  riderProfiles: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/delivery/rider-profiles/${toQuery({ ...(params || {}), page_size: 20 })}`).then(
      (body) => extractList<any>(body),
    ),

  /** Create my rider profile the first time I open the rider app. */
  bootstrapRider: (siteCode: string, extra?: Record<string, unknown>) =>
    request<any>('/delivery/rider-profiles/bootstrap/', {
      method: 'POST',
      body: JSON.stringify({ ...(extra || {}), site_code: siteCode }),
    }),

  /** Go on/off duty, update capacity or vehicle. Riders may edit their own row. */
  updateRider: (riderId: string, payload: Record<string, unknown>) =>
    request<any>(`/delivery/rider-profiles/${encodeURIComponent(riderId)}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  /** Decline a job back into the store's pool. */
  declineDelivery: (taskId: string) =>
    request<any>(`/delivery/delivery-tasks/${encodeURIComponent(taskId)}/decline/`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** My rider profile plus whether the store QR has activated me. */
  riderMe: () => request<any>('/delivery/rider-profiles/me/'),

  /** Deliveries, earnings, cash custody and activation in one read. */
  riderSummary: () => request<any>('/delivery/rider-profiles/me/summary/'),

  /** Scan the DS activation QR (`zippzo:site:<CODE>`), which opens the shift. */
  riderActivate: (qr: string) =>
    request<any>('/delivery/rider-profiles/activate-by-qr/', {
      method: 'POST',
      body: JSON.stringify({ qr }),
    }),

  /** My personal handoff QR (the store scans it to assign a tote). */
  riderQr: () => request<any>('/delivery/rider-profiles/me/qr/'),

  /** End the open shift; the rider must scan the store QR to start again. */
  riderEndShift: (shiftId: string) =>
    request<any>(`/delivery/rider-shifts/${encodeURIComponent(shiftId)}/close/`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'MANUAL' }),
    }),

  /** Start a Cashfree card/UPI/UPI-QR capture for a COD order at the door. */
  riderStartDoorPayment: (taskId: string, phone?: string) =>
    request<any>(`/delivery/delivery-tasks/${encodeURIComponent(taskId)}/start-payment/`, {
      method: 'POST',
      body: JSON.stringify({ phone: phone || '' }),
    }),

  /** Poll the door-step Cashfree attempt; CAPTURED means no cash is due. */
  riderDoorPaymentStatus: (taskId: string) =>
    request<any>(`/delivery/delivery-tasks/${encodeURIComponent(taskId)}/payment-status/`),

  // ---------- Inventory actions (associate) ----------
  relocateStock: (payload: Record<string, unknown>) =>
    request<any>('/inventory/relocate', { method: 'POST', body: JSON.stringify(payload) }),

  listCycleCounts: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/counting/cycle-counts/${toQuery({ ...(params || {}), page_size: 50 })}`).then(
      (body) => extractList<any>(body),
    ),

  createCycleCount: (payload: Record<string, unknown>) =>
    request<any>('/counting/cycle-counts/', { method: 'POST', body: JSON.stringify(payload) }),

  listCycleCountLines: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/counting/cycle-count-lines/${toQuery({ ...(params || {}), page_size: 200 })}`).then(
      (body) => extractList<any>(body),
    ),

  createCycleCountLine: (payload: Record<string, unknown>) =>
    request<any>('/counting/cycle-count-lines/', { method: 'POST', body: JSON.stringify(payload) }),

  updateCycleCountLine: (lineId: string, payload: Record<string, unknown>) =>
    request<any>(`/counting/cycle-count-lines/${encodeURIComponent(lineId)}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  updateCycleCount: (countId: string, payload: Record<string, unknown>) =>
    request<any>(`/counting/cycle-counts/${encodeURIComponent(countId)}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listTransferOrders: (params?: Record<string, string | number | undefined | null>) =>
    request<any>(`/ds-ops/transfer-orders/${toQuery({ ...(params || {}), page_size: 100 })}`).then(
      (body) => extractList<TransferOrderRow>(body),
    ),

  // ---------- Helpers ----------
  resolveLocationByBarcode: (barcode: string) =>
    request<any>(`/network/locations/${toQuery({ search: barcode, page_size: 50 })}`).then(
      (body) => extractList<LocationRow>(body),
    ),
};

export type { User };
