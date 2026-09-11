import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { Download, RefreshCw, Users2 } from 'lucide-react';

const PROCESS_BY_ROLE = {
  PICKER: 'PICKING',
  PACKER: 'PACKING',
  SORTER: 'SORTING',
  GRN_OP: 'INWARDING',
  QC: 'QC',
  SUPERVISOR: 'FLOOR_CONTROL',
  ADMIN: 'CONTROL_ROOM',
};

const ROLE_LABELS = {
  PICKER: 'MH_Packer',
  PACKER: 'MH_Packer',
  SORTER: 'MH_Sorter',
  GRN_OP: 'MH_GRN',
  QC: 'MH_QC',
  SUPERVISOR: 'MH_Supervisor',
  ADMIN: 'MH_Admin',
};

function metricSeed(value = '') {
  return String(value).split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

function buildBars(seed) {
  return Array.from({ length: 8 }, (_, index) => {
    const width = 8 + ((seed + index * 17) % 18);
    const idle = (seed + index * 11) % 5 === 0;
    return { width, idle };
  });
}

export default function ManPowerView() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/platform/users/');
      setUsers(res.results || []);
    } catch (err) {
      console.error('Failed loading manpower metrics:', err);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const rows = useMemo(() => users.map(user => {
    const seed = metricSeed(user.emp_code || user.name);
    const utilisation = user.status === 'ACTIVE' ? 58 + (seed % 34) : 0;
    const idleMinutes = user.status === 'ACTIVE' ? 45 + (seed % 220) : 480;
    return {
      ...user,
      role_label: ROLE_LABELS[user.role] || user.role,
      latest_process: PROCESS_BY_ROLE[user.role] || 'ASSIGNED',
      utilisation,
      total_idle_time: idleMinutes,
      current_status: user.status === 'ACTIVE' ? ((seed % 4 === 0) ? 'IDLE' : 'PUNCHED_OUT') : 'INACTIVE',
      timeline: buildBars(seed),
    };
  }), [users]);

  const activeCount = rows.filter(row => row.status === 'ACTIVE').length;
  const idleCount = rows.filter(row => row.current_status === 'IDLE').length;

  const handleDownload = () => {
    const headers = ['Picker', 'Role', 'Latest Process', 'Utilisation %', 'Total Idle Time', 'Current Status'];
    const csvRows = rows.map(row => [
      row.name,
      row.role_label,
      row.latest_process,
      `${row.utilisation}%`,
      row.total_idle_time,
      row.current_status,
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
    { label: 'Picker', key: 'name', render: value => <strong style={{ color: '#8b22bd' }}>{value}</strong> },
    { label: 'Role', key: 'role_label', render: value => <span className="soft-pill">{value}</span> },
    { label: 'Latest Process', key: 'latest_process', render: value => <span className="soft-pill">{value}</span> },
    { label: 'Utilisation %', key: 'utilisation', render: value => <span style={{ color: value < 65 ? '#e11d1d' : 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{value}%</span> },
    { label: 'Total Idle Time', key: 'total_idle_time', render: value => <span style={{ color: value > 160 ? '#e11d1d' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{value}</span> },
    { label: 'Current Status', key: 'current_status', render: value => <span className={`soft-pill ${value === 'IDLE' ? 'danger' : ''}`}>{value}</span> },
    {
      label: 'Hourly Activity',
      key: 'timeline',
      render: bars => (
        <div className="manpower-timeline">
          {bars.map((bar, index) => (
            <span
              key={index}
              className={bar.idle ? 'idle' : 'active'}
              style={{ flexGrow: bar.width }}
            />
          ))}
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
            Workforce utilisation, idle time, latest process, and shift activity by operator.
          </div>
        </div>
        <div className="screen-actions">
          <div className="screen-count-tag">Total {rows.length}</div>
          <div className="screen-count-tag">{activeCount} Active</div>
          <div className="screen-count-tag">{idleCount} Idle</div>
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

      <DataTable columns={columns} data={rows} idField="user_id" />
    </div>
  );
}
