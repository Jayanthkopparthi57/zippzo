import React, { useState, useEffect, useCallback, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../context/AuthContext';
import {
  fetchApi, postApi, unwrapList, describeError
} from '../api/client';
import {
  Bike, Bell, Package, MapPin, Clock, Navigation,
  Wallet, QrCode, History, Home, LogOut
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const TASKS = '/delivery/delivery-tasks/';
const RIDERS = '/delivery/rider-profiles/';
const SHIFTS = '/delivery/rider-shifts/';
const PICKUP = '/delivery/handoff/pickup';
const POD = '/delivery/handoff/pod';
const NOTIFICATIONS = '/notifications/notifications/';
const EARNINGS = '/money/rider-earnings/';
const CUSTODY = '/money/rider-custody/';

/**
 * The remote pooler plus the browser's connection cap can leave one fetch
 * hanging; bound every load so the console always settles into setup/shell.
 */
function withTimeout(p, ms = 45000) {
  return Promise.race([
    p,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error('Timed out talking to the server.')), ms);
      if (t.unref) t.unref();
    }),
  ]);
}

// One job is in focus at a time; the rest wait in history.
const ACTIVE_STATES = ['ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'POD_PENDING'];
const DONE_STATES = ['DELIVERED', 'FAILED', 'RETURNED'];

const VEHICLES = [
  ['BIKE', 'Bike'], ['SCOOTER', 'Scooter'], ['CYCLE', 'Cycle'], ['MINI_VAN', 'Mini Van'],
];

// What the rider's next move is, in the order the backend allows it.
const JOURNEY = {
  ACCEPTED: { eyebrow: 'Pickup at the store', cta: "I'm at the store", to: 'AT_DS' },
  AT_DS: { eyebrow: 'The store handed it to you', cta: 'Pick up order', pickup: true },
  PICKED_UP: { eyebrow: 'On the way', cta: 'Start delivery', to: 'EN_ROUTE' },
  EN_ROUTE: { eyebrow: 'At the door', cta: "I've arrived", to: 'ARRIVED' },
  ARRIVED: { eyebrow: 'Hand it over', cta: 'Complete delivery', pod: true },
  POD_PENDING: { eyebrow: 'Hand it over', cta: 'Enter pickup code', pod: true },
};

const PIN_SVG = {
  store: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f2b33d" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 6.2 5h11.6L20 10.5M5 10.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8.5M9.5 20v-5h5v5"/></svg>',
  customer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 11 12 4.5 19.5 11M6.5 9.5V19h11V9.5"/></svg>',
};

export default function RiderDashboardView() {
  const { user, logout, facilitiesList } = useAuth();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [shift, setShift] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [earnings, setEarnings] = useState([]);
  const [custody, setCustody] = useState(null);
  const [tab, setTab] = useState('home');

  const [qrInfo, setQrInfo] = useState(null);
  const [qrError, setQrError] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // POD dialog
  const [podOpen, setPodOpen] = useState(false);
  const [podOtp, setPodOtp] = useState('');
  const [podCod, setPodCod] = useState('');
  const [podSig, setPodSig] = useState('');
  const [podNote, setPodNote] = useState('');

  const [form, setForm] = useState({
    name: '', phone: '', vehicle_type: 'BIKE', vehicle_number: '', site_code: '',
  });

  const load = useCallback(async () => {
    setError('');
    try {
      const me = await withTimeout(fetchApi(`${RIDERS}me/`));
      setProfile(me?.has_profile ? me : null);

      if (me?.has_profile) {
        const [taskRes, shiftRes, notifRes, countRes, earnRes, custRes] =
          await Promise.all([
            withTimeout(fetchApi(TASKS), 45000).catch(() => []),
            withTimeout(fetchApi(`${SHIFTS}?status=OPEN`)).catch(() => []),
            withTimeout(fetchApi(NOTIFICATIONS)).catch(() => []),
            withTimeout(fetchApi(`${NOTIFICATIONS}unread_count/`)).catch(() => ({ unread: 0 })),
            withTimeout(fetchApi(EARNINGS)).catch(() => []),
            withTimeout(fetchApi(CUSTODY)).catch(() => null),
          ]);
        const rows = unwrapList(taskRes) || [];
        setTasks(Array.isArray(rows) ? rows : []);
        const open = unwrapList(shiftRes) || [];
        setShift(open[0] || null);
        setNotifications(Array.isArray(notifRes) ? notifRes : []);
        setUnread(countRes?.unread || 0);
        setEarnings(Array.isArray(earnRes) ? earnRes : []);
        const wallets = unwrapList(custRes);
        setCustody(wallets && wallets.length ? wallets[0] : null);
      } else {
        setTasks([]);
        setNotifications([]);
        setUnread(0);
        setEarnings([]);
        setCustody(null);
      }
    } catch (err) {
      console.error(err);
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live events refresh jobs immediately; the poll recovers from sockets
  // suspended by the OS or a dropped tunnel.
  useEffect(() => {
    const refresh = () => load();
    window.addEventListener('zippzo:live-event', refresh);
    const id = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener('zippzo:live-event', refresh);
      clearInterval(id);
    };
  }, [load]);

  // Keep the store's fleet board fed with a 1-pin location while online.
  const [locSharing, setLocSharing] = useState(false);
  useEffect(() => {
    if (!profile?.is_online || !navigator.geolocation) return undefined;
    let cancelled = false;
    let lastPush = 0;
    const push = (pos) => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastPush < 20000) return;
      lastPush = now;
      postApi(`${RIDERS}me/location/`, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      }).then(() => { if (!cancelled) setLocSharing(true); }).catch(() => {});
    };
    const opts = { enableHighAccuracy: false, maximumAge: 15000, timeout: 15000 };
    const watchId = navigator.geolocation.watchPosition(push, () => {}, opts);
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
      setLocSharing(false);
    };
  }, [profile?.is_online]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    setNotice('');
    try { await fn(); } catch (err) { setError(describeError(err)); }
    finally { setBusy(false); }
  };

  // ── first run: become a rider ──
  const bootstrap = () => run(async () => {
    const created = await postApi(`${RIDERS}bootstrap/`, form);
    setProfile({ has_profile: true, ...created });
    setNotice('Profile created. Go online to start getting jobs.');
    await load();
  });

  const toggleOnline = () => run(async () => {
    await postApi(`${RIDERS}${profile.rider_id}/set_online/`, {
      is_online: !profile.is_online,
    });
    await load();
  });

  const toggleShift = () => run(async () => {
    if (shift) {
      await postApi(`${SHIFTS}${shift.shift_id}/close/`, { reason: 'MANUAL' });
      setNotice('Shift ended.');
    } else {
      await postApi(`${SHIFTS}open/`, { site_code: profile.current_site_code });
      setNotice('Shift started.');
    }
    await load();
  });

  // ── job actions ──
  const advance = (task, to) => run(async () => {
    await postApi(`${TASKS}${task.task_id}/advance/`, { to });
    await load();
  });

  const pickup = (task) => run(async () => {
    await postApi(PICKUP, { task_id: task.task_id });
    setNotice('Order collected. The customer is waiting.');
    await load();
  });

  // Deliberately not wrapped in run(): the POD form needs the 409 body so the
  // "ask the customer for their code" note renders inside the sheet.
  const closePod = async (task) => {
    setBusy(true);
    setError('');
    setPodNote('');
    try {
      const res = await postApi(POD, {
        task_id: task.task_id,
        otp: podOtp.trim() || undefined,
        cod_amount: podCod.trim() || undefined,
        signature: podSig.trim() || undefined,
        method: podSig.trim() ? 'SIGNATURE' : 'PIN',
      });
      setPodOpen(false);
      setPodOtp('');
      setPodCod('');
      setPodSig('');
      if (res?.cod_variance && res.cod_variance !== '0.00') {
        setNotice(`Delivered, but you collected ₹${res.cod_amount} against ₹${res.cod_due} due (variance ${res.cod_variance}). Log this with dispatch.`);
      } else {
        setNotice('Delivered.');
      }
      await load();
    } catch (err) {
      const body = err?.body || {};
      if (body?.otp_required && body?.error) setPodNote(body.error);
      else if (body?.cod_required) setPodNote(`${body.error} (₹${body.cod_due} due)`);
      else setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  // ── my QR (store scan = consent at the counter) ──
  const loadQr = useCallback(async () => {
    setQrError('');
    try {
      const info = await withTimeout(fetchApi(`${RIDERS}me/qr/`));
      setQrInfo(info);
    } catch (err) {
      setQrError(describeError(err));
    }
  }, []);

  useEffect(() => { if (tab === 'qr') loadQr(); }, [tab, loadQr]);

  const markAllRead = () => run(async () => {
    await postApi(`${NOTIFICATIONS}mark_all_read/`, {});
    await load();
  });

  // ── derived ──
  const mine = tasks.filter(t => t.rider === profile?.rider_id);
  const active = mine.filter(t => ACTIVE_STATES.includes(t.status));
  const done = mine.filter(t => DONE_STATES.includes(t.status));
  const current = active[0] || null;
  const journey = current ? JOURNEY[current.status] : null;

  const today = new Date().toISOString().slice(0, 10);
  const todays = earnings.filter(e => String(e.created_at || '').slice(0, 10) === today);
  const todayTotal = todays.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // ── map ──
  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const layerRef = useRef({});

  // Destroy/recreate the map on tab change or when the job changes; the rider
  // moves while a job is open, but the map keeps its frame until the next job.
  useEffect(() => {
    if (tab !== 'home') return undefined;
    if (!mapEl.current || mapRef.current) return undefined;

    const mePos = (profile?.last_lat && profile?.last_lng)
      ? [Number(profile.last_lat), Number(profile.last_lng)] : null;
    const storePos = profile?.current_site_geo
      ? [profile.current_site_geo.lat, profile.current_site_geo.lng] : null;
    const custPos = (current?.geo_lat && current?.geo_lng)
      ? [Number(current.geo_lat), Number(current.geo_lng)] : null;
    const start = mePos || storePos || custPos;
    if (!start) return undefined; // the fallback panel stands in

    const map = L.map(mapEl.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView(start, 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    if (mePos) {
      layerRef.current.me = L.marker(mePos, {
        icon: L.divIcon({ className: '', html: '<div class="rv3-pin rv3-pin--me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false,
      }).addTo(map);
    }
    if (storePos) {
      layerRef.current.store = L.marker(storePos, {
        icon: L.divIcon({ className: '', html: `<div class="rv3-pin rv3-pin--store">${PIN_SVG.store}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
      }).addTo(map).bindTooltip('Store', { direction: 'top', offset: [0, -16] });
    }
    if (custPos) {
      layerRef.current.cust = L.marker(custPos, {
        icon: L.divIcon({ className: '', html: `<div class="rv3-pin rv3-pin--customer">${PIN_SVG.customer}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
      }).addTo(map).bindTooltip('Customer', { direction: 'top', offset: [0, -16] });
    }
    if (mePos && storePos && map.hasLayer(layerRef.current.me)) {
      // subtle line me -> store while heading to the store
      layerRef.current.line = L.polyline([mePos, custPos || storePos], {
        color: '#8b3df0', weight: 4, opacity: 0.9, dashArray: '2 10', lineCap: 'round',
      }).addTo(map);
    } else if (storePos && custPos) {
      layerRef.current.line = L.polyline([storePos, custPos], {
        color: '#8b3df0', weight: 4, opacity: 0.9, dashArray: '2 10', lineCap: 'round',
      }).addTo(map);
    }
    if (mePos && custPos) {
      map.fitBounds(L.latLngBounds([mePos, custPos]).pad(0.3));
    } else if (storePos && custPos) {
      map.fitBounds(L.latLngBounds([storePos, custPos]).pad(0.3));
    }

    mapRef.current = map;
    // Leaflet needs a nudge after the container settles on slower phones.
    setTimeout(() => map.invalidateSize(), 120);
    return () => {
      try {
        map.remove();
      } finally {
        mapRef.current = null;
        layerRef.current = {};
      }
    };
  }, [tab, current?.task_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    if (profile?.last_lat && profile?.last_lng) {
      map.setView([Number(profile.last_lat), Number(profile.last_lng)], 16);
    }
  };

  const routeToStore = () => {
    const map = mapRef.current;
    if (!map) return;
    const mePos = profile?.last_lat && profile?.last_lng
      ? [Number(profile.last_lat), Number(profile.last_lng)] : null;
    const storePos = profile?.current_site_geo
      ? [profile.current_site_geo.lat, profile.current_site_geo.lng] : null;
    const custPos = current?.geo_lat && current?.geo_lng
      ? [Number(current.geo_lat), Number(current.geo_lng)] : null;
    const pts = [mePos, custPos || storePos, storePos, custPos].filter(Boolean);
    if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts).pad(0.3));
    }
  };

  if (loading) {
    return (
      <div data-testid="rider-loading" className="rv3-loading">
        <span>Loading the rider console…</span>
      </div>
    );
  }

  // ── no profile yet ──
  if (!profile?.has_profile) {
    const stores = (facilitiesList.all_facilities || []).filter(s => s.site_type === 'DS');
    return (
      <div data-testid="rider-setup" className="rv3-setup">
        <div className="rv3-setup-card">
          <div className="rv3-setup-badge">
            <Bike size={13} /> Delivery partner
          </div>
          <h1 className="rv3-setup-title">Deliver.<br />Get paid.<br />Back to it.</h1>
          <p className="rv3-setup-sub">
            Set up your delivery profile. Jobs at your store reach you automatically —
            nothing to accept, nothing to scan.
          </p>

          {error && (
            <div role="alert" className="rv3-banner rv3-banner--error" style={{ position: 'static', marginBottom: 10 }}>
              {error}
            </div>
          )}

          <label className="rv3-field-label">Full name</label>
          <input className="rv3-input" value={form.name} placeholder={user?.full_name || ''}
                 onChange={e => setForm({ ...form, name: e.target.value })} />

          <label className="rv3-field-label">Phone</label>
          <input className="rv3-input" value={form.phone} inputMode="tel" placeholder="10-digit number"
                 onChange={e => setForm({ ...form, phone: e.target.value })} />

          <label className="rv3-field-label">Vehicle</label>
          <div className="rv3-vehicles">
            {VEHICLES.map(([value, text]) => (
              <button key={value} onClick={() => setForm({ ...form, vehicle_type: value })}
                      className={`rv3-vehicle ${form.vehicle_type === value ? 'rv3-vehicle--on' : ''}`}>
                {text}
              </button>
            ))}
          </div>

          <label className="rv3-field-label">Vehicle number</label>
          <input className="rv3-input" value={form.vehicle_number} placeholder="TS-08-AB-1234"
                 onChange={e => setForm({ ...form, vehicle_number: e.target.value })} />

          <label className="rv3-field-label">Home store</label>
          <select className="rv3-input" value={form.site_code}
                  onChange={e => setForm({ ...form, site_code: e.target.value })}
                  style={{ appearance: 'none' }}>
            <option value="">Select a dark store…</option>
            {stores.map(s => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
          {stores.length === 0 && (
            <p style={{ fontSize: 12, color: '#8a857a', marginTop: 6 }}>
              No stores loaded. Sign in again after the store assigns you one.
            </p>
          )}

          <button onClick={bootstrap} disabled={busy}
                  className="rv3-cta" style={{ marginTop: 18 }}>
            {busy ? 'Saving…' : 'Create profile & go online'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="rider-shell" className="rv3-shell">
      {/* ── map base (home only) ── */}
      {tab === 'home' && (
        <div className="rv3-map-wrap">
          <div ref={mapEl} className="rv3-map" />
          {!(profile?.last_lat && profile?.last_lng)
            && !profile?.current_site_geo && !current?.geo_lat && (
            <div className="rv3-map-fallback">
              <Bike size={30} strokeWidth={1.4} color="#f2b33d" />
              <strong>Waiting for GPS</strong>
              <span>Your route appears here as soon as this device shares a location.</span>
            </div>
          )}
        </div>
      )}

      {/* legibility fades over the map */}
      {tab === 'home' && <div className="rv3-fade-top" />}
      {tab === 'home' && <div className="rv3-fade-bottom" />}

      {/* ── top bar ── */}
      <div className="rv3-top">
        <div className="rv3-top-left">
          <div className="rv3-avatar">{String(profile.name || 'R').slice(0, 1).toUpperCase()}</div>
          <div className="rv3-top-meta">
            <div className="rv3-top-name">{profile.name}</div>
            <div className="rv3-top-store">
              {profile.current_site_code || 'NO STORE'}
              {locSharing ? ' · GPS ON' : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={toggleOnline} disabled={busy}
                  className={`rv3-online-pill${profile.is_online ? '' : ' rv3-online-pill--off'}`}>
            <span className="rv3-online-dot" />
            {profile.is_online ? 'Online' : 'Offline'}
          </button>
          <button onClick={logout} className="rv3-icon-btn"
                  aria-label="Sign out" title="Sign out">
            <LogOut size={17} strokeWidth={2} />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rv3-banner rv3-banner--error">{error}</div>
      )}
      {notice && (
        <div role="status" className="rv3-banner rv3-banner--ok">{notice}</div>
      )}

      {/* ── floating actions on the map ── */}
      {tab === 'home' && (
        <div className="rv3-fab-stack">
          {current && (
            <button className="rv3-fab rv3-fab--purple" onClick={routeToStore}
                    aria-label="Frame the route" title="Frame the route">
              <Navigation size={21} strokeWidth={2} />
            </button>
          )}
          <button className="rv3-fab" onClick={recenter} aria-label="Re-center" title="Re-center">
            <MapPin size={20} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* ══════════ HOME ══════════ */}
      {tab === 'home' && (
        <div className="rv3-sheet">
          <div className="rv3-sheet-handle" />
          {current && journey ? (
            <div data-testid={`rd-job-${current.order_no}`}>
              <div className="rv3-sheet-eyebrow">
                <span className="rv3-eyebrow-label">{journey.eyebrow}</span>
                {current.eta_at && (
                  <span className="rv3-eta"><Clock size={11} /> {new Date(current.eta_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                )}
              </div>
              <h2 className="rv3-job-title">{current.order_no}</h2>
              <div className="rv3-job-orderno">{current.shipped_qty ?? 1} item{(current.shipped_qty ?? 1) === 1 ? '' : 's'}{current.distance_m ? ` · ${(Number(current.distance_m) / 1000).toFixed(1)} km` : ''} · {current.staging_bin ? `staged ${current.staging_bin}` : 'loose bag'}</div>

              <div className="rv3-meta-row">
                <div className="rv3-meta-icon"><MapPin size={18} /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="rv3-meta-label">Deliver to</div>
                  <div className="rv3-meta-value">{current.delivery_address || 'Address on file'}</div>
                </div>
              </div>

              <div className="rv3-amount-row">
                <div className="rv3-amount-tile">
                  <div className="rv3-amount-label">Collect</div>
                  <div className="rv3-amount-value rv3-amount-value--gold">
                    ₹{Number(current.grand_total || 0).toFixed(2)}
                  </div>
                </div>
                <div className="rv3-amount-tile">
                  <div className="rv3-amount-label">Payment</div>
                  <div className="rv3-amount-value" style={{ fontSize: 15, paddingTop: 4 }}>
                    {current.payment_method === 'COD' || current.payment_method === 'COD_CASH' ? 'Cash on delivery' : current.payment_method || 'Paid'}
                  </div>
                </div>
              </div>

              <button className="rv3-cta" disabled={busy}
                      onClick={() => {
                        if (journey.to) advance(current, journey.to);
                        else if (journey.pickup) pickup(current);
                        else if (journey.pod) setPodOpen(true);
                      }}>
                {busy ? 'Working…' : journey.cta}
              </button>
            </div>
          ) : (
            <div className="rv3-idle">
              <div className="rv3-idle-ring"><Bike size={26} strokeWidth={1.6} /></div>
              <div className="rv3-idle-title">You're online</div>
              <div className="rv3-idle-sub">
                The next order at {profile.current_site_code || 'your store'} reaches you
                automatically. There is nothing to accept — just keep the app open.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════ HISTORY ══════════ */}
      {tab === 'history' && (
        <div className="rv3-page">
          <h1>Deliveries</h1>
          {done.length === 0 ? (
            <div className="rv3-empty">Nothing delivered yet.<br />Finished jobs land here.</div>
          ) : (
            <div className="rv3-card">
              {done.map(t => (
                <div key={t.task_id} className="rv3-row">
                  <Package size={17} color="#5b554a" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{t.order_no || t.task_id}</div>
                    <div style={{ fontSize: 11.5, color: '#8a857a' }}>
                      {t.delivered_at ? new Date(t.delivered_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </div>
                  </div>
                  <div className="rv3-row-amount">₹{Number(t.grand_total || 0).toFixed(0)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════ MONEY ══════════ */}
      {tab === 'money' && (
        <div className="rv3-page">
          <h1>Money</h1>
          <div className="rv3-card">
            <div className="rv3-amount-label">Cash with you now</div>
            <div className="rv3-bigstat">₹{Number(custody?.current_cash || 0).toFixed(0)}</div>
            <div className="rv3-bigstat-sub">
              {Number(custody?.bags_in_custody || 0)} order{Number(custody?.bags_in_custody || 0) === 1 ? '' : 's'} in custody · ceiling ₹{custody?.ceiling_amount || '5,000'}
            </div>
          </div>
          <div className="rv3-card">
            <div className="rv3-amount-label">Today's deliveries</div>
            <div className="rv3-bigstat" style={{ fontSize: 28 }}>₹{todayTotal.toFixed(0)}</div>
            <div className="rv3-bigstat-sub">
              {todays.length} completed · ₹{earnings.reduce((s, e) => s + Number(e.amount || 0), 0).toFixed(0)} all time pending
            </div>
          </div>
          <div className="rv3-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Clock size={20} color={shift ? '#166534' : '#8a857a'} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {shift ? 'Shift open' : 'No open shift'}
              </div>
              <div style={{ fontSize: 12, color: '#8a857a' }}>
                {shift
                  ? `Started ${new Date(shift.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${profile.current_site_code || ''}`
                  : 'Start a shift to make yourself eligible for jobs.'}
              </div>
            </div>
            <button className={`rv3-btn${shift ? '' : ' rv3-btn--gold'}`} onClick={toggleShift} disabled={busy}>
              {shift ? 'End' : 'Start'}
            </button>
          </div>
        </div>
      )}

      {/* ══════════ ALERTS ══════════ */}
      {tab === 'alerts' && (
        <div className="rv3-page">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h1 style={{ marginBottom: 14 }}>Alerts</h1>
            {notifications.length > 0 && (
              <button className="rv3-btn" style={{ height: 36, fontSize: 12 }} onClick={markAllRead}>Mark all read</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="rv3-empty">Nothing yet.<br />Order updates land here.</div>
          ) : (
            <div className="rv3-card">
              {notifications.map(n => (
                <div key={n.notification_id || n.id || JSON.stringify(n).slice(0, 24)} className="rv3-row">
                  <Bell size={16} color="#8a857a" style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{n.type.replaceAll('_', ' ')}</div>
                    <div style={{ fontSize: 11.5, color: '#8a857a' }}>
                      {n.payload_json?.order_no || n.payload_json?.task_id || ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════ QR ══════════ */}
      {tab === 'qr' && (
        <div className="rv3-page">
          <h1>My QR</h1>
          <div className="rv3-card">
            {qrError ? (
              <div role="alert" className="rv3-empty">{qrError}</div>
            ) : qrInfo ? (
              <div className="rv3-qr-box">
                <QRCodeSVG value={qrInfo.payload || `zippzo:rider:${qrInfo.rider_id}`} size={196} fgColor="#241203" bgColor="#fffdf8" />
                <div className="rv3-qr-note">
                  The store scans this once per handoff to confirm you physically took the order.
                  The code rotates after every scan.
                </div>
              </div>
            ) : (
              <div className="rv3-empty">Fetching your code…</div>
            )}
          </div>
        </div>
      )}

      {/* ── POD sheet ── */}
      {podOpen && current && (
        <div className="rv3-pod-backdrop" onClick={() => setPodOpen(false)}>
          <div className="rv3-pod" onClick={e => e.stopPropagation()}>
            <div className="rv3-sheet-handle" />
            <div className="rv3-eyebrow-label" style={{ marginBottom: 2 }}>Close the delivery</div>
            <h2 style={{ fontFamily: 'Space Grotesk', margin: '0 0 2px', fontSize: 21 }}>{current.order_no}</h2>
            <div style={{ fontSize: 12.5, color: '#8a857a' }}>{current.delivery_address || ''}</div>

            <label htmlFor="pod-otp">Pickup code from the customer</label>
            <input id="pod-otp" inputMode="numeric" autoComplete="one-time-code"
                   className="rv3-pod-otp" placeholder="6-digit code" value={podOtp}
                   onChange={e => setPodOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />

            <label htmlFor="pod-cod">Cash collected</label>
            <input id="pod-cod" inputMode="decimal"
                   placeholder={`₹${Number(current.grand_total || 0).toFixed(2)} due`} value={podCod}
                   onChange={e => setPodCod(e.target.value)} />

            <label htmlFor="pod-sig">Who took the order (optional)</label>
            <input id="pod-sig" placeholder="Name or signature" value={podSig}
                   onChange={e => setPodSig(e.target.value)} />

            {podNote && <div className="rv3-pod-note">{podNote}</div>}

            <div className="rv3-pod-actions">
              <button className="rv3-pod-cancel" onClick={() => setPodOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button className="rv3-cta" style={{ flex: 1 }} disabled={busy}
                      onClick={() => closePod(current)}>
                {busy ? 'Closing…' : 'Confirm delivery'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── bottom nav ── */}
      <nav className="rv3-nav" aria-label="Rider navigation">
        <button className={`rv3-nav-item${tab === 'home' ? ' rv3-nav-item--active' : ''}`} onClick={() => setTab('home')}>
          <Home size={19} strokeWidth={2} /><span>Home</span>
        </button>
        <button className={`rv3-nav-item${tab === 'history' ? ' rv3-nav-item--active' : ''}`} onClick={() => setTab('history')}>
          <History size={19} strokeWidth={2} /><span>Deliveries</span>
        </button>
        <button className={`rv3-nav-item${tab === 'money' ? ' rv3-nav-item--active' : ''}`} onClick={() => setTab('money')}>
          <Wallet size={19} strokeWidth={2} /><span>Money</span>
        </button>
        <button className={`rv3-nav-item${tab === 'alerts' ? ' rv3-nav-item--active' : ''}`} onClick={() => setTab('alerts')}>
          <Bell size={19} strokeWidth={2} /><span>Alerts</span>
          {unread > 0 && <span className="rv3-nav-badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <button className={`rv3-nav-item${tab === 'qr' ? ' rv3-nav-item--active' : ''}`} onClick={() => setTab('qr')}>
          <QrCode size={19} strokeWidth={2} /><span>My QR</span>
        </button>
      </nav>
    </div>
  );
}
