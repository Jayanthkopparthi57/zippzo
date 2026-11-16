import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchApi, postApi, unwrapList, describeError
} from '../../api/client';
import {
  myOrders, deliveryCode, orderTracking, asList, num, myAddresses, cancelOrder, storefront
} from '../darkstore/useDarkStore';
import { useTabs } from '../../context/TabContext';
import {
  Package, MapPin, ChevronRight, KeyRound, Bike,
  AlertCircle, RotateCcw, Truck, XCircle, ShoppingBasket,
} from 'lucide-react';

const LINES = '/orders/order-lines/';
const HISTORY = '/orders/order-history/';
const SKUS = '/catalog/skus/';
const RETURNS = '/reverse/returns/';

const AWAITING_CODE = new Set(['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED']);
const CANCELLED = new Set(['CANCELLED', 'REFUNDED', 'EXPIRED', 'FAILED']);
// Only these can still be cancelled by the shopper; the server enforces the
// same rule — cancelling later would break picking and refunds.
const CANCELLABLE = new Set(['PLACED', 'CONFIRMED', 'PAYMENT_PENDING']);

const STAGE_WORDS = {
  PLACED: 'Order placed',
  PAYMENT_PENDING: 'Awaiting confirmation',
  PAYMENT_FAILED: 'Payment failed',
  CONFIRMED: 'Confirmed',
  PICKING: 'Being picked',
  INTERRUPTED: 'Picking interrupted',
  PICKED: 'Picked',
  PARTIALLY_FULFILLED: 'Partly fulfilled',
  PACKED: 'Packed',
  PRICE_FINALIZED: 'Finalised',
  STAGED: 'Ready at the store',
  RIDER_ASSIGNED: 'Rider assigned',
  PICKED_UP: 'On the way',
  OUT_FOR_DELIVERY: 'Out for delivery',
  ARRIVED: 'Rider at your door',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  CANCELLED_PENDING_RETURN: 'Return in progress',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
  CLOSED_RTO: 'Returned to store',
  REFUNDED: 'Refunded',
};

/** "just now" / "2 min ago" for the rider's last position ping. */
function seenWords(iso) {
  if (!iso) return 'not shared yet';
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  return new Date(iso).toLocaleTimeString();
}

const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';

/**
 * Embedded OpenStreetMap map (Leaflet). The rider's pin moves with every
 * tracking poll. OSM needs no API key; if the CDN or tiles fail we degrade
 * to the "open in Google Maps" link below the frame instead of a void.
 */
function RiderMap({ rider, destination }) {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);
  const riderRef = React.useRef(null);
  const destRef = React.useRef(null);
  const lineRef = React.useRef(null);
  const errorRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    const ensureLeaflet = () => new Promise((resolve, reject) => {
      if (window.L) return resolve();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('map failed to load'));
      document.head.appendChild(script);
    });
    ensureLeaflet().then(() => {
      if (cancelled || !ref.current) return;
      const L = window.L;
      if (!mapRef.current) {
        const map = L.map(ref.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
          .on('tileerror', () => { if (errorRef.current) errorRef.current.style.display = 'block'; })
          .addTo(map);
        mapRef.current = map;
        destRef.current = L.marker([destination.lat, destination.lng], {
          icon: L.divIcon({
            className: 'map-dot',
            html: '<div style="width:24px;height:24px;border-radius:50% 50% 50% 2px;background:#6d4aff;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 5px rgba(0,0,0,.35)"></div>',
            iconSize: [24, 24], iconAnchor: [12, 20],
          }),
        }).addTo(map);
        riderRef.current = L.marker([rider.lat, rider.lng], {
          icon: L.divIcon({
            className: 'map-dot',
            html: '<div style="width:14px;height:14px;border-radius:50%;background:#6d4aff;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
            iconSize: [14, 14], iconAnchor: [7, 7],
          }),
        }).addTo(map);
        lineRef.current = L.polyline([[rider.lat, rider.lng], [destination.lat, destination.lng]], {
          color: '#6d4aff', weight: 3, dashArray: '6 8', opacity: 0.85,
        }).addTo(map);
        map.fitBounds(L.latLngBounds([[rider.lat, rider.lng], [destination.lat, destination.lng]]).pad(0.35));
      } else {
        riderRef.current.setLatLng([rider.lat, rider.lng]);
        lineRef.current.setLatLngs([[rider.lat, rider.lng], [destination.lat, destination.lng]]);
      }
    }).catch(() => {
      if (errorRef.current) errorRef.current.style.display = 'block';
    });
    return () => { cancelled = true; };
  }, [rider.lat, rider.lng, destination.lat, destination.lng]);

  return (
    <div className="shop-tracking-map__canvaswrap">
      <div ref={ref} className="shop-tracking-map__canvas" data-testid="tracking-leaflet" aria-label="Live rider position on map" />
      <div ref={errorRef} className="shop-tracking-map__note" style={{ display: 'none' }}>
        Map tiles unavailable — use the Google Maps link below.
      </div>
    </div>
  );
}

function RiderLocationMap({ tracking }) {
  const rider = tracking.location;
  const destination = tracking.destination;
  if (!rider || !destination) return null;
  if ([rider, destination].some((point) =>
    point.lat == null || point.lng == null || point.lat === '' || point.lng === ''
    || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))
    || Math.abs(Number(point.lat)) > 90 || Math.abs(Number(point.lng)) > 180
  )) return null;
  const rLat = Number(rider.lat), rLng = Number(rider.lng);
  const dLat = Number(destination.lat), dLng = Number(destination.lng);
  const rPos = { lat: rLat, lng: rLng };
  const dPos = { lat: dLat, lng: dLng };
  const origin = `${rLat},${rLng}`;
  const target = `${dLat},${dLng}`;
  const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(target)}&travelmode=driving`;

  return (
    <div className="shop-tracking-map" data-testid="tracking-map">
      <RiderMap rider={rPos} destination={dPos} />
      <a className="shop-tracking-map__link" href={mapUrl} target="_blank" rel="noreferrer">
        <MapPin size={16} /> Open rider route in Google Maps <ChevronRight size={16} />
      </a>
      <div className="shop-tracking-map__note">
        Rider's latest position ping — the map refreshes with each poll.
      </div>
    </div>
  );
}

export default function MyOrdersView() {  const { openTab } = useTabs();
  const [orders, setOrders] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [skus, setSkus] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState({ lines: [], history: [] });
  const [code, setCode] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);

  // Cancel flow
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  // Return flow
  const [returnFor, setReturnFor] = useState(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState(null);
  const [returns, setReturns] = useState([]);

  // Reorder
  const [reorderBusy, setReorderBusy] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    // 15s: the dev proxy queues behind other tabs' requests over HTTP/1.1, so
    // a tight timeout fires while the request is still waiting its turn.
    const withTimeout = (p, ms = 15000) => Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
    ]);
    const [o, a, s, r] = await Promise.allSettled([
      withTimeout(myOrders()),
      withTimeout(myAddresses()),
      withTimeout(fetchApi(SKUS)),
      withTimeout(fetchApi(RETURNS)),
    ]);
    // Only the order list itself is worth banner-scaring about; the rest is
    // enrichment that degrades quietly.
    if (o.status === 'fulfilled') setOrders(asList(o.value, 'orders'));
    else { console.error(o.reason); setError(describeError(o.reason)); }
    if (a.status === 'fulfilled') setAddresses(asList(a.value, 'addresses') || []);
    if (s.status === 'fulfilled') {
      const map = {};
      for (const sku of (unwrapList(s.value) || [])) map[sku.sku_id] = sku;
      setSkus(map);
    }
    if (r.status === 'fulfilled') setReturns(asList(r.value, 'returns') || []);
    setLoading(false);
  }, []);

  // StrictMode mounts, unmounts and remounts in dev. Without this guard the
  // effect fires twice, doubling every fetch and starving the HTTP/1.1
  // connection pool — half the requests then hang past the timeout.
  const didLoad = useRef(false);
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    load();
  }, [load]);

  // Order lifecycle notifications arrive over the authenticated event socket.
  // Refresh when a suspended mobile app returns to the foreground as recovery.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) load(); };
    window.addEventListener('zippzo:live-event', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('zippzo:live-event', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const openDetail = useCallback(async (orderId) => {
    setOpenId(orderId);
    setDetail({ lines: [], history: [] });
    setCode(null);
    setTracking(null);
    setDetailBusy(true);
    const withTimeout = (p, ms = 15000) => Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
    ]);
    const [l, h, t] = await Promise.allSettled([
      withTimeout(fetchApi(`${LINES}?order=${orderId}`)),
      withTimeout(fetchApi(`${HISTORY}?order=${orderId}`)),
      withTimeout(orderTracking(orderId)),
    ]);
    setDetail({
      lines: l.status === 'fulfilled' ? (unwrapList(l.value) || []) : [],
      history: h.status === 'fulfilled' ? (unwrapList(h.value) || []) : [],
    });
    setTracking(t.status === 'fulfilled' ? t.value : null);
    const order = orders.find(o => o.order_id === orderId);
    if (order && AWAITING_CODE.has(order.status)) {
      const c = await deliveryCode(orderId).catch(() => null);
      setCode(c);
    }
    setDetailBusy(false);
  }, [orders]);

  // A moving parcel is worth re-asking about; a parked one is not. The poll
  // stops the moment the server says the rider is no longer carrying it.
  useEffect(() => {
    if (!openId || !tracking?.live) return undefined;
    const id = setInterval(async () => {
      const next = await orderTracking(openId).catch(() => null);
      if (next) setTracking(next);
    }, 20000);
    return () => clearInterval(id);
  }, [openId, tracking?.live]);

  useEffect(() => {
    const order = orders.find(o => o.order_id === openId);
    if (!order || !AWAITING_CODE.has(order.status)) return undefined;
    const id = setInterval(async () => {
      const c = await deliveryCode(openId).catch(() => null);
      if (c) setCode(c);
    }, 8000);
    return () => clearInterval(id);
  }, [openId, orders]);

  const submitCancel = async () => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await cancelOrder(cancelFor, cancelReason.trim());
      setCancelFor(null);
      setCancelReason('');
      await load();
    } catch (err) {
      setCancelError(describeError(err));
    } finally {
      setCancelBusy(false);
    }
  };

  const submitReturn = async () => {
    setReturnBusy(true);
    setReturnError(null);
    try {
      await postApi(RETURNS, { order: returnFor, reason: returnReason.trim() });
      setReturnFor(null);
      setReturnReason('');
      await load();
    } catch (err) {
      setReturnError(describeError(err));
    } finally {
      setReturnBusy(false);
    }
  };

  const reorder = async (order) => {
    setReorderBusy(order.order_id);
    try {
      const [linesRes, storeRes] = await Promise.all([
        fetchApi(`${LINES}?order=${order.order_id}`),
        storefront(typeof order.site === 'string' ? order.site : '').catch(() => null),
      ]);
      const lines = unwrapList(linesRes) || [];
      const items = storeRes?.items || storeRes?.results || [];
      let added = 0;
      for (const l of lines) {
        const item = items.find(i => i.sku_id === l.sku);
        if (!item) continue; // item left the shelf since the order
        for (let n = 0; n < l.qty; n += 1) {
          window.dispatchEvent(new CustomEvent('zippzo:basket-add', {
            detail: { sku_id: l.sku, qty: 1 },
          }));
          added += 1;
        }
      }
      if (added > 0) {
        openTab('shop-storefront', 'Order Groceries', 'ShoppingBasket');
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setReorderBusy(null);
    }
  };

  const track = (order) => {
    window.dispatchEvent(new CustomEvent('zippzo:track-order', { detail: { orderId: order.order_id } }));
    openTab('shop-track', 'Track order', 'Truck');
  };

  const live = orders.filter(o => !CANCELLED.has(o.status));
  const past = orders.filter(o => CANCELLED.has(o.status) || o.status === 'DELIVERED');
  const rows = filter === 'live' ? orders.filter(o => !CANCELLED.has(o.status) && o.status !== 'DELIVERED')
    : filter === 'past' ? past
    : orders;

  const addressFor = (order) =>
    addresses.find(a => a.address_id === order.address);

  if (loading) {
    return <div className="shop-page" style={{ textAlign: 'center', color: 'var(--shop-ink-3)', paddingTop: 60 }}>Loading your orders…</div>;
  }

  if (error && orders.length === 0) {
    return (
      <div className="shop-page" style={{ textAlign: 'center', paddingTop: 60 }}>
        <AlertCircle size={30} className="shop-err-icon" />
        <p style={{ color: 'var(--shop-danger-ink, #991b1b)', fontWeight: 600 }}>{error}</p>
        <button className="shop-btn shop-btn--primary" onClick={load}>Try again</button>
      </div>
    );
  }

  return (
    <div className="shop-page">
      <div className="shop-page__head">
        <h1 className="shop-h1"><Package size={21} /> My orders</h1>
        <div className="shop-toggle">
          {[['all', `All (${orders.length})`], ['live', `Live (${orders.filter(o => !CANCELLED.has(o.status) && o.status !== 'DELIVERED').length})`], ['past', `Past (${past.length})`]].map(([id, label]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </div>

      {rows.length === 0 && (
        <div className="shop-empty-card">
          <ShoppingBasket size={32} />
          <div className="shop-empty-card__title">Nothing here yet.</div>
          <div className="shop-empty-card__sub">Place an order from the storefront.</div>
        </div>
      )}

      {rows.map(o => (
        <div key={o.order_id} className="shop-ordercard">
          <button
            type="button"
            className="shop-ordercard__head"
            aria-expanded={openId === o.order_id}
            onClick={() => openId === o.order_id ? setOpenId(null) : openDetail(o.order_id)}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="shop-ordercard__no">{o.order_no}</span>
                <span className={`shop-chip shop-chip--${CANCELLED.has(o.status) ? 'cancel' : o.status === 'DELIVERED' ? 'done' : AWAITING_CODE.has(o.status) || o.status === 'RIDER_ASSIGNED' ? 'live' : 'neutral'}`}>
                  {STAGE_WORDS[o.status] || o.status}
                </span>
              </div>
              <div className="shop-ordercard__meta">
                {o.placed_at ? new Date(o.placed_at).toLocaleString() : ''}
                {o.payment_method === 'COD' && ' · pay on delivery'}
                {o.delivery_slot && ` · ${o.delivery_slot}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="shop-ordercard__total">₹{num(o.grand_total).toFixed(2)}</span>
              <ChevronRight size={17} aria-hidden="true" style={{
                color: openId === o.order_id ? 'var(--shop-accent)' : 'var(--shop-ink-3)',
                transform: openId === o.order_id ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
              }} />
            </div>
          </button>

          {openId === o.order_id && (
            <div className="shop-ordercard__body">
              {detailBusy && <div style={{ color: 'var(--shop-ink-3)', fontSize: 13 }}>Loading…</div>}

              {/* Delivery code — heading div then code div; E2E reads the code
                  from the heading's parent's second child */}
              {code && (
                <div className="shop-dcode">
                  <KeyRound size={26} style={{ flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {code.state === 'ready' ? 'Your delivery code'
                        : code.state === 'used' ? 'This code has been used'
                        : 'Waiting for the rider to ask for a code'}
                    </div>
                    {code.code && (
                      <div className="shop-dcode__code">{code.code}</div>
                    )}
                    <div className="shop-dcode__hint">
                      Read this to the rider at your door. The rider never sees it beforehand.
                    </div>
                  </div>
                </div>
              )}

              {/* Live delivery: who is carrying it and how far out they are.
                  The server only names a rider while the parcel is moving. */}
              {tracking?.live && tracking.rider && (
                <div className="shop-ocard-block" data-testid="tracking-live">
                  <h3 className="shop-ocard-block__title">On the way</h3>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{
                      width: 38, height: 38, borderRadius: 999, flexShrink: 0,
                      display: 'grid', placeItems: 'center',
                      background: 'var(--shop-accent-soft, #ede9fe)', color: 'var(--shop-accent)',
                    }}>
                      <Bike size={19} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div data-testid="tracking-rider" style={{ fontSize: 13, fontWeight: 700 }}>
                        {tracking.rider.name}
                        {tracking.rider.vehicle_type
                          && <span style={{ fontWeight: 500, color: 'var(--shop-ink-3)' }}>
                            {' · '}{tracking.rider.vehicle_type.toLowerCase()}
                          </span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--shop-ink-3)' }}>
                        {tracking.rider.rating != null && <>★ {Number(tracking.rider.rating).toFixed(1)} · </>}
                        {tracking.rider.phone_masked || 'Call through the app'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {tracking.eta_minutes != null && (
                        <div data-testid="tracking-eta" style={{ fontSize: 17, fontWeight: 800 }}>
                          About {tracking.eta_minutes} min
                        </div>
                      )}
                      {tracking.distance_km != null && (
                        <div data-testid="tracking-distance" style={{ fontSize: 11, color: 'var(--shop-ink-3)' }}>
                          {tracking.distance_km} km away
                        </div>
                      )}
                    </div>
                  </div>
                  <div data-testid="tracking-location" style={{
                    fontSize: 12, color: 'var(--shop-ink-3)', marginTop: 10,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <MapPin size={13} />
                    {tracking.location
                      ? (tracking.stale
                        ? `Last known position · ${seenWords(tracking.updated_at)}`
                        : `Live position · updated ${seenWords(tracking.updated_at)}`)
                      : 'The rider has not shared a position yet.'}
                  </div>
                  {tracking.location && tracking.destination && (
                    <RiderLocationMap tracking={tracking} />
                  )}
                </div>
              )}

              {/* Timeline */}
              <div className="shop-ocard-block">
                <h3 className="shop-ocard-block__title">Tracking</h3>
                {detail.history.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--shop-ink-3)' }}>No updates yet.</div>
                )}
                {detail.history.map((h, i) => (
                  <div key={h.history_id || i} className="shop-tl">
                    <div className="shop-tl__rail">
                      <span className={`shop-tl__dot ${i === 0 ? 'shop-tl__dot--live' : ''}`} />
                      {i < detail.history.length - 1 && <span className="shop-tl__line" />}
                    </div>
                    <div className="shop-tl__body">
                      <div className="shop-tl__label">{STAGE_WORDS[h.to_status] || h.to_status}</div>
                      <div className="shop-tl__time">
                        {h.created_at ? new Date(h.created_at).toLocaleString() : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Items */}
              <div className="shop-ocard-block">
                <h3 className="shop-ocard-block__title">Items ({detail.lines.length})</h3>
                {detail.lines.map(l => (
                  <div key={l.line_id} className="shop-ocard-row">
                    <span>{l.qty}× {skus[l.sku]?.name || skus[l.sku]?.sku_code || 'Item'}</span>
                    <span className="shop-ocard-row__amt">₹{num(l.line_total).toFixed(2)}</span>
                  </div>
                ))}
                <div className="shop-ocard-row shop-ocard-row--total">
                  <span>Total</span><span>₹{num(o.grand_total).toFixed(2)}</span>
                </div>
              </div>

              {/* Address */}
              <div className="shop-ocard-block shop-ocard-addr">
                <MapPin size={17} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13 }}>
                  {addressFor(o)
                    ? [addressFor(o).line1, addressFor(o).line2, addressFor(o).city, addressFor(o).pincode]
                        .filter(Boolean).join(', ')
                    : 'Delivery address not found in your saved list.'}
                </div>
              </div>

              {/* Actions: cancel while live, reorder + return once done */}
              <div className="shop-ocard-actions">
                {CANCELLABLE.has(o.status) && (
                  cancelFor === o.order_id ? (
                    <div className="shop-ocard-block" style={{ width: '100%' }}>
                      <label className="shop-field-label">Why are you cancelling?</label>
                      <textarea
                        value={cancelReason}
                        onChange={e => setCancelReason(e.target.value)}
                        rows={3}
                        placeholder="Ordered by mistake, found it elsewhere…"
                        className="shop-textarea" />
                      {cancelError && <div className="shop-err-text">{cancelError}</div>}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button className="shop-btn shop-btn--ghost" onClick={() => { setCancelFor(null); setCancelError(null); }}>
                          Keep order
                        </button>
                        <button className="shop-btn shop-btn--danger" onClick={submitCancel} disabled={cancelBusy}>
                          {cancelBusy ? 'Cancelling…' : 'Cancel order'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="shop-btn shop-btn--ghost" onClick={() => { setCancelFor(o.order_id); setCancelError(null); }}>
                      <XCircle size={15} /> Cancel order
                    </button>
                  )
                )}

                {(CANCELLED.has(o.status) || o.status === 'DELIVERED') && (
                  <button className="shop-btn shop-btn--ghost" onClick={() => reorder(o)} disabled={reorderBusy === o.order_id}>
                    <ShoppingBasket size={15} /> {reorderBusy === o.order_id ? 'Re-adding…' : 'Reorder'}
                  </button>
                )}

                {!CANCELLED.has(o.status) && o.status !== 'DELIVERED' && (
                  <button type="button" className="shop-btn shop-btn--ghost" onClick={() => track(o)}>
                    <Truck size={15} /> Track order
                  </button>
                )}

                {o.status === 'DELIVERED' && (
                  returns.some(r => r.order === o.order_id) ? (
                    <span className="shop-ocard-return-note">
                      <RotateCcw size={15} /> A return is open for this order.
                    </span>
                  ) : returnFor === o.order_id ? (
                    <div className="shop-ocard-block" style={{ width: '100%' }}>
                      <label className="shop-field-label">What went wrong?</label>
                      <textarea
                        value={returnReason}
                        onChange={e => setReturnReason(e.target.value)}
                        rows={3}
                        placeholder="Damaged, wrong item, past its date…"
                        className="shop-textarea" />
                      {returnError && <div className="shop-err-text">{returnError}</div>}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button className="shop-btn shop-btn--ghost" onClick={() => { setReturnFor(null); setReturnError(null); }}>
                          Cancel
                        </button>
                        <button className="shop-btn shop-btn--danger" onClick={submitReturn} disabled={returnBusy || !returnReason.trim()}>
                          {returnBusy ? 'Sending…' : 'Request return'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="shop-btn shop-btn--ghost" onClick={() => { setReturnFor(o.order_id); setReturnError(null); }}>
                      <RotateCcw size={15} /> Report a problem
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {filter === 'all' && live.some(o => AWAITING_CODE.has(o.status)) && (
        <div className="shop-live-note">
          <Truck size={18} />
          {live.filter(o => AWAITING_CODE.has(o.status)).length} order(s) on the way —
          the delivery code appears in the order once the rider asks for it.
        </div>
      )}
    </div>
  );
}
