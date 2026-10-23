import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  fetchApi, postApi, unwrapList, describeError
} from '../api/client';
import {
  Truck, Bell, Package, MapPin, CheckCircle, Clock, Bike,
  LogOut, Wifi, WifiOff, Inbox, Wallet, Banknote, QrCode
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
 * The remote Neon pooler plus the browser's HTTP/1.1 connection cap can leave
 * one fetch in a Promise.all hanging for minutes under StrictMode's double
 * mount. Bound every load so the console always settles into setup/shell/error
 * instead of sitting on the spinner.
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

// The next thing the rider has to do, in the order the backend allows it.
// Each entry is the API action that makes it true.
const STEPS = [
  { status: 'ACCEPTED', label: 'Head to the store', to: 'AT_DS', button: "I'm at the store" },
  { status: 'AT_DS', label: 'Collect the tote', action: 'pickup', button: 'Collect tote' },
  { status: 'PICKED_UP', label: 'On the way', to: 'EN_ROUTE', button: 'Start delivery' },
  { status: 'EN_ROUTE', label: 'At the door', to: 'ARRIVED', button: "I've arrived" },
  { status: 'ARRIVED', label: 'Hand it over', action: 'pod', button: 'Complete delivery' },
  { status: 'POD_PENDING', label: 'Hand it over', action: 'pod', button: 'Enter pickup code' },
];

function StatTile({ label, value, sub, warn }) {
  return (
    <div className={`rd-stat${warn ? ' rd-stat--warn' : ''}`}>
      <div className="rd-stat__label">{label}</div>
      <div className="rd-stat__value">{value}</div>
      {sub && <div className="rd-stat__sub">{sub}</div>}
    </div>
  );
}

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
  const [tab, setTab] = useState('jobs');

  // Personal scan code, fetched only when the rider asks for it: the code
  // doubles as the rider's acceptance at the store counter, so it is not
  // sitting on screen from the moment the console opens.
  const [qrInfo, setQrInfo] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Pickup / POD dialogs
  const [toteOpen, setToteOpen] = useState(false);
  const [toteBarcode, setToteBarcode] = useState('');
  const [podOpen, setPodOpen] = useState(false);
  const [podOtp, setPodOtp] = useState('');
  const [podCod, setPodCod] = useState('');
  const [podSig, setPodSig] = useState('');
  const [podNote, setPodNote] = useState('');

  // First-run rider setup
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

  // Poll every 10 s so new job offers and package-ready notifications appear
  // without the rider manually refreshing.
  useEffect(() => {
    const id = setInterval(() => load(), 10000);
    return () => clearInterval(id);
  }, [load]);

  // While online, keep the store's fleet board fed with where this rider
  // actually is. A browser that refuses the permission, or a device with no
  // GPS, just leaves the board showing "no location" - the console itself
  // keeps working either way, so the failure is never surfaced as an error.
  const [locSharing, setLocSharing] = useState(false);
  useEffect(() => {
    if (!profile?.is_online || !navigator.geolocation) return undefined;
    let cancelled = false;
    let lastPush = 0;
    const push = (pos) => {
      if (cancelled) return;
      const now = Date.now();
      // One pin every 20 s is plenty for a board that only shows "last seen".
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
    setNotice('Profile created. Go online to start receiving jobs.');
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
  const accept = (task) => run(async () => {
    await postApi(`${TASKS}${task.task_id}/accept/`, {});
    setNotice(`Job ${task.order_no || ''} accepted.`);
    await load();
  });

  const decline = (task) => run(async () => {
    await postApi(`${TASKS}${task.task_id}/decline/`, {});
    setNotice('Job handed back to the pool.');
    await load();
  });

  const advance = (task, to) => run(async () => {
    await postApi(`${TASKS}${task.task_id}/advance/`, { to });
    await load();
  });

  const collectTote = (task) => run(async () => {
    await postApi(PICKUP, {
      task_id: task.task_id,
      lpn_barcode: toteBarcode.trim() || undefined,
    });
    setToteOpen(false);
    setToteBarcode('');
    setNotice('Collected. The order is now yours.');
    await load();
  });

  // Deliberately not wrapped in run(): the POD form needs the 409 body so it
  // can show "ask the customer for the code" inside the dialog rather than as
  // a banner above the fold.
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

  // ── my QR ──
  const loadQr = async () => {
    setQrLoading(true);
    setQrError('');
    try {
      const info = await withTimeout(fetchApi(`${RIDERS}me/qr/`));
      setQrInfo(info);
      setQrOpen(true);
    } catch (err) {
      setQrError(describeError(err));
    } finally {
      setQrLoading(false);
    }
  };

  const markAllRead = () => run(async () => {
    await postApi(`${NOTIFICATIONS}mark_all_read/`, {});
    await load();
  });

  // ── derived views ──
  const mine = tasks.filter(t => t.rider === profile?.rider_id);
  const offers = tasks.filter(t =>
    !t.rider && t.site === profile?.current_site &&
    ['UNASSIGNED', 'OFFERED'].includes(t.status));
  const active = mine.filter(t => ACTIVE_STATES.includes(t.status));
  const done = mine.filter(t => DONE_STATES.includes(t.status));

  if (loading) {
    return (
      <div data-testid="rider-loading" className="rd-loading">
        Loading the rider console...
      </div>
    );
  }

  // ── no profile yet ──
  if (!profile?.has_profile) {
    const stores = (facilitiesList.all_facilities || []).filter(s => s.site_type === 'DS');
    return (
      <div data-testid="rider-setup" className="rd-setup">
        <div className="rd-setup__card">
          <h1 className="rd-setup__title">
            <Bike size={19} color="#6d4aff" /> Set up your rider profile
          </h1>
          <p className="rd-setup__sub">
            Your account has no delivery profile yet. These details are what the
            store checks before handing you a tote.
          </p>

          {error && (
            <div role="alert" className="rd-banner rd-banner--error">
              <span className="rd-banner__icon">{error}</span>
            </div>
          )}

          <label className="rd-label">Full name</label>
          <input className="rd-input" value={form.name} placeholder={user?.full_name || ''}
                 onChange={e => setForm({ ...form, name: e.target.value })} />

          <label className="rd-label">Phone</label>
          <input className="rd-input" value={form.phone} inputMode="tel" placeholder="10-digit number"
                 onChange={e => setForm({ ...form, phone: e.target.value })} />

          <label className="rd-label">Vehicle</label>
          <div className="rd-vehicles">
            {VEHICLES.map(([value, text]) => (
              <button key={value} onClick={() => setForm({ ...form, vehicle_type: value })}
                      className={`rd-vehicle ${form.vehicle_type === value ? 'rd-vehicle--on' : 'rd-vehicle--off'}`}>
                {text}
              </button>
            ))}
          </div>

          <label className="rd-label">Vehicle number</label>
          <input className="rd-input" value={form.vehicle_number} placeholder="KA-01-AB-1234"
                 onChange={e => setForm({ ...form, vehicle_number: e.target.value })} />

          <label className="rd-label">Home store</label>
          <select className="rd-input" value={form.site_code}
                  onChange={e => setForm({ ...form, site_code: e.target.value })}>
            <option value="">Select a dark store…</option>
            {stores.map(s => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
          {stores.length === 0 && (
            <p className="rd-setup__hint">
              No stores loaded. Refresh after logging in again.
            </p>
          )}

          <button onClick={bootstrap} disabled={busy}
                  className="rd-btn rd-btn--primary rd-btn--block rd-setup__submit">
            {busy ? 'Saving…' : 'Create profile'}
          </button>
        </div>
      </div>
    );
  }

  const step = active[0] ? STEPS.find(s => s.status === active[0].status) : null;

  return (
    <div data-testid="rider-shell" className="rd-shell">
      {(error || notice) && (
        <div role="alert" className={`rd-banner ${error ? 'rd-banner--error' : 'rd-banner--ok'}`}>
          <span className="rd-banner__icon">{error || notice}</span>
        </div>
      )}

      {/* Header */}
      <div className="rd-header">
        <div>
          <h1 className="rd-header__title">
            <Truck size={17} color="#6d4aff" /> Zippzo Rider
          </h1>
          <p className="rd-header__sub">
            {profile.is_online
              ? <Wifi size={12} color="#16a34a" />
              : <WifiOff size={12} color="#a1a1aa" />}
            {profile.is_online ? 'Online' : 'Offline'} · {profile.name}
            {profile.is_online && (
              <span data-testid="rd-loc" style={{ marginLeft: 6 }}>
                {locSharing ? '· sharing location' : '· location off'}
              </span>
            )}
          </p>
        </div>
        <div className="rd-header__actions">
          <button onClick={() => setTab('alerts')} title="Notifications"
                  className="rd-btn rd-btn--quiet rd-btn--icon">
            <Bell size={16} />
            {unread > 0 && <span className="rd-badge-dot">{unread}</span>}
          </button>
          <button onClick={toggleOnline}
                  className={`rd-btn ${profile.is_online ? 'rd-btn--quiet' : 'rd-btn--go'}`}>
            {profile.is_online ? 'Go offline' : 'Go online'}
          </button>
          <button onClick={logout} className="rd-btn rd-btn--quiet rd-btn--icon" title="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {/* Shift bar */}
      <div className={`rd-shift ${shift ? 'rd-shift--open' : 'rd-shift--closed'}`}>
        <span className="rd-shift__text">
          <Clock size={12} />
          {shift
            ? <>Shift started {new Date(shift.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
            : 'No open shift'}
          {profile.current_site_code && <> · {profile.current_site_code}</>}
        </span>
        <button onClick={toggleShift} disabled={busy}
                className={`rd-btn rd-btn--sm ${shift ? 'rd-btn--stop' : 'rd-btn--primary'}`}>
          {shift ? 'End shift' : 'Start shift'}
        </button>
      </div>

      {/* Tabs */}
      <div className="rd-tabs">
        {[['jobs', 'Jobs', Package], ['history', 'History', CheckCircle], ['money', 'Money', Wallet], ['qr', 'My QR', QrCode], ['alerts', `Alerts${unread ? ` (${unread})` : ''}`, Bell]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
                  className={`rd-tab ${tab === id ? 'rd-tab--active' : ''}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="rd-main">

        {tab === 'jobs' && (
          <>
            {/* Offers */}
            {offers.length > 0 && (
              <section className="rd-section">
                <h3 className="rd-section__head">
                  Waiting for a rider ({offers.length})
                </h3>
                {offers.map(t => (
                  <div key={t.task_id} className="rd-card" data-testid={`rd-offer-${t.order_no}`}>
                    <div className="rd-offer__top">
                      <div>
                        <div className="rd-offer__no">{t.order_no}</div>
                        <div className="rd-offer__meta">
                          {t.order_weight_kg ? `${t.order_weight_kg} kg` : 'Weight pending'}
                          {t.requires_cold_chain && ' · cold chain'}
                          {t.staging_bin && ` · staged at ${t.staging_bin}`}
                        </div>
                      </div>
                      <div className="rd-offer__cod">
                        {t.payment_method === 'COD' && t.grand_total ? `₹${t.grand_total}` : ''}
                      </div>
                    </div>
                    <div className="rd-offer__actions">
                      <button onClick={() => decline(t)} disabled={busy}
                              className="rd-btn rd-btn--quiet">
                        Not me
                      </button>
                      <button onClick={() => accept(t)} disabled={busy}
                              className="rd-btn rd-btn--primary">
                        Accept job
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Active job */}
            {active.length > 0 ? (
              <div className="rd-job">
                <div className="rd-job__head">
                  <div>
                    <div className="rd-job__no">{active[0].order_no}</div>
                    <div className="rd-job__status">
                      {active[0].status.replace(/_/g, ' ').toLowerCase()}
                      {active[0].staging_bin && ` · ${active[0].staging_bin}`}
                    </div>
                  </div>
                  <Package size={20} />
                </div>

                <div className="rd-job__body">
                  {/* Progress */}
                  <div className="rd-progress">
                    {['ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'DELIVERED'].map(s => {
                      const order = ['ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED'];
                      const current = active[0].status === 'POD_PENDING' ? 'ARRIVED' : active[0].status;
                      const idx = order.indexOf(current);
                      const thisIdx = order.indexOf(s === 'DELIVERED' ? 'ARRIVED' : s);
                      const reached = s === 'DELIVERED' ? false : thisIdx <= idx;
                      return (
                        <div key={s} className={`rd-progress__seg${reached ? ' rd-progress__seg--on' : ''}`} />
                      );
                    })}
                  </div>

                  {step && (
                    <div className="rd-step rd-step--accent">
                      <span className="rd-step__icon"><Clock size={15} /></span>
                      <div>
                        <strong>{step.label}</strong>
                        <div className="rd-step__hint">
                          {active[0].status === 'AT_DS' && 'Scan the tote barcode to take custody of the goods.'}
                          {active[0].status === 'PICKED_UP' && 'Goods are with you. Cash orders collect on handover.'}
                          {active[0].status === 'ARRIVED' && 'Ask the customer for their pickup code.'}
                          {active[0].status === 'POD_PENDING' && 'A code has been sent to the customer.'}
                          {active[0].status === 'ACCEPTED' && 'Get to the store, then confirm you are there.'}
                          {active[0].status === 'EN_ROUTE' && 'Confirm when you are at the delivery address.'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Address */}
                  <div className="rd-addr">
                    <span className="rd-addr__icon"><MapPin size={15} /></span>
                    <div>
                      <div className="rd-addr__name">
                        {active[0].customer_name || 'Customer'}
                      </div>
                      <div className="rd-addr__line">
                        {active[0].delivery_address ||
                          'The delivery address appears once you are assigned this job.'}
                      </div>
                    </div>
                  </div>

                  {active[0].payment_method === 'COD' && active[0].grand_total && (
                    <div className="rd-cod">
                      <span className="rd-cod__label">Cash to collect</span>
                      <span className="rd-cod__value">
                        ₹{Number(active[0].grand_total).toFixed(2)}
                      </span>
                    </div>
                  )}

                  {step && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (step.action === 'pickup') setToteOpen(true);
                        else if (step.action === 'pod') { setPodOpen(true); setPodNote(''); setPodOtp(''); setPodCod(''); }
                        else advance(active[0], step.to);
                      }}
                      className="rd-btn rd-btn--go rd-btn--block">
                      {busy ? 'Working…' : step.button}
                    </button>
                  )}

                  {/* Pickup dialog */}
                  {toteOpen && (
                    <div className="rd-dialog">
                      <h4 className="rd-dialog__title">Collect tote</h4>
                      <input
                        value={toteBarcode}
                        onChange={e => setToteBarcode(e.target.value)}
                        placeholder="Tote barcode (optional — confirms the right bag)"
                        className="rd-input" />
                      <div className="rd-dialog__row">
                        <button onClick={() => { setToteOpen(false); setToteBarcode(''); }}
                                className="rd-btn rd-btn--quiet">Cancel</button>
                        <button onClick={() => collectTote(active[0])} disabled={busy}
                                className="rd-btn rd-btn--go">
                          {busy ? 'Checking…' : 'Confirm pickup'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* POD dialog */}
                  {podOpen && (
                    <div className="rd-dialog">
                      <h4 className="rd-dialog__title">Proof of delivery</h4>

                      <label className="rd-label">Pickup code from the customer</label>
                      <input
                        value={podOtp}
                        onChange={e => setPodOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code" inputMode="numeric"
                        className="rd-input rd-input--code" />

                      {active[0].payment_method === 'COD' && (
                        <>
                          <label className="rd-label">Cash collected</label>
                          <input
                            value={podCod}
                            onChange={e => setPodCod(e.target.value)}
                            placeholder={`₹${active[0].grand_total || '0.00'} due`}
                            inputMode="decimal"
                            className="rd-input rd-input--money" />
                        </>
                      )}

                      <label className="rd-label">Customer name / signature (optional)</label>
                      <input
                        value={podSig}
                        onChange={e => setPodSig(e.target.value.slice(0, 120))}
                        placeholder="Who took the bag"
                        className="rd-input" />

                      {podNote && (
                        <div className="rd-note">{podNote}</div>
                      )}

                      <div className="rd-dialog__row">
                        <button onClick={() => { setPodOpen(false); setPodNote(''); }}
                                className="rd-btn rd-btn--quiet">Cancel</button>
                        <button onClick={() => closePod(active[0])} disabled={busy}
                                className="rd-btn rd-btn--go">
                          {busy ? 'Closing…' : 'Confirm delivery'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : offers.length === 0 && (
              <div className="rd-empty">
                <div className="rd-empty__icon">
                  <Inbox size={26} />
                </div>
                <h2 className="rd-empty__title">Nothing waiting</h2>
                <p className="rd-empty__text">
                  {profile.is_online
                    ? 'You are online. New jobs at this store show up here.'
                    : 'You are offline. Go online to receive jobs.'}
                </p>
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <div className="rd-list">
            {done.length === 0 && (
              <div className="rd-list__empty">No completed jobs yet.</div>
            )}
            {done.map((d) => (
              <div key={d.task_id} className="rd-row">
                <div className="rd-row__main">
                  <div className="rd-row__title">{d.order_no}</div>
                  <div className="rd-row__sub">
                    {d.delivered_at ? new Date(d.delivered_at).toLocaleString() : ''}
                  </div>
                </div>
                <span className={`rd-pill ${d.status === 'DELIVERED' ? 'rd-pill--ok' : 'rd-pill--bad'}`}>
                  {d.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'money' && (
          <>
            <div className="rd-stats">
              <StatTile
                label="Cash in hand"
                value={`₹${Number(custody?.current_cash || 0).toFixed(2)}`}
                sub={custody
                  ? `ceiling ₹${Number(custody.ceiling_amount || 0).toFixed(2)}`
                  : 'nothing collected yet'}
                warn={custody && Number(custody.current_cash) >= Number(custody.ceiling_amount)} />
              <StatTile
                label="Float"
                value={`₹${Number(custody?.current_float || 0).toFixed(2)}`} />
              <StatTile
                label="Bags carried"
                value={String(custody?.bags_in_custody ?? 0)} />
              <StatTile
                label="Earned"
                value={`₹${earnings.reduce((t, e) => t + Number(e.amount || 0), 0).toFixed(2)}`}
                sub={`${earnings.length} delivery${earnings.length === 1 ? '' : 'ies'}`} />
            </div>

            <div className="rd-list">
              <div className="rd-list__head">
                <Banknote size={15} color="#16a34a" /> Delivery earnings
              </div>
              {earnings.length === 0 && (
                <div className="rd-list__empty">
                  Earnings are credited when you close a delivery.
                </div>
              )}
              {earnings.map((e) => (
                <div key={e.earning_id} className="rd-row">
                  <div className="rd-row__main">
                    <div className="rd-row__title">
                      Order {e.order_no || String(e.order).slice(0, 8)}
                    </div>
                    <div className="rd-row__sub">
                      {e.created_at ? new Date(e.created_at).toLocaleString() : ''}
                    </div>
                  </div>
                  <div className="rd-row__end">
                    <div className="rd-row__amount">
                      ₹{Number(e.amount || 0).toFixed(2)}
                    </div>
                    <div className={`rd-row__state ${e.status === 'PAID' ? 'rd-row__state--paid' : 'rd-row__state--due'}`}>
                      {e.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'qr' && (
          <section className="rd-section" data-testid="rd-qr-section">
            <h3 className="rd-section__head">My rider QR</h3>
            <div className="rd-qr">
              {qrError && (
                <div className="rd-banner rd-banner--error" data-testid="rd-qr-error">
                  <span className="rd-banner__icon">{qrError}</span>
                </div>
              )}
              {!qrOpen && (
                <button onClick={loadQr} disabled={qrLoading}
                        className="rd-btn rd-btn--primary" data-testid="rd-qr-show">
                  {qrLoading ? 'Loading…' : 'Show my QR code'}
                </button>
              )}
              {qrOpen && qrInfo && (
                <div className="rd-qr__card">
                  <div className="rd-qr__svg" data-testid="rd-qr-svg">
                    <QRCodeSVG value={qrInfo.payload || qrInfo.code} size={220} marginSize={2} />
                  </div>
                  <div className="rd-qr__code" data-testid="rd-qr-code">{qrInfo.code}</div>
                  <div className="rd-qr__meta">
                    {qrInfo.name}
                    {qrInfo.site ? ` · ${qrInfo.site}` : ' · no store yet'}
                    {' · scanned '}{qrInfo.scan_count ?? 0} time{(qrInfo.scan_count ?? 0) === 1 ? '' : 's'}
                    {qrInfo.is_online ? ' · online' : ' · offline'}
                  </div>
                  <div className="rd-qr__hint">
                    The store scans this at the handoff counter to give you a job —
                    the scan itself is your acceptance, so there is nothing to tap here.
                  </div>
                  <button onClick={loadQr} disabled={qrLoading}
                          className="rd-btn rd-btn--quiet rd-btn--sm" data-testid="rd-qr-refresh">
                    {qrLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'alerts' && (
          <>
            <div className="rd-section__bar">
              <h3 className="rd-section__head">Notifications</h3>
              {unread > 0 && (
                <button onClick={markAllRead} disabled={busy}
                        className="rd-btn rd-btn--quiet rd-btn--sm">
                  Mark all read
                </button>
              )}
            </div>
            <div className="rd-list">
              {notifications.length === 0 && (
                <div className="rd-list__empty">
                  Nothing yet. Job offers and order updates land here.
                </div>
              )}
              {notifications.map((n) => (
                <div key={n.notification_id}
                     className={`rd-notif${n.read_at ? '' : ' rd-notif--unread'}`}>
                  <div className="rd-notif__top">
                    <span className="rd-notif__title">
                      {NOTIF_LABELS[n.type] || n.type}
                    </span>
                    <span className="rd-notif__time">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="rd-notif__body">
                    {n.payload_json?.order_no && `Order ${n.payload_json.order_no}`}
                    {n.payload_json?.staging_bin && ` · collect from ${n.payload_json.staging_bin}`}
                    {!n.payload_json?.order_no && !n.payload_json?.staging_bin && '—'}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const NOTIF_LABELS = {
  RIDER_JOB_OFFERED: 'New job at your store',
  ORDER_PACKED: 'Order packed — ready to collect',
  ORDER_ON_THE_WAY: 'Order is on the way',
  ORDER_DELIVERED: 'Order delivered',
  DELIVERY_OTP: 'Pickup code requested',
  ORDER_UPDATE: 'Order update',
};
