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
  MapPin, KeyRound, Bike, Package, ArrowLeft,
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
      const map = L.map(ref.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      map.setView([destination.lat, destination.lng], 14);
      L.marker([destination.lat, destination.lng], {
        icon: L.divIcon({
          className: 'map-dot',
          html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 2px;background:#285A73;border:2px solid #fff;transform:rotate(-45deg)"></div>',
          iconSize: [22, 22], iconAnchor: [11, 18],
        }),
      }).addTo(map);
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
          html: '<div style="width:14px;height:14px;border-radius:50%;background:#285A73;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
          iconSize: [14, 14], iconAnchor: [7, 7],
        }),
      }).addTo(mapRef.current);
    }
  }, [destination.lat, destination.lng, rider.lat, rider.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => () => {
    if (mapRef.current) {
      try { mapRef.current.remove(); } catch { /* already gone */ }
      mapRef.current = null;
    }
  }, []);

  return (
    <div className="shop-tracking-map__canvaswrap">
      <div ref={ref} className="shop-tracking-map__canvas" aria-label="Live rider position on map" />
    </div>
  );
}

function Steps({ status }) {
  const active = stepFor(status);
  return (
    <ol className="shop-track-steps" aria-label="Order progress">
      {TRACK_STEPS.map((label, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={label} className={`shop-track-step${done ? ' shop-track-step--done' : ''}${current ? ' shop-track-step--current' : ''}`}>
            <span className="shop-track-step__node" aria-hidden="true">{done ? '✓' : i + 1}</span>
            <span className="shop-track-step__label">{label}</span>
            {i < TRACK_STEPS.length - 1 && <span className="shop-track-step__bar" aria-hidden="true" />}
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
    const id = setInterval(() => { void openDetail(openId); }, 15000);
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

  return (
    <div className="shop-page">
      <button type="button" className="shop-pdp__back" onClick={() => openTab('shop-orders', 'My orders', 'Package')}>
        <ArrowLeft size={16} /> Back to orders
      </button>
      <h1 className="shop-h1" style={{ marginTop: 8 }}>Track order {shown.order_no}</h1>

      <section className="shop-track-hero" aria-label="Delivery progress">
        <Steps status={shown.status} />
        <div className="shop-track-hero__eta">
          <div className="shop-track-hero__etaLabel">
            {shown.status === 'DELIVERED' ? 'DELIVERED' : 'ARRIVING IN'}
          </div>
          <div className="shop-track-hero__etaValue">
            {shown.status === 'DELIVERED'
              ? 'Delivered to your door'
              : `${tracking?.eta_minutes ?? 10} minutes`}
          </div>
          <div className="shop-track-hero__orderNo">Order {shown.order_no}</div>
        </div>
      </section>

      {tracking?.live && tracking.rider && (
        <section className="shop-ocard-block" data-testid="tracking-live" style={{ marginTop: 14 }}>
          <h3 className="shop-ocard-block__title">On the way</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 42, height: 42, borderRadius: 999, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'var(--shop-green-soft)', color: 'var(--shop-green-dark)' }}>
              <Bike size={20} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{tracking.rider.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--shop-ink-3)' }}>
                {[tracking.rider.vehicle_type, tracking.rider.phone_masked].filter(Boolean).join(' · ')}
              </div>
            </div>
            {tracking.distance_km != null && (
              <div style={{ fontSize: 11, color: 'var(--shop-ink-3)', textAlign: 'right' }}>{tracking.distance_km} km away</div>
            )}
          </div>
          {tracking.location && tracking.destination && (
            <RiderMap rider={tracking.location} destination={tracking.destination} />
          )}
        </section>
      )}

      {code && (
        <div className="shop-dcode" style={{ marginTop: 14 }}>
          <KeyRound size={26} style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {code.state === 'ready' ? 'Your delivery code'
                : code.state === 'used' ? 'This code has been used'
                : 'Waiting for the rider to ask for a code'}
            </div>
            {code.code && <div className="shop-dcode__code">{code.code}</div>}
            <div className="shop-dcode__hint">Share this with the rider at your door.</div>
          </div>
        </div>
      )}

      <section className="shop-ocard-block" style={{ marginTop: 14 }}>
        <h3 className="shop-ocard-block__title">What you ordered</h3>
        {detail.lines.length === 0 && <div style={{ color: 'var(--shop-ink-3)', fontSize: 13 }}>Order details loading…</div>}
        {detail.lines.map(l => (
          <div key={l.line_id} className="shop-ocard-row">
            <span>{l.qty}× {skus[l.sku]?.name || 'Item'}</span>
            <span className="shop-ocard-row__amt">₹{num(l.line_total).toFixed(2)}</span>
          </div>
        ))}
        <div className="shop-ocard-row shop-ocard-row--total">
          <span>Total</span><span className="shop-ocard-row__amt">₹{num(shown.grand_total).toFixed(2)}</span>
        </div>
      </section>

      <section className="shop-ocard-block shop-ocard-addr" style={{ marginTop: 14 }}>
        <MapPin size={17} />
        <div style={{ fontSize: 13 }}>
          {[addressFor(shown)?.line1, addressFor(shown)?.city, addressFor(shown)?.pincode].filter(Boolean).join(', ')}
        </div>
      </section>

      {error && <div className="alert alert-error" role="alert" style={{ marginTop: 14 }}>{error}</div>}
    </div>
  );
}
