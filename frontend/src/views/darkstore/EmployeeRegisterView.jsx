import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeIndianRupee, Bike, CheckCircle2, Clock3, Download, Pencil, Plus,
  RefreshCw, Search, ShieldCheck, Trash2, Users2,
} from 'lucide-react';
import { fetchApi, postApi, patchApi, describeError } from '../../api/client';
import { useDarkStore } from './useDarkStore';
import { useAuth } from '../../context/AuthContext';
import StoreGate from './StoreGate';
import '../../styles/vendors.css';

const EMPLOYEE_TYPES = [
  ['PICKER', 'Picker'], ['PACKER', 'Packer'], ['INVENTORY_ASSOCIATE', 'Inventory associate'],
  ['INBOUND_ASSOCIATE', 'Inbound associate'], ['PUTAWAY_ASSOCIATE', 'Putaway associate'],
  ['OPERATOR', 'Operator'], ['STORE_MANAGER', 'Store manager'],
];
const ACCOUNT_ROLE = {
  PICKER: 'WAREHOUSE_STAFF', PACKER: 'WAREHOUSE_STAFF',
  INVENTORY_ASSOCIATE: 'INVENTORY_ASSOCIATE', INBOUND_ASSOCIATE: 'INBOUND_ASSOCIATE',
  PUTAWAY_ASSOCIATE: 'PUTAWAY_ASSOCIATE', OPERATOR: 'WAREHOUSE_STAFF',
  STORE_MANAGER: 'OPS_MANAGER', RIDER: 'RIDER',
};
const VEHICLES = ['BIKE', 'SCOOTER', 'CYCLE', 'MINI_VAN'];
const BASSIS = ['PER_TASK', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'];

const emptyEmployee = () => ({
  full_name: '', email: '', phone: '', password: '',
  role_at_site: 'PICKER', basis: 'MONTHLY', amount: '',
});
const emptyRider = () => ({
  full_name: '', email: '', phone: '', password: '',
  vehicle_type: 'BIKE', vehicle_number: '', kyc_status: 'VERIFIED',
});

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Pill({ children, tone = 'neutral' }) {
  return <span className={`vend-pill vend-pill--${tone}`}>{children}</span>;
}

function Register({ site, siteId, storeCode }) {
  const { user: currentUser } = useAuth();
  const canRemove = Boolean(currentUser?.is_super_admin || currentUser?.is_admin);
  const [tab, setTab] = useState('employees');
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [riders, setRiders] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [employeeForm, setEmployeeForm] = useState(emptyEmployee());
  const [riderForm, setRiderForm] = useState(emptyRider());
  const [compEdit, setCompEdit] = useState(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [riderSearch, setRiderSearch] = useState('');

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [people, userRows, payRows, riderRows, shiftRows] = await Promise.all([
        fetchApi(`/network/manpower?site=${encodeURIComponent(storeCode)}`),
        fetchApi('/iam/users/'),
        fetchApi(`/network/payroll/?site=${encodeURIComponent(siteId)}&page_size=500`),
        fetchApi('/delivery/rider-profiles/?page_size=500'),
        fetchApi('/delivery/rider-shifts/?page_size=500'),
      ]);
      setEmployees(Array.isArray(people) ? people : (people?.results || []));
      setUsers(Array.isArray(userRows) ? userRows : (userRows?.results || []));
      setPayroll(Array.isArray(payRows) ? payRows : []);
      setRiders(Array.isArray(riderRows) ? riderRows : []);
      setShifts(Array.isArray(shiftRows) ? shiftRows : []);
    } catch (err) {
      setError(describeError(err) || 'Could not load staff records.');
    } finally { setLoading(false); }
  }, [storeCode, siteId]);

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
  const payByUser = useMemo(() => {
    const map = new Map();
    payroll.forEach((p) => {
      if (!p.user) return;
      const old = map.get(String(p.user));
      if (!old || (p.is_active && !old.is_active)) map.set(String(p.user), p);
    });
    return map;
  }, [payroll]);
  const riderByUser = useMemo(() => {
    const map = new Map();
    riders.forEach((r) => { if (r.user) map.set(String(r.user), r); });
    return map;
  }, [riders]);
  const openShiftByRider = useMemo(() => {
    const map = new Map();
    shifts.filter((s) => s.status === 'OPEN')
      .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))
      .forEach((s, index) => {
        if (!map.has(String(s.rider))) map.set(String(s.rider), { ...s, queue: index + 1 });
      });
    return map;
  }, [shifts]);

  const setEmployee = (key, value) => setEmployeeForm((prev) => ({ ...prev, [key]: value }));
  const setRider = (key, value) => setRiderForm((prev) => ({ ...prev, [key]: value }));

  const saveEmployee = async (event) => {
    event.preventDefault();
    if (!employeeForm.full_name.trim() || !employeeForm.email.trim() || !employeeForm.password.trim()) {
      setError('Name, email and password are required.'); return;
    }
    setBusy(true); setError('');
    try {
      const created = await postApi('/iam/users/', {
        email: employeeForm.email, full_name: employeeForm.full_name,
        phone: employeeForm.phone, password: employeeForm.password,
        role: ACCOUNT_ROLE[employeeForm.role_at_site] || 'WAREHOUSE_STAFF',
        role_at_site: employeeForm.role_at_site, site_id: siteId,
      });
      if (Number(employeeForm.amount) > 0) {
        await postApi('/network/payroll/', {
          user: created.user_id, site: siteId, employee: employeeForm.email.split('@')[0].toUpperCase().slice(0, 20),
          basis: employeeForm.basis, amount: Number(employeeForm.amount).toFixed(2),
          currency: 'INR', effective_from: new Date().toISOString().slice(0, 10), is_active: true,
        });
      }
      setEmployeeForm(emptyEmployee());
      await reload(); showNotice('Employee registered.');
    } catch (err) { setError(describeError(err) || 'Could not register employee.'); }
    finally { setBusy(false); }
  };

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
      setRiderForm(emptyRider()); await reload(); showNotice('Rider registered. QR activation is still required before taking jobs.');
    } catch (err) { setError(describeError(err) || 'Could not register rider.'); }
    finally { setBusy(false); }
  };

  const changeRole = async (row, value) => {
    setBusyId(`role-${row.user}`);
    try {
      await patchApi(`/iam/users/${row.user}/`, {
        role: ACCOUNT_ROLE[value] || 'WAREHOUSE_STAFF', role_at_site: value,
      });
      await reload(); showNotice(`${row.name || 'Employee'} role updated.`);
    } catch (err) { setError(describeError(err) || 'Could not change role.'); }
    finally { setBusyId(''); }
  };

  const saveComp = async (row) => {
    if (!compEdit || !Number(compEdit.amount)) return;
    setBusyId(`pay-${row.user}`);
    try {
      const payload = { basis: compEdit.basis, amount: Number(compEdit.amount).toFixed(2), is_active: true };
      if (compEdit.comp_id) await patchApi(`/network/payroll/${compEdit.comp_id}/`, payload);
      else await postApi('/network/payroll/', { ...payload, user: row.user, site: siteId,
        employee: (row.employee || String(row.email || '').split('@')[0]).toUpperCase().slice(0, 20),
        currency: 'INR', effective_from: new Date().toISOString().slice(0, 10) });
      setCompEdit(null); await reload(); showNotice('Pay rate saved.');
    } catch (err) { setError(describeError(err) || 'Could not save pay rate.'); }
    finally { setBusyId(''); }
  };

  const startComp = (row) => {
    const current = payByUser.get(String(row.user));
    setCompEdit({ comp_id: current?.comp_id, basis: current?.basis || (riderByUser.has(String(row.user)) ? 'PER_TASK' : 'MONTHLY'), amount: current?.amount || '' });
  };

  const removeEmployee = async (row) => {
    if (!window.confirm(`Remove ${row.name || row.email} from this store?`)) return;
    setBusyId(`remove-${row.user}`);
    try {
      await postApi(`/iam/users/${row.user}/remove/`, {});
      await reload(); showNotice('Employee removed.');
    } catch (err) { setError(describeError(err) || 'Could not remove employee.'); }
    finally { setBusyId(''); }
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

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((r) => [r.name, r.email, r.role_at_site].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [employees, employeeSearch]);
  const filteredRiders = useMemo(() => {
    const q = riderSearch.trim().toLowerCase();
    if (!q) return riders;
    return riders.filter((r) => [r.name, r.phone, r.vehicle_number, r.kyc_status]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [riders, riderSearch]);

  const exportCsv = (rows, headers, file) => {
    const csv = [headers.join(','), ...rows.map((row) => headers.map((_, i) => JSON.stringify(row[i] ?? '')).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a'); link.href = url; link.download = file; link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="vend-page">
      <div className="vend-page__head">
        <div><h1>Employee Register</h1><p>Create staff and rider logins for {site?.code || 'this store'}.</p></div>
        <div className="vend-page__context"><Pill tone="accent">{storeCode}</Pill>{site?.name && <span>{site.name}</span>}</div>
      </div>

      <div className="vend-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'employees'} className={tab === 'employees' ? 'active' : ''} onClick={() => setTab('employees')}><Users2 size={15} /> Warehouse Staff</button>
        <button type="button" role="tab" aria-selected={tab === 'riders'} className={tab === 'riders' ? 'active' : ''} onClick={() => setTab('riders')}><Bike size={15} /> Riders</button>
      </div>

      {error && <div className="vend-feedback vend-feedback--error">{error}</div>}
      {notice && <div className="vend-feedback vend-feedback--ok">{notice}</div>}
      {loading && <div className="vend-feedback">Loading staff records…</div>}

      <div className="vend-kpis">
        <div className="vend-kpi"><Users2 size={20} /><span>Staff assigned</span><strong>{employees.length}</strong></div>
        <div className="vend-kpi vend-kpi--green"><CheckCircle2 size={20} /><span>On shift</span><strong>{employees.filter((r) => r.on_shift).length}</strong></div>
        <div className="vend-kpi vend-kpi--amber"><BadgeIndianRupee size={20} /><span>Monthly pay</span><strong>{money(payroll.filter((p) => p.basis === 'MONTHLY' && p.is_active).reduce((s, p) => s + Number(p.amount || 0), 0))}</strong></div>
        <div className="vend-kpi"><Bike size={20} /><span>Riders</span><strong>{riders.length}</strong></div>
      </div>

      {tab === 'employees' ? (
        <>
          <section className="vend-card">
            <div className="vend-card__head vend-card__head--blue">
              <Users2 size={18} />
              <div><h2>Employee Registration</h2><p>Create a warehouse login, store role and pay rate in one step.</p></div>
            </div>
            <form className="vend-form" onSubmit={saveEmployee}>
              <fieldset disabled={busy}>
                <div className="vend-grid vend-grid--two">
                  <label>Full name *<input value={employeeForm.full_name} onChange={(e) => setEmployee('full_name', e.target.value)} /></label>
                  <label>Email *<input type="email" value={employeeForm.email} onChange={(e) => setEmployee('email', e.target.value)} /></label>
                  <label>Phone<input value={employeeForm.phone} onChange={(e) => setEmployee('phone', e.target.value)} /></label>
                  <label>Password *<input type="password" value={employeeForm.password} onChange={(e) => setEmployee('password', e.target.value)} /></label>
                  <label>Role at this store
                    <select value={employeeForm.role_at_site} onChange={(e) => setEmployee('role_at_site', e.target.value)}>
                      {EMPLOYEE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>Pay basis
                    <select value={employeeForm.basis} onChange={(e) => setEmployee('basis', e.target.value)}>
                      {BASSIS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </label>
                  <label>Pay amount (₹)<input type="number" min="0" step="0.01" value={employeeForm.amount} onChange={(e) => setEmployee('amount', e.target.value)} placeholder="Optional" /></label>
                </div>
                <div className="vend-form__actions"><button type="submit" className="vend-btn vend-btn--primary"><Plus size={14} /> Register Employee</button></div>
              </fieldset>
            </form>
          </section>

          <section className="vend-card">
            <div className="vend-card__head">
              <Users2 size={18} />
              <div><h2>Registered Employees</h2><p>{employees.length} assigned at this store</p></div>
              <div className="vend-card__tools">
                <div className="vend-search"><Search size={14} /><input value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} placeholder="Search staff…" /></div>
                <button type="button" className="vend-btn" onClick={() => exportCsv(filteredEmployees.map((r) => [r.name, r.email, r.role_at_site, r.on_shift ? 'ON SHIFT' : 'OFF SHIFT']), ['Name', 'Email', 'Role', 'Status'], 'employees.csv')}><Download size={14} /> Export</button>
                <button type="button" className="vend-btn" onClick={() => reload()}><RefreshCw size={14} /> Sync</button>
              </div>
            </div>
            <div className="vend-table-wrap">
              <table className="vend-table">
                <thead><tr><th>#</th><th>Employee</th><th>Role at store</th><th>Status</th><th>FIFO</th><th>Pay</th><th>Action</th></tr></thead>
                <tbody>
                  {filteredEmployees.map((row, index) => {
                    const pay = payByUser.get(String(row.user));
                    const shift = openShiftByRider.get(String(riderByUser.get(String(row.user))?.rider_id));
                    return (
                      <tr key={row.user || index}>
                        <td>{index + 1}</td>
                        <td><b>{row.name || row.employee}</b><div className="vend-mono" style={{ fontSize: 10 }}>{row.email}</div></td>
                        <td>
                          <select value={row.role_at_site || 'PICKER'} disabled={Boolean(busyId)} onChange={(e) => changeRole(row, e.target.value)} style={{ padding: '4px 6px', fontSize: 11 }}>
                            {EMPLOYEE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </td>
                        <td><Pill tone={row.on_shift || shift ? 'success' : 'neutral'}>{row.on_shift || shift ? `ON SHIFT${shift?.queue ? ` #${shift.queue}` : ''}` : 'OFF SHIFT'}</Pill></td>
                        <td>{shift?.queue ? `#${shift.queue}` : '—'}</td>
                        <td>
                          {compEdit && String(compEdit.user) === String(row.user) ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <select value={compEdit.basis} onChange={(e) => setCompEdit({ ...compEdit, basis: e.target.value })} style={{ fontSize: 10 }}>
                                {BASSIS.map((b) => <option key={b} value={b}>{b}</option>)}
                              </select>
                              <input type="number" value={compEdit.amount} onChange={(e) => setCompEdit({ ...compEdit, amount: e.target.value })} style={{ width: 80, fontSize: 11 }} />
                              <button type="button" className="vend-btn" onClick={() => saveComp(row)}>Save</button>
                              <button type="button" className="vend-btn" onClick={() => setCompEdit(null)}>×</button>
                            </div>
                          ) : (
                            <button type="button" className="vend-btn" onClick={() => { setCompEdit({ user: row.user, comp_id: pay?.comp_id, basis: pay?.basis || 'MONTHLY', amount: pay?.amount || '' }); }}>
                              {pay ? `${pay.basis} · ${money(pay.amount)}` : 'Set pay'}
                            </button>
                          )}
                        </td>
                        <td className="vend-actions">
                          {canRemove ? (
                            <button type="button" title="Remove employee" disabled={Boolean(busyId)} onClick={() => removeEmployee(row)}><Trash2 size={13} /></button>
                          ) : <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredEmployees.length && <tr><td colSpan={7} className="vend-empty">No employees assigned here yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="vend-card__foot">Showing {filteredEmployees.length} of {employees.length} employees</div>
          </section>
        </>
      ) : (
        <>
          <section className="vend-card">
            <div className="vend-card__head vend-card__head--blue">
              <Bike size={18} />
              <div><h2>Rider Registration</h2><p>Different from warehouse staff — vehicle, KYC and QR activation are tracked separately.</p></div>
              <span className="vend-card__badge">Delivery fleet</span>
            </div>
            <form className="vend-form" onSubmit={saveRider}>
              <fieldset disabled={busy}>
                <div className="vend-grid vend-grid--two">
                  <label>Full name *<input value={riderForm.full_name} onChange={(e) => setRider('full_name', e.target.value)} /></label>
                  <label>Email *<input type="email" value={riderForm.email} onChange={(e) => setRider('email', e.target.value)} /></label>
                  <label>Phone<input value={riderForm.phone} onChange={(e) => setRider('phone', e.target.value)} /></label>
                  <label>Password *<input type="password" value={riderForm.password} onChange={(e) => setRider('password', e.target.value)} /></label>
                  <label>Vehicle type
                    <select value={riderForm.vehicle_type} onChange={(e) => setRider('vehicle_type', e.target.value)}>
                      {VEHICLES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>Vehicle number<input value={riderForm.vehicle_number} onChange={(e) => setRider('vehicle_number', e.target.value)} /></label>
                  <label>KYC status
                    <select value={riderForm.kyc_status} onChange={(e) => setRider('kyc_status', e.target.value)}>
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
              <div><h2>Rider Fleet</h2><p>{riders.length} rider profile(s)</p></div>
              <div className="vend-card__tools">
                <div className="vend-search"><Search size={14} /><input value={riderSearch} onChange={(e) => setRiderSearch(e.target.value)} placeholder="Search riders…" /></div>
                <button type="button" className="vend-btn" onClick={() => exportCsv(filteredRiders.map((r) => [r.name, r.phone, r.vehicle_type, r.vehicle_number, r.kyc_status, r.is_online ? 'ONLINE' : 'OFFLINE']), ['Rider', 'Phone', 'Vehicle', 'Number', 'KYC', 'State'], 'riders.csv')}><Download size={14} /> Export</button>
              </div>
            </div>
            <div className="vend-table-wrap">
              <table className="vend-table">
                <thead><tr><th>#</th><th>Rider</th><th>Phone</th><th>Vehicle</th><th>Store</th><th>KYC</th><th>State</th><th>Action</th></tr></thead>
                <tbody>
                  {filteredRiders.map((row, index) => {
                    const shift = openShiftByRider.get(String(row.rider_id));
                    return (
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
                        <td><Pill tone={row.is_online && shift ? 'success' : 'neutral'}>{row.is_online ? (shift ? `ON SHIFT #${shift.queue}` : 'ONLINE') : 'OFFLINE'}</Pill></td>
                        <td className="vend-actions">
                          <button type="button" title="Set KYC verified" disabled={Boolean(busyId)} onClick={() => updateKyc(row, 'VERIFIED')}><ShieldCheck size={13} /></button>
                          {canRemove && (
                            <button type="button" title="Remove rider login" disabled={Boolean(busyId)} onClick={() => {
                              const user = userById.get(String(row.user));
                              if (user) removeEmployee({ user: user.user_id, name: row.name, email: user.email });
                            }}><Trash2 size={13} /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredRiders.length && <tr><td colSpan={8} className="vend-empty">No riders registered yet.</td></tr>}
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

export default function EmployeeRegisterView() {
  const { site, siteId, storeCode } = useDarkStore();
  return (
    <StoreGate>
      <Register site={site} siteId={siteId} storeCode={storeCode} />
    </StoreGate>
  );
}
