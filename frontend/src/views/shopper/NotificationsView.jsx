import React, { useState, useEffect, useCallback } from 'react';
import { fetchApi, postApi, describeError } from '../../api/client';
import { Bell, CheckCheck, Package, Truck, KeyRound, Info } from 'lucide-react';

const NOTIFICATIONS = '/notifications/notifications/';

const LABELS = {
  ORDER_PACKED: 'Your order is packed',
  ORDER_ON_THE_WAY: 'Your order is on the way',
  ORDER_DELIVERED: 'Delivered',
  DELIVERY_OTP: 'Delivery code ready',
  RIDER_JOB_OFFERED: 'Rider assignment',
  ORDER_UPDATE: 'Order update',
};

const ICONS = {
  ORDER_PACKED: Package,
  ORDER_ON_THE_WAY: Truck,
  ORDER_DELIVERED: CheckCheck,
  DELIVERY_OTP: KeyRound,
  RIDER_JOB_OFFERED: Truck,
  ORDER_UPDATE: Info,
};

const tint = (n) => {
  if (n.read_at) return { bg: '#fff', dot: '#cbd5e1' };
  if (n.type === 'DELIVERY_OTP') return { bg: '#fff7ed', dot: '#f97316' };
  return { bg: '#f5f3ff', dot: '#7c3aed' };
};

export default function NotificationsView() {
  const [rows, setRows] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = useCallback(async (unreadOnly = onlyUnread) => {
    setError(null);
    try {
      const [list, count] = await Promise.all([
        fetchApi(`${NOTIFICATIONS}${unreadOnly ? '?unread=true' : ''}`),
        fetchApi(`${NOTIFICATIONS}unread_count/`).catch(() => ({ unread: 0 })),
      ]);
      setRows(Array.isArray(list) ? list : []);
      setUnread(count?.unread || 0);
    } catch (err) {
      console.error(err);
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [onlyUnread]);

  useEffect(() => { load(onlyUnread); }, [load, onlyUnread]);

  // Refresh every 30 s so order-status notifications (packed, on-the-way, OTP)
  // appear without the shopper manually pulling to refresh.
  useEffect(() => {
    const id = setInterval(() => load(onlyUnread), 30000);
    return () => clearInterval(id);
  }, [load, onlyUnread]);

  const markOne = async (n) => {
    if (n.read_at) return;
    try {
      await postApi(`${NOTIFICATIONS}${n.notification_id}/mark_read/`, {});
      setRows(prev => prev.map(r => r.notification_id === n.notification_id
        ? { ...r, read_at: new Date().toISOString() } : r));
      setUnread(u => Math.max(0, u - 1));
    } catch (err) {
      setError(describeError(err));
    }
  };

  const markAll = async () => {
    setBusy(true);
    setError(null);
    try {
      await postApi(`${NOTIFICATIONS}mark_all_read/`, {});
      await load(onlyUnread);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 44, textAlign: 'center', color: '#64748b' }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, color: '#0f172a', display: 'flex', gap: 9, alignItems: 'center' }}>
          <Bell size={20} color="#7c3aed" /> Notifications
          {unread > 0 && (
            <span style={{
              background: '#dc2626', color: '#fff', borderRadius: 999,
              fontSize: 12, fontWeight: 800, padding: '2px 9px',
            }}>{unread}</span>
          )}
        </h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setOnlyUnread(v => !v)} style={{
            border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13,
            fontWeight: 700, cursor: 'pointer',
            background: onlyUnread ? '#7c3aed' : '#f1f5f9',
            color: onlyUnread ? '#fff' : '#475569',
          }}>Unread</button>
          {unread > 0 && (
            <button onClick={markAll} disabled={busy} style={{
              border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13,
              fontWeight: 700, cursor: 'pointer', background: '#f1f5f9',
              color: '#475569',
            }}>{busy ? 'Marking…' : 'Mark all read'}</button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" style={{
          background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
          borderRadius: 10, padding: '11px 14px', fontSize: 13, fontWeight: 600,
          marginBottom: 14,
        }}>{error}</div>
      )}

      {rows.length === 0 && (
        <div style={{
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
          padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14,
        }}>
          {onlyUnread ? 'Nothing unread.' : 'Nothing yet. Order updates land here.'}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
        {rows.map((n, i) => {
          const Icon = ICONS[n.type] || Info;
          const tone = tint(n);
          const body = n.payload_json || {};
          return (
            <div key={n.notification_id} onClick={() => markOne(n)} style={{
              background: tone.bg,
              borderBottom: i < rows.length - 1 ? '1px solid #e2e8f0' : 'none',
              padding: '14px 16px', cursor: n.read_at ? 'default' : 'pointer',
              display: 'flex', gap: 13, alignItems: 'flex-start',
            }}>
              <div style={{
                background: tone.dot, borderRadius: 999, width: 34, height: 34,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={17} color="#fff" />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>
                    {LABELS[n.type] || n.type}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#475569', marginTop: 3 }}>
                  {body.order_no ? `Order ${body.order_no}` : ''}
                  {body.otp ? ` — code ${body.otp}` : ''}
                  {body.cod_amount ? ` — ₹${body.cod_amount} collected` : ''}
                  {!body.order_no && !body.otp && !body.cod_amount && '—'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
