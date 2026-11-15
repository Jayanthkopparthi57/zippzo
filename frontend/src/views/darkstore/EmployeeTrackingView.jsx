import React, { useMemo } from 'react';
import { RefreshCw, AlertTriangle, Users2 } from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useDarkStore, useAsyncData, asList } from './useDarkStore';
import { fetchApi } from '../../api/client';

const dateOf = (value) => (value ? new Date(value) : null);
const within = (value, start) => {
  const date = dateOf(value);
  return Boolean(date && date >= start);
};
const startOfWeek = (now) => {
  const date = new Date(now);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
};
const startOfMonth = (now) => {
  const date = new Date(now);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
};
const money = (value) => `₹${Number(value || 0).toFixed(2)}`;
const avgMinutes = (rows) => {
  const durations = rows
    .map((row) => {
      const start = dateOf(row.started_at || row.accepted_at || row.created_at);
      const end = dateOf(row.completed_at || row.delivered_at);
      return start && end ? (end - start) / 60000 : null;
    })
    .filter((value) => value != null && value >= 0);
  if (!durations.length) return null;
  return durations.reduce((sum, value) => sum + value, 0) / durations.length;
};
const formatAvg = (minutes) => {
  if (minutes == null) return '—';
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}s`;
  if (minutes < 60) return `${minutes.toFixed(0)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
};
const taskOwner = (task) => String(task.completed_by || task.assigned_to || task.user || '');
const distinct = (rows, key) => new Set(rows.map((row) => String(row[key])).filter(Boolean)).size;

function Tracking({ storeCode, siteId }) {
  const { data: assignments, error, loading, reload } = useAsyncData(
    () => fetchApi(`/network/manpower?site=${encodeURIComponent(storeCode)}`).then((r) => asList(r, '/network/manpower')),
    [storeCode],
    { pollMs: 30000 },
  );
  const { data: productivity } = useAsyncData(
    () => fetchApi('/workforce/productivity/?page_size=1000').then((r) => asList(r, '/workforce/productivity')),
    [],
    { pollMs: 60000 },
  );
  const { data: work } = useAsyncData(
    () => fetchApi('/workforce/work-assignments/?page_size=1000').then((r) => asList(r, '/workforce/work-assignments')),
    [],
    { pollMs: 60000 },
  );
  const { data: pickTasks } = useAsyncData(
    () => fetchApi('/ds-ops/pick-tasks/?page_size=1000').then((r) => asList(r, '/ds-ops/pick-tasks')),
    [],
    { pollMs: 60000 },
  );
  const { data: packTasks } = useAsyncData(
    () => fetchApi('/ds-ops/pack-tasks/?page_size=1000').then((r) => asList(r, '/ds-ops/pack-tasks')),
    [],
    { pollMs: 60000 },
  );
  const { data: deliveryTasks } = useAsyncData(
    () => fetchApi(`/delivery/delivery-tasks/?site=${encodeURIComponent(siteId)}&page_size=1000`).then((r) => asList(r, '/delivery/delivery-tasks')),
    [siteId],
    { pollMs: 60000 },
  );
  const { data: riderProfiles } = useAsyncData(
    () => fetchApi('/delivery/rider-profiles/?page_size=500').then((r) => asList(r, '/delivery/rider-profiles')),
    [],
    { pollMs: 60000 },
  );
  const { data: riderShifts } = useAsyncData(
    () => fetchApi('/delivery/rider-shifts/?page_size=500').then((r) => asList(r, '/delivery/rider-shifts')),
    [],
    { pollMs: 0 },
  );
  const { data: earnings } = useAsyncData(
    () => fetchApi('/money/rider-earnings/?page_size=1000').then((r) => asList(r, '/money/rider-earnings')),
    [],
    { pollMs: 60000 },
  );
  const { data: payroll } = useAsyncData(
    () => fetchApi(`/network/payroll/?site=${encodeURIComponent(siteId)}&is_active=true&page_size=500`).then((r) => asList(r, '/network/payroll')),
    [siteId],
    { pollMs: 0 },
  );
  const { data: staffShifts } = useAsyncData(
    () => fetchApi(`/network/staff-shifts/?site=${encodeURIComponent(siteId)}&page_size=500`).then((r) => asList(r, '/network/staff-shifts')),
    [siteId],
    { pollMs: 0 },
  );

  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const latestRollup = useMemo(() => {
    const map = new Map();
    [...(productivity || [])]
      .sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)))
      .forEach((row) => { if (row.user && !map.has(row.user)) map.set(row.user, row); });
    return map;
  }, [productivity]);

  const latestWork = useMemo(() => {
    const map = new Map();
    [...(work || [])]
      .filter((task) => ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(task.status))
      .sort((a, b) => String(b.assigned_at).localeCompare(String(a.assigned_at)))
      .forEach((task) => { if (task.user && !map.has(task.user)) map.set(task.user, task); });
    return map;
  }, [work]);

  const riderByUser = useMemo(() => {
    const map = new Map();
    (riderProfiles || []).forEach((r) => { if (r.user) map.set(String(r.user), r); });
    return map;
  }, [riderProfiles]);

  const queue = useMemo(() => {
    const open = (riderShifts || [])
      .filter((s) => s.status === 'OPEN' && String(s.site) === String(siteId))
      .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
    return new Map(open.map((s, index) => [String(s.rider), index + 1]));
  }, [riderShifts, siteId]);

  const metrics = useMemo(() => {
    const completedPicks = (pickTasks || []).filter((t) => t.status === 'COMPLETED');
    const completedPacks = (packTasks || []).filter((t) => t.status === 'COMPLETED');
    const delivered = (deliveryTasks || []).filter((t) => t.status === 'DELIVERED');
    const earningsRows = earnings || [];
    const compByUser = new Map((payroll || []).map((r) => [String(r.user), r]));

    return Object.fromEntries((assignments || []).map((a) => {
      const userId = String(a.user || '');
      const rider = a.user ? riderByUser.get(String(a.user)) : null;
      const riderId = rider ? String(rider.rider_id) : null;
      const isRider = a.role_at_site === 'RIDER' || Boolean(rider);
      const myPicks = completedPicks.filter((t) => taskOwner(t) === userId);
      const myPacks = completedPacks.filter((t) => taskOwner(t) === userId);
      const myDeliveries = riderId
        ? delivered.filter((t) => String(t.rider) === riderId)
        : [];
      const myWork = (work || []).filter((t) => String(t.user) === userId && t.status === 'COMPLETED');
      const comp = compByUser.get(userId) || null;
      const shifts = (staffShifts || []).filter((s) => String(s.user) === userId);
      const hoursBetween = (start, source = shifts) => source
        .filter((s) => within(s.started_at, start))
        .reduce((sum, s) => {
          const end = dateOf(s.ended_at || new Date());
          const begin = dateOf(s.started_at);
          return sum + (begin && end ? Math.max(0, (end - begin) / 3600000) : 0);
        }, 0);
      const riderEarn = riderId ? earningsRows.filter((e) => String(e.rider) === riderId) : [];
      const sumEarned = (rows) => rows.reduce((sum, e) => sum + Number(e.amount || 0) + Number(e.tips || 0), 0);
      const weeklyEarned = isRider
        ? sumEarned(riderEarn.filter((e) => within(e.created_at, weekStart)))
        : myWork.concat(myPicks, myPacks)
          .filter((t) => within(t.completed_at, weekStart))
          .length * Number(comp?.basis === 'PER_TASK' ? comp.amount || 0 : 0)
          + (comp?.basis === 'HOURLY' ? hoursBetween(weekStart) * Number(comp.amount || 0) : 0)
          + (comp?.basis === 'DAILY' ? new Set(shifts.filter((s) => within(s.started_at, weekStart)).map((s) => String(s.started_at).slice(0, 10))).size * Number(comp.amount || 0) : 0);
      const monthlyEarned = isRider
        ? sumEarned(riderEarn.filter((e) => within(e.created_at, monthStart)))
        : (comp?.basis === 'MONTHLY' ? Number(comp.amount || 0) : 0)
          + myWork.concat(myPicks, myPacks)
            .filter((t) => within(t.completed_at, monthStart))
            .length * Number(comp?.basis === 'PER_TASK' ? comp.amount || 0 : 0)
          + (comp?.basis === 'HOURLY' ? hoursBetween(monthStart) * Number(comp.amount || 0) : 0)
          + (comp?.basis === 'DAILY' ? new Set(shifts.filter((s) => within(s.started_at, monthStart)).map((s) => String(s.started_at).slice(0, 10))).size * Number(comp.amount || 0) : 0);
      const rideAmount = riderId ? (myDeliveries.length ? sumEarned(myDeliveries.map((task) => {
        const found = riderEarn.find((e) => String(e.order) === String(task.order));
        return { amount: found?.amount || 0, tips: found?.tips || 0 };
      })) / myDeliveries.length : null) : null;
      const avg = isRider ? avgMinutes(myDeliveries) : avgMinutes([...myPicks, ...myPacks, ...myWork]);
      return [userId || a.employee, {
        a, isRider, comp, rider, queue: riderId ? queue.get(riderId) || null : null,
        ordersPicked: distinct(myPicks, 'order'),
        ordersPacked: distinct(myPacks, 'order'),
        ordersDelivered: myDeliveries.length,
        avgTime: avg,
        rate: comp ? `${comp.basis === 'PER_TASK' ? '₹' : ''}${comp.amount} / ${comp.basis}` : (isRider && rideAmount != null ? `${money(rideAmount)} / ride` : '—'),
        week: weeklyEarned,
        month: monthlyEarned,
        salary: comp?.basis === 'MONTHLY' ? Number(comp.amount) : null,
      }];
    }));
  }, [assignments, pickTasks, packTasks, deliveryTasks, earnings, payroll, staffShifts, riderProfiles, queue, siteId, weekStart, monthStart, work]);

  const rows = useMemo(
    () => (assignments || []).filter((row) => !storeCode || row.site_code === storeCode),
    [assignments, storeCode],
  );
  const onShift = rows.filter((row) => row.on_shift).length;

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>EMPLOYEE TRACKING</span>
            <span className="screen-count-tag">{rows.length} assigned</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Picker, packer and rider output, FIFO queue, earnings and salary for <StoreBadge />.
          </div>
        </div>
        <div className="screen-actions">
          <span className="screen-count-tag">{onShift} on shift</span>
          <button className="btn-ui neutral" onClick={() => reload()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Operator</th>
              <th>Employee</th>
              <th>Site</th>
              <th>Role</th>
              <th>Shift</th>
              <th>FIFO</th>
              <th>Picked</th>
              <th>Packed</th>
              <th>Delivered</th>
              <th>Avg time</th>
              <th>Rate</th>
              <th>This week</th>
              <th>This month / salary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rollup = row.user ? latestRollup.get(row.user) : null;
              const task = row.user ? latestWork.get(row.user) : null;
              const metric = metrics[row.user || row.employee] || {};
              return (
                <tr key={row.assignment_id || row.employee}>
                  <td>
                    <strong>{row.name || row.email || '—'}</strong>
                    {row.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.email}</div>}
                    {task && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latest: {task.task_type}</div>}
                  </td>
                  <td className="mono-num">{row.employee || '—'}</td>
                  <td className="mono-num">{row.site_code || '—'}</td>
                  <td>{row.role_at_site || '—'}</td>
                  <td>
                    <StatusBadge status={row.on_shift ? 'ON SHIFT' : 'OFF SHIFT'} />
                    {row.shift_started_at && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {new Date(row.shift_started_at).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="mono-num">{metric.queue ? `#${metric.queue}` : '—'}</td>
                  <td className="mono-num">{metric.ordersPicked ?? '—'} {metric.isRider ? '' : `(${rollup?.tasks_completed ?? 0} tasks)`}</td>
                  <td className="mono-num">{metric.ordersPacked ?? '—'} <span style={{ color: 'var(--text-muted)' }}>packed</span></td>
                  <td className="mono-num">{metric.ordersDelivered ?? '—'}</td>
                  <td className="mono-num">{formatAvg(metric.avgTime)}</td>
                  <td className="mono-num">{metric.rate || '—'}</td>
                  <td className="mono-num">{money(metric.week)}</td>
                  <td className="mono-num">
                    {money(metric.month)}
                    {metric.salary != null && <span style={{ color: 'var(--text-muted)' }}> · salary {money(metric.salary)}/mo</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={13} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                  <Users2 size={18} style={{ marginBottom: 4 }} />
                  <div>No employees assigned to this store.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EmployeeTrackingView() {
  const { siteId, storeCode } = useDarkStore();
  return (
    <StoreGate>
      {siteId && <Tracking storeCode={storeCode} siteId={siteId} />}
    </StoreGate>
  );
}
