import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download, Pencil, Plus, RefreshCw, Search, Trash2, Users2,
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
  STORE_MANAGER: 'OPS_MANAGER',
};
const BASIS = ['PER_TASK', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'];
const emptyEmployee = () => ({
  full_name: '', email: '', phone: '', password: '',
  role_at_site: 'PICKER', basis: 'MONTHLY', amount: '',
});
const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Register({ siteId, storeCode }) {
  const { user: currentUser } = useAuth();
  const canRemove = Boolean(currentUser?.is_super_admin || currentUser?.is_admin);
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [form, setForm] = useState(emptyEmployee());
  const [compEdit, setCompEdit] = useState(null);
  const [search, setSearch] = useState('');

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [people, userRows, payRows, shiftRows] = await Promise.all([
        fetchApi(`/network/manpower?site=${encodeURIComponent(storeCode)}`),
        fetchApi('/iam/users/'),
        fetchApi(`/network/payroll/?site=${encodeURIComponent(siteId)}&page_size=500`),
        fetchApi('/delivery/rider-shifts/?page_size=500'),
      ]);
      setEmployees(Array.isArray(people) ? people : (people?.results || []));
      setUsers(Array.isArray(userRows) ? userRows : []);
      setPayroll(Array.isArray(payRows) ? payRows : []);
      setShifts(Array.isArray(shiftRows) ? shiftRows : []);
    } catch (err) {
      setError(describeError(err) || 'Could not load employee records.');
    } finally { setLoading(false); }
  }, [storeCode, siteId]);

  useEffect(() => { reload(); }, [reload]);

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  };
  const payByUser = useMemo(() => {
    const map = new Map();
    payroll.forEach((p) => {
      if (!p.user) return;
      const old = map.get(String(p.user));
      if (!old || (p.is_active && !old.is_active)) map.set(String(p.user), p);
    });
    return map;
  }, [payroll]);
  const openShifts = useMemo(() => {
    const map = new Map();
    shifts.filter((s) => s.status === 'OPEN')
      .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))
      .forEach((s, i) => { if (!map.has(String(s.user))) map.set(String(s.user), { ...s, queue: i + 1 }); });
    return map;
  }, [shifts]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((r) => [r.name, r.email, r.role_at_site].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [employees, search]);

  const saveEmployee = async (event) => {
    event.preventDefault();
    if (!form.full_name.trim() || !form.email.trim() || !form.password.trim()) {
      setError('Name, email and password are required.'); return;
    }
    setBusy(true); setError('');
    try {
      const created = await postApi('/iam/users/', {
        email: form.email, full_name: form.full_name, phone: form.phone, password: form.password,
        role: ACCOUNT_ROLE[form.role_at_site] || 'WAREHOUSE_STAFF',
        role_at_site: form.role_at_site, site_id: siteId,
      });
      if (Number(form.amount) > 0) {
        await postApi('/network/payroll/', {
          user: created.user_id, site: siteId,
          employee: form.email.split('@')[0].toUpperCase().slice(0, 20),
          basis: form.basis, amount: Number(form.amount).toFixed(2),
          currency: 'INR', effective_from: new Date().toISOString().slice(0, 10), is_active: true,
        });
      }
      setForm(emptyEmployee()); await reload(); showNotice('Employee registered.');
    } catch (err) { setError(describeError(err) || 'Could not register employee.'); }
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
      else await postApi('/network/payroll/', {
        ...payload, user: row.user, site: siteId,
        employee: (row.employee || String(row.email || '').split('@')[0]).toUpperCase().slice(0, 20),
        currency: 'INR', effective_from: new Date().toISOString().slice(0, 10),
      });
      setCompEdit(null); await reload(); showNotice('Pay rate saved.');
    } catch (err) { setError(describeError(err) || 'Could not save pay rate.'); }
    finally { setBusyId(''); }
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
      {loading && <div className="vend-feedback">Loading employee records…</div>}

      <section className="vend-card">
        <div className="vend-card__head vend-card__head--blue">
          <Users2 size={18} />
          <div><h2>Employee Registration</h2><p>Create a staff login, store role and pay rate for {storeCode}.</p></div>
        </div>
        <form className="vend-form" onSubmit={saveEmployee}>
          <fieldset disabled={busy}>
            <div className="vend-grid vend-grid--two">
              <label>Full name *<input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
              <label>Email *<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label>Password *<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
              <label>Role at this store
                <select value={form.role_at_site} onChange={(e) => setForm({ ...form, role_at_site: e.target.value })}>
                  {EMPLOYEE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>Pay basis
                <select value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })}>
                  {BASIS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
              <label>Pay amount (₹)<input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Optional" /></label>
            </div>
            <div className="vend-form__actions"><button type="submit" className="vend-btn vend-btn--primary"><Plus size={14} /> Register Employee</button></div>
          </fieldset>
        </form>
      </section>

      <section className="vend-card">
        <div className="vend-card__head">
          <Users2 size={18} />
          <div><h2>Employee Details</h2><p>{employees.length} employee(s) assigned here</p></div>
          <div className="vend-card__tools">
            <div className="vend-search"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…" /></div>
            <button type="button" className="vend-btn" onClick={() => exportCsv(filtered.map((r) => [r.name, r.email, r.role_at_site, r.on_shift ? 'ON SHIFT' : 'OFF SHIFT']), ['Name', 'Email', 'Role', 'Status'], 'employees.csv')}><Download size={14} /> Export</button>
            <button type="button" className="vend-btn" onClick={() => reload()}><RefreshCw size={14} /> Sync</button>
          </div>
        </div>
        <div className="vend-table-wrap">
          <table className="vend-table">
            <thead><tr><th>#</th><th>Employee</th><th>Role at store</th><th>Status</th><th>Pay</th><th>Action</th></tr></thead>
            <tbody>
              {filtered.map((row, index) => {
                const pay = payByUser.get(String(row.user));
                const shift = openShifts.get(String(row.user));
                return (
                  <tr key={row.user || index}>
                    <td>{index + 1}</td>
                    <td><b>{row.name || row.employee}</b><div className="vend-mono" style={{ fontSize: 10 }}>{row.email}</div></td>
                    <td>
                      <select value={row.role_at_site || 'PICKER'} disabled={Boolean(busyId)} onChange={(e) => changeRole(row, e.target.value)} style={{ padding: '4px 6px', fontSize: 11 }}>
                        {EMPLOYEE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td>{row.on_shift || shift ? `ON SHIFT${shift?.queue ? ` #${shift.queue}` : ''}` : 'OFF SHIFT'}</td>
                    <td>
                      {compEdit && String(compEdit.user) === String(row.user) ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <select value={compEdit.basis} onChange={(e) => setCompEdit({ ...compEdit, basis: e.target.value })} style={{ fontSize: 10 }}>
                            {BASIS.map((b) => <option key={b} value={b}>{b}</option>)}
                          </select>
                          <input type="number" value={compEdit.amount} onChange={(e) => setCompEdit({ ...compEdit, amount: e.target.value })} style={{ width: 80, fontSize: 11 }} />
                          <button type="button" className="vend-btn" onClick={() => saveComp(row)}>Save</button>
                          <button type="button" className="vend-btn" onClick={() => setCompEdit(null)}>×</button>
                        </div>
                      ) : (
                        <button type="button" className="vend-btn" onClick={() => setCompEdit({ user: row.user, comp_id: pay?.comp_id, basis: pay?.basis || 'MONTHLY', amount: pay?.amount || '' })}>
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
              {!filtered.length && <tr><td colSpan={6} className="vend-empty">No employees assigned here yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="vend-card__foot">Showing {filtered.length} of {employees.length} employees</div>
      </section>
    </div>
  );
}

export default function EmployeeRegisterView() {
  const { siteId, storeCode } = useDarkStore();
  return (
    <StoreGate>
      <Register siteId={siteId} storeCode={storeCode} />
    </StoreGate>
  );
}
