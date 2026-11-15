import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import ShiftPlanCard from '../../components/ui/ShiftPlanCard';
import { Download, RefreshCw, X, Search } from 'lucide-react';

export default function VehicleAssignmentView() {
  const [trips, setTrips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [activeTab, setActiveTab] = useState('active');
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');

  // Assign Vehicle Modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [targetTrip, setTargetTrip] = useState(null);
  const [vehicleId, setVehicleId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [assignError, setAssignError] = useState('');

  const resultsFrom = (data) => Array.isArray(data) ? data : data.results || [];
  const vehicleTypeById = new Map(vehicles.map(vehicle => [vehicle.vehicle_id, vehicle.vehicle_type_code]));

  const loadData = async () => {
    setLoading(true);
    try {
      const [tripsData, vehiclesData, checkinsData] = await Promise.all([
        apiClient.get('/transport/trips/', { page_size: 200 }),
        apiClient.get('/master/vehicles/', { page_size: 500 }),
        apiClient.get('/master/vehicle-checkins/', { page_size: 200 }),
      ]);
      setTrips(resultsFrom(tripsData));
      setVehicles(resultsFrom(vehiclesData));
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

  const handleAssignVehicle = async (e) => {
    e.preventDefault();
    if (!targetTrip) return;
    setAssignError('');
    try {
      await apiClient.patch(`/transport/trips/${targetTrip.trip_id}/`, {
        vehicle: vehicleId || null,
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim(),
      });
      setShowAssignModal(false);
      setVehicleId('');
      setDriverName('');
      setDriverPhone('');
      await loadData();
    } catch (err) {
      console.error('Failed assigning vehicle:', err);
      setAssignError(err.message || 'Error assigning vehicle.');
    }
  };

  const handleDownloadCsv = () => {
    if (trips.length === 0) return;
    const headers = ['Trip ID', 'Status', 'Vehicle Number', 'Driver', 'Destination', 'Created At'];
    const rows = trips.map(t => [
      t.code,
      t.status,
      t.vehicle_registration || 'UNASSIGNED',
      t.driver_name || 'PENDING',
      t.destination_site_code || '—',
      t.created_at,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Zippzo_Trips_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Dynamic Metrics for ShiftPlanCard
  const totalTrips = trips.length;
  const assignedTrips = trips.filter(t => t.vehicle).length;
  const dockedTrips = checkins.filter(checkin => checkin.status === 'OPEN').length;
  const unassignedVehicles = trips.filter(t => !t.vehicle).length;

  const dynamicPlan = {
    code: `DP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    startDate: '1:00 am, Today',
    endDate: '1:00 am, Tomorrow',
    location: trips.find(t => t.origin_site_code)?.origin_site_code || '—',
    batch1Timing: '1:00 AM - 2:00 PM',
    batch2Timing: '2:00 PM - 1:00 AM',
    totalTrips: totalTrips,
    plannedTrips: totalTrips,
    adhocTrips: 0,
    batch1Assigned: `${assignedTrips} / ${totalTrips}`,
    batch1Docked: `${dockedTrips} / ${totalTrips}`,
    batch2Assigned: `${Math.floor(assignedTrips / 2)} / ${Math.max(0, Math.floor(totalTrips / 2))}`,
    batch2Docked: `${Math.floor(dockedTrips / 2)} / ${Math.max(0, Math.floor(totalTrips / 2))}`,
    unassignedVehicles: unassignedVehicles,
  };

  const columns = [
    {
      label: 'Trip ID',
      key: 'code',
      render: (val, row) => (
        <div>
          <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            ID: {row.trip_id ? row.trip_id.slice(0, 12) : '—'}
          </div>
        </div>
      ),
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Vehicle Type',
      key: 'vehicle',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>{vehicleTypeById.get(val) || 'STANDARD'}</span>,
    },
    {
      label: 'Vendor / Carrier',
      key: 'carrier_name',
      render: (val) => <span>{val || '—'}</span>,
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
      label: 'Vehicle Assignment',
      key: 'vehicle_registration',
      render: (val) => val
        ? <span className="status-badge teal">ASSIGNED ({val})</span>
        : <span className="status-badge amber">PENDING ASSIGNMENT</span>,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => (
        <button
          className="btn-ui primary"
          style={{ padding: '2px 8px', fontSize: 10.5 }}
          onClick={(e) => {
            e.stopPropagation();
            setTargetTrip(row);
            setVehicleId(row.vehicle || '');
            setDriverName(row.driver_name || '');
            setDriverPhone(row.driver_phone || '');
            setAssignError('');
            setShowAssignModal(true);
          }}
        >
          {row.vehicle_registration ? 'Reassign' : 'Assign Vehicle'}
        </button>
      ),
    },
  ];

  const filteredTrips = trips.filter(t => {
    if (activeTab === 'active') {
      if (['COMPLETED', 'CANCELLED'].includes(t.status)) return false;
    } else if (activeTab === 'scheduled') {
      if (t.status !== 'PLANNED') return false;
    } else if (activeTab === 'completed') {
      if (t.status !== 'COMPLETED') return false;
    }
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (t.code && t.code.toLowerCase().includes(q)) ||
      (t.vehicle_registration && t.vehicle_registration.toLowerCase().includes(q)) ||
      (t.driver_name && t.driver_name.toLowerCase().includes(q)) ||
      (t.destination_site_code && t.destination_site_code.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      {/* Sub-Tabs: Active / Scheduled / Completed */}
      <div className="subtabs-rail">
        <div className="subtabs-list">
          {['Active', 'Scheduled', 'Completed'].map(t => (
            <button
              key={t}
              className={`subtab-btn ${activeTab === t.toLowerCase() ? 'active' : ''}`}
              onClick={() => setActiveTab(t.toLowerCase())}
            >
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, paddingBottom: 6 }}>
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          <button className="btn-ui neutral" onClick={handleDownloadCsv}>
            <Download size={12} />
            <span>Download Trips CSV</span>
          </button>
        </div>
      </div>

      {/* Plan Card with Shift Timings & Dynamic Meters */}
      <ShiftPlanCard plan={dynamicPlan} />

      {/* Trips Data Table Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 16 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          Trips <span className="screen-count-tag" style={{ marginLeft: 6 }}>{filteredTrips.length}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search trip ID / vehicle..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{
              padding: '4px 26px 4px 8px',
              fontSize: 12,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)'
            }}
          />
          <Search size={12} style={{ position: 'absolute', right: 8, color: 'var(--text-muted)' }} />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredTrips}
        idField="trip_id"
      />

      {/* Assign Vehicle Modal */}
      {showAssignModal && targetTrip && (
        <div className="modal-backdrop" onClick={() => setShowAssignModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div className="modal-title">Assign Vehicle to Trip: {targetTrip.code}</div>
              <button className="btn-ui neutral" onClick={() => setShowAssignModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleAssignVehicle}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)', fontSize: 12 }}>
                  <div><strong>Destination:</strong> {targetTrip.destination_site_code || '—'}</div>
                  <div style={{ marginTop: 4 }}><strong>Current Status:</strong> {targetTrip.status}</div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Registered Vehicle</label>
                  <select
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                    required
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                  >
                    <option value="">Select vehicle</option>
                    {vehicles.map(vehicle => (
                      <option key={vehicle.vehicle_id} value={vehicle.vehicle_id}>
                        {vehicle.registration_no} — {vehicle.vehicle_type_code || vehicle.status}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Assigned Driver Name</label>
                  <input
                    type="text"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Assigned Driver Phone</label>
                  <input
                    type="text"
                    value={driverPhone}
                    onChange={(e) => setDriverPhone(e.target.value)}
                    placeholder="e.g. +91 90000 00000"
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                  />
                </div>

                {assignError && <div className="form-error-banner">{assignError}</div>}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowAssignModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary">
                  Confirm Assignment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
