import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { RefreshCw, Download } from 'lucide-react';

const STATUS_FILTERS = ['ALL', 'CHECKED_IN', 'DOCKED_IN', 'IN_TRANSIT', 'COMPLETED'];

export default function VehicleCheckinView() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [filterQuery, setFilterQuery] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/transport/trips/');
      setTrips(data.results || []);
    } catch (err) {
      console.error('VehicleCheckinView fetch error:', err);
      setTrips([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDownload = () => {
    if (!trips.length) return;
    const headers = ['Trip ID', 'Vehicle No', 'Destination', 'Batch', 'Check-In Time', 'Dock Door', 'Status'];
    const rows = trips.map((t) => [
      t.trip_no,
      t.vehicle_no || 'UNASSIGNED',
      t.dest_site || '—',
      t.batch_slot || '—',
      t.checked_in_at || '—',
      t.dock_door || '—',
      t.status,
    ]);
    const csv =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csv);
    link.download = `VehicleCheckin_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filtered = trips.filter((t) => {
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (t.trip_no && t.trip_no.toLowerCase().includes(q)) ||
      (t.vehicle_no && t.vehicle_no.toLowerCase().includes(q)) ||
      (t.dest_site && t.dest_site.toLowerCase().includes(q))
    );
  });

  const columns = [
    {
      label: 'Trip ID',
      key: 'trip_no',
      render: (val, row) => (
        <div className="cell-2line">
          <div className="cell-primary" style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>{val}</div>
          <div className="cell-secondary">ID: {row.trip_id ? row.trip_id.slice(0, 12) : '—'}</div>
        </div>
      ),
    },
    {
      label: 'Vehicle No',
      key: 'vehicle_no',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          {val || 'UNASSIGNED'}
        </span>
      ),
    },
    {
      label: 'Destination',
      key: 'dest_site',
      render: (val, row) => (
        <div className="cell-2line">
          <div className="cell-primary">{val || row.site_code || '—'}</div>
          <div className="cell-secondary">{row.transporter_name || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Batch / Slot',
      key: 'batch_slot',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>
      ),
    },
    {
      label: 'Check-In Time',
      key: 'checked_in_at',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {val ? new Date(val).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      label: 'Dock Door',
      key: 'dock_door',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)' }}>{val || '—'}</span>
      ),
    },
    { label: 'Status', key: 'status', badge: true },
  ];

  return (
    <div>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>VEHICLE CHECK IN</span>
            <span className="screen-count-tag">{filtered.length} records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Gate check-in log for inbound vehicles and trips.
          </div>
        </div>
        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          <button className="btn-ui neutral" onClick={handleDownload}>
            <Download size={12} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Status filter rail */}
      <div className="status-tabs">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={`status-tab ${statusFilter === s ? 'active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="table-filter-row">
        <input
          type="text"
          className="table-filter-input"
          placeholder="Filter table rows..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
        <span className="table-record-count">
          Showing {filtered.length} of {trips.length} records
        </span>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        idField="trip_id"
      />
    </div>
  );
}
