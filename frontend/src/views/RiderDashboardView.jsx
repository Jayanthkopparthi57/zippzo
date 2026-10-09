import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  fetchApi, postApi, unwrapList, describeError
} from '../api/client';
import {
  Truck, Bell, Package, MapPin, CheckCircle, Clock, Bike,
  LogOut, Wifi, WifiOff, Inbox, Wallet, Banknote
} from 'lucide-react';

const TASKS = '/delivery/delivery-tasks/';
const RIDERS = '/delivery/rider-profiles/';
const SHIFTS = '/delivery/rider-shifts/';
const PICKUP = '/delivery/handoff/pickup';
const POD = '/delivery/handoff/pod';
const NOTIFICATIONS = '/notifications/notifications/';
const EARNINGS = '/money/rider-earnings/';
const CUSTODY = '/money/rider-custody/';

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

const bannerStyle = (bg, border, color) => ({
  background: bg, border: `1px solid ${border}`, color,
  padding: '12px 14px', borderRadius: 10, marginBottom: 14,
  display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13,
});

const btn = (background, color) => ({
  background, color, border: 'none', borderRadius: 10, padding: '13px 16px',
  fontWeight: 700, fontSize: 14, cursor: 'pointer',
});

function WalletStat({ label, value, sub, warn }) {
  return (
    <div style={{
      flex: '1 1 160px', background: '#fff', borderRadius: 12,
      border: `1px solid ${warn ? '#fcd34d' : '#e2e8f0'}`,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: warn ? '#b45309' : '#1e293b', marginTop: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: warn ? '#92400e' : '#94a3b8', marginTop: 3 }}>{sub}</div>}
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
      const me = await fetchApi(`${RIDERS}me/`);
      setProfile(me?.has_profile ? me : null);

      if (me?.has_profile) {
        const [taskRes, shiftRes, notifRes, countRes, earnRes, custRes] =
          await Promise.all([
            fetchApi(TASKS),
            fetchApi(`${SHIFTS}?status=OPEN`).catch(() => []),
            fetchApi(NOTIFICATIONS).catch(() => []),
            fetchApi(`${NOTIFICATIONS}unread_count/`).catch(() => ({ unread: 0 })),
            fetchApi(EARNINGS).catch(() => []),
            fetchApi(CUSTODY).catch(() => null),
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

  // Poll every 30 s so new job offers and package-ready notifications appear
  // without the rider manually refreshing. 30 s is a reasonable tradeoff
  // between freshness and battery/data usage for a quick-commerce rider.
  useEffect(() => {
    const id = setInterval(() => load(), 30000);
    return () => clearInterval(id);
  }, [load]);

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
      <div data-testid="rider-loading" style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>
        Loading the rider console...
      </div>
    );
  }

  // ── no profile yet ──
  if (!profile?.has_profile) {
    const stores = (facilitiesList.all_facilities || []).filter(s => s.site_type === 'DS');
    const field = { width: '100%', padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' };
    return (
      <div data-testid="rider-setup" style={{ background: '#f8fafc', minHeight: '100vh', padding: 24 }}>
        <div style={{ maxWidth: 460, margin: '40px auto', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 18, display: 'flex', gap: 8, alignItems: 'center', color: '#1e293b' }}>
            <Bike size={20} color="#7c3aed" /> Set up your rider profile
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: 13, color: '#64748b' }}>
            Your account has no delivery profile yet. These details are what the
            store checks before handing you a tote.
          </p>

          {error && <div role="alert" style={bannerStyle('#fef2f2', '#fecaca', '#991b1b')}>{error}</div>}

          <label style={labelStyle}>Full name</label>
          <input style={field} value={form.name} placeholder={user?.full_name || ''}
                 onChange={e => setForm({ ...form, name: e.target.value })} />

          <label style={labelStyle}>Phone</label>
          <input style={field} value={form.phone} inputMode="tel" placeholder="10-digit number"
                 onChange={e => setForm({ ...form, phone: e.target.value })} />

          <label style={labelStyle}>Vehicle</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            {VEHICLES.map(([value, text]) => (
              <button key={value} onClick={() => setForm({ ...form, vehicle_type: value })}
                      style={{
                        ...btn(form.vehicle_type === value ? '#7c3aed' : '#f1f5f9',
                              form.vehicle_type === value ? '#fff' : '#475569'),
                        padding: '9px 14px', fontSize: 13,
                      }}>
                {text}
              </button>
            ))}
          </div>

          <label style={labelStyle}>Vehicle number</label>
          <input style={field} value={form.vehicle_number} placeholder="KA-01-AB-1234"
                 onChange={e => setForm({ ...form, vehicle_number: e.target.value })} />

          <label style={labelStyle}>Home store</label>
          <select style={field} value={form.site_code}
                  onChange={e => setForm({ ...form, site_code: e.target.value })}>
            <option value="">Select a dark store…</option>
            {stores.map(s => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
          {stores.length === 0 && (
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>
              No stores loaded. Refresh after logging in again.
            </p>
          )}

          <button onClick={bootstrap} disabled={busy}
                  style={{ ...btn('#7c3aed', '#fff'), width: '100%', marginTop: 18 }}>
            {busy ? 'Saving…' : 'Create profile'}
          </button>
        </div>
      </div>
    );
  }

  const step = active[0] ? STEPS.find(s => s.status === active[0].status) : null;

  return (
    <div data-testid="rider-shell" style={{ background: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {(error || notice) && (
        <div role="alert" style={{
          margin: '12px 20px 0', padding: '10px 14px', borderRadius: 8,
          background: error ? '#fef2f2' : '#ecfdf5',
          border: `1px solid ${error ? '#fecaca' : '#a7f3d0'}`,
          color: error ? '#991b1b' : '#065f46',
          fontSize: 13, fontWeight: 600,
        }}>
          {error || notice}
        </div>
      )}

      {/* Header */}
      <div style={{
        background: '#fff', padding: '14px 20px', borderBottom: '1px solid #e2e8f0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 17, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Truck size={19} color="#7c3aed" /> Zippzo Rider
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b', display: 'flex', gap: 6, alignItems: 'center' }}>
            {profile.is_online
              ? <Wifi size={13} color="#10b981" />
              : <WifiOff size={13} color="#94a3b8" />}
            {profile.is_online ? 'Online' : 'Offline'} · {profile.name}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setTab('alerts')} title="Notifications"
                  style={{ ...btn('#f1f5f9', '#475569'), padding: '9px 11px', position: 'relative' }}>
            <Bell size={17} />
            {unread > 0 && (
              <span style={{
                position: 'absolute', top: -5, right: -5, background: '#dc2626',
                color: '#fff', borderRadius: 999, fontSize: 10, minWidth: 17,
                height: 17, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontWeight: 800,
              }}>{unread}</span>
            )}
          </button>
          <button onClick={toggleOnline}
                  style={btn(profile.is_online ? '#f1f5f9' : '#10b981',
                            profile.is_online ? '#475569' : '#fff')}>
            {profile.is_online ? 'Go offline' : 'Go online'}
          </button>
          <button onClick={logout} style={btn('#f1f5f9', '#475569')} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Shift bar */}
      <div style={{
        background: shift ? '#ecfdf5' : '#fffbeb', borderBottom: '1px solid #e2e8f0',
        padding: '9px 20px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', fontSize: 13,
      }}>
        <span style={{ color: shift ? '#065f46' : '#92400e', fontWeight: 600 }}>
          {shift
            ? <>Shift started {new Date(shift.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
            : 'No open shift'}
          {profile.current_site_code && <> · {profile.current_site_code}</>}
        </span>
        <button onClick={toggleShift} disabled={busy}
                style={{ ...btn(shift ? '#dc2626' : '#7c3aed', '#fff'), padding: '7px 14px', fontSize: 13 }}>
          {shift ? 'End shift' : 'Start shift'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '12px 20px 0' }}>
        {[['jobs', 'Jobs', Package], ['history', 'History', CheckCircle], ['money', 'Money', Wallet], ['alerts', `Alerts${unread ? ` (${unread})` : ''}`, Bell]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            display: 'flex', gap: 6, alignItems: 'center', border: 'none',
            background: tab === id ? '#7c3aed' : 'transparent',
            color: tab === id ? '#fff' : '#64748b',
            padding: '8px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13,
            cursor: 'pointer',
          }}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: 20, maxWidth: 640, margin: '0 auto', width: '100%' }}>

        {tab === 'jobs' && (
          <>
            {/* Offers */}
            {offers.length > 0 && (
              <section style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 13, color: '#475569', margin: '0 0 10px' }}>
                  Waiting for a rider ({offers.length})
                </h3>
                {offers.map(t => (
                  <div key={t.task_id} style={{
                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
                    padding: 14, marginBottom: 10,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#1e293b' }}>{t.order_no}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                          {t.order_weight_kg ? `${t.order_weight_kg} kg` : 'Weight pending'}
                          {t.requires_cold_chain && ' · cold chain'}
                          {t.staging_bin && ` · staged at ${t.staging_bin}`}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, color: '#b45309' }}>
                        {t.payment_method === 'COD' && t.grand_total ? `₹${t.grand_total}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button onClick={() => decline(t)} disabled={busy}
                              style={{ ...btn('#f1f5f9', '#475569'), flex: 1, padding: '11px' }}>
                        Not me
                      </button>
                      <button onClick={() => accept(t)} disabled={busy}
                              style={{ ...btn('#7c3aed', '#fff'), flex: 2, padding: '11px' }}>
                        Accept job
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Active job */}
            {active.length > 0 ? (
              <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <div style={{
                  background: '#7c3aed', color: '#fff', padding: '12px 18px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{active[0].order_no}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {active[0].status.replace(/_/g, ' ').toLowerCase()}
                      {active[0].staging_bin && ` · ${active[0].staging_bin}`}
                    </div>
                  </div>
                  <Package size={22} />
                </div>

                <div style={{ padding: 18 }}>
                  {/* Progress */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
                    {['ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'DELIVERED'].map(s => {
                      const order = ['ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED'];
                      const current = active[0].status === 'POD_PENDING' ? 'ARRIVED' : active[0].status;
                      const idx = order.indexOf(current);
                      const thisIdx = order.indexOf(s === 'DELIVERED' ? 'ARRIVED' : s);
                      const reached = s === 'DELIVERED' ? false : thisIdx <= idx;
                      return (
                        <div key={s} style={{
                          flex: 1, height: 5, borderRadius: 3,
                          background: reached ? '#7c3aed' : '#e2e8f0',
                        }} />
                      );
                    })}
                  </div>

                  {step && (
                    <div style={bannerStyle('#f5f3ff', '#ddd6fe', '#5b21b6')}>
                      <Clock size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <strong>{step.label}</strong>
                        <div style={{ marginTop: 2, fontSize: 12 }}>
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
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 14 }}>
                    <MapPin size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                        {active[0].customer_name || 'Customer'}
                      </div>
                      <div style={{ fontSize: 13, color: '#64748b' }}>
                        {active[0].delivery_address ||
                          'The delivery address appears once you are assigned this job.'}
                      </div>
                    </div>
                  </div>

                  {active[0].payment_method === 'COD' && active[0].grand_total && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', padding: '10px 14px',
                      background: '#fef3c7', borderRadius: 10, marginBottom: 14, fontSize: 14,
                    }}>
                      <span style={{ color: '#92400e', fontWeight: 600 }}>Cash to collect</span>
                      <span style={{ fontWeight: 800, fontSize: 17, color: '#b45309' }}>
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
                      style={{ ...btn('#10b981', '#fff'), width: '100%' }}>
                      {busy ? 'Working…' : step.button}
                    </button>
                  )}

                  {/* Pickup dialog */}
                  {toteOpen && (
                    <div style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 14, marginTop: 14 }}>
                      <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#334155' }}>Collect tote</h4>
                      <input
                        value={toteBarcode}
                        onChange={e => setToteBarcode(e.target.value)}
                        placeholder="Tote barcode (optional — confirms the right bag)"
                        style={{ width: '100%', padding: 11, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', marginBottom: 10 }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { setToteOpen(false); setToteBarcode(''); }}
                                style={{ ...btn('#f1f5f9', '#475569'), flex: 1 }}>Cancel</button>
                        <button onClick={() => collectTote(active[0])} disabled={busy}
                                style={{ ...btn('#10b981', '#fff'), flex: 2 }}>
                          {busy ? 'Checking…' : 'Confirm pickup'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* POD dialog */}
                  {podOpen && (
                    <div style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 14, marginTop: 14 }}>
                      <h4 style={{ margin: '0 0 10px', fontSize: 14, color: '#334155' }}>Proof of delivery</h4>

                      <label style={labelStyle}>Pickup code from the customer</label>
                      <input
                        value={podOtp}
                        onChange={e => setPodOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code" inputMode="numeric"
                        style={{ width: '100%', padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 18, letterSpacing: 3, marginBottom: 10, boxSizing: 'border-box' }} />

                      {active[0].payment_method === 'COD' && (
                        <>
                          <label style={labelStyle}>Cash collected</label>
                          <input
                            value={podCod}
                            onChange={e => setPodCod(e.target.value)}
                            placeholder={`₹${active[0].grand_total || '0.00'} due`}
                            inputMode="decimal"
                            style={{ width: '100%', padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 15, marginBottom: 10, boxSizing: 'border-box' }} />
                        </>
                      )}

                      <label style={labelStyle}>Customer name / signature (optional)</label>
                      <input
                        value={podSig}
                        onChange={e => setPodSig(e.target.value.slice(0, 120))}
                        placeholder="Who took the bag"
                        style={{ width: '100%', padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 15, marginBottom: 10, boxSizing: 'border-box' }} />

                      {podNote && (
                        <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', padding: 10, borderRadius: 8, marginBottom: 10 }}>
                          {podNote}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { setPodOpen(false); setPodNote(''); }}
                                style={{ ...btn('#f1f5f9', '#475569'), flex: 1 }}>Cancel</button>
                        <button onClick={() => closePod(active[0])} disabled={busy}
                                style={{ ...btn('#10b981', '#fff'), flex: 2 }}>
                          {busy ? 'Closing…' : 'Confirm delivery'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : offers.length === 0 && (
              <div style={{
                background: '#fff', padding: 36, borderRadius: 16, textAlign: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}>
                <div style={{
                  background: '#f1f5f9', width: 60, height: 60, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px',
                }}>
                  <Inbox size={30} color="#94a3b8" />
                </div>
                <h2 style={{ margin: '0 0 6px', color: '#1e293b', fontSize: 17 }}>Nothing waiting</h2>
                <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
                  {profile.is_online
                    ? 'You are online. New jobs at this store show up here.'
                    : 'You are offline. Go online to receive jobs.'}
                </p>
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            {done.length === 0 && (
              <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                No completed jobs yet.
              </div>
            )}
            {done.map((d, i) => (
              <div key={d.task_id} style={{
                padding: '12px 16px',
                borderBottom: i < done.length - 1 ? '1px solid #e2e8f0' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13,
              }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#1e293b' }}>{d.order_no}</div>
                  <div style={{ color: '#64748b', marginTop: 2 }}>
                    {d.delivered_at ? new Date(d.delivered_at).toLocaleString() : ''}
                  </div>
                </div>
                <span style={{
                  background: d.status === 'DELIVERED' ? '#d1fae5' : '#fee2e2',
                  color: d.status === 'DELIVERED' ? '#065f46' : '#991b1b',
                  padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                }}>{d.status}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'money' && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <WalletStat
                label="Cash in hand"
                value={`₹${Number(custody?.current_cash || 0).toFixed(2)}`}
                sub={custody
                  ? `ceiling ₹${Number(custody.ceiling_amount || 0).toFixed(2)}`
                  : 'nothing collected yet'}
                warn={custody && Number(custody.current_cash) >= Number(custody.ceiling_amount)} />
              <WalletStat
                label="Float"
                value={`₹${Number(custody?.current_float || 0).toFixed(2)}`} />
              <WalletStat
                label="Bags carried"
                value={String(custody?.bags_in_custody ?? 0)} />
              <WalletStat
                label="Earned"
                value={`₹${earnings.reduce((t, e) => t + Number(e.amount || 0), 0).toFixed(2)}`}
                sub={`${earnings.length} delivery${earnings.length === 1 ? '' : 'ies'}`} />
            </div>

            <div style={{
              background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '13px 16px', borderBottom: '1px solid #e2e8f0',
                fontWeight: 800, fontSize: 14, color: '#1e293b',
                display: 'flex', gap: 8, alignItems: 'center',
              }}>
                <Banknote size={17} color="#10b981" /> Delivery earnings
              </div>
              {earnings.length === 0 && (
                <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                  Earnings are credited when you close a delivery.
                </div>
              )}
              {earnings.map((e, i) => (
                <div key={e.earning_id} style={{
                  padding: '12px 16px',
                  borderBottom: i < earnings.length - 1 ? '1px solid #f1f5f9' : 'none',
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', fontSize: 13,
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#1e293b' }}>
                      Order {e.order_no || String(e.order).slice(0, 8)}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      {e.created_at ? new Date(e.created_at).toLocaleString() : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, color: '#059669' }}>
                      ₹{Number(e.amount || 0).toFixed(2)}
                    </div>
                    <div style={{
                      fontSize: 11, color: e.status === 'PAID' ? '#065f46' : '#92400e',
                      fontWeight: 700,
                    }}>{e.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'alerts' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ fontSize: 13, color: '#475569', margin: 0 }}>Notifications</h3>
              {unread > 0 && (
                <button onClick={markAllRead} disabled={busy}
                        style={{ ...btn('#f1f5f9', '#475569'), padding: '7px 12px', fontSize: 12 }}>
                  Mark all read
                </button>
              )}
            </div>
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              {notifications.length === 0 && (
                <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                  Nothing yet. Job offers and order updates land here.
                </div>
              )}
              {notifications.map((n, i) => (
                <div key={n.notification_id} style={{
                  padding: '13px 16px',
                  borderBottom: i < notifications.length - 1 ? '1px solid #e2e8f0' : 'none',
                  background: n.read_at ? '#fff' : '#f5f3ff',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                      {NOTIF_LABELS[n.type] || n.type}
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
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

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#475569',
  margin: '14px 0 5px',
};

const NOTIF_LABELS = {
  RIDER_JOB_OFFERED: 'New job at your store',
  ORDER_PACKED: 'Order packed — ready to collect',
  ORDER_ON_THE_WAY: 'Order is on the way',
  ORDER_DELIVERED: 'Order delivered',
  DELIVERY_OTP: 'Pickup code requested',
  ORDER_UPDATE: 'Order update',
};
