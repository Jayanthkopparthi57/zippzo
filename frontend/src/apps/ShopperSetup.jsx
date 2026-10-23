import React, { useState, useEffect, useCallback } from 'react';
import { fetchApi, postApi, describeError, unwrapList } from '../api/client';
import { UserRound, AlertCircle, Loader2 } from 'lucide-react';

const CUSTOMERS = '/orders/customers/';

/**
 * The first-run screen for a fresh shopper login.
 *
 * There is no self-service sign-up in this platform: staff provision the
 * login, and the login arrives with no `Customer` row behind it. Checkout
 * refuses an account that has no customer row, and so do the address and
 * basket endpoints, so this screen is the missing step between "a login that
 * can see the shop" and "a person who can buy from it". It is the shopper-side
 * equivalent of the rider's profile setup.
 *
 * It sits above the tab shell rather than inside a tab, because there is
 * nothing useful to show in the other three tabs until the account exists.
 */
export default function ShopperSetup({ onReady }) {
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');

  const ensure = useCallback(async () => {
    setError(null);
    setChecking(true);
    try {
      const rows = unwrapList(await fetchApi(CUSTOMERS)) || [];
      if (rows.length > 0) {
        onReady(rows[0]);
        return;
      }
      setChecking(false);
    } catch (err) {
      // A failed check must not lock the shopper out of the setup form:
      // they can still fill it in and the POST will report the real problem.
      console.error(err);
      setChecking(false);
    }
  }, [onReady]);

  useEffect(() => { ensure(); }, [ensure]);

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await postApi(CUSTOMERS, { name: name.trim() });
      onReady(created);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div data-testid="shopper-setup-loading"
           style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>
        <Loader2 size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
        Checking your account…
      </div>
    );
  }

  const field = {
    width: '100%', padding: 11, border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 14, boxSizing: 'border-box',
  };

  return (
    <div data-testid="shopper-setup" style={{ background: '#f8fafc', minHeight: '100vh', padding: 24 }}>
      <div style={{
        maxWidth: 440, margin: '48px auto', background: '#fff', borderRadius: 16,
        padding: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      }}>
        <h1 style={{
          margin: '0 0 6px', fontSize: 18, display: 'flex', gap: 8,
          alignItems: 'center', color: '#1e293b',
        }}>
          <UserRound size={20} color="#7c3aed" /> Set up your account
        </h1>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: '#64748b' }}>
          One detail and you can start shopping. We use it to greet you and to
          keep your orders straight.
        </p>

        {error && (
          <div role="alert" style={{
            background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
            borderRadius: 10, padding: '11px 14px', fontSize: 13, fontWeight: 600,
            display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16,
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit}>
          <label style={{
            display: 'block', fontSize: 12, fontWeight: 700, color: '#475569',
            margin: '0 0 5px',
          }}>
            Your name
          </label>
          <input
            data-testid="shopper-setup-name"
            style={field}
            value={name}
            maxLength={80}
            placeholder="How should we greet you?"
            onChange={(e) => setName(e.target.value)}
          />

          <button
            data-testid="shopper-setup-submit"
            type="submit"
            disabled={busy || !name.trim()}
            style={{
              width: '100%', marginTop: 18, padding: 12, border: 'none',
              borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer',
              color: '#fff',
              background: name.trim() ? '#7c3aed' : '#cbd5e1',
            }}
          >
            {busy ? 'Creating…' : 'Start shopping'}
          </button>
        </form>
      </div>
    </div>
  );
}
