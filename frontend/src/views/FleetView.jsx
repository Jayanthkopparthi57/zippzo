import React, { useState, useEffect } from 'react';
import { Truck, ShieldCheck, MapPin, ClipboardList, Plus, CheckCircle2, ArrowLeft } from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import { fetchApi, postApi } from '../api/client';

export default function FleetView({ initialTab = 'vehicle-assignment' }) {
  const [activeSubtab, setActiveSubtab] = useState(initialTab);
  const [vehicles, setVehicles] = useState([]);
  const [trips, setTrips] = useState([]);
  const [isCheckingInGate, setIsCheckingInGate] = useState(false);

  // Gate check-in state
  const [vehNo, setVehNo] = useState('AP-05-TX-1234');
  const [driver, setDriver] = useState('Venkat Rao');
  const [dockDoor, setDockDoor] = useState('DOCK-01');

  useEffect(() => {
    setActiveSubtab(initialTab);
  }, [initialTab]);

  const loadData = () => {
    fetchApi('/delivery/route-plans/').then(res => {
      if (res) setTrips(res);
    });
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGateCheckin = async (e) => {
    e.preventDefault();
    if (trips.length === 0) {
      alert('No trip found to attach vehicle checkin. Please create a trip or dispatch plan first.');
      return;
    }
    const targetTrip = trips[0];
    const newCheckin = {
      trip: targetTrip.trip_id,
      vehicle_no: vehNo,
      driver_name: driver,
      direction: 'INBOUND',
      delay_status: 'ON_TRACK',
      dl_valid: true,
      rc_valid: true,
      six_sided: true
    };
    const res = await postApi('/ds-ops/bin-transfers/', newCheckin);
    if (res) {
      loadData();
      setIsCheckingInGate(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // 1. DEDICATED PAGE: GATE ENTRY CHECK-IN
  // ══════════════════════════════════════════════════════════════════
  if (isCheckingInGate) {
    return (
      <div className="animate-fade" style={{ padding: '24px 32px', maxWidth: 850, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <button
            className="btn-secondary"
            onClick={() => setIsCheckingInGate(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', fontWeight: 600 }}
          >
            <ArrowLeft size={16} /> Back to Fleet Registry
          </button>
          <span className="badge badge-purple" style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700 }}>
            Gate Pass Registry
          </span>
        </div>

        <div style={{
          background: '#ffffff',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
          padding: 28,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f5f3ff', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Truck size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Record Fleet Gate Entry Check-In
              </h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '3px 0 0 0' }}>
                Verify vehicle documents, driver credentials, and assign dock door
              </p>
            </div>
          </div>

          <div style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0' }} />

          <form onSubmit={handleGateCheckin}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>Vehicle License Plate No</label>
                <input
                  type="text"
                  className="form-input"
                  value={vehNo}
                  onChange={e => setVehNo(e.target.value)}
                  placeholder="e.g. AP 05 TX 1234"
                  required
                />
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>Driver Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={driver}
                  onChange={e => setDriver(e.target.value)}
                  placeholder="e.g. Venkat Rao"
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label className="form-label" style={{ fontWeight: 600 }}>Assigned Dock Door</label>
              <select className="form-input" value={dockDoor} onChange={e => setDockDoor(e.target.value)}>
                <option value="DOCK-01">Inbound Dock Door #1</option>
                <option value="DOCK-02">Inbound Dock Door #2</option>
                <option value="DOCK-03">Outbound Dispatch Gate #3</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button type="button" className="btn-secondary" onClick={() => setIsCheckingInGate(false)} style={{ padding: '10px 20px', fontWeight: 600 }}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" style={{ background: '#7c3aed', color: '#fff', padding: '10px 24px', fontWeight: 700, fontSize: 14 }}>
                Record Gate Entry
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. MASTER DATA TABLES VIEW (ZERO FORMS BELOW TABLE)
  // ══════════════════════════════════════════════════════════════════
  return (
    <div>
      <div className="subtabs-bar">
        <button className={`subtab-btn ${activeSubtab === 'vehicle-assignment' ? 'active' : ''}`} onClick={() => setActiveSubtab('vehicle-assignment')}>
          Vehicle Assignment
        </button>
        <button className={`subtab-btn ${activeSubtab === 'vehicle-checkin' ? 'active' : ''}`} onClick={() => setActiveSubtab('vehicle-checkin')}>
          Vehicle Dock Check In
        </button>
        <button className={`subtab-btn ${activeSubtab === 'active-trips' ? 'active' : ''}`} onClick={() => setActiveSubtab('active-trips')}>
          Active Trips En Route
        </button>
        <button className={`subtab-btn ${activeSubtab === 'all-trips' ? 'active' : ''}`} onClick={() => setActiveSubtab('all-trips')}>
          All Trips Log History
        </button>
      </div>

      {(activeSubtab === 'vehicle-assignment' || activeSubtab === 'vehicle-checkin') && (
        <DataTable
          title="Linehaul Vehicles & Dock Gate Registry"
          subtitle="Fleet status, load capacities, drivers, and assigned dock doors"
          onAdd={() => setIsCheckingInGate(true)}
          addLabel="Gate Check-In"
          columns={[
            { header: 'Checkin ID', key: 'checkin_id', render: r => <span className="code-cell">{r.checkin_id ? String(r.checkin_id).slice(0, 8) : 'N/A'}</span> },
            { header: 'Vehicle Plate No', key: 'vehicle_no', render: r => <strong style={{ color: 'var(--accent-cyan)' }}>{r.vehicle_no}</strong> },
            { header: 'Trip Reference', key: 'trip_no', render: r => <span style={{ fontFamily: 'monospace' }}>{r.trip_no || 'N/A'}</span> },
            { header: 'Direction', key: 'direction', render: r => <span className="badge badge-info">{r.direction}</span> },
            { header: 'Assigned Driver', key: 'driver_name' },
            { header: 'Check-In Time', key: 'checkin_at', render: r => r.checkin_at ? new Date(r.checkin_at).toLocaleString() : 'Just now' },
            {
              header: 'Status',
              key: 'delay_status',
              render: r => (
                <span className={`badge ${r.delay_status === 'ON_TRACK' ? 'badge-success' : 'badge-warning'}`}>
                  {r.delay_status || 'ON_TRACK'}
                </span>
              )
            }
          ]}
          data={vehicles}
        />
      )}

      {activeSubtab === 'active-trips' && (
        <DataTable
          title="Live In-Transit Trips"
          subtitle="Active long-haul and hub-to-spoke transit trucks"
          columns={[
            { header: 'Trip #', key: 'trip_no', render: r => <strong className="code-cell">{r.trip_no}</strong> },
            { header: 'Origin Mother Hub', key: 'origin_site_name', render: r => <span>{r.origin_site_name || 'Central Dark Store'}</span> },
            { header: 'Destination', key: 'dest_site_name', render: r => <span>{r.dest_site_name || 'Hafeezpet #009'}</span> },
            { header: 'Vehicle No', key: 'vehicle_no' },
            { header: 'Status', key: 'status', render: r => <span className="badge badge-purple">{r.status || 'IN_TRANSIT'}</span> },
            { header: 'Departure Time', key: 'dispatch_time', render: r => <span>{r.dispatch_time ? new Date(r.dispatch_time).toLocaleTimeString() : '10:30 AM'}</span> }
          ]}
          data={trips}
        />
      )}

      {activeSubtab === 'all-trips' && (
        <DataTable
          title="Trip Dispatch Audit History"
          subtitle="Complete historical log of fulfilled inter-facility transport runs"
          columns={[
            { header: 'Trip #', key: 'trip_no', render: r => <span className="code-cell">{r.trip_no}</span> },
            { header: 'Vehicle Plate', key: 'vehicle_no' },
            { header: 'Driver', key: 'driver_name' },
            { header: 'Seal Number', key: 'seal_number', render: r => <span className="badge badge-purple">{r.seal_number || 'SEAL-2026-08'}</span> },
            { header: 'Route Status', key: 'status', render: r => <span className={`badge ${r.status === 'COMPLETED' ? 'badge-success' : 'badge-info'}`}>{r.status}</span> },
            {
              header: 'GPS / Telematics',
              render: r => (
                <span style={{ fontSize: '11px', color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={12} /> Connected
                </span>
              )
            }
          ]}
          data={trips}
        />
      )}
    </div>
  );
}
