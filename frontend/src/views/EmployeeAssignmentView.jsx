import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserCheck, Calendar, Activity, CheckCircle2, Clock, AlertCircle, RefreshCw, WifiOff } from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import { fetchApi, unwrapList, describeError } from '../api/client';

const DONE = new Set(['COMPLETED', 'DELIVERED', 'CLOSED', 'DONE']);

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
 * The previous revision rendered three hard-coded arrays (fictitious
 * employees, tasks and accuracy percentages) with no request at all.
 */
function toAssignments(putaways, picks, packs, deliveries) {
  const rows = [];
  const push = (r) => rows.push(r);

  putaways.forEach((t) => push({
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
    taskId: shortId(t.id),
    type: 'Packing',
    refDoc: t.lpn || shortId(t.packlist_id),
    userId: t.assigned_to,
    assignedAt: t.created_at,
    startedAt: null,
    completedAt: t.completed_at,
    status: t.status,
    units: Number(t.packed_qty) || 0,
  }));
  deliveries.forEach((t) => push({
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        userPayload, riderPayload, putawayPayload, pickPayload, packPayload, deliveryPayload,
      ] = await Promise.all([
        fetchApi('/iam/users/?page_size=500'),
        fetchApi('/delivery/rider-profiles/?page_size=500'),
        fetchApi('/supply/putaway-tasks/?page_size=500'),
        fetchApi('/ds-ops/pick-tasks/?page_size=500'),
        fetchApi('/ds-ops/pack-tasks/?page_size=500'),
        fetchApi('/delivery/delivery-tasks/?page_size=500'),
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

      setUsers(userList);
      setAssignments(toAssignments(putaways, picks, packs, deliveries));

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

  const staff = users.filter((u) => u.role !== 'CUSTOMER');

  const rosterData = staff.map((u) => {
    const a = (activity && activity.get(u.user_id)) || null;
    return {
      code: shortId(u.user_id),
      name: u.full_name || u.email,
      email: u.email,
      role: u.role,
      status: u.status,
      open: a ? a.open : 0,
      done: a ? a.done : 0,
      lastSeen: u.last_login_at,
    };
  });

  const taskData = assignments.map((t) => ({
    taskId: t.taskId,
    type: t.type,
    refDoc: t.refDoc,
    employee: nameOf(t.userId),
    assignedAt: when(t.assignedAt),
    completedAt: when(t.completedAt),
    status: t.status,
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
        <button className="subtab-btn" onClick={load} style={{ marginLeft: 'auto' }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* ═══ TAB 1: SHIFT ROSTER ═══ */}
      {activeSubtab === 'roster' && (
        <DataTable
          data-testid="emp-roster"
          title="Shift Roster"
          subtitle="Staff accounts on the network, with their live open and completed work"
          columns={[
            { header: 'Employee', key: 'name', render: r => <strong>{r.name}</strong> },
            { header: 'Sign-in', key: 'email', render: r => <span style={{ fontSize: 12, color: '#64748b' }}>{r.email}</span> },
            { header: 'Assigned Role', key: 'role', render: r => <span className="badge badge-purple">{String(r.role).replace(/_/g, ' ')}</span> },
            { header: 'Last Sign-in', key: 'lastSeen', render: r => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.lastSeen ? when(r.lastSeen) : <WifiOff size={12} />}</span> },
            { header: 'Open Tasks', key: 'open', render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.open}</span> },
            { header: 'Completed', key: 'done', render: r => (
              <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={12} /> {r.done}
              </span>
            )},
            { header: 'Account', key: 'status', render: r => stateBadge(r.status) },
          ]}
          data={rosterData}
        />
      )}

      {/* ═══ TAB 2: TASK ASSIGNMENTS ═══ */}
      {activeSubtab === 'tasks' && (
        <DataTable
          data-testid="emp-tasks"
          title="Warehouse Task Assignments"
          subtitle="Putaway, picking, packing and delivery work as it stands in the API right now"
          columns={[
            { header: 'Task', key: 'taskId', render: r => <span className="code-cell">{r.taskId}</span> },
            { header: 'Type', key: 'type', render: r => <span className="badge badge-info">{r.type}</span> },
            { header: 'Reference', key: 'refDoc', render: r => <strong>{r.refDoc}</strong> },
            { header: 'Assigned Employee', key: 'employee', render: r => <span>{r.employee}</span> },
            { header: 'Created', key: 'assignedAt', render: r => <span style={{ fontSize: 12 }}>{r.assignedAt}</span> },
            { header: 'Completed', key: 'completedAt', render: r => <span style={{ fontSize: 12, fontWeight: 600 }}>{r.completedAt}</span> },
            { header: 'Status', key: 'status', render: r => stateBadge(r.status) },
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
            { header: 'Short Picks', key: 'short', render: r => (
              <strong style={{ color: Number(r.short) > 0 ? '#d97706' : '#059669' }}>{r.short}</strong>
            )},
          ]}
          data={productivityData}
        />
      )}
    </div>
  );
}
