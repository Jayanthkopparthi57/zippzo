import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { Plus, RefreshCw, Download, Search, X } from 'lucide-react';

export default function DispatchPlanView({ initialTab = 'dispatch-plan' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [plans, setPlans] = useState([]);
  const [manifests, setManifests] = useState([]);
  const [lpns, setLpns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sites, setSites] = useState([]);

  // New Plan form state
  const [newPlan, setNewPlan] = useState({
    code: `DP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-HYD080M`,
    site: '',
    status: 'ACTIVE',
    total_trips: 15,
    mh_locations: 'HYD-DRY-MH2-KANDLAKOYA (HYD080M)',
  });

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'manifests') {
        const data = await apiClient.get('/outbound/manifests/');
        setManifests(data.results || []);
      } else if (activeTab === 'totes-lpns') {
        const data = await apiClient.get('/inventory/lpns/');
        setLpns(data.results || []);
      } else {
        const data = await apiClient.get('/outbound/dispatch-plans/');
        setPlans(data.results || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadSites = async () => {
    try {
      const data = await apiClient.get('/master/sites/');
      setSites(data.results || []);
      if (data.results?.length > 0) {
        setNewPlan(prev => ({ ...prev, site: data.results[0].site_id }));
      }
    } catch (err) {
      console.error('Failed loading sites:', err);
    }
  };

  useEffect(() => {
    loadData();
    loadSites();
  }, [activeTab]);

  const handleCreatePlan = async (e) => {
    e.preventDefault();
    try {
      await apiClient.post('/outbound/dispatch-plans/', {
        code: newPlan.code,
        site: newPlan.site,
        status: newPlan.status,
        total_trips: parseInt(newPlan.total_trips) || 1,
        mh_locations: newPlan.mh_locations,
        updated_by: 'ops.dispatch@zippzo.com',
      });
      setShowCreateModal(false);
      await loadData();
    } catch (err) {
      console.error('Failed creating dispatch plan:', err);
      alert('Error creating plan.');
    }
  };

  const handleDownloadCsv = () => {
    if (activeTab === 'manifests') {
      if (manifests.length === 0) return;
      const headers = ['Manifest No', 'Type', 'Status', 'Site', 'Vehicle', 'Packed Totes', 'Packed Qty', 'Shipments', 'Created At'];
      const rows = manifests.map(m => [
        m.manifest_no,
        m.type || '—',
        m.status,
        m.site_code || 'HYD080M',
        m.vehicle_no || '—',
        m.packed_totes || 0,
        m.packed_qty || 0,
        m.shipments_count || 0,
        m.created_at,
      ]);
      downloadCsv(headers, rows, 'Manifests');
    } else if (activeTab === 'totes-lpns') {
      if (lpns.length === 0) return;
      const headers = ['LPN Barcode', 'Type', 'Status', 'Current Bin', 'Is Superstore', 'Created At'];
      const rows = lpns.map(l => [
        l.barcode,
        l.type || 'TOTE',
        l.status || 'AVAILABLE',
        l.current_bin || '—',
        l.is_superstore ? 'YES' : 'NO',
        l.created_at,
      ]);
      downloadCsv(headers, rows, 'Totes_LPNs');
    } else {
      if (plans.length === 0) return;
      const headers = ['Plan Code', 'Status', 'Facility', 'Total Trips', 'Trips with Vehicles', 'Updated By', 'Created At'];
      const rows = plans.map(p => [
        p.code,
        p.status,
        p.site_code || 'HYD080M',
        p.total_trips || 0,
        p.trips_with_vehicles || 0,
        p.updated_by || '—',
        p.created_at,
      ]);
      downloadCsv(headers, rows, 'Dispatch_Plans');
    }
  };

  const downloadCsv = (headers, rows, prefix) => {
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Zippzo_${prefix}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const planColumns = [
    {
      label: 'Plan ID',
      key: 'code',
      render: (val) => <strong style={{ color: 'var(--c-amber)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Origin Warehouse',
      key: 'site_code',
      render: (val, row) => <span>{val || row.mh_locations || 'HYD080M'}</span>,
    },
    {
      label: 'Planned Trips',
      key: 'total_trips',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong>,
    },
    {
      label: 'Vehicles Assigned',
      key: 'trips_with_vehicles',
      render: (val, row) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontWeight: 600 }}>
          {val ?? 0} / {row.total_trips ?? 0}
        </span>
      ),
    },
    {
      label: 'Created Date',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
    {
      label: 'Updated By',
      key: 'updated_by',
      render: (val) => <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{val || 'System'}</span>,
    },
  ];

  const manifestColumns = [
    {
      label: 'Manifest No',
      key: 'manifest_no',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Type: {row.type || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Facility',
      key: 'site_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || 'HYD080M'}</span>,
    },
    {
      label: 'Vehicle',
      key: 'vehicle_no',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val || '—'}</span>,
    },
    {
      label: 'Packed Totes',
      key: 'packed_totes',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong>,
    },
    {
      label: 'Packed Qty',
      key: 'packed_qty',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontWeight: 600 }}>{val ?? 0}</span>,
    },
    {
      label: 'Shipments',
      key: 'shipments_count',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</span>,
    },
    {
      label: 'Dispatched Time',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
  ];

  const lpnColumns = [
    {
      label: 'LPN / Tote Barcode',
      key: 'barcode',
      render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'Container Type',
      key: 'type',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || 'TOTE'}</span>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Current Bin',
      key: 'current_bin',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--c-amber)', padding: '2px 6px' }}>{val || '—'}</span>,
    },
    {
      label: 'Superstore',
      key: 'is_superstore',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: val ? 'var(--c-teal)' : 'var(--text-muted)' }}>{val ? 'YES' : 'NO'}</span>,
    },
    {
      label: 'Registered Time',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
  ];

  const filteredPlans = plans.filter(p => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (p.code && p.code.toLowerCase().includes(q)) ||
      (p.status && p.status.toLowerCase().includes(q)) ||
      (p.site_code && p.site_code.toLowerCase().includes(q))
    );
  });

  const filteredManifests = manifests.filter(m => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (m.manifest_no && m.manifest_no.toLowerCase().includes(q)) ||
      (m.status && m.status.toLowerCase().includes(q))
    );
  });

  const filteredLpns = lpns.filter(l => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (l.barcode && l.barcode.toLowerCase().includes(q)) ||
      (l.current_bin && l.current_bin.toLowerCase().includes(q)) ||
      (l.status && l.status.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      {/* Subtabs Rail */}
      <div className="subtabs-rail" style={{ marginBottom: 12 }}>
        <div className="subtabs-list">
          <button
            className={`subtab-btn ${activeTab === 'dispatch-plan' ? 'active' : ''}`}
            onClick={() => setActiveTab('dispatch-plan')}
          >
            Dispatch Plans ({plans.length})
          </button>
          <button
            className={`subtab-btn ${activeTab === 'manifests' ? 'active' : ''}`}
            onClick={() => setActiveTab('manifests')}
          >
            Manifests ({manifests.length})
          </button>
          <button
            className={`subtab-btn ${activeTab === 'totes-lpns' ? 'active' : ''}`}
            onClick={() => setActiveTab('totes-lpns')}
          >
            Totes & LPNs ({lpns.length})
          </button>
        </div>

        <div className="screen-actions" style={{ paddingBottom: 6 }}>
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          <button className="btn-ui neutral" onClick={handleDownloadCsv}>
            <Download size={12} />
            <span>Export CSV</span>
          </button>
          {activeTab === 'dispatch-plan' && (
            <button className="btn-ui primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={13} />
              <span>Add New Plan</span>
            </button>
          )}
        </div>
      </div>

      {/* Screen Header */}
      <div className="screen-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="screen-title">
            <span>
              {activeTab === 'manifests'
                ? 'OUTBOUND SHIPPING MANIFESTS'
                : activeTab === 'totes-lpns'
                ? 'OUTBOUND CONTAINERS & TOTES'
                : 'LINEHAUL DISPATCH PLANS'}
            </span>
            <span className="screen-count-tag">
              {activeTab === 'manifests'
                ? filteredManifests.length
                : activeTab === 'totes-lpns'
                ? filteredLpns.length
                : filteredPlans.length} Records
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {activeTab === 'manifests'
              ? 'Truck loading logs, sealed tote manifests, and gate handover documents.'
              : activeTab === 'totes-lpns'
              ? 'Barcoded tote containers, license plate numbers, and tare weights.'
              : 'Mother Hub outbound dispatch schedules, departure cutoffs, and route allocations.'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search records..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{
              padding: '5px 28px 5px 10px',
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

      {/* Main Table */}
      {activeTab === 'manifests' ? (
        <DataTable
          columns={manifestColumns}
          data={filteredManifests}
          idField="manifest_id"
          emptyMessage="No dispatch manifests found."
        />
      ) : activeTab === 'totes-lpns' ? (
        <DataTable
          columns={lpnColumns}
          data={filteredLpns}
          idField="lpn_id"
          emptyMessage="No container LPNs found."
        />
      ) : (
        <DataTable
          columns={planColumns}
          data={filteredPlans}
          idField="plan_id"
          emptyMessage="No dispatch plans found."
        />
      )}

      {/* Add Plan Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <div className="modal-title">Create New Linehaul Dispatch Plan</div>
              <button className="btn-ui neutral" onClick={() => setShowCreateModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreatePlan}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Plan Code</label>
                  <input
                    type="text"
                    value={newPlan.code}
                    onChange={(e) => setNewPlan({ ...newPlan, code: e.target.value })}
                    required
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Facility</label>
                    <select
                      value={newPlan.site}
                      onChange={(e) => setNewPlan({ ...newPlan, site: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                    >
                      {sites.map(s => (
                        <option key={s.site_id} value={s.site_id}>
                          {s.code} - {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Planned Trips</label>
                    <input
                      type="number"
                      value={newPlan.total_trips}
                      onChange={(e) => setNewPlan({ ...newPlan, total_trips: e.target.value })}
                      required
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Location Details</label>
                  <input
                    type="text"
                    value={newPlan.mh_locations}
                    onChange={(e) => setNewPlan({ ...newPlan, mh_locations: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary">
                  Save Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
