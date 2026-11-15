import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { Download, RefreshCw, Users2 } from 'lucide-react';

/**
 * Workforce overview.
 *
 * Every number on this screen used to be invented from a character-code hash of
 * the operator's name: utilisation, idle minutes and the eight activity bars
 * were all `seed % n`. That made an idle picker and a busy one indistinguishable
 * and could not change when the person actually worked.
 *
 * It now reads the workforce execution tables: ProductivityRollup for the day's
 * totals, WorkTimeLog for the measured intervals behind the hourly bars, and
 * WorkAssignment for what the operator is currently on. A person with no rows
 * renders dashes; nothing is filled in for them.
 */

const PROCESS_BY_ACTIVITY = {
  PICK: 'PICKING',
  PACK: 'PACKING',
  PUTAWAY: 'PUTAWAY',
  GRN: 'INWARDING',
  SORT: 'SORTING',
  CYCLE_COUNT: 'CYCLE_COUNT',
  DISPATCH: 'DISPATCH',
  IDLE: 'IDLE',
  BREAK: 'BREAK',
  MEETING: 'MEETING',
  OTHER: 'OTHER',
};

const ROLE_LABELS = {
  PICKER: 'MH_Picker',
  PACKER: 'MH_Packer',
  SORTER: 'MH_Sorter',
  GRN_OP: 'MH_GRN',
  QC: 'MH_QC',
  SUPERVISOR: 'MH_Supervisor',
  ADMIN: 'MH_Admin',
  WAREHOUSE_STAFF: 'MH_Staff',
  OPS_MANAGER: 'MH_Manager',
  SUPER_ADMIN: 'MH_Admin',
  DARK_STORE_MANAGER: 'DS_Manager',
  RIDER: 'Rider',
  CUSTOMER: 'Customer',
};

const IDLE_ACTIVITIES = new Set(['IDLE', 'BREAK']);

function asResults(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.results) ? payload.results : [];
}

function dash(value, suffix = '') {
  if (value === null || value === undefined || value === '') {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  return <span>{value}{suffix}</span>;
}

/** Eight one-hour buckets ending at the current hour. */
function hourBuckets(now = new Date()) {
  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  end.setHours(end.getHours() + 1);
  return Array.from({ length: 8 }, (_, i) => {
    const start = new Date(end);
    start.setHours(start.getHours() - (8 - i));
    const stop = new Date(start);
    stop.setHours(stop.getHours() + 1);
    return { start, stop };
  });
}

function overlapMinutes(log, bucket) {
  const start = new Date(log.started_at);
  const end = log.ended_at ? new Date(log.ended_at) : new Date(start.getTime() + (log.minutes || 0) * 60000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const from = Math.max(start.getTime(), bucket.start.getTime());
  const to = Math.min(end.getTime(), bucket.stop.getTime());
  return Math.max(0, Math.round((to - from) / 60000));
}

function buildTimeline(logs) {
  const buckets = hourBuckets();
  return buckets.map((bucket) => {
    let active = 0;
    let idle = 0;
    for (const log of logs) {
      const minutes = overlapMinutes(log, bucket);
      if (!minutes) continue;
      if (IDLE_ACTIVITIES.has(log.activity)) idle += minutes;
      else active += minutes;
    }
    return { active, idle, total: active + idle };
  });
}

export default function ManPowerView() {
  const [users, setUsers] = useState([]);
  const [rollups, setRollups] = useState([]);
  const [timeLogs, setTimeLogs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    const settled = await Promise.allSettled([
      apiClient.get('/iam/users/?page_size=500'),
      apiClient.get('/workforce/productivity/?page_size=500'),
      apiClient.get('/workforce/time-logs/?page_size=500'),
      apiClient.get('/workforce/work-assignments/?page_size=500'),
    ]);
    const [userRes, rollupRes, logRes, assignmentRes] = settled;

    // The roster is the anchor. The workforce rows are evidence about it, so a
    // failed rollup request must not blank the whole board.
    if (userRes.status === 'fulfilled') {
      setUsers(asResults(userRes.value));
    } else {
      setUsers([]);
      setError('Could not load the staff roster.');
    }
    setRollups(rollupRes.status === 'fulfilled' ? asResults(rollupRes.value) : []);
    setTimeLogs(logRes.status === 'fulfilled' ? asResults(logRes.value) : []);
    setAssignments(
      assignmentRes.status === 'fulfilled' ? asResults(assignmentRes.value) : []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const rows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const byUser = (items) => {
      const map = new Map();
      for (const item of items) {
        const key = String(item.user || item.user_id || '');
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
      }
      return map;
    };

    const rollupsByUser = byUser(rollups);
    const logsByUser = byUser(timeLogs);
    const assignmentsByUser = byUser(assignments);

    return users.map((user) => {
      const key = String(user.user_id || user.user || '');
      const userRollups = (rollupsByUser.get(key) || [])
        .slice()
        .sort((a, b) => String(b.work_date || '').localeCompare(String(a.work_date || '')));
      const latestRollup = userRollups[0] || null;

      const userLogs = logsByUser.get(key) || [];
      const todayLogs = userLogs.filter((log) => new Date(log.started_at) >= today);

      const workedMinutes = latestRollup
        ? latestRollup.minutes_worked
        : todayLogs
          .filter((log) => !IDLE_ACTIVITIES.has(log.activity))
          .reduce((sum, log) => sum + (log.minutes || 0), 0);
      const idleMinutes = latestRollup
        ? latestRollup.idle_minutes
        : todayLogs
          .filter((log) => IDLE_ACTIVITIES.has(log.activity))
          .reduce((sum, log) => sum + (log.minutes || 0), 0);

      const measured = (workedMinutes || 0) + (idleMinutes || 0);
      const utilisation = measured
        ? Math.round(((workedMinutes || 0) / measured) * 100)
        : null;

      const recentLog = userLogs
        .slice()
        .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0];
      const openAssignment = (assignmentsByUser.get(key) || []).find(
        (a) => ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(a.status));

      return {
        ...user,
        role_label: ROLE_LABELS[user.role] || user.role || '—',
        latest_process: openAssignment?.task_type
          ? PROCESS_BY_ACTIVITY[openAssignment.task_type] || openAssignment.task_type
          : recentLog?.activity
            ? PROCESS_BY_ACTIVITY[recentLog.activity] || recentLog.activity
            : null,
        utilisation,
        total_idle_time: latestRollup ? latestRollup.idle_minutes : idleMinutes || null,
        units_per_hour: latestRollup ? Number(latestRollup.units_per_hour) : null,
        current_status: openAssignment
          ? 'ON TASK'
          : recentLog && !recentLog.ended_at
            ? 'ACTIVE LOG'
            : user.status === 'ACTIVE'
              ? 'NO ACTIVITY'
              : 'INACTIVE',
        timeline: buildTimeline(userLogs),
      };
    });
  }, [users, rollups, timeLogs, assignments]);

  const activeCount = rows.filter((row) => row.status === 'ACTIVE').length;
  const onTaskCount = rows.filter((row) => row.current_status === 'ON TASK').length;

  const handleDownload = () => {
    const headers = [
      'Picker', 'Role', 'Latest Process', 'Utilisation %', 'Units / Hour',
      'Idle Minutes', 'Current Status',
    ];
    const csvRows = rows.map((row) => [
      row.name,
      row.role_label,
      row.latest_process ?? '',
      row.utilisation ?? '',
      row.units_per_hour ?? '',
      row.total_idle_time ?? '',
      row.current_status,
    ]);
    const csv = [headers, ...csvRows]
      .map((values) => values.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zippzo-manpower-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const columns = [
    {
      label: 'Picker',
      key: 'name',
      render: (row) => (
        <div>
          <strong style={{ color: '#8b22bd' }}>{row.name || row.email || '—'}</strong>
          {row.emp_code && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {row.emp_code}
            </div>
          )}
        </div>
      ),
    },
    { label: 'Role', key: 'role_label', render: (row) => <span className="soft-pill">{row.role_label}</span> },
    {
      label: 'Latest Process',
      key: 'latest_process',
      render: (row) => (row.latest_process
        ? <span className="soft-pill">{row.latest_process}</span>
        : <span style={{ color: 'var(--text-muted)' }}>—</span>),
    },
    {
      label: 'Utilisation %',
      key: 'utilisation',
      render: (row) => dash(row.utilisation, '%'),
    },
    { label: 'Units / Hour', key: 'units_per_hour', render: (row) => dash(row.units_per_hour) },
    { label: 'Idle Minutes', key: 'total_idle_time', render: (row) => dash(row.total_idle_time) },
    {
      label: 'Current Status',
      key: 'current_status',
      render: (row) => (
        <span className={`soft-pill ${row.current_status === 'NO ACTIVITY' || row.current_status === 'INACTIVE' ? 'danger' : ''}`}>
          {row.current_status}
        </span>
      ),
    },
    {
      label: 'Hourly Activity',
      key: 'timeline',
      render: (row) => (
        <div className="manpower-timeline" title="Measured work intervals, one bar per hour">
          {(row.timeline || []).map((bar, index) => {
            const grow = bar.total || 1;
            return (
              <span
                key={index}
                className={bar.active >= bar.idle && bar.total > 0 ? 'active' : bar.idle > 0 ? 'idle' : 'empty'}
                style={{ flexGrow: grow, opacity: bar.total ? 1 : 0.18 }}
              />
            );
          })}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <Users2 size={18} />
            <span>MAN POWER</span>
            <span className="screen-count-tag">{rows.length} staff</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Utilisation, units per hour and hourly activity measured from workforce time logs and daily rollups.
          </div>
        </div>
        <div className="screen-actions">
          <div className="screen-count-tag">Total {rows.length}</div>
          <div className="screen-count-tag">{activeCount} Active</div>
          <div className="screen-count-tag">{onTaskCount} On task</div>
          <button className="btn-ui neutral" onClick={loadData} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          <button className="btn-ui primary" onClick={handleDownload} disabled={rows.length === 0}>
            <Download size={12} />
            <span>Download Report</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!error && !loading && rollups.length === 0 && timeLogs.length === 0 && (
        <div className="scan-feedback" style={{ marginBottom: 12, fontSize: 12 }}>
          No workforce time logs or productivity rollups yet. Utilisation and hourly
          activity stay blank until the Operations app records work.
        </div>
      )}

      <div className="subtabs-rail">
        <div className="subtabs-list">
          <button className="subtab-btn active">Man Power</button>
          <button className="subtab-btn">Outbound</button>
          <button className="subtab-btn">Dispatch Command Center</button>
        </div>
      </div>

      <DataTable columns={columns} data={rows} idField="user_id" />
    </div>
  );
}
