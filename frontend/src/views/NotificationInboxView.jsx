import React, { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Package, Truck, KeyRound, Info, RefreshCw,
  MapPin, Boxes, ClipboardList, PackageCheck } from 'lucide-react';
import { fetchApi, postApi, describeError } from '../api/client';
import { PageHead } from '../components/ui/WmsUI';

const ENDPOINT = '/notifications/notifications/';
const LABELS = {
  ORDER_PLACED: 'Order placed',
  ORDER_PACKED: 'Order packed',
  ORDER_PICKED_UP: 'Rider picked up order',
  ORDER_ON_THE_WAY: 'Order on the way',
  ORDER_DELIVERED: 'Order delivered',
  DELIVERY_OTP: 'Delivery verification code',
  RIDER_JOB_OFFERED: 'New rider job',
  RIDER_ASSIGNED: 'Rider assigned to order',
  RIDER_ARRIVED: 'Rider arrived',
  WMS_TASK_ASSIGNED: 'Putaway task assigned',
  PICK_TASK_ASSIGNED: 'Pick task assigned',
  PACK_TASK_ASSIGNED: 'Pack task assigned',
  ORDER_UPDATE: 'Order update',
};
const ICONS = {
  ORDER_PLACED: Package,
  ORDER_PACKED: Package,
  ORDER_ON_THE_WAY: Truck,
  ORDER_DELIVERED: CheckCheck,
  DELIVERY_OTP: KeyRound,
  RIDER_JOB_OFFERED: Truck,
  RIDER_ASSIGNED: Truck,
  RIDER_ARRIVED: MapPin,
  WMS_TASK_ASSIGNED: Boxes,
  PICK_TASK_ASSIGNED: ClipboardList,
  PACK_TASK_ASSIGNED: PackageCheck,
};

function messageFor(row) {
  const payload = row.payload_json || {};
  const parts = [];
  if (payload.order_no) parts.push(`Order ${payload.order_no}`);
  if (payload.task_type) parts.push(`${payload.task_type} task ${payload.task_id || ''}`.trim());
  if (payload.site_code) parts.push(payload.site_code);
  if (payload.sku_code) parts.push(payload.sku_code);
  if (payload.qty != null) parts.push(`Qty ${payload.qty}`);
  if (payload.staging_bin) parts.push(`Collect from ${payload.staging_bin}`);
  if (payload.otp) parts.push(`Customer code: ${payload.otp}`);
  if (payload.cod_amount) parts.push(`COD collected: ₹${payload.cod_amount}`);
  return parts.join(' · ') || 'Open the related order or task for details.';
}

export default function NotificationInboxView() {
  const [rows, setRows] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [items, count] = await Promise.all([
        fetchApi(ENDPOINT),
        fetchApi(`${ENDPOINT}unread_count/`),
      ]);
      setRows(Array.isArray(items) ? items : []);
      setUnread(count?.unread || 0);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => load();
    window.addEventListener('zippzo:live-event', refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener('zippzo:live-event', refresh);
      clearInterval(timer);
    };
  }, [load]);

  const markAll = async () => {
    setBusy(true);
    try {
      await postApi(`${ENDPOINT}mark_all_read/`, {});
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const markRead = async (row) => {
    if (row.read_at) return;
    try {
      await postApi(`${ENDPOINT}${row.notification_id}/mark_read/`, {});
      const readAt = new Date().toISOString();
      setRows(current => current.map(item => item.notification_id === row.notification_id
        ? { ...item, read_at: readAt } : item));
      setUnread(current => Math.max(0, current - 1));
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <section className="notification-inbox" data-testid="notification-inbox">
      <PageHead
        title="Notifications"
        count={unread}
        countLabel="unread"
        subtitle="Order updates, rider offers, delivery codes, and handoff status for your account."
        actions={(
          <div className="notification-inbox__actions">
            <button type="button" className="btn-secondary" onClick={load} aria-label="Refresh notifications">
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" className="btn-primary" onClick={markAll} disabled={!unread || busy}>
              <CheckCheck size={15} /> Mark all read
            </button>
          </div>
        )}
      />
      {error && <div className="notification-inbox__error" role="alert">{error}</div>}
      {loading ? (
        <div className="notification-inbox__empty">Loading notifications…</div>
      ) : rows.length === 0 ? (
        <div className="notification-inbox__empty"><Bell size={24} /><strong>You're all caught up</strong><span>New updates will appear here.</span></div>
      ) : (
        <div className="notification-inbox__list">
          {rows.map(row => {
            const Icon = ICONS[row.type] || Info;
            return (
              <button
                type="button"
                key={row.notification_id}
                className={`notification-inbox__row${row.read_at ? '' : ' is-unread'}`}
                onClick={() => markRead(row)}
              >
                <span className="notification-inbox__icon"><Icon size={17} /></span>
                <span className="notification-inbox__copy">
                  <strong>{LABELS[row.type] || row.type}</strong>
                  <span>{messageFor(row)}</span>
                </span>
                <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
