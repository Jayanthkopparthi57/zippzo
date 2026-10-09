import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { fetchApi, describeError } from '../../api/client';
import {
  myAddresses, saveAddress, setDefaultAddress, removeAddress, asList
} from '../darkstore/useDarkStore';
import { User, MapPin, Plus, Star, Trash2, AlertCircle } from 'lucide-react';

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
    try {
      const [a, c] = await Promise.all([
        myAddresses(),
        fetchApi(CUSTOMERS).catch(() => []),
      ]);
      setRows(asList(a, 'addresses') || []);
      const mine = asList(c, 'customers') || [];
      setCustomer(mine[0] || null);
    } catch (err) {
      console.error(err);
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      await load();
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

  const field = {
    width: '100%', padding: 11, border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 14, boxSizing: 'border-box',
  };
  const label = {
    display: 'block', fontSize: 12, fontWeight: 700, color: '#475569',
    margin: '12px 0 5px',
  };

  if (loading) {
    return <div style={{ padding: 44, textAlign: 'center', color: '#64748b' }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 48px' }}>
      <h1 style={{ margin: '0 0 16px', fontSize: 20, color: '#0f172a', display: 'flex', gap: 9, alignItems: 'center' }}>
        <User size={20} color="#7c3aed" /> Account
      </h1>

      {error && (
        <div role="alert" style={{
          background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
          borderRadius: 10, padding: '11px 14px', fontSize: 13, fontWeight: 600,
          marginBottom: 14,
        }}>{error}</div>
      )}

      {/* Profile */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
        padding: 18, marginBottom: 18,
      }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{
            width: 54, height: 54, borderRadius: '50%', background: '#7c3aed',
            color: '#fff', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 22, fontWeight: 800,
            flexShrink: 0,
          }}>
            {(user?.name || 'Z').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#0f172a' }}>{user?.name}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{user?.email}</div>
          </div>
        </div>

        <div style={{
          display: 'flex', gap: 10, marginTop: 16, paddingTop: 14,
          borderTop: '1px solid #f1f5f9', flexWrap: 'wrap',
        }}>
          <Stat label="Trust tier"
                value={customer?.trust_tier || '—'}
                hint={customer ? TIER_WORDS[customer.trust_tier] : 'Not loaded'} />
          <Stat label="Saved addresses" value={String(rows.length)} />
          <Stat label="Status" value={user?.status || 'ACTIVE'} />
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={logout} style={{
            padding: '10px 18px', background: '#f1f5f9', border: 'none',
            borderRadius: 9, fontWeight: 700, fontSize: 13, color: '#475569',
            cursor: 'pointer',
          }}>Sign out</button>
        </div>
      </div>

      {/* Address book */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '15px 18px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', borderBottom: '1px solid #e2e8f0',
        }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', display: 'flex', gap: 8, alignItems: 'center' }}>
            <MapPin size={17} color="#dc2626" /> Address book
          </span>
          {!adding && (
            <button onClick={() => { setAdding(true); setFormError(null); }} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8,
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}>
              <Plus size={15} /> Add address
            </button>
          )}
        </div>

        {adding && (
          <div style={{ padding: 16, background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <label style={label}>Label</label>
            <input style={field} value={draft.label} placeholder="Home, Work…"
                   onChange={e => setDraft({ ...draft, label: e.target.value })} />

            <label style={label}>Flat, house, street</label>
            <input style={field} value={draft.line1} placeholder="Flat 304, Sunrise Apartments"
                   onChange={e => setDraft({ ...draft, line1: e.target.value })} />

            <label style={label}>Area (optional)</label>
            <input style={field} value={draft.line2} placeholder="Madhapur"
                   onChange={e => setDraft({ ...draft, line2: e.target.value })} />

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={label}>City</label>
                <input style={field} value={draft.city} placeholder="Hyderabad"
                       onChange={e => setDraft({ ...draft, city: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>Pincode</label>
                <input style={field} value={draft.pincode} inputMode="numeric" maxLength={6}
                       placeholder="500081"
                       onChange={e => setDraft({ ...draft, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
              </div>
            </div>

            {formError && (
              <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 9 }}>{formError}</div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => { setAdding(false); setFormError(null); }} style={{
                flex: 1, padding: 11, background: '#fff', border: '1px solid #cbd5e1',
                borderRadius: 9, fontWeight: 700, color: '#475569', cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={add} disabled={busy || !draft.line1.trim() || draft.pincode.length !== 6} style={{
                flex: 2, padding: 11, border: 'none', borderRadius: 9,
                fontWeight: 700, color: '#fff', cursor: 'pointer',
                background: draft.line1.trim() && draft.pincode.length === 6 ? '#7c3aed' : '#cbd5e1',
              }}>{busy ? 'Saving…' : 'Save address'}</button>
            </div>
          </div>
        )}

        {rows.length === 0 && !adding && (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            No saved addresses yet.
          </div>
        )}

        {rows.map((a, i) => (
          <div key={a.address_id} style={{
            padding: '14px 18px',
            borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none',
            display: 'flex', justifyContent: 'space-between', gap: 12,
            alignItems: 'flex-start',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>
                  {a.label || 'Address'}
                </span>
                {a.is_default && (
                  <span style={{
                    background: '#d1fae5', color: '#065f46', fontSize: 11,
                    fontWeight: 800, padding: '2px 8px', borderRadius: 10,
                  }}>DEFAULT</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
                {[a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
              {!a.is_default && (
                <button onClick={() => makeDefault(a.address_id)} disabled={busy}
                        title="Make this the default" style={{
                  padding: '8px 11px', background: '#f1f5f9', border: 'none',
                  borderRadius: 8, color: '#475569', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                  fontWeight: 700,
                }}>
                  <Star size={14} /> Default
                </button>
              )}
              <button onClick={() => drop(a.address_id)} disabled={busy}
                      title="Remove address" style={{
                padding: '8px 11px', background: '#fef2f2', border: 'none',
                borderRadius: 8, color: '#b91c1c', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                fontWeight: 700,
              }}>
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {formError && !adding && (
        <div role="alert" style={{
          marginTop: 14, background: '#fef2f2', border: '1px solid #fecaca',
          color: '#991b1b', borderRadius: 10, padding: '11px 14px',
          fontSize: 13, fontWeight: 600, display: 'flex', gap: 8,
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {formError}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div style={{
      background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 10,
      padding: '9px 13px', minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b', marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{hint}</div>}
    </div>
  );
}
