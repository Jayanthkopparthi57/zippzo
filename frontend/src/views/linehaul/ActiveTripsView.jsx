import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import StatusFilterRail from '../../components/ui/StatusFilterRail';
import { RefreshCw, Download, CheckCircle2, Truck, Clock } from 'lucide-react';

export default function ActiveTripsView() {
  const [trips, setTrips] = useState([]);
  const [activeStage, setActiveStage] = useState('all');
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/transport/trips/');
      setTrips(data.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCheckIn = async (trip) => {
    try {
      await apiClient.patch(`/transport/trips/${trip.trip_id}/`, {
        status: 'CHECKED_IN',
      });
      await loadData();
    } catch (err) {
      console.error('Failed checking in trip:', err);
    }
  };

  const handleDownloadReport = () => {
    if (trips.length === 0) return;
    const headers = ['Trip ID', 'Status', 'Vehicle Number', 'Driver', 'Destination', 'Checked In'];
    const rows = trips.map(t => [
      t.trip_no,
      t.status,
      t.vehicle_no || 'UNASSIGNED',
      t.driver_name || 'PENDING',
      t.dest_site || 'HYD-NCB Enclave',
      t.status === 'CHECKED_IN' || t.status === 'DOCKED_IN' ? 'Yes' : 'No',
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Active_Trips_Report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Dynamic counts
  const loadingPending = trips.filter(t => t.status === 'PLANNED' || t.status === 'SCHEDULED' || !t.vehicle_no).length;
  const loadingProgress = trips.filter(t => t.status === 'LOADING' || t.status === 'DOCKED_IN').length;
  const inTransit = trips.filter(t => t.status === 'IN_TRANSIT').length;
  const returnsCount = trips.filter(t => t.status === 'RETURNS' || t.status === 'COMPLETED').length;
  const inboundTrips = trips.filter(t => t.status === 'CHECKED_IN').length;

  const stages = [
    { id: 'all', label: 'All Trips', count: trips.length },
    { id: 'loading-pending', label: 'Loading Pending', count: loadingPending },
    { id: 'loading-progress', label: 'Loading In Progress', count: loadingProgress },
    { id: 'in-transit', label: 'In-Transit (Forward)', count: inTransit },
    { id: 'checked-in', label: 'Checked-In at Gate', count: inboundTrips },
  ];

  const columns = [
    {
      label: 'Master Trip ID',
      key: 'trip_no',
      render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'Batch / Schedule',
      key: 'batch_slot',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {val || '—'}
        </span>
      ),
    },
    {
      label: 'Master Trip Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Destination',
      key: 'dest_site',
      render: (val, row) => (
        <span style={{ color: 'var(--c-teal)', fontWeight: 600 }}>
          {val || row.site_code || '—'}
        </span>
      ),
    },
    {
      label: 'Vehicle Number',
      key: 'vehicle_no',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val || 'UNASSIGNED'}</span>,
    },
    {
      label: 'Gate Check-In',
      key: 'checked_in',
      render: (val, row) => {
        const isChecked = row.status === 'CHECKED_IN' || row.status === 'DOCKED_IN';
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: isChecked ? '#48a968' : 'var(--text-muted)' }}>
            {isChecked ? '✓ Checked-In' : 'Pending Gate'}
          </span>
        );
      },
    },
    {
      label: 'Reporting Cutoff',
      key: 'reporting_cutoff',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {val ? new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
      ),
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 6 }}>
          {row.status !== 'CHECKED_IN' && row.status !== 'DOCKED_IN' && (
            <button
              className="btn-ui neutral"
              style={{ padding: '2px 8px', fontSize: 10.5 }}
              onClick={(e) => {
                e.stopPropagation();
                handleCheckIn(row);
              }}
            >
              Check-In
            </button>
          )}
        </div>
      ),
    },
  ];

  const filteredTrips = trips.filter(t => {
    if (activeStage === 'loading-pending') return t.status === 'PLANNED' || t.status === 'SCHEDULED' || !t.vehicle_no;
    if (activeStage === 'loading-progress') return t.status === 'LOADING' || t.status === 'DOCKED_IN';
    if (activeStage === 'in-transit') return t.status === 'IN_TRANSIT';
    if (activeStage === 'checked-in') return t.status === 'CHECKED_IN';
    return true;
  });

  return (
    <div>
      {/* Horizontal Status Rail */}
      <StatusFilterRail
        stages={stages}
        activeStage={activeStage}
        onSelectStage={setActiveStage}
        actionLabel="Download Report"
        onActionClick={handleDownloadReport}
      />

      {/* Operational KPI Risk Metrics (Dynamic) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>Total Scheduled Trips</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{trips.length}</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>Loading Pending</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--c-amber)' }}>{loadingPending}</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>In-Transit</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--c-teal)' }}>{inTransit}</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>Gate Check-In Done</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: '#48a968' }}>{inboundTrips}</div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredTrips}
        idField="trip_id"
      />
    </div>
  );
}
