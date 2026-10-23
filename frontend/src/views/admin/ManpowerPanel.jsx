import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, LogOut, RefreshCw, UserPlus, Users } from 'lucide-react';
import { describeError, fetchApi, patchApi, postApi, unwrapList } from '../../api/client';

const MONTHS_PER_MONTH = 1;
const WEEKS_PER_MONTH = 52 / 12;
const DAYS_PER_MONTH = 26;
const HOURS_PER_DAY = 8;

/** Monthly cost of one pay rate, so hourly and daily staff can be summed. */
export function monthlyCost(rate) {
  const amount = Number(rate.amount || 0);
  switch (rate.basis) {
    case 'WEEKLY': return amount * WEEKS_PER_MONTH;
    case 'DAILY': return amount * DAYS_PER_MONTH;
    case 'HOURLY': return amount * HOURS_PER_DAY * DAYS_PER_MONTH;
    case 'PER_TASK': return 0;
    case 'MONTHLY':
    default: return amount * MONTHS_PER_MONTH;
  }
}

function minutesSince(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/**
 * Who is on the floor right now, and what the roster costs.
 *
 * The staffing board is the same data the picker screens use (site
 * assignments + open shifts), with the two admin actions that were missing:
 * clock somebody out when they forget, and take somebody off a site. Payroll
 * is read from the compensation table so the "committed per month" figure
 * matches what the Compensation tab pays.
 */
export default function ManpowerPanel({ sites = [], employees = [] }) {
  const [siteCode, setSiteCode] = useState('');
  const [rows, setRows] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({
    employee: '', user: '', site: '', mode: 'DARKHOUSE', role_at_site: 'PICKER',
  });
  const [saving, setSaving] = useState(false);

  const darkStores = useMemo(
    () => sites.filter((s) => s.site_type === 'DS' || s.site_type === 'DARK_STORE'),
    [sites],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [manpower, comp] = await Promise.all([
        fetchApi(`/network/manpower${siteCode ? `?site=${encodeURIComponent(siteCode)}` : ''}`),
        fetchApi('/network/payroll/?is_active=true&page_size=500'),
      ]);
      setRows(Array.isArray(manpower?.results) ? manpower.results : []);
      setPayroll(unwrapList(comp) || []);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [siteCode]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const rostered = rows.length;
    const onShift = rows.filter((r) => r.on_shift).length;
    const linked = rows.filter((r) => r.linked).length;
    // The payroll endpoint filters by site uuid, not code, so resolve the
    // selected store once and sum only its rates.
    const siteId = siteCode
      ? sites.find((s) => s.code === siteCode)?.site_id
      : null;
    const rates = siteId
      ? payroll.filter((rate) => String(rate.site) === String(siteId))
      : payroll;
    const monthly = rates.reduce((sum, rate) => sum + monthlyCost(rate), 0);
    const perTask = rates.filter((r) => r.basis === 'PER_TASK').length;
    return { rostered, onShift, linked, monthly, perTask };
  }, [rows, payroll, siteCode, sites]);

  const clockOut = async (row) => {
    if (!row.shift_id) return;
    setBusyKey(`${row.employee}-${row.site}`);
    setError('');
    try {
      await postApi(`/network/staff-shifts/${row.shift_id}/close/`, { reason: 'MANUAL' });
      setNotice(`${row.name || row.employee} clocked out.`);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyKey('');
    }
  };

  const removeAssignment = async (row) => {
    if (!row.assignment_id) return;
    if (!window.confirm(`Take ${row.name || row.employee} off ${row.site_code}?`)) return;
    setBusyKey(`${row.employee}-${row.site}`);
    setError('');
    try {
      await patchApi(`/network/employee-assignments/${row.assignment_id}/`,
        { is_active: false });
      setNotice(`${row.name || row.employee} removed from ${row.site_code}.`);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyKey('');
    }
  };

  const addAssignment = async () => {
    if (!draft.employee.trim() || !draft.site) {
      setError('Employee code and site are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await postApi('/network/employee-assignments/', {
        employee: draft.employee.trim().toUpperCase(),
        user: draft.user || null,
        site: draft.site,
        mode: draft.mode,
        role_at_site: draft.role_at_site,
        is_primary: false,
        is_active: true,
      });
      setShowAdd(false);
      setDraft({ employee: '', user: '', site: '', mode: 'DARKHOUSE', role_at_site: 'PICKER' });
      setNotice('Assignment added.');
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="mp-panel">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Rostered', value: summary.rostered, testid: 'mp-stat-rostered' },
          { label: 'On shift now', value: summary.onShift, testid: 'mp-stat-onshift' },
          { label: 'Linked logins', value: summary.linked, testid: 'mp-stat-linked' },
          {
            label: 'Committed / month', value: `₹${Math.round(summary.monthly).toLocaleString('en-IN')}`,
            testid: 'mp-stat-monthly',
          },
        ].map((card) => (
          <div key={card.label} className="panel" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {card.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800 }} data-testid={card.testid}>
              {loading ? '—' : card.value}
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label className="form-label" style={{ fontSize: 11 }}>Store</label>
          <select className="form-input" style={{ minWidth: 230, height: 32 }}
            data-testid="mp-site" value={siteCode} onChange={(e) => setSiteCode(e.target.value)}>
            <option value="">All sites</option>
            {darkStores.map((s) => <option key={s.site_id} value={s.code}>{s.code} — {s.name}</option>)}
          </select>
        </div>
        <button className="btn-secondary" style={{ height: 32, fontSize: 12 }}
          data-testid="mp-refresh" disabled={loading} onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="btn-primary" style={{ height: 32, fontSize: 12 }}
          data-testid="mp-add" onClick={() => { setError(''); setShowAdd((v) => !v); }}>
          <UserPlus size={13} /> Rosters staff
        </button>
        <span className="form-hint" data-testid="mp-count">
          {loading ? 'Loading…' : `${rows.length} assignment${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {(error || notice) && (
        <div className={`scan-feedback ${error ? 'scan-feedback--error' : 'scan-feedback--ok'}`}
          data-testid={error ? 'mp-error' : 'mp-notice'} style={{ marginBottom: 12 }}>
          {error || notice}
        </div>
      )}

      {showAdd && (
        <div className="panel" style={{ padding: 14, marginBottom: 14 }} data-testid="mp-add-form">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Employee code</label>
              <input className="form-input" style={{ height: 32 }} data-testid="mp-add-employee"
                value={draft.employee} placeholder="DSP470CFE"
                onChange={(e) => setDraft((d) => ({ ...d, employee: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Login (optional)</label>
              <select className="form-input" style={{ height: 32 }} data-testid="mp-add-user"
                value={draft.user} onChange={(e) => setDraft((d) => ({ ...d, user: e.target.value }))}>
                <option value="">— unlinked —</option>
                {employees.filter((e) => e.role !== 'CUSTOMER').map((e) => (
                  <option key={e.user_id} value={e.user_id}>{e.full_name || e.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Site</label>
              <select className="form-input" style={{ height: 32 }} data-testid="mp-add-site"
                value={draft.site} onChange={(e) => setDraft((d) => ({ ...d, site: e.target.value }))}>
                <option value="">— Select —</option>
                {darkStores.map((s) => <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Mode</label>
              <select className="form-input" style={{ height: 32 }} data-testid="mp-add-mode"
                value={draft.mode} onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value }))}>
                <option value="DARKHOUSE">Darkhouse</option>
                <option value="WAREHOUSE">Warehouse</option>
              </select>
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Role</label>
              <input className="form-input" style={{ height: 32 }} data-testid="mp-add-role"
                value={draft.role_at_site} placeholder="PICKER"
                onChange={(e) => setDraft((d) => ({ ...d, role_at_site: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button className="btn-primary" style={{ height: 32, fontSize: 12 }}
                data-testid="mp-add-save" disabled={saving} onClick={addAssignment}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="btn-secondary" style={{ height: 32, fontSize: 12 }}
                onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="panel" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Users size={15} color="#7c3aed" />
          <strong style={{ fontSize: 13 }}>Staffing board</strong>
        </div>
        {!loading && rows.length === 0 && (
          <div className="wf-empty" data-testid="mp-empty" style={{ padding: '18px 0' }}>
            <div className="wf-empty__title">Nobody is rostered here</div>
            <div>Add a site assignment, or pick another store.</div>
          </div>
        )}
        {rows.length > 0 && (
          <table className="data-table" data-testid="mp-table">
            <thead>
              <tr>
                <th>Employee</th><th>Person</th><th>Site</th><th>Role</th>
                <th>Shift</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.employee}-${row.site}`} data-testid={`mp-row-${row.employee}`}>
                  <td><span className="code-cell">{row.employee}</span></td>
                  <td>
                    {row.linked ? <strong>{row.name || row.email}</strong>
                      : <span style={{ color: '#94a3b8', fontSize: 11 }}>Unlinked code</span>}
                  </td>
                  <td><span className="code-cell">{row.site_code}</span></td>
                  <td style={{ fontSize: 11 }}>{row.role_at_site || '—'} <span style={{ color: '#94a3b8' }}>· {row.mode}</span></td>
                  <td>
                    {row.on_shift ? (
                      <span className="badge badge-success">
                        ON SHIFT · {Math.floor(minutesSince(row.shift_started_at) / 60)}h
                        {String(minutesSince(row.shift_started_at) % 60).padStart(2, '0')}m
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>off shift</span>
                    )}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      {row.on_shift && (
                        <button className="btn-secondary" style={{ height: 26, padding: '0 8px', fontSize: 11 }}
                          data-testid={`mp-clockout-${row.employee}`}
                          disabled={busyKey === `${row.employee}-${row.site}`}
                          onClick={() => clockOut(row)}>
                          <LogOut size={12} /> Clock out
                        </button>
                      )}
                      <button className="btn-secondary" style={{ height: 26, padding: '0 8px', fontSize: 11, color: '#b91c1c' }}
                        data-testid={`mp-remove-${row.employee}`}
                        disabled={busyKey === `${row.employee}-${row.site}`}
                        onClick={() => removeAssignment(row)}>
                        Remove
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ margin: '10px 2px 0', color: '#64748b', fontSize: 11 }}>
        <Clock size={12} style={{ verticalAlign: -2 }} /> Committed per month converts weekly, daily and hourly
        rates at 52/12 weeks, 26 days and 8 hours a day. Per-task rates are variable and excluded.
        {summary.perTask > 0 && ` ${summary.perTask} per-task rate(s) not included.`}
      </p>
    </div>
  );
}
