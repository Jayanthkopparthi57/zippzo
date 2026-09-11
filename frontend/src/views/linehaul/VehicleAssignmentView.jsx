import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import ShiftPlanCard from '../../components/ui/ShiftPlanCard';
import { Download, RefreshCw, Truck, X, Search, CheckCircle2 } from 'lucide-react';

export default function VehicleAssignmentView() {
  const [trips, setTrips] = useState([]);
  const [activeTab, setActiveTab] = useState('active');
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');

  // Assign Vehicle Modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [targetTrip, setTargetTrip] = useState(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');

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

  const handleAssignVehicle = async (e) => {
    e.preventDefault();
    if (!targetTrip) return;
    try {
      await apiClient.patch(`/transport/trips/${targetTrip.trip_id}/`, {
        vehicle_no: vehicleNo,
        driver_name: driverName || 'Assigned Driver',
        status: 'DOCKED_IN',
      });
      setShowAssignModal(false);
      setVehicleNo('');
      setDriverName('');
      await loadData();
    } catch (err) {
      console.error('Failed assigning vehicle:', err);
      alert('Error assigning vehicle.');
    }
  };

  const handleDownloadCsv = () => {
    if (trips.length === 0) return;
    const headers = ['Trip ID', 'Status', 'Vehicle Number', 'Driver', 'Destination', 'Created At'];
    const rows = trips.map(t => [
      t.trip_no,
      t.status,
      t.vehicle_no || 'UNASSIGNED',
      t.driver_name || 'PENDING',
      t.dest_site || t.site_code || '—',
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
  const assignedTrips = trips.filter(t => t.vehicle_no).length;
  const dockedTrips = trips.filter(t => t.status === 'DOCKED_IN' || t.status === 'LOADING').length;
  const unassignedVehicles = trips.filter(t => !t.vehicle_no).length;

  const dynamicPlan = {
    code: 'DP-20260905-HYD080M',
    startDate: '1:00 am, Today',
    endDate: '1:00 am, Tomorrow',
    location: 'HYD-DRY-MH2-KANDLAKOYA (HYD080M)',
    batch1Timing: '1:00 AM - 2:00 PM',
    batch2Timing: '2:00 PM - 1:00 AM',
    totalTrips: totalTrips,
    plannedTrips: totalTrips,
    adhocTrips: 0,
    batch1Assigned: `${assignedTrips} / ${totalTrips}`,
    batch1Docked: `${dockedTrips} / ${totalTrips}`,
    batch2Assigned: `${Math.floor(assignedTrips / 2)} / ${Math.max(1, Math.floor(totalTrips / 2))}`,
    batch2Docked: `${Math.floor(dockedTrips / 2)} / ${Math.max(1, Math.floor(totalTrips / 2))}`,
    unassignedVehicles: unassignedVehicles,
  };

  const columns = [
    {
      label: 'Trip ID',
      key: 'trip_no',
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
      key: 'vehicle_type',
      render: (val, row) => <span style={{ fontFamily: 'var(--font-mono)' }}>{row.vehicle_type_code || row.vehicle_type || 'STANDARD'}</span>,
    },
    {
      label: 'Vendor / Carrier',
      key: 'transporter_name',
      render: (val, row) => <span>{val || row.transporter_name || 'Carrier Fleet'}</span>,
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
      label: 'Vehicle Assignment',
      key: 'vehicle_no',
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
            setVehicleNo(row.vehicle_no || '');
            setDriverName(row.driver_name || '');
            setShowAssignModal(true);
          }}
        >
          {row.vehicle_no ? 'Reassign' : 'Assign Vehicle'}
        </button>
      ),
    },
  ];

  const filteredTrips = trips.filter(t => {
    if (activeTab === 'active') {
      if (['COMPLETED', 'CANCELLED'].includes(t.status)) return false;
    } else if (activeTab === 'completed') {
      if (t.status !== 'COMPLETED') return false;
    }
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (t.trip_no && t.trip_no.toLowerCase().includes(q)) ||
      (t.vehicle_no && t.vehicle_no.toLowerCase().includes(q)) ||
      (t.driver_name && t.driver_name.toLowerCase().includes(q)) ||
      (t.dest_site && t.dest_site.toLowerCase().includes(q))
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
              <div className="modal-title">Assign Vehicle to Trip: {targetTrip.trip_no}</div>
              <button className="btn-ui neutral" onClick={() => setShowAssignModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleAssignVehicle}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)', fontSize: 12 }}>
                  <div><strong>Destination:</strong> {targetTrip.dest_site || 'HYD-NCB Enclave'}</div>
                  <div style={{ marginTop: 4 }}><strong>Current Status:</strong> {targetTrip.status}</div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Vehicle Registration Number</label>
                  <input
                    type="text"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    placeholder="e.g. TS12UC0730"
                    required
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                  />
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
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowAssignModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary">
                  Confirm Vehicle Docking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
