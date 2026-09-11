/* ── API Wrapper ─────────────────────────────────── */
const API_BASE = '/api';

const api = {
  async get(path, params = {}) {
    const url = new URL(API_BASE + path, location.origin);
    Object.entries(params).forEach(([k, v]) => v !== '' && v != null && url.searchParams.set(k, v));
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
    return r.json();
  },

  async post(path, data) {
    const r = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(JSON.stringify(err));
    }
    return r.json();
  },

  async put(path, data) {
    const r = await fetch(API_BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },

  async patch(path, data) {
    const r = await fetch(API_BASE + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },

  async delete(path) {
    const r = await fetch(API_BASE + path, {
      method: 'DELETE',
      headers: { 'X-CSRFToken': getCookie('csrftoken') },
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return true;
  },
};

function getCookie(name) {
  const v = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
  return v ? v[2] : '';
}
