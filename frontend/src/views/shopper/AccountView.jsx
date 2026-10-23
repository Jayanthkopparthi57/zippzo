import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { fetchApi, describeError } from '../../api/client';
import {
  myAddresses, saveAddress, setDefaultAddress, removeAddress, asList
} from '../darkstore/useDarkStore';
import { User, MapPin, Plus, Star, Trash2, AlertCircle, LogOut } from 'lucide-react';

const CUSTOMERS = '/orders/customers/';

const TIER_WORDS = {
  T0: 'New account',
  T1: 'Established',
  T2: 'Trusted',
  T3: 'Highly trusted',
  T_FLAGGED: 'Under review',
};

export default function AccountView() {
  const { user, logout } = useAuth();

  const [rows, setRows] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [draft, setDraft] = useState({
    label: 'Home', line1: '', line2: '', city: '', pincode: '',
  });

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    // 15s: the dev proxy queues behind other tabs' requests over HTTP/1.1, so
    // a tight timeout fires while the request is still waiting its turn.
    const withTimeout = (p, ms = 15000) => Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
    ]);
    const [a, c] = await Promise.allSettled([
      withTimeout(myAddresses()),
      withTimeout(fetchApi(CUSTOMERS)),
    ]);
    // Addresses are context, not the point of this screen — a miss just
    // leaves the book empty rather than banner-scaring the shopper.
    if (a.status === 'fulfilled') setRows(asList(a.value, 'addresses') || []);
    if (c.status === 'fulfilled') {
      const mine = asList(c.value, 'customers') || [];
      setCustomer(mine[0] || null);
    } else { console.error(c.reason); setError(describeError(c.reason)); }
    setLoading(false);
  }, []);

  const didLoad = useRef(false);
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    load();
  }, [load]);

  const act = async (fn) => {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      await load();
      window.dispatchEvent(new CustomEvent('zippzo:addresses-changed'));
    } catch (err) {
      setFormError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const add = () => act(async () => {
    await saveAddress(draft);
    setAdding(false);
    setDraft({ label: 'Home', line1: '', line2: '', city: '', pincode: '' });
  });

  const makeDefault = (id) => act(() => setDefaultAddress(id));

  const drop = (id) => act(() => removeAddress(id));

  if (loading) {
    return <div className="shop-page" style={{ textAlign: 'center', color: 'var(--shop-ink-3)', paddingTop: 60 }}>Loading…</div>;
  }

  return (
    <div className="shop-page">
      <h1 className="shop-h1"><User size={21} /> Account</h1>

      {error && (
        <div role="alert" className="shop-err-banner">{error}</div>
      )}

      {/* Profile */}
      <div className="shop-panel shop-profile">
        <div className="shop-profile__id">
          <div className="shop-profile__avatar">
            {(user?.name || 'Z').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="shop-profile__name">{user?.name}</div>
            <div className="shop-profile__email">{user?.email}</div>
          </div>
        </div>

        <div className="shop-profile__stats">
          <Stat label="Trust tier"
                value={customer?.trust_tier || '—'}
                hint={customer ? TIER_WORDS[customer.trust_tier] : 'Not loaded'} />
          <Stat label="Saved addresses" value={String(rows.length)} />
          <Stat label="Status" value={user?.status || 'ACTIVE'} />
        </div>

        <div style={{ marginTop: 16 }}>
          <button className="shop-btn shop-btn--ghost" onClick={logout}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>

      {/* Address book */}
      <div className="shop-panel">
        <div className="shop-panel__head">
          <span className="shop-panel__title">
            <MapPin size={17} /> Address book
          </span>
          {!adding && (
            <button className="shop-btn shop-btn--primary" onClick={() => { setAdding(true); setFormError(null); }}>
              <Plus size={15} /> Add address
            </button>
          )}
        </div>

        {adding && (
          <div className="shop-addr-form">
            <label className="shop-field-label">Label</label>
            <input className="shop-input" value={draft.label} placeholder="Home, Work…"
                   onChange={e => setDraft({ ...draft, label: e.target.value })} />

            <label className="shop-field-label">Flat, house, street</label>
            <input className="shop-input" value={draft.line1} placeholder="Flat 304, Sunrise Apartments"
                   onChange={e => setDraft({ ...draft, line1: e.target.value })} />

            <label className="shop-field-label">Area (optional)</label>
            <input className="shop-input" value={draft.line2} placeholder="Madhapur"
                   onChange={e => setDraft({ ...draft, line2: e.target.value })} />

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label className="shop-field-label">City</label>
                <input className="shop-input" value={draft.city} placeholder="Hyderabad"
                       onChange={e => setDraft({ ...draft, city: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="shop-field-label">Pincode</label>
                <input className="shop-input" value={draft.pincode} inputMode="numeric" maxLength={6}
                       placeholder="500081"
                       onChange={e => setDraft({ ...draft, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
              </div>
            </div>

            {formError && <div className="shop-err-text">{formError}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="shop-btn shop-btn--ghost" style={{ flex: 1 }}
                      onClick={() => { setAdding(false); setFormError(null); }}>
                Cancel
              </button>
              <button className="shop-btn shop-btn--primary" style={{ flex: 2 }}
                      onClick={add}
                      disabled={busy || !draft.line1.trim() || draft.pincode.length !== 6}>
                {busy ? 'Saving…' : 'Save address'}
              </button>
            </div>
          </div>
        )}

        {rows.length === 0 && !adding && (
          <div className="shop-empty-card">
            <MapPin size={32} />
            <div className="shop-empty-card__title">No saved addresses yet.</div>
          </div>
        )}

        {rows.map((a) => (
          <div key={a.address_id} className="shop-addr-row">
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="shop-addr-row__label">{a.label || 'Address'}</span>
                {a.is_default && <span className="shop-chip shop-chip--done">DEFAULT</span>}
              </div>
              <div className="shop-addr-row__text">
                {[a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', ')}
              </div>
            </div>
            <div className="shop-addr-row__actions">
              {!a.is_default && (
                <button className="shop-btn shop-btn--ghost" onClick={() => makeDefault(a.address_id)} disabled={busy}
                        title="Make this the default">
                  <Star size={14} /> Default
                </button>
              )}
              <button className="shop-btn shop-btn--ghost" onClick={() => drop(a.address_id)} disabled={busy}
                      title="Remove address" style={{ color: 'var(--shop-bad)' }}>
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {formError && !adding && (
        <div role="alert" className="shop-err-banner" style={{ marginTop: 14 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {formError}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="shop-stat">
      <div className="shop-stat__label">{label}</div>
      <div className="shop-stat__value">{value}</div>
      {hint && <div className="shop-stat__hint">{hint}</div>}
    </div>
  );
}
