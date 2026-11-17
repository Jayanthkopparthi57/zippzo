import React, { useState, useEffect, useCallback, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  fetchApi, unwrapList, describeError,
} from '../../api/client';
import {
  myOrders, deliveryCode, orderTracking, asList, num, myAddresses,
} from '../darkstore/useDarkStore';
import { useTabs } from '../../context/TabContext';
import {
  MapPin, KeyRound, Package, ArrowLeft, ChevronDown, Check,
} from 'lucide-react';

const LINES = '/orders/order-lines/';
const HISTORY = '/orders/order-history/';
const AWAITING_CODE = new Set(['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED']);
const CANCELLED = new Set(['CANCELLED', 'REFUNDED', 'EXPIRED', 'FAILED']);

const TRACK_STEPS = ['Order placed', 'Preparing', 'On the way', 'Delivered'];
const stepFor = (status) => {
  if (status === 'DELIVERED') return 3;
  if (['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED'].includes(status)) return 2;
  if (['CONFIRMED', 'PICKING', 'INTERRUPTED', 'PICKED', 'RACK_DROPPED', 'PARTIALLY_FULFILLED', 'PACKED', 'PRICE_FINALIZED', 'STAGED', 'RIDER_ASSIGNED'].includes(status)) return 1;
  return 0;
};

const ROUTE_COLOR = '#285A73';

function RiderMap({ rider, destination }) {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);
  const routeRef = React.useRef(null);
  const riderRef = React.useRef(null);
  const routeKeyRef = React.useRef('');

  React.useEffect(() => {
    if (!ref.current) return undefined;

    // A different destination = rebuild the map (pin, frame, route all change).
    const destKey = `${destination.lat},${destination.lng}`;
    if (mapRef.current && routeKeyRef.current !== destKey) {
      try { mapRef.current.remove(); } catch { /* gone */ }
      mapRef.current = null;
      routeRef.current = null;
      riderRef.current = null;
      routeKeyRef.current = destKey;
    }

    if (!mapRef.current) {
      const map = L.map(ref.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      mapRef.current = map;
      map.setView([destination.lat, destination.lng], 15);
      L.marker([destination.lat, destination.lng], {
        icon: L.divIcon({
          className: 'map-dot',
          html: '<div class="track-pin track-pin--door"><svg viewBox="0 0 24 24" width="26" height="26" fill="#285A73"><path d="M12 2a8 8 0 0 0-8 8c0 5.4 6.4 11.4 6.7 11.7a2 2 0 0 0 2.6 0C13.6 21.4 20 15.4 20 10a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg></div>',
          iconSize: [26, 26], iconAnchor: [13, 24],
        }),
      }).addTo(map).bindTooltip('Your door', { direction: 'top', offset: [0, -22] });
      routeKeyRef.current = `${destination.lat},${destination.lng}`;
      (async () => {
        try {
          const url = `https://router.project-osrm.org/route/v1/driving/${rider.lng},${rider.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
          const r = await fetch(url);
          const body = await r.json();
          const route = body?.routes?.[0];
          if (route) {
            routeRef.current = L.polyline(route.geometry.coordinates.map(([lng, lat]) => [lat, lng]), {
              color: ROUTE_COLOR, weight: 5, opacity: 0.95, lineCap: 'round',
            }).addTo(map);
            map.fitBounds(L.latLngBounds([[destination.lat, destination.lng], [rider.lat, rider.lng]]).pad(0.25));
            return;
          }
          throw new Error('no route');
        } catch {
          routeRef.current = L.polyline([[rider.lat, rider.lng], [destination.lat, destination.lng]], {
            color: ROUTE_COLOR, weight: 4, opacity: 0.75, dashArray: '4 8', lineCap: 'round',
          }).addTo(map);
        }
      })();
    }

    // Rider position moves on every poll; update the peg, keep the map frame.
    if (riderRef.current) {
      riderRef.current.setLatLng([rider.lat, rider.lng]);
    } else if (mapRef.current) {
      riderRef.current = L.marker([rider.lat, rider.lng], {
        icon: L.divIcon({
          className: 'map-dot',
          html: '<div class="track-pin track-pin--rider"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 17.5 4 6l5 4 3-8 3 8 5-4-1.5 11.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5z"/></svg></div>',
          iconSize: [36, 36], iconAnchor: [18, 18],
        }),
      }).addTo(mapRef.current).bindTooltip('Your rider', { direction: 'top', offset: [0, -18] });
    }
  }, [destination.lat, destination.lng, rider.lat, rider.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => () => {
    if (mapRef.current) {
      try { mapRef.current.remove(); } catch { /* already gone */ }
      mapRef.current = null;
    }
  }, []);

  return (
    <div ref={ref} className="track-map__canvas" role="application" aria-label="Live rider position on the map" />
  );
}

function Steps({ status }) {
  const active = stepFor(status);
  return (
    <ol className="track-steps" aria-label="Order progress">
      {TRACK_STEPS.map((label, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={label} className={`track-step${done ? ' track-step--done' : ''}${current ? ' track-step--current' : ''}`}>
            <span className="track-step__node" aria-hidden="true">{done ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
            <span className="track-step__label">{label}</span>
            {i < TRACK_STEPS.length - 1 && <span className="track-step__bar" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export default function TrackerView() {
  const { openTab } = useTabs();
  const [orders, setOrders] = useState([]);
  const [skus, setSkus] = useState({});
  const [addresses, setAddresses] = useState([]);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState({ lines: [], history: [] });
  const [code, setCode] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [itemsOpen, setItemsOpen] = useState(true);
  const reqRef = useRef(0);

  const load = useCallback(() => {
    const req = ++reqRef.current;
    const withTimeout = (p, ms = 15000) => Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
    ]);
    Promise.allSettled([
      withTimeout(myOrders()),
      withTimeout(myAddresses()),
      withTimeout(fetchApi('/catalog/skus/')),
    ]).then(([o, a, s]) => {
      if (req !== reqRef.current) return;
      if (o.status === 'fulfilled') setOrders(asList(o.value, 'orders'));
      else setError(describeError(o.reason));
      if (a.status === 'fulfilled') setAddresses(asList(a.value, 'addresses') || []);
      if (s.status === 'fulfilled') {
        const map = {};
        for (const sku of (unwrapList(s.value) || [])) map[sku.sku_id] = sku;
        setSkus(map);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(async (orderId) => {
    if (!orderId) return;
    setOpenId(orderId);
    const withTimeout = (p, ms = 15000) => Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
    ]);
    const [l, h, t, c] = await Promise.allSettled([
      withTimeout(fetchApi(`${LINES}?order=${orderId}`)),
      withTimeout(fetchApi(`${HISTORY}?order=${orderId}`)),
      withTimeout(orderTracking(orderId)),
      withTimeout(deliveryCode(orderId).catch(() => null)),
    ]);
    setDetail({
      lines: l.status === 'fulfilled' ? (unwrapList(l.value) || []) : [],
      history: h.status === 'fulfilled' ? (unwrapList(h.value) || []) : [],
    });
    if (t.status === 'fulfilled') setTracking(t.value);
    if (c.status === 'fulfilled' && c.value) setCode(c.value);
  }, []);

  // My Orders fires `zippzo:track-order` whenever the shopper taps Track on a live card.
  useEffect(() => {
    const handler = (e) => { const id = e.detail?.orderId; if (id) void openDetail(id); };
    window.addEventListener('zippzo:track-order', handler);
    return () => window.removeEventListener('zippzo:track-order', handler);
  }, [openDetail]);

  // Default to the most recent live parcel when this tab is opened cold.
  useEffect(() => {
    if (openId || !orders.length || loading) return;
    const live = orders.filter((o) => !CANCELLED.has(o.status) && o.status !== 'DELIVERED');
    const target = (live[0] || orders[0]).order_id;
    if (target) void openDetail(target);
  }, [orders, openId, loading, openDetail]);

  // Poll tracking + the delivery code while a parcel is moving.
  useEffect(() => {
    if (!openId) return undefined;
    const liveOrder = orders.find((o) => o.order_id === openId);
    if (!liveOrder || !AWAITING_CODE.has(liveOrder.status)) return undefined;
    const id = setInterval(() => { void openDetail(openId); }, 8000);
    return () => clearInterval(id);
  }, [openId, orders, openDetail]);

  const addressFor = (order) => addresses.find((a) => a.address_id === order.address);

  if (loading) {
    return <div className="shop-page" style={{ textAlign: 'center', color: 'var(--shop-ink-3)', paddingTop: 60 }}>Loading…</div>;
  }

  const live = orders.filter((o) => !CANCELLED.has(o.status) && o.status !== 'DELIVERED');
  const shown = openId ? orders.find((o) => o.order_id === openId) : (live[0] || orders[0] || null);

  if (!shown) {
    return (
      <div className="shop-page">
        <h1 className="shop-h1"><Package size={21} /> Track an order</h1>
        <div className="shop-empty-card">
          <Package size={32} />
          <div className="shop-empty-card__title">Nothing to track yet</div>
          <div className="shop-empty-card__sub">Place an order and tracking appears here.</div>
          <button type="button" className="shop-empty-card__cta" onClick={() => openTab('shop-storefront', 'Order Groceries', 'ShoppingBasket')}>
            Start shopping
          </button>
        </div>
      </div>
    );
  }

  const delivered = shown.status === 'DELIVERED';
  const eta = tracking?.eta_minutes;
  const addr = addressFor(shown);
  const addressLine = [addr?.line1, addr?.city, addr?.pincode].filter(Boolean).join(', ');
  const itemCount = detail.lines.reduce((sum, l) => sum + Number(l.qty || 0), 0) || detail.lines.length;
  const mapReady = tracking?.live && tracking.rider && tracking.location && tracking.destination;

  return (
    <div className="shop-page track-page">
      <div className="track-frame">
        {/* ══ map layer ═══════════════════════════════════════════════════ */}
        <div className="track-map">
          {mapReady ? (
            <RiderMap rider={tracking.location} destination={tracking.destination} />
          ) : (
            <div className="track-map__empty" aria-hidden="true">
              <div className="track-map__emptyPin"><MapPin size={44} strokeWidth={1.4} /></div>
              <div className="track-map__emptyTitle">
                {delivered ? 'Handed over' : tracking?.live ? 'Locating your rider…' : 'Your rider will appear here'}
              </div>
              <div className="track-map__emptySub">
                {delivered
                  ? 'Thanks for ordering with Zippzo.'
                  : 'Live position lights up once the parcel is on its way.'}
              </div>
            </div>
          )}
        </div>

        {/* ══ floating chrome on the map ═══════════════════════════════════ */}
        <div className="track-top">
          <button type="button" className="track-back" onClick={() => openTab('shop-orders', 'My orders', 'Package')}>
            <ArrowLeft size={17} /> <span>My orders</span>
          </button>
          <div className="track-orderno" title={`Order ${shown.order_no}`}>#{shown.order_no}</div>
        </div>

        {/* ══ bottom sheet — the order, the rider, the code ═════════════════ */}
        <section className="track-sheet" aria-label="Order details">
          <div className="track-sheet__handle" aria-hidden="true" />

          <div className="track-sheet__etaRow">
            <div>
              <div className="track-eyebrow">{delivered ? 'Completed' : 'Arriving in'}</div>
              <div className={`track-eta${delivered ? ' track-eta--done' : ''}`}>
                {delivered ? 'Delivered to your door' : eta != null ? `${eta} min` : '—'}
              </div>
              {!delivered && eta == null && (
                <div className="track-etaNote">ETA appears once the rider shares a position.</div>
              )}
            </div>
            <div className="track-etaSide">
              <span className="track-cashChip">{shown.payment_method === 'COD' || shown.payment_method === 'COD_CASH' ? 'COD' : 'Prepaid'}</span>
            </div>
          </div>

          <Steps status={shown.status} />

          {/* rider strip — only while the parcel is moving */}
          {tracking?.live && tracking.rider && (
            <div className="track-rider" data-testid="tracking-live">
              <span className="track-rider__avatar" aria-hidden="true">{String(tracking.rider.name || 'R').slice(0, 1).toUpperCase()}</span>
              <span className="track-rider__who">
                <span className="track-rider__name">{tracking.rider.name}</span>
                <span className="track-rider__meta">{[tracking.rider.vehicle_type, tracking.rider.phone_masked].filter(Boolean).join(' · ')}</span>
              </span>
              {tracking.distance_km != null && (
                <span className="track-rider__km">{tracking.distance_km} km<small> away</small></span>
              )}
              {tracking.stale && <span className="track-rider__stale" title="Rider position is older than 2 minutes">stale</span>}
            </div>
          )}

          {/* delivery code — the doorstep handshake */}
          {code && (
            <div className="track-code" role="group" aria-label="Delivery code">
              <KeyRound size={22} className="track-code__icon" aria-hidden="true" />
              <div className="track-code__body">
                <div className="track-code__label">
                  {code.state === 'ready' ? 'Your delivery code'
                    : code.state === 'used' ? 'Code used — order closed'
                    : 'Waiting for the rider to ask'}
                </div>
                {code.code && <div className="track-code__value">{code.code}</div>}
                <div className="track-code__hint">Share this with the rider at your door.</div>
              </div>
            </div>
          )}

          {/* collapsible order details */}
          <div className="track-items">
            <button type="button" className="track-items__toggle" aria-expanded={itemsOpen} onClick={() => setItemsOpen((v) => !v)}>
              <span className="track-items__title">Order details</span>
              <span className="track-items__sum">{itemCount} item{itemCount === 1 ? '' : 's'} · ₹{num(shown.grand_total).toFixed(2)}</span>
              <ChevronDown size={18} className={`track-items__chev${itemsOpen ? ' track-items__chev--open' : ''}`} aria-hidden="true" />
            </button>
            {itemsOpen && (
              <div className="track-items__body">
                {detail.lines.length === 0 && <div className="track-items__loading">Order details loading…</div>}
                {detail.lines.map(l => (
                  <div key={l.line_id} className="track-items__row">
                    <span><b>{l.qty}×</b> {skus[l.sku]?.name || 'Item'}</span>
                    <span className="track-items__amt">₹{num(l.line_total).toFixed(2)}</span>
                  </div>
                ))}
                <div className="track-items__row track-items__row--total">
                  <span>Total{shown.payment_method === 'COD' || shown.payment_method === 'COD_CASH' ? ' (pay on delivery)' : ''}</span>
                  <span className="track-items__amt">₹{num(shown.grand_total).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          {addressLine && (
            <div className="track-addr">
              <MapPin size={16} aria-hidden="true" />
              <span>{addressLine}</span>
            </div>
          )}

          {error && <div className="alert alert-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        </section>
      </div>
    </div>
  );
}
