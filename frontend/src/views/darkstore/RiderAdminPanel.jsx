import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeIndianRupee, Bike, Download, Plus, RefreshCw, Search,
  ShieldCheck, Trash2,
} from 'lucide-react';
import { fetchApi, postApi, patchApi, describeError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const VEHICLES = ['BIKE', 'SCOOTER', 'CYCLE', 'MINI_VAN'];
const emptyRider = () => ({
  full_name: '', email: '', phone: '', password: '',
  vehicle_type: 'BIKE', vehicle_number: '', kyc_status: 'VERIFIED',
});
const rateDefaults = {
  base_per_km: '7.00', delivery_radius_km: '5.00', busy_bonus: '5.00',
  rain_bonus: '5.00', busy_rain_bonus: '10.00', incentive_orders: 15, incentive_amount: '100.00',
};
/** Rider registration, fleet roster and pay rate card for the DS console. */
export default function RiderAdminPanel({ section = 'roster', siteId = '', storeCode = '' }) {
  const { user: currentUser } = useAuth();
  const canRemove = Boolean(currentUser?.is_super_admin || currentUser?.is_admin);
  const [riders, setRiders] = useState([]);
  const [users, setUsers] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [rateRule, setRateRule] = useState(null);
  const [rateForm, setRateForm] = useState(rateDefaults);
  const [riderForm, setRiderForm] = useState(emptyRider());
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [riderRows, userRows, shiftRows, rateRows] = await Promise.all([
        fetchApi('/delivery/rider-profiles/?page_size=500'),
        fetchApi('/iam/users/'),
        fetchApi('/delivery/rider-shifts/?page_size=500'),
        fetchApi(`/delivery/rider-payment-rules/?site=${encodeURIComponent(siteId)}`),
      ]);
      setRiders(Array.isArray(riderRows) ? riderRows : []);
      setUsers(Array.isArray(userRows) ? userRows : []);
      setShifts(Array.isArray(shiftRows) ? shiftRows : []);
      const rule = Array.isArray(rateRows) ? rateRows[0] : null;
      setRateRule(rule || null);
      if (rule) setRateForm({
        base_per_km: rule.base_per_km, delivery_radius_km: rule.delivery_radius_km,
        busy_bonus: rule.busy_bonus, rain_bonus: rule.rain_bonus,
        busy_rain_bonus: rule.busy_rain_bonus,
        incentive_orders: rule.incentive_orders, incentive_amount: rule.incentive_amount,
      });
    } catch (err) {
      setError(describeError(err) || 'Could not load rider records.');
    } finally { setLoading(false); }
  }, [siteId]);

  useEffect(() => { reload(); }, [reload]);

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const userById = useMemo(() => {
    const map = new Map();
    users.forEach((u) => map.set(String(u.user_id), u));
    return map;
  }, [users]);
  const openShiftByRider = useMemo(() => {
    const map = new Map();
    shifts.filter((s) => s.status === 'OPEN')
      .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))
      .forEach((s, index) => {
        if (!map.has(String(s.rider))) map.set(String(s.rider), { ...s, queue: index + 1 });
      });
    return map;
  }, [shifts]);
  const filteredRiders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return riders;
    return riders.filter((r) => [r.name, r.phone, r.vehicle_number, r.kyc_status]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [riders, search]);

  const saveRider = async (event) => {
    event.preventDefault();
    if (!riderForm.full_name.trim() || !riderForm.email.trim() || !riderForm.password.trim()) {
      setError('Name, email and password are required.'); return;
    }
    setBusy(true); setError('');
    try {
      const created = await postApi('/iam/users/', {
        email: riderForm.email, full_name: riderForm.full_name, phone: riderForm.phone,
        password: riderForm.password, role: 'RIDER', role_at_site: 'RIDER', site_id: siteId,
      });
      await postApi('/delivery/rider-profiles/admin-bootstrap/', {
        user: created.user_id, site_code: storeCode, name: riderForm.full_name,
        phone: riderForm.phone || '0000000000', vehicle_type: riderForm.vehicle_type,
        vehicle_number: riderForm.vehicle_number, kyc_status: riderForm.kyc_status,
      });
      setRiderForm(emptyRider()); await reload();
      showNotice('Rider registered. QR activation is still required before taking jobs.');
    } catch (err) { setError(describeError(err) || 'Could not register rider.'); }
    finally { setBusy(false); }
  };

  const updateKyc = async (rider, status) => {
    setBusyId(`kyc-${rider.rider_id}`);
    try {
      await postApi('/delivery/admin/riders', { rider_id: rider.rider_id, kyc_status: status });
      await reload(); showNotice(`Rider KYC set to ${status}.`);
    } catch (err) { setError(describeError(err) || 'Could not update KYC.'); }
    finally { setBusyId(''); }
  };

  const updateVehicle = async (rider) => {
    setBusyId(`veh-${rider.rider_id}`);
    try {
      await patchApi(`/delivery/rider-profiles/${rider.rider_id}/`, {
        vehicle_type: rider.vehicle_type, vehicle_number: rider.vehicle_number || '',
      });
      await reload(); showNotice('Rider vehicle updated.');
    } catch (err) { setError(describeError(err) || 'Could not update vehicle.'); }
    finally { setBusyId(''); }
  };

  const removeRider = async (row) => {
    const user = userById.get(String(row.user));
    if (!user || !window.confirm(`Remove ${row.name || user.email}?`)) return;
    setBusyId(`remove-${row.rider_id}`);
    try {
      await postApi(`/iam/users/${user.user_id}/remove/`, {});
      await reload(); showNotice('Rider removed.');
    } catch (err) { setError(describeError(err) || 'Could not remove rider.'); }
    finally { setBusyId(''); }
  };

  const setRate = (key, value) => setRateForm((prev) => ({ ...prev, [key]: value }));
  const saveRate = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = { ...rateForm, incentive_orders: Number(rateForm.incentive_orders) || 0, site: siteId };
      if (rateRule) await patchApi(`/delivery/rider-payment-rules/${rateRule.rule_id}/`, payload);
      else await postApi('/delivery/rider-payment-rules/', payload);
      await reload(); showNotice('Rider payment rate card saved.');
    } catch (err) { setError(describeError(err) || 'Could not save the rate card.'); }
    finally { setBusy(false); }
  };
  const previewRate = async () => {
    if (!rateRule) { setError('Save the rate card first.'); return; }
    setBusy(true);
    try {
      const result = await postApi(`/delivery/rider-payment-rules/${rateRule.rule_id}/preview/`, {
        distance_km: Number(rateForm.delivery_radius_km) || 5,
        busy: true, rain: true,
        completed_orders: Number(rateForm.incentive_orders) || 0,
      });
      setPreview(result);
    } catch (err) { setError(describeError(err) || 'Could not preview pay.'); }
    finally { setBusy(false); }
  };

  const exportCsv = (rows, headers, file) => {
    const csv = [headers.join(','), ...rows.map((row) => headers.map((_, i) => JSON.stringify(row[i] ?? '')).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a'); link.href = url; link.download = file; link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="vend-page">
      {error && <div className="vend-feedback vend-feedback--error">{error}</div>}
      {notice && <div className="vend-feedback vend-feedback--ok">{notice}</div>}
      {loading && <div className="vend-feedback">Loading rider records…</div>}

      {section === 'rates' ? (
        <section className="vend-card vend-rate">
          <div className="vend-card__head vend-card__head--blue">
            <BadgeIndianRupee size={18} />
            <div><h2>Rider payment option</h2><p>Rate card for {storeCode || 'this store'}.</p></div>
          </div>
          <div className="vend-rate__body">
            <div className="vend-rate__row vend-rate__row--head"><span>Rider payment option</span><span>Amount</span></div>
            <div className="vend-rate__row"><span>Base payment</span><b>₹{rateForm.base_per_km || '0'} per km</b></div>
            <div className="vend-rate__row"><span>Delivery radius</span><b>{rateForm.delivery_radius_km || '0'} km</b></div>
            <div className="vend-rate__row"><span>Busy-hours bonus</span><b>+₹{rateForm.busy_bonus || '0'}</b></div>
            <div className="vend-rate__row"><span>Rain bonus</span><b>+₹{rateForm.rain_bonus || '0'}</b></div>
            <div className="vend-rate__row"><span>Busy hours + rain</span><b>+₹{rateForm.busy_rain_bonus || '0'}</b></div>
            <div className="vend-rate__row"><span>Every {rateForm.incentive_orders || 0} completed orders</span><b>₹{rateForm.incentive_amount || '0'} incentive</b></div>
            {preview && (
              <div className="vend-rate__preview">
                Sample {rateForm.delivery_radius_km || 5} km delivery in busy hours + rain:
                <b> ₹{preview.total}</b> (base ₹{preview.base} + bonus ₹{preview.bonus} + incentive ₹{preview.incentive})
              </div>
            )}
            <form className="vend-rate__edit" onSubmit={saveRate}>
              <fieldset disabled={busy}>
                <label>₹ / km<input type="number" min="0" step="0.01" value={rateForm.base_per_km} onChange={(e) => setRate('base_per_km', e.target.value)} /></label>
                <label>Radius (km)<input type="number" min="0" step="0.1" value={rateForm.delivery_radius_km} onChange={(e) => setRate('delivery_radius_km', e.target.value)} /></label>
                <label>Busy bonus<input type="number" min="0" step="0.01" value={rateForm.busy_bonus} onChange={(e) => setRate('busy_bonus', e.target.value)} /></label>
                <label>Rain bonus<input type="number" min="0" step="0.01" value={rateForm.rain_bonus} onChange={(e) => setRate('rain_bonus', e.target.value)} /></label>
                <label>Busy + rain<input type="number" min="0" step="0.01" value={rateForm.busy_rain_bonus} onChange={(e) => setRate('busy_rain_bonus', e.target.value)} /></label>
                <label>Orders / incentive<input type="number" min="0" value={rateForm.incentive_orders} onChange={(e) => setRate('incentive_orders', e.target.value)} /></label>
                <label>Incentive ₹<input type="number" min="0" step="0.01" value={rateForm.incentive_amount} onChange={(e) => setRate('incentive_amount', e.target.value)} /></label>
                <div className="vend-form__actions">
                  <button type="submit" className="vend-btn vend-btn--primary">Save rate card</button>
                  <button type="button" className="vend-btn" onClick={previewRate}>Preview pay</button>
                </div>
              </fieldset>
            </form>
            <div className="vend-rate__note">
              Bank, PAN and UPI details for rider salaries are entered under <b>Salary &amp; payouts</b> in this hub.
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="vend-card">
            <div className="vend-card__head vend-card__head--blue">
              <Bike size={18} />
              <div><h2>Rider Registration</h2><p>Create a rider login with vehicle and KYC details.</p></div>
            </div>
            <form className="vend-form" onSubmit={saveRider}>
              <fieldset disabled={busy}>
                <div className="vend-grid vend-grid--two">
                  <label>Full name *<input value={riderForm.full_name} onChange={(e) => setRiderForm({ ...riderForm, full_name: e.target.value })} /></label>
                  <label>Email *<input type="email" value={riderForm.email} onChange={(e) => setRiderForm({ ...riderForm, email: e.target.value })} /></label>
                  <label>Phone<input value={riderForm.phone} onChange={(e) => setRiderForm({ ...riderForm, phone: e.target.value })} /></label>
                  <label>Password *<input type="password" value={riderForm.password} onChange={(e) => setRiderForm({ ...riderForm, password: e.target.value })} /></label>
                  <label>Vehicle type
                    <select value={riderForm.vehicle_type} onChange={(e) => setRiderForm({ ...riderForm, vehicle_type: e.target.value })}>
                      {VEHICLES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>Vehicle number<input value={riderForm.vehicle_number} onChange={(e) => setRiderForm({ ...riderForm, vehicle_number: e.target.value })} /></label>
                  <label>KYC status
                    <select value={riderForm.kyc_status} onChange={(e) => setRiderForm({ ...riderForm, kyc_status: e.target.value })}>
                      <option value="VERIFIED">Verified</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option>
                    </select>
                  </label>
                </div>
                <div className="vend-form__actions"><button type="submit" className="vend-btn vend-btn--primary"><Plus size={14} /> Register Rider</button></div>
              </fieldset>
            </form>
          </section>

          <section className="vend-card">
            <div className="vend-card__head">
              <Bike size={18} />
              <div><h2>Rider Details</h2><p>{riders.length} rider profile(s)</p></div>
              <div className="vend-card__tools">
                <div className="vend-search"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search riders…" /></div>
                <button type="button" className="vend-btn" onClick={() => exportCsv(filteredRiders.map((r) => [r.name, r.phone, r.vehicle_type, r.vehicle_number, r.kyc_status]), ['Rider', 'Phone', 'Vehicle', 'Number', 'KYC'], 'riders.csv')}><Download size={14} /> Export</button>
                <button type="button" className="vend-btn" onClick={() => reload()}><RefreshCw size={14} /> Sync</button>
              </div>
            </div>
            <div className="vend-table-wrap">
              <table className="vend-table">
                <thead><tr><th>#</th><th>Rider</th><th>Phone</th><th>Vehicle</th><th>Store</th><th>KYC</th><th>Action</th></tr></thead>
                <tbody>
                  {filteredRiders.map((row, index) => (
                    <tr key={row.rider_id}>
                      <td>{index + 1}</td>
                      <td><b>{row.name || userById.get(String(row.user))?.full_name || '—'}</b></td>
                      <td>{row.phone || '—'}</td>
                      <td>
                        <select value={row.vehicle_type} onChange={(e) => updateVehicle({ ...row, vehicle_type: e.target.value })} disabled={Boolean(busyId)} style={{ fontSize: 11 }}>
                          {VEHICLES.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <div className="vend-mono" style={{ fontSize: 10 }}>{row.vehicle_number || '—'}</div>
                      </td>
                      <td>{row.current_site_code || '—'}</td>
                      <td>
                        <select value={row.kyc_status} onChange={(e) => updateKyc(row, e.target.value)} disabled={Boolean(busyId)} style={{ fontSize: 11 }}>
                          <option value="VERIFIED">Verified</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option>
                        </select>
                      </td>
                      <td className="vend-actions">
                        <button type="button" title="Verify KYC" disabled={Boolean(busyId)} onClick={() => updateKyc(row, 'VERIFIED')}><ShieldCheck size={13} /></button>
                        {canRemove && <button type="button" title="Remove rider" disabled={Boolean(busyId)} onClick={() => removeRider(row)}><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  ))}
                  {!filteredRiders.length && <tr><td colSpan={7} className="vend-empty">No riders registered yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="vend-card__foot">Showing {filteredRiders.length} of {riders.length} riders · new riders must scan the store QR to activate</div>
          </section>
        </>
      )}
    </div>
  );
}
