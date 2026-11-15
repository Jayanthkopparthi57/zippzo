import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import StatusFilterRail from '../../components/ui/StatusFilterRail';

export default function ActiveTripsView() {
  const [trips, setTrips] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [activeStage, setActiveStage] = useState('all');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');

  const resultsFrom = (data) => Array.isArray(data) ? data : data.results || [];
  const openCheckinByVehicle = new Map(
    checkins
      .filter(checkin => checkin.status === 'OPEN')
      .map(checkin => [checkin.vehicle, checkin])
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const [tripsData, checkinsData] = await Promise.all([
        apiClient.get('/transport/trips/', { page_size: 200 }),
        apiClient.get('/master/vehicle-checkins/', { page_size: 200 }),
      ]);
      setTrips(resultsFrom(tripsData));
      setCheckins(resultsFrom(checkinsData));
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
    setActionError('');
    if (!trip.vehicle) {
      setActionError('Assign a vehicle to this trip before gate check-in.');
      return;
    }
    try {
      await apiClient.post('/master/vehicle-checkins/', {
        vehicle: trip.vehicle,
        site: trip.origin_site,
        direction: 'IN',
        purpose: 'TRANSFER',
        driver_name: trip.driver_name || '',
        driver_phone: trip.driver_phone || '',
        notes: `Trip ${trip.code}`,
      });
      await loadData();
    } catch (err) {
      console.error('Failed checking in trip:', err);
      setActionError(err.message || 'Failed checking in trip.');
    }
  };

  const handleCheckOut = async (trip) => {
    setActionError('');
    const checkin = openCheckinByVehicle.get(trip.vehicle);
    if (!checkin) return;
    try {
      await apiClient.patch(`/master/vehicle-checkins/${checkin.checkin_id}/`, {
        status: 'CLOSED',
        checked_out_at: new Date().toISOString(),
      });
      await loadData();
    } catch (err) {
      console.error('Failed checking out trip:', err);
      setActionError(err.message || 'Failed checking out trip.');
    }
  };

  const handleDownloadReport = () => {
    if (trips.length === 0) return;
    const headers = ['Trip ID', 'Status', 'Vehicle Number', 'Driver', 'Destination', 'Checked In'];
    const rows = trips.map(t => [
      t.code,
      t.status,
      t.vehicle_registration || 'UNASSIGNED',
      t.driver_name || 'PENDING',
      t.destination_site_code || '—',
      openCheckinByVehicle.has(t.vehicle) ? 'Yes' : 'No',
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
  const loadingPending = trips.filter(t => t.status === 'PLANNED' && !t.vehicle).length;
  const loadingProgress = trips.filter(t => t.status === 'DELAYED').length;
  const inTransit = trips.filter(t => t.status === 'IN_TRANSIT').length;
  const inboundTrips = checkins.filter(checkin => checkin.status === 'OPEN').length;

  const stages = [
    { id: 'all', label: 'All Trips', count: trips.length },
    { id: 'loading-pending', label: 'Loading Pending', count: loadingPending },
    { id: 'loading-progress', label: 'Delayed', count: loadingProgress },
    { id: 'in-transit', label: 'In-Transit (Forward)', count: inTransit },
    { id: 'checked-in', label: 'Vehicle Checked-In', count: inboundTrips },
  ];

  const columns = [
    {
      label: 'Master Trip ID',
      key: 'code',
      render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'Shipment / Schedule',
      key: 'shipment_code',
      render: (val, row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {val || '—'}{row.planned_departure_at ? ` • ${new Date(row.planned_departure_at).toLocaleString()}` : ''}
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
      key: 'destination_site_code',
      render: (val) => (
        <span style={{ color: 'var(--c-teal)', fontWeight: 600 }}>
          {val || '—'}
        </span>
      ),
    },
    {
      label: 'Vehicle Number',
      key: 'vehicle_registration',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val || 'UNASSIGNED'}</span>,
    },
    {
      label: 'Gate Check-In',
      key: 'checked_in',
      render: (_, row) => {
        const isChecked = openCheckinByVehicle.has(row.vehicle);
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: isChecked ? '#48a968' : 'var(--text-muted)' }}>
            {isChecked ? '✓ Checked-In' : 'Pending Gate'}
          </span>
        );
      },
    },
    {
      label: 'Planned Departure',
      key: 'planned_departure_at',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {val ? new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
      ),
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => {
        const isChecked = openCheckinByVehicle.has(row.vehicle);
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            {!isChecked && (
              <button
                className="btn-ui neutral"
                style={{ padding: '2px 8px', fontSize: 10.5 }}
                disabled={!row.vehicle}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCheckIn(row);
                }}
              >
                Check-In
              </button>
            )}
            {isChecked && (
              <button
                className="btn-ui neutral"
                style={{ padding: '2px 8px', fontSize: 10.5 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCheckOut(row);
                }}
              >
                Check-Out
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const filteredTrips = trips.filter(t => {
    if (activeStage === 'loading-pending') return t.status === 'PLANNED' && !t.vehicle;
    if (activeStage === 'loading-progress') return t.status === 'DELAYED';
    if (activeStage === 'in-transit') return t.status === 'IN_TRANSIT';
    if (activeStage === 'checked-in') return openCheckinByVehicle.has(t.vehicle);
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

      {actionError && <div className="form-error-banner" style={{ marginBottom: 12 }}>{actionError}</div>}

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
