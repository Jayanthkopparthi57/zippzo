import React, { useState, useEffect, useCallback } from 'react';
import { Users, Activity, CheckCircle2, Clock, AlertCircle, RefreshCw, LogIn, LogOut, HardHat } from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import { fetchApi, postApi, unwrapList, describeError } from '../api/client';

const DONE = new Set(['COMPLETED', 'DELIVERED', 'CLOSED', 'DONE', 'CONFIRMED']);

const ASSIGN_ENDPOINT = {
  pick: (id) => `/ds-ops/pick-tasks/${id}/assign/`,
  pack: (id) => `/ds-ops/pack-tasks/${id}/assign/`,
  putaway: (id) => `/supply/putaway-tasks/${id}/assign/`,
};

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function shortId(v) {
  return v ? String(v).slice(0, 8) : '—';
}

/**
 * Merge the four real work feeds into one assignment row set.
 *
 * Every value here is read from the API: nothing on this screen is typed in.
 * `fullId` and `kind` ride along so the row can drive a live assign/unassign
 * call back into the task's own viewset.
 */
function toAssignments(putaways, picks, packs, deliveries) {
  const rows = [];
  const push = (r) => rows.push(r);

  putaways.forEach((t) => push({
    fullId: String(t.task_id), kind: 'putaway',
    taskId: shortId(t.task_id),
    type: 'Putaway',
    refDoc: shortId(t.grn_line),
    userId: t.assigned_to,
    assignedAt: t.created_at,
    startedAt: t.started_at,
    completedAt: t.completed_at,
    status: t.status,
    units: Number(t.qty) || 0,
  }));
  picks.forEach((t) => push({
    fullId: String(t.id), kind: 'pick',
    taskId: shortId(t.id),
    type: 'Picking',
    refDoc: shortId(t.picklist_id),
    userId: t.assigned_to,
    assignedAt: t.created_at,
    startedAt: t.started_at,
    completedAt: t.completed_at,
    status: t.status,
    units: Number(t.picked_qty) || 0,
  }));
  packs.forEach((t) => push({
    fullId: String(t.id), kind: 'pack',
    taskId: shortId(t.id),
    type: 'Packing',
    refDoc: t.lpn || shortId(t.packlist_id),
    userId: t.assigned_to,
    assignedAt: t.created_at,
    startedAt: t.started_at,
    completedAt: t.completed_at,
    status: t.status,
    units: Number(t.packed_qty) || 0,
  }));
  deliveries.forEach((t) => push({
    fullId: String(t.task_id), kind: 'delivery',
    taskId: shortId(t.task_id),
    type: 'Delivery',
    refDoc: t.order_no || shortId(t.task_id),
    userId: t.assigned_to,
    assignedAt: t.created_at,
    startedAt: t.accepted_at || t.pickup_at,
    completedAt: t.delivered_at,
    status: t.status,
    units: Number(t.shipped_qty) || 0,
  }));

  return rows.sort((a, b) => String(b.assignedAt || '').localeCompare(String(a.assignedAt || '')));
}

export default function EmployeeAssignmentView({ initialTab = 'roster' }) {
  const [activeSubtab, setActiveSubtab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [activity, setActivity] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [siteOf, setSiteOf] = useState({});
  const [manpower, setManpower] = useState([]);
  const [actionBusy, setActionBusy] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        userPayload, riderPayload, putawayPayload, pickPayload, packPayload, deliveryPayload,
        shiftPayload, assignPayload, manpowerPayload,
      ] = await Promise.all([
        fetchApi('/iam/users/?page_size=500'),
        fetchApi('/delivery/rider-profiles/?page_size=500'),
        fetchApi('/supply/putaway-tasks/?page_size=500'),
        fetchApi('/ds-ops/pick-tasks/?page_size=500'),
        fetchApi('/ds-ops/pack-tasks/?page_size=500'),
        fetchApi('/delivery/delivery-tasks/?page_size=500'),
        fetchApi('/network/staff-shifts/?page_size=500'),
        fetchApi('/network/employee-assignments/?page_size=500'),
        fetchApi('/network/manpower'),
      ]);

      const userList = unwrapList(userPayload) || [];
      // DeliveryTask keys its worker by rider profile, every other feed by
      // user id, so resolve rider -> user before the rows are merged.
      const riderUser = new Map(
        (unwrapList(riderPayload) || []).map((r) => [String(r.rider_id), r.user])
      );
      const putaways = unwrapList(putawayPayload) || [];
      const picks = unwrapList(pickPayload) || [];
      const packs = unwrapList(packPayload) || [];
      const deliveries = (unwrapList(deliveryPayload) || []).map((t) => ({
        ...t,
        assigned_to: riderUser.get(String(t.rider)) || t.rider,
      }));

      // StaffShifts are ordered -started_at server-side, so the first row
      // seen for a user is their most recent shift.
      const shiftRows = unwrapList(shiftPayload) || [];
      const latestByUser = new Map();
      shiftRows.forEach((s) => {
        const key = String(s.user);
        if (!latestByUser.has(key)) latestByUser.set(key, s);
      });

      // Primary site per employee — the site a clock-in is raised against.
      const siteRows = unwrapList(assignPayload) || [];
      const siteMap = {};
      siteRows.forEach((a) => {
        const key = String(a.user);
        if (!siteMap[key] || a.is_primary) siteMap[key] = a.site_code;
      });

      setUsers(userList);
      setAssignments(toAssignments(putaways, picks, packs, deliveries));
      setShifts(latestByUser);
      setSiteOf(siteMap);
      setManpower(unwrapList(manpowerPayload) || []);

      // Per-person throughput, computed from the same rows rather than stored
      // anywhere, so the snapshot can never drift from the task feed.
      const byUser = new Map();
      const track = (id) => {
        if (!id) return null;
        if (!byUser.has(id)) {
          byUser.set(id, {
            open: 0, done: 0, picks: 0, pickUnits: 0, short: 0,
            putaway: 0, packed: 0, delivered: 0, deliverUnits: 0,
          });
        }
        return byUser.get(id);
      };

      picks.forEach((t) => {
        const a = track(t.assigned_to); if (!a) return;
        if (DONE.has(t.status)) { a.done += 1; a.picks += 1; a.pickUnits += Number(t.picked_qty) || 0; a.short += Number(t.short_qty) || 0; }
        else a.open += 1;
      });
      putaways.forEach((t) => {
        const a = track(t.assigned_to); if (!a) return;
        if (DONE.has(t.status)) { a.done += 1; a.putaway += 1; } else a.open += 1;
      });
      packs.forEach((t) => {
        const a = track(t.assigned_to); if (!a) return;
        if (DONE.has(t.status)) { a.done += 1; a.packed += Number(t.packed_qty) || 0; } else a.open += 1;
      });
      deliveries.forEach((t) => {
        const a = track(t.assigned_to); if (!a) return;
        if (DONE.has(t.status)) { a.done += 1; a.delivered += 1; a.deliverUnits += Number(t.shipped_qty) || 0; } else a.open += 1;
      });

      setActivity(byUser);
    } catch (err) {
      setError(describeError(err));
      setUsers([]);
      setAssignments([]);
      setActivity(null);
      setShifts(new Map());
      setSiteOf({});
      setManpower([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const nameOf = (id) => {
    if (!id) return 'Unassigned';
    const u = users.find((x) => String(x.user_id) === String(id));
    return u ? (u.full_name || u.email) : 'Unassigned';
  };

  /* ── Clock in / clock out ── */
  const clockAction = async (u, shift) => {
    setActionBusy(String(u.user_id));
    setActionError('');
    try {
      if (shift && String(shift.status).toUpperCase() === 'OPEN') {
        await postApi(`/network/staff-shifts/${shift.shift_id}/close/`, { reason: 'MANUAL' });
      } else {
        const site = siteOf[String(u.user_id)];
        if (!site) {
          setActionError(`${u.full_name || u.email} has no assigned site to clock in at. Assign them on the facility first.`);
          return;
        }
        await postApi('/network/staff-shifts/open/', {
          user: String(u.user_id),
          site_code: site,
          role_at_site: u.role,
        });
      }
      await load();
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setActionBusy('');
    }
  };

  /* ── Assign / unassign a task ── */
  const assignTask = async (row, userId) => {
    if (!row.kind || !ASSIGN_ENDPOINT[row.kind]) return;
    setActionBusy(row.fullId);
    setActionError('');
    try {
      await postApi(ASSIGN_ENDPOINT[row.kind](row.fullId), { user: userId || null });
      await load();
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setActionBusy('');
    }
  };

  const staff = users.filter((u) => u.role !== 'CUSTOMER');

  const rosterData = staff.map((u) => {
    const a = (activity && activity.get(u.user_id)) || null;
    const shift = shifts.get(String(u.user_id)) || null;
    const isOpen = shift && String(shift.status).toUpperCase() === 'OPEN';
    return {
      raw: u,
      shift,
      isOpen,
      code: shortId(u.user_id),
      name: u.full_name || u.email,
      email: u.email,
      role: u.role,
      status: u.status,
      site: siteOf[String(u.user_id)] || '—',
      shiftState: shift ? (isOpen ? 'ON SHIFT' : 'ENDED') : 'NO SHIFT',
      shiftSince: isOpen ? when(shift.started_at) : (shift ? when(shift.started_at) : '—'),
      open: a ? a.open : 0,
      done: a ? a.done : 0,
      lastSeen: u.last_login_at,
    };
  });

  const taskData = assignments.map((t) => ({
    ...t,
    employee: nameOf(t.userId),
    assignedAt: when(t.assignedAt),
    completedAt: when(t.completedAt),
  }));

  const productivityData = staff
    .map((u) => ({ user: u, a: activity && activity.get(u.user_id) }))
    .filter((r) => r.a && (r.a.done > 0 || r.a.open > 0))
    .map(({ user, a }) => ({
      employee: user.full_name || user.email,
      picks: `${a.picks} (${a.pickUnits} units)`,
      putaway: a.putaway,
      packed: a.packed,
      delivered: `${a.delivered} (${a.deliverUnits} parcels)`,
      short: a.short,
      open: a.open,
    }));

  const stateBadge = (status) => {
    const s = String(status || '').toUpperCase();
    const cls = DONE.has(s) ? 'badge badge-success'
      : ['ASSIGNED', 'STARTED', 'IN_PROGRESS', 'PICKING', 'PACKING', 'ACCEPTED', 'OFFERED', 'PICKED_UP'].includes(s)
        ? 'badge badge-info' : 'badge badge-warning';
    return <span className={cls}>{s || '—'}</span>;
  };

  if (loading) {
    return <div data-testid="emp-loading" style={{ padding: 40, textAlign: 'center' }}>Loading employee activity…</div>;
  }

  return (
    <div className="view-container">
      {error && (
        <div data-testid="emp-load-error" role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} /> {error}
          <button className="btn btn-secondary" style={{ marginLeft: 12, fontSize: 12 }} onClick={load}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}
      {actionError && (
        <div data-testid="emp-action-error" role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} /> {actionError}
        </div>
      )}

      {/* Subtabs Bar */}
      <div className="subtabs-bar">
        <button data-testid="emp-tab-roster" className={`subtab-btn ${activeSubtab === 'roster' ? 'active' : ''}`} onClick={() => setActiveSubtab('roster')}>
          <Users size={14} /> Shift Roster ({rosterData.length})
        </button>
        <button data-testid="emp-tab-tasks" className={`subtab-btn ${activeSubtab === 'tasks' ? 'active' : ''}`} onClick={() => setActiveSubtab('tasks')}>
          <Clock size={14} /> Task Assignments ({taskData.length})
        </button>
        <button data-testid="emp-tab-productivity" className={`subtab-btn ${activeSubtab === 'productivity' ? 'active' : ''}`} onClick={() => setActiveSubtab('productivity')}>
          <Activity size={14} /> Productivity Snapshot
        </button>
        <button data-testid="emp-tab-manpower" className={`subtab-btn ${activeSubtab === 'manpower' ? 'active' : ''}`} onClick={() => setActiveSubtab('manpower')}>
          <HardHat size={14} /> Manpower ({manpower.length})
        </button>
        <button className="subtab-btn" data-testid="emp-refresh" onClick={load} style={{ marginLeft: 'auto' }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* ═══ TAB 1: SHIFT ROSTER — live attendance + clock in/out ═══ */}
      {activeSubtab === 'roster' && (
        <DataTable
          data-testid="emp-roster"
          title="Shift Roster"
          subtitle="Clock-in/clock-out attendance with live open and completed work per employee"
          columns={[
            { header: 'Employee', key: 'name', render: r => <strong>{r.name}</strong> },
            { header: 'Sign-in', key: 'email', render: r => <span style={{ fontSize: 12, color: '#64748b' }}>{r.email}</span> },
            { header: 'Assigned Role', key: 'role', render: r => <span className="badge badge-purple">{String(r.role).replace(/_/g, ' ')}</span> },
            { header: 'Site', key: 'site', render: r => <span className="code-cell">{r.site}</span> },
            { header: 'Shift', key: 'shiftState', render: r => (
              <span data-testid={`emp-shift-state-${r.code}`}
                className={`badge ${r.isOpen ? 'badge-success' : r.shift ? 'badge-default' : 'badge-warning'}`}>
                {r.shiftState}
              </span>
            )},
            { header: 'Since', key: 'shiftSince', render: r => <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{r.shiftSince}</span> },
            { header: 'Open Tasks', key: 'open', render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.open}</span> },
            { header: 'Completed', key: 'done', render: r => (
              <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={12} /> {r.done}
              </span>
            )},
            { header: 'Clock', key: 'clock', render: r => (
              <button
                className={r.isOpen ? 'btn-secondary' : 'btn-primary'}
                data-testid={`emp-clock-${r.code}`}
                disabled={actionBusy === String(r.raw.user_id) || r.status !== 'ACTIVE'}
                style={{ height: 26, padding: '0 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => clockAction(r.raw, r.shift)}>
                {actionBusy === String(r.raw.user_id) ? '…' : r.isOpen
                  ? <><LogOut size={12} /> Clock Out</>
                  : <><LogIn size={12} /> Clock In</>}
              </button>
            )},
            { header: 'Account', key: 'status', render: r => stateBadge(r.status) },
          ]}
          data={rosterData}
        />
      )}

      {/* ═══ TAB 2: TASK ASSIGNMENTS — live assign / unassign ═══ */}
      {activeSubtab === 'tasks' && (
        <DataTable
          data-testid="emp-tasks"
          title="Warehouse Task Assignments"
          subtitle="Putaway, picking, packing and delivery work — reassign open tasks from this board"
          columns={[
            { header: 'Task', key: 'taskId', render: r => <span className="code-cell">{r.taskId}</span> },
            { header: 'Type', key: 'type', render: r => <span className="badge badge-info">{r.type}</span> },
            { header: 'Reference', key: 'refDoc', render: r => <strong>{r.refDoc}</strong> },
            { header: 'Assigned Employee', key: 'employee', render: r => <span>{r.employee}</span> },
            { header: 'Created', key: 'assignedAt', render: r => <span style={{ fontSize: 12 }}>{r.assignedAt}</span> },
            { header: 'Completed', key: 'completedAt', render: r => <span style={{ fontSize: 12, fontWeight: 600 }}>{r.completedAt}</span> },
            { header: 'Status', key: 'status', render: r => stateBadge(r.status) },
            { header: 'Actions', key: 'actions', render: (r, idx) => {
              const assignable = !!ASSIGN_ENDPOINT[r.kind];
              const terminal = DONE.has(String(r.status).toUpperCase()) || String(r.status).toUpperCase() === 'CANCELLED';
              if (!assignable) return <span style={{ fontSize: 11, color: '#94a3b8' }}>Rider flow</span>;
              return (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                  <select
                    className="form-input"
                    data-testid={`emp-task-assign-${idx}`}
                    disabled={terminal || actionBusy === r.fullId}
                    value={r.userId ? String(r.userId) : ''}
                    onChange={(e) => assignTask(r, e.target.value)}
                    style={{ height: 26, fontSize: 11, padding: '0 6px', minWidth: 140 }}>
                    <option value="">— Unassigned —</option>
                    {staff.map((u) => (
                      <option key={u.user_id} value={String(u.user_id)}>{u.full_name || u.email}</option>
                    ))}
                  </select>
                  {actionBusy === r.fullId && <span style={{ fontSize: 11 }}>…</span>}
                </span>
              );
            }},
          ]}
          data={taskData}
        />
      )}

      {/* ═══ TAB 3: PRODUCTIVITY SNAPSHOT ═══ */}
      {activeSubtab === 'productivity' && (
        <DataTable
          data-testid="emp-productivity"
          title="Productivity Snapshot"
          subtitle="Throughput counted from completed tasks — picks, putaways, packed units and deliveries"
          columns={[
            { header: 'Employee', key: 'employee', render: r => <strong>{r.employee}</strong> },
            { header: 'Picks Completed', key: 'picks', render: r => <span>{r.picks}</span> },
            { header: 'Putaway Tasks', key: 'putaway', render: r => <span>{r.putaway}</span> },
            { header: 'Units Packed', key: 'packed', render: r => <span>{r.packed}</span> },
            { header: 'Deliveries', key: 'delivered', render: r => <span>{r.delivered}</span> },
            { header: 'Still Open', key: 'open', render: r => (
              <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Clock size={11} /> {r.open}
              </span>
            )},
            { header: 'Short Picks', key: 'short', render: r => (
              <strong style={{ color: Number(r.short) > 0 ? '#d97706' : '#059669' }}>{r.short}</strong>
            )},
          ]}
          data={productivityData}
        />
      )}

      {/* ═══ TAB 4: MANPOWER — active staffing + live clock-in state ═══ */}
      {activeSubtab === 'manpower' && (
        <div data-testid="emp-manpower">
          <DataTable
            title="Manpower"
            subtitle="Active site assignments joined to live clock-ins — who is rostered where, and who is on shift right now"
            columns={[
              { header: 'Employee', key: 'person', render: r => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <strong>{r.name || r.email || r.employee}</strong>
                  {!r.linked && (
                    <span className="badge badge-warning" data-testid={`emp-manpower-unlinked-${r.employee}`}>UNLINKED</span>
                  )}
                </span>
              )},
              { header: 'Code', key: 'employee', render: r => <span className="code-cell">{r.employee}</span> },
              { header: 'Site', key: 'site_code', render: r => <span className="code-cell">{r.site_code}</span> },
              { header: 'Role', key: 'role_at_site', render: r => (
                <span className="badge badge-purple">{r.role_at_site || '—'}</span>
              )},
              { header: 'Mode', key: 'mode', render: r => <span className="badge badge-info">{r.mode}</span> },
              { header: 'Primary', key: 'is_primary', render: r => (
                r.is_primary ? <span className="badge badge-success">PRIMARY</span> : <span style={{ color: '#94a3b8' }}>—</span>
              )},
              { header: 'Clock', key: 'on_shift', render: r => (
                <span data-testid={`emp-manpower-shift-${r.employee}`}
                  className={`badge ${r.on_shift ? 'badge-success' : 'badge-default'}`}>
                  {r.on_shift ? 'ON SHIFT' : 'OFF'}
                </span>
              )},
              { header: 'Since', key: 'since', render: r => (
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{r.since}</span>
              )},
            ]}
            data={manpower.map((m, idx) => ({
              ...m,
              person: m.name || m.email || m.employee || String(idx),
              since: m.on_shift ? when(m.shift_started_at) : '—',
            }))}
          />
        </div>
      )}
    </div>
  );
}
