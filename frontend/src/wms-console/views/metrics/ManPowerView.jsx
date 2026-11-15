import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { Download, RefreshCw, Users2 } from 'lucide-react';

export default function ManPowerView() {
  const [assignments, setAssignments] = useState([]);
  const [productivity, setProductivity] = useState([]);
  const [workAssignments, setWorkAssignments] = useState([]);
  const [loading, setLoading] = useState(true);

  const resultsFrom = (data) => Array.isArray(data) ? data : data.results || [];

  const loadData = async () => {
    setLoading(true);
    try {
      const [manpowerData, productivityData, workData] = await Promise.all([
        apiClient.get('/network/manpower'),
        apiClient.get('/workforce/productivity/', { page_size: 1000 }),
        apiClient.get('/workforce/work-assignments/', { page_size: 1000 }),
      ]);
      setAssignments(resultsFrom(manpowerData));
      setProductivity(resultsFrom(productivityData));
      setWorkAssignments(resultsFrom(workData));
    } catch (err) {
      console.error('Failed loading manpower metrics:', err);
      setAssignments([]);
      setProductivity([]);
      setWorkAssignments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const latestProductivityByUser = useMemo(() => {
    const map = new Map();
    const sorted = [...productivity].sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)));
    sorted.forEach(row => {
      if (row.user && !map.has(row.user)) {
        map.set(row.user, row);
      }
    });
    return map;
  }, [productivity]);

  const latestWorkByUser = useMemo(() => {
    const map = new Map();
    const open = workAssignments
      .filter(task => ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(task.status))
      .sort((a, b) => String(b.assigned_at).localeCompare(String(a.assigned_at)));
    open.forEach(task => {
      if (task.user && !map.has(task.user)) {
        map.set(task.user, task);
      }
    });
    return map;
  }, [workAssignments]);

  const rows = useMemo(() => assignments.map(assignment => {
    const rollup = assignment.user ? latestProductivityByUser.get(assignment.user) : null;
    const latestWork = assignment.user ? latestWorkByUser.get(assignment.user) : null;
    return {
      ...assignment,
      operator_name: assignment.name || assignment.email || assignment.employee,
      latest_process: latestWork?.task_type || '—',
      current_status: assignment.on_shift ? 'ON SHIFT' : 'OFF SHIFT',
      work_date: rollup?.work_date || null,
      tasks_completed: rollup?.tasks_completed ?? null,
      units_processed: rollup?.units_processed ?? null,
      minutes_worked: rollup?.minutes_worked ?? null,
      idle_minutes: rollup?.idle_minutes ?? null,
      units_per_hour: rollup?.units_per_hour ?? null,
    };
  }), [assignments, latestProductivityByUser, latestWorkByUser]);

  const onShiftCount = rows.filter(row => row.on_shift).length;
  const unlinkedCount = rows.filter(row => !row.linked).length;

  const handleDownload = () => {
    const headers = ['Operator', 'Employee', 'Site', 'Role', 'Latest Work', 'Current Status', 'Work Date', 'Tasks Completed', 'Units Processed', 'Minutes Worked', 'Idle Minutes', 'Units Per Hour'];
    const csvRows = rows.map(row => [
      row.operator_name,
      row.employee,
      row.site_code,
      row.role_at_site,
      row.latest_process,
      row.current_status,
      row.work_date || '',
      row.tasks_completed ?? '',
      row.units_processed ?? '',
      row.minutes_worked ?? '',
      row.idle_minutes ?? '',
      row.units_per_hour ?? '',
    ]);
    const csv = [headers, ...csvRows].map(values => values.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
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
    { label: 'Operator', key: 'operator_name', render: value => <strong style={{ color: '#8b22bd' }}>{value}</strong> },
    { label: 'Employee', key: 'employee', render: value => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{value || '—'}</span> },
    { label: 'Site', key: 'site_code', render: value => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{value || '—'}</span> },
    { label: 'Role at Site', key: 'role_at_site', render: value => <span className="soft-pill">{value || '—'}</span> },
    { label: 'Latest Work', key: 'latest_process', render: value => <span className="soft-pill">{value || '—'}</span> },
    { label: 'Current Status', key: 'current_status', render: (value, row) => (
      <span>
        <span className={`soft-pill ${row.on_shift ? '' : 'danger'}`}>{value}</span>
        {row.shift_started_at && (
          <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {new Date(row.shift_started_at).toLocaleString()}
          </span>
        )}
      </span>
    ) },
    { label: 'Work Date', key: 'work_date', render: value => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{value || '—'}</span> },
    { label: 'Tasks Completed', key: 'tasks_completed', render: value => <span style={{ fontFamily: 'var(--font-mono)' }}>{value ?? '—'}</span> },
    { label: 'Units Processed', key: 'units_processed', render: value => <span style={{ fontFamily: 'var(--font-mono)' }}>{value ?? '—'}</span> },
    { label: 'Minutes Worked', key: 'minutes_worked', render: value => <span style={{ fontFamily: 'var(--font-mono)' }}>{value ?? '—'}</span> },
    { label: 'Idle Minutes', key: 'idle_minutes', render: value => <span style={{ color: Number(value || 0) > 160 ? '#e11d1d' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{value ?? '—'}</span> },
    { label: 'Units / Hour', key: 'units_per_hour', render: value => <span style={{ fontFamily: 'var(--font-mono)' }}>{value ?? '—'}</span> },
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
            Live site roster, open shifts, latest assigned work, and daily productivity rollups.
          </div>
        </div>
        <div className="screen-actions">
          <div className="screen-count-tag">Total {rows.length}</div>
          <div className="screen-count-tag">{onShiftCount} On Shift</div>
          <div className="screen-count-tag">{rows.length - onShiftCount} Off Shift</div>
          {unlinkedCount > 0 && <div className="screen-count-tag">{unlinkedCount} Unlinked</div>}
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          <button className="btn-ui primary" onClick={handleDownload} disabled={rows.length === 0}>
            <Download size={12} />
            <span>Download Report</span>
          </button>
        </div>
      </div>

      <div className="subtabs-rail">
        <div className="subtabs-list">
          <button className="subtab-btn active">Man Power</button>
          <button className="subtab-btn">Outbound</button>
          <button className="subtab-btn">Dispatch Command Center</button>
        </div>
      </div>

      <DataTable columns={columns} data={rows} idField="assignment_id" />
    </div>
  );
}
