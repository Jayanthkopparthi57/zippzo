import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, RefreshCw, UserPlus, Users2, X } from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useDarkStore, useAsyncData, asList } from './useDarkStore';
import { fetchApi, postApi, patchApi } from '../../api/client';

function Register({ site, siteId, storeCode }) {
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', role: 'WAREHOUSE_STAFF', role_at_site: 'PICKER',
    password: '', vehicle_number: '', vehicle_type: 'BIKE',
  });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [created, setCreated] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const { data: assignments, loading, reload } = useAsyncData(
    () => fetchApi(`/network/manpower?site=${encodeURIComponent(storeCode)}`).then((r) => asList(r, '/network/manpower')),
    [storeCode],
    { pollMs: 30000 },
  );
  const { data: userRows } = useAsyncData(
    () => fetchApi('/iam/users/?page_size=500').then((r) => asList(r, '/iam/users')),
    [],
    { pollMs: 0 },
  );
  const userRoleById = useMemo(() => {
    const map = new Map();
    (userRows || []).forEach((u) => { if (u.user_id) map.set(String(u.user_id), u.role); });
    return map;
  }, [userRows]);
  const { data: riderProfiles } = useAsyncData(
    () => fetchApi('/delivery/rider-profiles/?page_size=500').then((r) => asList(r, '/delivery/rider-profiles')),
    [],
    { pollMs: 30000 },
  );
  const { data: riderShifts } = useAsyncData(
    () => fetchApi('/delivery/rider-shifts/?page_size=500').then((r) => asList(r, '/delivery/rider-shifts')),
    [],
    { pollMs: 30000 },
  );
  const { data: payrollRows, reload: reloadPayroll } = useAsyncData(
    () => fetchApi(`/network/payroll/?site=${encodeURIComponent(siteId)}&page_size=500`).then((r) => asList(r, '/network/payroll')),
    [siteId],
    { pollMs: 30000 },
  );
  const [compEdit, setCompEdit] = useState(null); // { comp_id?, user_id, employee, basis, amount }
  const [compBusy, setCompBusy] = useState(false);
  const [compError, setCompError] = useState('');
  const [editUser, setEditUser] = useState(null); // { user_id, full_name, role, role_at_site, status }
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const payByUser = useMemo(() => {
    const map = new Map();
    (payrollRows || []).forEach((p) => {
      if (!p.user) return;
      const key = String(p.user);
      const existing = map.get(key);
      if (!existing || (p.is_active && !existing.is_active)) map.set(key, p);
    });
    return map;
  }, [payrollRows]);

  const riderByUser = useMemo(() => {
    const map = new Map();
    (riderProfiles || []).forEach((r) => {
      if (r.user) map.set(String(r.user), r);
    });
    return map;
  }, [riderProfiles]);
  const openShiftByRider = useMemo(() => {
    const map = new Map();
    (riderShifts || [])
      .filter((s) => s.status === 'OPEN')
      .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))
      .forEach((s, index) => {
        if (!map.has(String(s.rider))) map.set(String(s.rider), { ...s, queue: index + 1 });
      });
    return map;
  }, [riderShifts]);
  const rows = useMemo(() => assignments || [], [assignments]);


  const saveComp = async () => {
    if (!compEdit) return;
    setCompBusy(true);
    setCompError('');
    try {
      const body = {
        basis: compEdit.basis,
        amount: Number(compEdit.amount || 0).toFixed(2),
        employee: compEdit.employee || '',
        is_active: true,
        currency: 'INR',
        effective_from: new Date().toISOString().slice(0, 10),
      };
      if (compEdit.comp_id) {
        await patchApi(`/network/payroll/${compEdit.comp_id}/`, {
          basis: body.basis,
          amount: body.amount,
          employee: body.employee,
          is_active: true,
        });
      } else {
        await postApi('/network/payroll/', {
          user: compEdit.user_id,
          site: siteId,
          ...body,
        });
      }
      setCompEdit(null);
      await reloadPayroll({ quiet: true });
    } catch (err) {
      setCompError(err?.message || 'Could not save pay.');
    } finally {
      setCompBusy(false);
    }
  };

  const set = (key) => (event) => setForm((current) => {
    const value = event.target.value;
    if (key !== 'role') return { ...current, [key]: value };
    // Keep the store-level department in step with the account type so an
    // Inbound Associate is not silently left as a PICKER assignment.
    const department = {
      PICKER: 'PICKER',
      INVENTORY_ASSOCIATE: 'INVENTORY_ASSOCIATE',
      INBOUND_ASSOCIATE: 'INBOUND_ASSOCIATE',
      PUTAWAY_ASSOCIATE: 'PUTAWAY_ASSOCIATE',
      RIDER: 'RIDER',
      WAREHOUSE_STAFF: 'PICKER',
    }[value] || 'PICKER';
    return { ...current, role: value, role_at_site: department };
  });

  const saveUserEdit = async () => {
    if (!editUser) return;
    setEditBusy(true);
    setEditError('');
    try {
      const payload = {
        role: editUser.role,
        status: editUser.status,
        role_at_site: editUser.role_at_site,
        full_name: editUser.full_name,
      };
      if (editUser.password) payload.password = editUser.password;
      await patchApi(`/iam/users/${editUser.user_id}/`, payload);
      setEditUser(null);
      await reload({ quiet: true });
    } catch (err) {
      setEditError(err?.message || 'Could not update the employee.');
    } finally {
      setEditBusy(false);
    }
  };

  const createEmployee = async (event) => {
    event.preventDefault();
    setBusy('create');
    setNotice(null);
    setCreated(null);
    try {
      const user = await postApi('/iam/users/', {
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        role: form.role,
        password: form.password,
        site_id: siteId,
        role_at_site: form.role_at_site,
      });
      let profile = null;
      if (form.role === 'RIDER') {
        const bootstrap = await postApi('/delivery/rider-profiles/admin-bootstrap/', {
          user: user.user_id,
          site_code: storeCode,
          name: form.full_name.trim(),
          phone: form.phone.trim(),
          vehicle_type: form.vehicle_type,
          vehicle_number: form.vehicle_number.trim(),
          kyc_status: 'VERIFIED',
        });
        profile = bootstrap.profile;
      }
      setCreated({ user, profile });
      setForm((current) => ({ ...current, email: '', password: '', full_name: '', phone: '', vehicle_number: '' }));
      await reload({ quiet: true });
      if (!notice) setNotice({ type: 'ok', message: `${user.full_name} registered at ${storeCode}.` });
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Could not create the employee.' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>EMPLOYEE REGISTER</span>
            <span className="screen-count-tag">{rows.length} employees</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Create staff for <StoreBadge />, set their pay — riders are stamped onto orders automatically at checkout.
          </div>
        </div>
        <div className="screen-actions">
          <button className="btn-ui primary" onClick={() => setShowForm(true)}><UserPlus size={13} /> <span>New Employee</span></button>
          <button className="btn-ui neutral" onClick={() => reload()} disabled={loading}><RefreshCw size={12} className={loading ? 'spin' : ''} /> <span>Sync</span></button>
        </div>
      </div>

      {notice && (
        <div className={notice.type === 'ok' ? 'scan-feedback scan-feedback--ok' : notice.type === 'warn' ? 'scan-feedback scan-feedback--hint' : 'scan-feedback scan-feedback--error'} style={{ marginBottom: 12 }}>
          {notice.type === 'ok' ? <Check size={14} /> : <AlertTriangle size={14} />} {notice.message}
        </div>
      )}
      {compError && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} /> {compError}
        </div>
      )}

      {showForm && (
          <div className="modal-backdrop" onClick={() => busy === 'create' ? undefined : setShowForm(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}>
          <form onSubmit={createEmployee}>
          <div className="modal-header">
            <div className="modal-title"><UserPlus size={16} /> Register employee</div>
            <button type="button" className="btn-ui neutral" onClick={() => setShowForm(false)} disabled={busy === 'create'}><X size={14} /></button>
          </div>
          <div className="form-group">
            <label className="form-label">Full name</label>
            <input className="form-input" value={form.full_name} onChange={set('full_name')} required />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={form.email} onChange={set('email')} required />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-input" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="form-group">
            <label className="form-label">Employee type</label>
            <select className="form-input" value={form.role} onChange={set('role')}>
              <option value="PICKER">Picker</option>
              <option value="INVENTORY_ASSOCIATE">Inventory Associate</option>
              <option value="INBOUND_ASSOCIATE">Inbound Associate</option>
              <option value="PUTAWAY_ASSOCIATE">Putaway Associate</option>
              <option value="WAREHOUSE_STAFF">Floor staff (legacy)</option>
              <option value="RIDER">Rider</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Role at this store</label>
            <select className="form-input" value={form.role_at_site} onChange={set('role_at_site')}>
              <option value="PICKER">Picker</option>
              <option value="PACKER">Packer / Rack drop</option>
              <option value="INVENTORY_ASSOCIATE">Inventory Associate</option>
              <option value="INBOUND_ASSOCIATE">Inbound Associate</option>
              <option value="PUTAWAY_ASSOCIATE">Putaway Associate</option>
              <option value="OPERATOR">Floor operator</option>
              <option value="RIDER">Rider</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={form.password} onChange={set('password')} required />
          </div>
          {form.role === 'RIDER' && (
            <>
              <div className="form-group">
                <label className="form-label">Vehicle type</label>
                <select className="form-input" value={form.vehicle_type} onChange={set('vehicle_type')}>
                  <option value="BIKE">Bike</option>
                  <option value="SCOOTER">Scooter</option>
                  <option value="CYCLE">Cycle</option>
                  <option value="MINI_VAN">Mini van</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Vehicle number</label>
                <input className="form-input" value={form.vehicle_number} onChange={set('vehicle_number')} />
              </div>
            </>
          )}
          <button className="btn-ui primary" type="submit" disabled={busy === 'create'}>
            {busy === 'create' ? 'Registering…' : 'Register employee'}
          </button>
          {created && (
            <div style={{ marginTop: 14, border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 12 }}>
              <strong>{created.user.full_name}</strong> · {created.user.email}
            </div>
          )}
          </form>
            </div>
          </div>
        )}

      {editUser && (
        <div className="modal-backdrop" onClick={() => editBusy ? undefined : setEditUser(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <div className="modal-title">Edit employee</div>
              <button type="button" className="btn-ui neutral" onClick={() => setEditUser(null)} disabled={editBusy}><X size={14} /></button>
            </div>
            {editError && <div className="form-error-banner">{editError}</div>}
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={editUser.full_name} onChange={(e) => setEditUser((c) => ({ ...c, full_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Role (account)</label>
              <select className="form-input" value={editUser.role} onChange={(e) => setEditUser((c) => ({ ...c, role: e.target.value }))}>
                <option value="SUPER_ADMIN">Super admin</option>
                <option value="OPS_MANAGER">Ops manager</option>
                <option value="WAREHOUSE_STAFF">Warehouse staff</option>
                <option value="RIDER">Rider</option>
                <option value="SENDER">Sender</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Role at this store</label>
              <select className="form-input" value={editUser.role_at_site} onChange={(e) => setEditUser((c) => ({ ...c, role_at_site: e.target.value }))}>
                <option value="PICKER">Picker</option>
                <option value="PACKER">Packer / Rack drop</option>
                <option value="INVENTORY_ASSOCIATE">Inventory Associate</option>
                <option value="INBOUND_ASSOCIATE">Inbound Associate</option>
                <option value="PUTAWAY_ASSOCIATE">Putaway Associate</option>
                <option value="OPERATOR">Floor operator</option>
                <option value="RIDER">Rider</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-input" value={editUser.status} onChange={(e) => setEditUser((c) => ({ ...c, status: e.target.value }))}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="BLOCKED">Blocked</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">New password (leave blank to keep)</label>
              <input className="form-input" type="password" value={editUser.password || ''} onChange={(e) => setEditUser((c) => ({ ...c, password: e.target.value }))} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-ui neutral" onClick={() => setEditUser(null)} disabled={editBusy}>Cancel</button>
              <button type="button" className="btn-ui primary" disabled={editBusy} onClick={saveUserEdit}>
                {editBusy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th><th>Role</th><th>Active</th><th>FIFO queue</th><th>Pay</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rider = row.user ? riderByUser.get(String(row.user)) : null;
              const shift = rider ? openShiftByRider.get(String(rider.rider_id)) : null;
              const active = Boolean(row.on_shift || (rider && rider.is_online && shift));
              const accountRole = userRoleById.get(String(row.user)) || '';
              const needsWarehouseOtp = accountRole !== 'RIDER' && (accountRole === 'WAREHOUSE_STAFF' || (!accountRole && row.role_at_site !== 'RIDER'));
              return (
                <tr key={row.assignment_id || row.employee}>
                  <td>
                    <strong>{row.name || row.email || '—'}</strong>
                    {row.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.email}</div>}
                    <div className="mono-num" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.employee || ''}</div>
                  </td>
                  <td>{row.role_at_site || row.role || '—'}</td>
                  <td>
                    <StatusBadge status={active ? 'ACTIVE' : 'OFFLINE'} />
                    {shift && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{new Date(shift.started_at).toLocaleString()}</div>}
                  </td>
                  <td className="mono-num">{shift ? `#${shift.queue}` : '—'}</td>
                  <td>
                    {compEdit?.user_id === String(row.user || '') ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <select className="form-input" value={compEdit.basis}
                          onChange={(e) => setCompEdit((cur) => ({ ...cur, basis: e.target.value }))}
                          style={{ padding: '3px 5px', fontSize: 11, height: 28, width: 78 }}
                        >
                          <option value="PER_TASK">Per task</option>
                          <option value="HOURLY">Hourly</option>
                          <option value="DAILY">Daily</option>
                          <option value="WEEKLY">Weekly</option>
                          <option value="MONTHLY">Monthly</option>
                        </select>
                        <input type="number" min="0" step="0.5" className="form-input mono-num" value={compEdit.amount}
                          onChange={(e) => setCompEdit((cur) => ({ ...cur, amount: e.target.value }))}
                          style={{ padding: '3px 6px', fontSize: 12, height: 28, width: 64 }} placeholder="₹" />
                        <button className="btn-ui primary" type="button" disabled={compBusy} onClick={saveComp} style={{ padding: '3px 8px', fontSize: 11, height: 28 }}>{compBusy ? 'Saving…' : 'Save'}</button>
                        <button className="btn-ui neutral" type="button" disabled={compBusy} onClick={() => setCompEdit(null)} style={{ padding: '3px 8px', fontSize: 11, height: 28 }}>Cancel</button>
                      </div>
                    ) : (() => {
                      const pay = row.user ? payByUser.get(String(row.user)) : null;
                      const isRider = accountRole === 'RIDER' || row.role_at_site === 'RIDER';
                      return pay ? (
                        <button type="button" onClick={() => setCompEdit({ comp_id: pay.comp_id, user_id: String(row.user), employee: pay.employee || row.employee || '', basis: pay.basis, amount: pay.amount })}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-primary)', textAlign: 'left' }}>
                          <span className="mono-num" style={{ fontWeight: 700 }}>₹{pay.amount}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{pay.basis === 'PER_TASK' ? '/task' : pay.basis === 'MONTHLY' ? '/mo' : `/${pay.basis.toLowerCase()}`}</span>
                        </button>
                      ) : (
                        <button type="button" onClick={() => setCompEdit({ user_id: String(row.user), employee: row.employee || '', basis: isRider ? 'PER_TASK' : 'MONTHLY', amount: '' })}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 11, textDecoration: 'underline' }}>
                          Set pay
                        </button>
                      );
                    })()}
                  </td>
 
                  <td>
                    <button type="button" className="btn-ui neutral" style={{ padding: '3px 8px', fontSize: 11, height: 28 }}
                      onClick={() => setEditUser({
                        user_id: String(row.user || ''),
                        full_name: row.name || '',
                        role: accountRole || 'WAREHOUSE_STAFF',
                        role_at_site: row.role_at_site || 'PICKER',
                        status: 'ACTIVE',
                      })}>
                      Edit
                    </button>
                  </td>

                  <td>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {needsWarehouseOtp ? 'Use shared daily OTP' : accountRole === 'RIDER' ? 'Activates by scanning the store QR' : 'No OTP (admin)'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                  <Users2 size={18} style={{ marginBottom: 4 }} />
                  <div>No employees are registered at this store yet.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EmployeeRegisterView() {
  const { site, siteId, storeCode } = useDarkStore();
  return (
    <StoreGate>
      {siteId && <Register site={site} siteId={siteId} storeCode={storeCode} />}
    </StoreGate>
  );
}
