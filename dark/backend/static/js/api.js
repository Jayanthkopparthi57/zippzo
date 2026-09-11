/* ==========================================================================
   ZIPPZO WMS — API CLIENT MODULE
   Centralized fetch() wrapper with JWT authentication, token refresh,
   error handling, and request/response interceptors.
   ========================================================================== */

const API_BASE_URL = '/api/v1';

// ── Token Management ────────────────────────────────────────────────────
const TokenManager = {
  getAccess: () => localStorage.getItem('zippzo_access_token'),
  getRefresh: () => localStorage.getItem('zippzo_refresh_token'),
  getUser: () => {
    try { return JSON.parse(localStorage.getItem('zippzo_user')); } catch { return null; }
  },

  save(data) {
    if (data.access) localStorage.setItem('zippzo_access_token', data.access);
    if (data.refresh) localStorage.setItem('zippzo_refresh_token', data.refresh);
    if (data.user) localStorage.setItem('zippzo_user', JSON.stringify(data.user));
  },

  clear() {
    localStorage.removeItem('zippzo_access_token');
    localStorage.removeItem('zippzo_refresh_token');
    localStorage.removeItem('zippzo_user');
  },

  isLoggedIn() {
    return !!this.getAccess();
  }
};

// ── Core Fetch Wrapper ──────────────────────────────────────────────────
let isRefreshing = false;
let refreshQueue = [];

async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  const token = TokenManager.getAccess();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers
  };

  // If sending JSON body, stringify it
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    config.body = JSON.stringify(options.body);
  }

  try {
    let response = await fetch(url, config);

    // Handle 401 — attempt token refresh
    if (response.status === 401 && TokenManager.getRefresh() && !options._isRetry) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry original request with new token
        headers['Authorization'] = `Bearer ${TokenManager.getAccess()}`;
        config.headers = headers;
        config._isRetry = true;
        response = await fetch(url, config);
      } else {
        // Refresh failed — force logout
        TokenManager.clear();
        if (typeof renderLoginScreen === 'function') renderLoginScreen();
        throw new ApiError('Session expired. Please log in again.', 401);
      }
    }

    // Parse response
    const contentType = response.headers.get('content-type');
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorMsg = typeof data === 'object'
        ? (data.detail || data.error || data.message || JSON.stringify(data))
        : data;
      throw new ApiError(errorMsg, response.status, data);
    }

    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(`Network error: ${err.message}`, 0);
  }
}

async function refreshAccessToken() {
  if (isRefreshing) {
    // Wait for ongoing refresh
    return new Promise((resolve) => {
      refreshQueue.push(resolve);
    });
  }

  isRefreshing = true;
  try {
    const response = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: TokenManager.getRefresh() })
    });

    if (response.ok) {
      const data = await response.json();
      TokenManager.save(data);
      refreshQueue.forEach(cb => cb(true));
      return true;
    }
    refreshQueue.forEach(cb => cb(false));
    return false;
  } catch {
    refreshQueue.forEach(cb => cb(false));
    return false;
  } finally {
    isRefreshing = false;
    refreshQueue = [];
  }
}

// ── Error Class ─────────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

// ── Convenience Methods ─────────────────────────────────────────────────
const api = {
  get: (endpoint, params = {}) => {
    const queryStr = new URLSearchParams(params).toString();
    const url = queryStr ? `${endpoint}?${queryStr}` : endpoint;
    return apiRequest(url, { method: 'GET' });
  },

  post: (endpoint, body = {}) => {
    return apiRequest(endpoint, { method: 'POST', body });
  },

  patch: (endpoint, body = {}) => {
    return apiRequest(endpoint, { method: 'PATCH', body });
  },

  put: (endpoint, body = {}) => {
    return apiRequest(endpoint, { method: 'PUT', body });
  },

  delete: (endpoint) => {
    return apiRequest(endpoint, { method: 'DELETE' });
  },

  // ── Auth-specific shortcuts ─────────────────────────────────────────
  login: async (username, password) => {
    const data = await apiRequest('/auth/login/', {
      method: 'POST',
      body: { username, password }
    });
    TokenManager.save(data);
    return data;
  },

  sendCode: async (email) => {
    return apiRequest('/auth/send-code/', {
      method: 'POST',
      body: { email }
    });
  },

  verifyCode: async (email, code, requestId) => {
    const data = await apiRequest('/auth/verify-code/', {
      method: 'POST',
      body: { email, code, request_id: requestId }
    });
    if (data.tokens) {
      TokenManager.save(data.tokens);
    }
    return data;
  },

  register: (userData) => {
    return apiRequest('/auth/register/', {
      method: 'POST',
      body: userData
    });
  },

  logout: () => {
    TokenManager.clear();
  },

  me: () => {
    return api.get('/auth/me/');
  },

  // ── Employee OTP & Admin Approval Workflow ─────────────────────────
  employeeLoginRequest: (username, password) => {
    return apiRequest('/auth/employee-login-request/', {
      method: 'POST',
      body: { username, password }
    });
  },

  verifyOtp: async (requestId, otpCode) => {
    const data = await apiRequest('/auth/employee-verify-otp/', {
      method: 'POST',
      body: { request_id: requestId, otp_code: otpCode }
    });
    if (data.tokens) TokenManager.save(data.tokens);
    return data;
  },

  checkLoginApprovalStatus: async (requestId) => {
    const data = await apiRequest(`/auth/login-approval-status/${requestId}/`, {
      method: 'GET'
    });
    if (data.status === 'approved' && data.tokens) {
      TokenManager.save(data.tokens);
    }
    return data;
  },

  getPendingLogins: () => api.get('/auth/admin/pending-logins/'),
  approveEmployeeLogin: (requestId) => api.post(`/auth/admin/logins/${requestId}/approve/`),
  rejectEmployeeLogin: (requestId) => api.post(`/auth/admin/logins/${requestId}/reject/`),
  getPendingUsers: () => api.get('/auth/admin/pending-users/'),
  approveUser: (userId, data) => api.patch(`/auth/admin/users/${userId}/approve/`, data),
  rejectUser: (userId, reason) => api.patch(`/auth/admin/users/${userId}/reject/`, { notes: reason }),

  // ── Domain API Shortcuts ────────────────────────────────────────────

  // Receiving / Inbound
  getGRNs: (params) => api.get('/receiving/grns/', params),
  getPurchaseOrders: (params) => api.get('/receiving/purchase-orders/', params),
  createPurchaseOrder: (body) => api.post('/receiving/purchase-orders/', body),
  completeGRN: (grnId) => api.post(`/receiving/grns/${grnId}/complete-qc/`),

  // Inventory
  getInventory: (params) => api.get('/inventory/', params),
  getTransactions: (params) => api.get('/inventory/transactions/', params),
  transferStock: (body) => api.post('/inventory/transfer/', body),

  // Catalog
  getProducts: (params) => api.get('/catalog/products/', params),
  createProduct: (body) => api.post('/catalog/products/', body),
  getBatches: (params) => api.get('/catalog/batches/', params),

  // Fulfillment
  getSalesOrders: (params) => api.get('/fulfillment/sales-orders/', params),
  createSalesOrder: (body) => api.post('/fulfillment/sales-orders/', body),
  allocateOrder: (orderId) => api.post(`/fulfillment/sales-orders/${orderId}/allocate/`),
  getOrderStatus: (orderId) => api.get(`/fulfillment/sales-orders/${orderId}/fulfillment-status/`),
  getPickWaves: (params) => api.get('/fulfillment/waves/', params),
  generateWave: (body) => api.post('/fulfillment/waves/generate/', body),
  getPickTasks: (params) => api.get('/fulfillment/pick-tasks/', params),
  scanVerifyPick: (taskId, body) => api.post(`/fulfillment/pick-tasks/${taskId}/scan-verify/`, body),
  reportPickException: (taskId, body) => api.post(`/fulfillment/pick-tasks/${taskId}/exception/`, body),

  // Packing
  getPackingTasks: (params) => api.get('/packing/tasks/', params),
  scanVerifyPack: (taskId, body) => api.post(`/packing/tasks/${taskId}/scan-verify/`, body),

  // Shipping
  getShipments: (params) => api.get('/shipping/shipments/', params),
  createShipment: (body) => api.post('/shipping/shipments/', body),
  handoverShipment: (shipId) => api.post(`/shipping/shipments/${shipId}/handover/`),
  deliverShipment: (shipId) => api.post(`/shipping/shipments/${shipId}/deliver/`),
  getManifests: (params) => api.get('/shipping/manifests/', params),

  // Master Data
  getWarehouses: (params) => api.get('/master/warehouses/', params),
  getZones: (params) => api.get('/master/zones/', params),
  getLocations: (params) => api.get('/master/locations/', params),
  createLocation: (body) => api.post('/master/locations/', body),

  // HR / Workforce
  getEmployees: (params) => api.get('/hr/employees/', params),
  clockIn: (empId) => api.post(`/hr/employees/${empId}/clock-in/`),
  clockOut: (empId) => api.post(`/hr/employees/${empId}/clock-out/`),
  getDailyTasks: (params) => api.get('/hr/daily-tasks/', params),

  // Returns
  getReturns: (params) => api.get('/returns/rmas/', params),
  createReturn: (body) => api.post('/returns/rmas/', body),
};

// ── Global Loading State ────────────────────────────────────────────────
let _loadingCount = 0;

function showLoading() {
  _loadingCount++;
  const loader = document.getElementById('global-loader');
  if (loader) loader.style.display = 'flex';
}

function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none';
  }
}

// Wrap api methods with loading indicator
async function withLoading(apiCall) {
  showLoading();
  try {
    return await apiCall;
  } finally {
    hideLoading();
  }
}
