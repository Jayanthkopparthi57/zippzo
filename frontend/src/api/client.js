// Unified API Client for Zippzo Platform
//
// On the web the API is same-origin (`origin/api`, proxied to Django by the
// Vite dev server and served by the reverse proxy in production), so no URL is
// configured. A Capacitor shell is different: the WebView's origin is
// `capacitor://localhost` / `http://localhost` and is served out of the app
// bundle, so `/api` would resolve against the device itself and every call
// would fail. The native build therefore passes VITE_API_BASE (see
// `.env.native` and the `build:native` script) pointing at the reachable
// Django host.
const configuredBase = (typeof import.meta !== 'undefined' && import.meta?.env)
  ? import.meta.env.VITE_API_BASE
  : undefined;
const BASE_URL = configuredBase
  ? String(configuredBase).replace(/\/+$/, '')
  : (typeof window !== 'undefined' && window.location && window.location.origin)
    ? `${window.location.origin}/api`
    : 'http://127.0.0.1:8000/api';

export function liveEventsUrl() {
  // Development and proxy based deployments may intentionally configure a
  // path-only API base (for example `/api`). Resolve it against this origin so
  // the socket URL follows the same host as fetch requests.
  const apiUrl = new URL(BASE_URL, typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1');
  apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  apiUrl.pathname = `${apiUrl.pathname.replace(/\/?api\/?$/, '').replace(/\/$/, '')}/ws/events/`;
  apiUrl.search = '';
  return apiUrl.toString();
}

let _authToken = null;

export function setAuthToken(token) {
  _authToken = token;
  if (token) {
    localStorage.setItem('zippzo_jwt', token);
  } else {
    localStorage.removeItem('zippzo_jwt');
  }
}

export function getAuthToken() {
  if (_authToken) return _authToken;
  return localStorage.getItem('zippzo_jwt');
}

function getHeaders(extra = {}) {
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...extra
  };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Error raised for any non-2xx response or transport failure.
 * Carries the DRF error body so the UI can show the real reason.
 */
export class ApiError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function buildUrl(endpoint, params) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  if (!params) return url;

  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (item !== undefined && item !== null) query.append(key, String(item));
      });
    } else {
      query.set(key, String(value));
    }
  });

  const queryString = query.toString();
  if (!queryString) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
}

async function readBody(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/** Pull a readable message out of a DRF {detail} / {field: [...]} payload. */
export function describeError(err) {
  if (!(err instanceof ApiError)) return err?.message || 'Request failed';
  const b = err.body;
  if (typeof b === 'string') return b.slice(0, 300) || err.message;
  if (b && typeof b === 'object') {
    if (b.detail) return String(b.detail);
    if (b.error) return String(b.error);
    const parts = [];
    for (const [field, val] of Object.entries(b)) {
      if (field === 'non_field_errors') { parts.push(...[].concat(val).map(String)); continue; }
      parts.push(`${field}: ${[].concat(val).map(String).join(', ')}`);
    }
    if (parts.length) return parts.join(' | ');
  }
  return err.message;
}

/**
 * GET with DRF pagination unwrapped to an array.
 *
 * Throws ApiError on any failure. Returning `[]` on error made a broken
 * endpoint indistinguishable from genuinely empty stock, so callers must
 * handle the failure explicitly (or use fetchApiOr where a fallback is right).
 */
export async function fetchApi(endpoint, params) {
  const data = await getJson(endpoint, params);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return data;
}

/**
 * GET keeping the DRF page envelope: `{count, next, previous, results}`.
 *
 * fetchApi drops count/next, which is right for screens that render one page
 * of everything, but a ledger needs "page 3 of 12" and a total. Bare-array
 * endpoints are normalised to a single page so callers never branch on shape.
 */
export async function fetchApiPage(endpoint, params) {
  const data = await getJson(endpoint, params);
  if (Array.isArray(data)) {
    return { count: data.length, next: null, previous: null, results: data };
  }
  if (data && Array.isArray(data.results)) {
    return {
      count: typeof data.count === 'number' ? data.count : data.results.length,
      next: data.next || null,
      previous: data.previous || null,
      results: data.results,
    };
  }
  return { count: 0, next: null, previous: null, results: [] };
}

/**
 * DRF list endpoints return `{count, next, previous, results}` while plain
 * APIViews return a bare array. Callers that only check `Array.isArray` end up
 * silently rendering an empty table, so always normalise through this.
 *
 * Returns null when the payload is not a recognisable list, so callers can
 * treat "unexpected shape" as an error instead of as "no data".
 */
export function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.results)) {
    return payload.results;
  }
  return null;
}

/** Same as fetchApi but falls back instead of throwing, for optional lookups. */
export async function fetchApiOr(endpoint, fallback) {
  try {
    return await fetchApi(endpoint);
  } catch (err) {
    console.error(`[API] ${endpoint} failed, using fallback:`, describeError(err));
    return fallback;
  }
}

/** One GET as raw JSON; the shared body of fetchApi / fetchApiPage. */
async function getJson(endpoint, params) {
  const url = buildUrl(endpoint, params);
  let lastError = null;
  // Managed Postgres (Neon) occasionally drops a connection mid-request and
  // the backend answers 500 for that one call. A GET has no side effects, so
  // one retry turns a transient blip into a normal page instead of an error
  // strip the operator has to clear by hand.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { headers: getHeaders(), redirect: 'follow' });
    } catch (err) {
      lastError = new ApiError(`Network error: ${err.message}`, { url, body: null });
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      throw lastError;
    }
    if (res.ok) return readBody(res);

    const body = await readBody(res);
    lastError = new ApiError(`GET ${endpoint} -> ${res.status} ${res.statusText}`, {
      status: res.status, url, body,
    });
    if (res.status >= 500 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      continue;
    }
    throw lastError;
  }
  throw lastError;
}

/**
 * POST to create records or invoke an action.
 */
export async function postApi(endpoint, payload) {
  const url = buildUrl(endpoint);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload ?? {}),
      redirect: 'follow'
    });
  } catch (err) {
    throw new ApiError(`Network error: ${err.message}`, { url });
  }
  if (!res.ok) {
    const body = await readBody(res);
    throw new ApiError(`POST ${endpoint} -> ${res.status}`, { status: res.status, url, body });
  }
  return readBody(res);
}

export async function putApi(endpoint, payload) {
  const url = buildUrl(endpoint);
  let res;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(payload ?? {}),
      redirect: 'follow'
    });
  } catch (err) {
    throw new ApiError(`Network error: ${err.message}`, { url });
  }
  if (!res.ok) {
    const body = await readBody(res);
    throw new ApiError(`PUT ${endpoint} -> ${res.status}`, { status: res.status, url, body });
  }
  return readBody(res);
}

/**
 * PATCH to update records.
 */
export async function patchApi(endpoint, payload) {
  const url = buildUrl(endpoint);
  let res;
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(payload ?? {}),
      redirect: 'follow'
    });
  } catch (err) {
    throw new ApiError(`Network error: ${err.message}`, { url });
  }
  if (!res.ok) {
    const body = await readBody(res);
    throw new ApiError(`PATCH ${endpoint} -> ${res.status}`, { status: res.status, url, body });
  }
  return readBody(res);
}

/**
 * POST a single file as multipart/form-data.
 *
 * The browser must set the multipart boundary itself, so no Content-Type
 * header is sent here (unlike getHeaders()). Used by catalog and Darkstore
 * pricing screens to upload product photos before saving the SKU image URL.
 */
export async function uploadFile(endpoint, file, field = 'file') {
  const url = buildUrl(endpoint);
  const body = new FormData();
  body.append(field, file);
  const headers = { Accept: 'application/json' };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body, redirect: 'follow' });
  } catch (err) {
    throw new ApiError(`Network error: ${err.message}`, { url });
  }
  if (!res.ok) {
    const errBody = await readBody(res);
    throw new ApiError(`POST ${endpoint} -> ${res.status}`, { status: res.status, url, body: errBody });
  }
  return readBody(res);
}

/**
 * DELETE a record.
 */
export async function deleteApi(endpoint) {
  const url = buildUrl(endpoint);
  let res;
  try {
    res = await fetch(url, { method: 'DELETE', headers: getHeaders(), redirect: 'follow' });
  } catch (err) {
    throw new ApiError(`Network error: ${err.message}`, { url });
  }
  if (!res.ok && res.status !== 404) {
    const body = await readBody(res);
    throw new ApiError(`DELETE ${endpoint} -> ${res.status}`, { status: res.status, url, body });
  }
  return true;
}

export const apiClient = {
  get: fetchApi,
  post: postApi,
  put: putApi,
  patch: patchApi,
  delete: deleteApi,
};
