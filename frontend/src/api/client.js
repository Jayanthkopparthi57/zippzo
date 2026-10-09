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
const configuredBase = import.meta.env.VITE_API_BASE;
const BASE_URL = configuredBase
  ? String(configuredBase).replace(/\/+$/, '')
  : (typeof window !== 'undefined' && window.location && window.location.origin)
    ? `${window.location.origin}/api`
    : 'http://127.0.0.1:8000/api';

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

function buildUrl(endpoint) {
  return endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
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
export async function fetchApi(endpoint) {
  const url = buildUrl(endpoint);
  let res;
  try {
    res = await fetch(url, { headers: getHeaders(), redirect: 'follow' });
  } catch (err) {
    throw new ApiError(`Network error: ${err.message}`, { url, body: null });
  }
  if (!res.ok) {
    const body = await readBody(res);
    throw new ApiError(`GET ${endpoint} -> ${res.status} ${res.statusText}`, {
      status: res.status, url, body,
    });
  }
  const data = await readBody(res);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return data;
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
