const API_BASE = '/api';

async function handleResponse(res) {
  if (res.ok) {
    return res.status === 204 ? {} : res.json();
  }

  let details = null;
  try {
    details = await res.json();
  } catch (err) {
    details = null;
  }

  const error = new Error(details?.detail || details?.error || `API Error ${res.status}: ${res.statusText}`);
  error.status = res.status;
  error.details = details;
  throw error;
}

function getAuthHeaders() {
  const token = localStorage.getItem('zippzo_auth_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Token ${token}`;
  }
  return headers;
}

export const apiClient = {
  async get(path, params = {}) {
    const url = new URL(API_BASE + path, window.location.origin);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== '' && v != null) url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString(), {
      headers: getAuthHeaders(),
    });
    return handleResponse(res);
  },

  async post(path, data = {}) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async patch(path, data = {}) {
    const res = await fetch(API_BASE + path, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async put(path, data = {}) {
    const res = await fetch(API_BASE + path, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  async delete(path) {
    const res = await fetch(API_BASE + path, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse(res);
  },
};
