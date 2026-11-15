import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi, postApi, describeError } from '../../api/client';
import { Bell, CheckCheck, Package, Truck, KeyRound, Info } from 'lucide-react';

const NOTIFICATIONS = '/notifications/notifications/';

const LABELS = {
  ORDER_PLACED: 'Order received',
  ORDER_PACKED: 'Your order is packed',
  ORDER_PICKED_UP: 'Rider picked up your order',
  ORDER_ON_THE_WAY: 'Your order is on the way',
  ORDER_DELIVERED: 'Delivered',
  DELIVERY_OTP: 'Delivery code ready',
  RIDER_ASSIGNED: 'Your rider is assigned',
  RIDER_ARRIVED: 'Your rider has arrived',
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
  if (n.read_at) return { bg: 'transparent', dot: 'var(--shop-line-2)' };
  if (n.type === 'DELIVERY_OTP') return { bg: '#fff7ed', dot: '#f97316' };
  return { bg: 'var(--shop-accent-soft)', dot: 'var(--shop-accent)' };
};

export default function NotificationsView() {
  const [rows, setRows] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = useCallback(async (unreadOnly = onlyUnread, quiet = false) => {
    setError(null);
    if (!quiet) setLoading(true);
    // 15s: the dev proxy queues behind other tabs' requests over HTTP/1.1.
    const withTimeout = (p, ms = 15000) => Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
    ]);
    const [list, count] = await Promise.allSettled([
      withTimeout(fetchApi(`${NOTIFICATIONS}${unreadOnly ? '?unread=true' : ''}`)),
      withTimeout(fetchApi(`${NOTIFICATIONS}unread_count/`)),
    ]);
    if (list.status === 'fulfilled') {
      setRows(Array.isArray(list.value) ? list.value : []);
    } else { console.error(list.reason); setError(describeError(list.reason)); }
    if (count.status === 'fulfilled') setUnread(count.value?.unread || 0);
    if (!quiet) setLoading(false);
  }, [onlyUnread]);

  const didLoad = useRef(false);
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    load(onlyUnread);
  }, [load, onlyUnread]);

  // Refresh every 30 s so order-status notifications (packed, on-the-way, OTP)
  // appear without the shopper manually pulling to refresh.
  useEffect(() => {
    const id = setInterval(() => load(onlyUnread, true), 30000);
    return () => clearInterval(id);
  }, [load, onlyUnread]);

  useEffect(() => {
    const refresh = () => load(onlyUnread, true);
    window.addEventListener('zippzo:live-event', refresh);
    return () => window.removeEventListener('zippzo:live-event', refresh);
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
    return <div className="shop-page" style={{ textAlign: 'center', color: 'var(--shop-ink-3)' }}>Loading…</div>;
  }

  return (
    <div className="shop-page">
      <div className="shop-page__head">
        <h1 className="shop-h1">
          <Bell size={21} /> Notifications
          {unread > 0 && (
            <span className="shop-badge">{unread}</span>
          )}
        </h1>
        <div className="shop-toggle">
          <button aria-pressed={onlyUnread} onClick={() => {
            const next = !onlyUnread;
            setOnlyUnread(next);
            load(next);
          }}>Unread</button>
          {unread > 0 && (
            <button onClick={markAll} disabled={busy}>{busy ? 'Marking…' : 'Mark all read'}</button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="shop-err-banner">{error}</div>
      )}

      {rows.length === 0 && (
        <div className="shop-empty-card">
          <Bell size={32} />
          <div className="shop-empty-card__title">
            {onlyUnread ? 'Nothing unread.' : 'Nothing yet.'}
          </div>
          <div className="shop-empty-card__sub">Order updates land here.</div>
        </div>
      )}

      <div className="shop-panel">
        {rows.map((n) => {
          const Icon = ICONS[n.type] || Info;
          const tone = tint(n);
          const body = n.payload_json || {};
          return (
            <div key={n.notification_id}
                 className={`shop-notif-row ${n.read_at ? 'shop-notif-row--read' : ''}`}
                 onClick={() => markOne(n)}
                 role="button"
                 tabIndex={n.read_at ? -1 : 0}
                 onKeyDown={(event) => {
                   if (event.key === 'Enter' || event.key === ' ') {
                     event.preventDefault();
                     markOne(n);
                   }
                 }}
                 aria-label={`${LABELS[n.type] || n.type}${n.read_at ? ', read' : ', mark as read'}`}
                 style={{ background: n.read_at ? 'transparent' : tone.bg }}>
              <div className="shop-notif-row__icon" style={{ background: tone.dot }}>
                <Icon size={17} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span className="shop-notif-row__title">
                    {LABELS[n.type] || n.type}
                  </span>
                  <span className="shop-notif-row__time">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="shop-notif-row__body">
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
