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
  const [createError, setCreateError] = useState('');
  const [sites, setSites] = useState([]);

  const today = new Date().toISOString().slice(0, 10);

  // New Plan form state
  const [newPlan, setNewPlan] = useState({
    code: `DP-${today.replace(/-/g, '')}`,
    site: '',
    plan_date: today,
    wave_code: '',
    cutoff_at: '',
    status: 'DRAFT',
    planned_orders: '',
    target_lpns: '',
    notes: '',
  });

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const resultsFrom = (data) => Array.isArray(data) ? data : data.results || [];

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'manifests') {
        const data = await apiClient.get('/transport/manifests/', { page_size: 200 });
        setManifests(resultsFrom(data));
      } else if (activeTab === 'totes-lpns') {
        const [data, sitesData] = await Promise.all([
          apiClient.get('/inventory/lpns/', { page_size: 500 }),
          apiClient.get('/network/sites/', { page_size: 500 }),
        ]);
        const siteRows = resultsFrom(sitesData);
        const siteCodeById = Object.fromEntries(siteRows.map(site => [site.site_id, site.code]));
        setSites(siteRows);
        setLpns(resultsFrom(data).map(row => ({
          ...row,
          site_code: siteCodeById[row.current_site] || row.current_site || '—',
          source_site_code: siteCodeById[row.source_site] || row.source_site || '—',
          dest_site_code: siteCodeById[row.dest_site] || row.dest_site || '—',
        })));
      } else {
        const data = await apiClient.get('/transport/dispatch-plans/', { page_size: 200 });
        setPlans(resultsFrom(data));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadSites = async () => {
    try {
      const data = await apiClient.get('/network/sites/', { page_size: 500 });
      const siteRows = resultsFrom(data);
      setSites(siteRows);
      if (siteRows.length > 0) {
        setNewPlan(prev => ({ ...prev, site: prev.site || siteRows[0].site_id }));
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
    setCreateError('');
    try {
      await apiClient.post('/transport/dispatch-plans/', {
        code: newPlan.code.trim(),
        site: newPlan.site,
        plan_date: newPlan.plan_date,
        wave_code: newPlan.wave_code.trim(),
        cutoff_at: newPlan.cutoff_at || null,
        status: newPlan.status,
        planned_orders: parseInt(newPlan.planned_orders) || 0,
        target_lpns: parseInt(newPlan.target_lpns) || 0,
        notes: newPlan.notes.trim(),
      });
      setShowCreateModal(false);
      await loadData();
    } catch (err) {
      console.error('Failed creating dispatch plan:', err);
      setCreateError(err.message || 'Error creating plan.');
    }
  };

  const handleDownloadCsv = () => {
    if (activeTab === 'manifests') {
      if (manifests.length === 0) return;
      const headers = ['Manifest Code', 'Shipment', 'Dispatch Plan', 'Status', 'Site', 'Total LPNs', 'Total Units', 'Generated At', 'Created At'];
      const rows = manifests.map(m => [
        m.code,
        m.shipment_code || '—',
        m.dispatch_plan_code || '—',
        m.status,
        m.site_code || '—',
        m.total_lpns || 0,
        m.total_units || 0,
        m.generated_at || '—',
        m.created_at,
      ]);
      downloadCsv(headers, rows, 'Manifests');
    } else if (activeTab === 'totes-lpns') {
      if (lpns.length === 0) return;
      const headers = ['LPN Barcode', 'Type', 'Status', 'Current Container', 'Current Site', 'Insulated', 'Created At'];
      const rows = lpns.map(l => [
        l.barcode,
        l.lpn_type || 'TOTE',
        l.status || 'AVAILABLE',
        l.current_ref_id || l.current_container || '—',
        l.site_code || '—',
        l.is_insulated ? 'YES' : 'NO',
        l.created_at,
      ]);
      downloadCsv(headers, rows, 'Totes_LPNs');
    } else {
      if (plans.length === 0) return;
      const headers = ['Plan Code', 'Wave Code', 'Status', 'Facility', 'Plan Date', 'Cutoff', 'Carrier', 'Vehicle', 'Planned Orders', 'Target LPNs', 'Created By', 'Created At'];
      const rows = plans.map(p => [
        p.code,
        p.wave_code || '—',
        p.status,
        p.site_code || p.site || '—',
        p.plan_date || '—',
        p.cutoff_at || '—',
        p.carrier_name || '—',
        p.vehicle_registration || '—',
        p.planned_orders || 0,
        p.target_lpns || 0,
        p.created_by || '—',
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
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-amber)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Wave: {row.wave_code || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Origin Warehouse',
      key: 'site_code',
      render: (val, row) => <span>{val || row.site || '—'}</span>,
    },
    {
      label: 'Plan Date',
      key: 'plan_date',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleDateString() : '—'}</span>,
    },
    {
      label: 'Cutoff',
      key: 'cutoff_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
    {
      label: 'Carrier / Vehicle',
      key: 'carrier_name',
      render: (val, row) => (
        <span>
          {val || '—'}
          {row.vehicle_registration ? ` • ${row.vehicle_registration}` : ''}
        </span>
      ),
    },
    {
      label: 'Planned Orders',
      key: 'planned_orders',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong>,
    },
    {
      label: 'Target LPNs',
      key: 'target_lpns',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontWeight: 600 }}>{val ?? 0}</span>,
    },
    {
      label: 'Created By',
      key: 'created_by',
      render: (val) => <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{val || 'System'}</span>,
    },
  ];

  const manifestColumns = [
    {
      label: 'Manifest Code',
      key: 'code',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Shipment: {row.shipment_code || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Site',
      key: 'site_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'Dispatch Plan',
      key: 'dispatch_plan_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val || '—'}</span>,
    },
    {
      label: 'Total LPNs',
      key: 'total_lpns',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong>,
    },
    {
      label: 'Total Units',
      key: 'total_units',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontWeight: 600 }}>{val ?? 0}</span>,
    },
    {
      label: 'Generated At',
      key: 'generated_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
    {
      label: 'Created At',
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
      key: 'lpn_type',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || 'TOTE'}</span>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Current Container',
      key: 'current_ref_id',
      render: (val, row) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--c-amber)', padding: '2px 6px' }}>{val || row.current_container || '—'}</span>,
    },
    {
      label: 'Current Site',
      key: 'site_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'Insulated',
      key: 'is_insulated',
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
      (p.wave_code && p.wave_code.toLowerCase().includes(q)) ||
      (p.status && p.status.toLowerCase().includes(q)) ||
      (p.site_code && p.site_code.toLowerCase().includes(q)) ||
      (p.carrier_name && p.carrier_name.toLowerCase().includes(q)) ||
      (p.vehicle_registration && p.vehicle_registration.toLowerCase().includes(q))
    );
  });

  const filteredManifests = manifests.filter(m => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (m.code && m.code.toLowerCase().includes(q)) ||
      (m.status && m.status.toLowerCase().includes(q)) ||
      (m.site_code && m.site_code.toLowerCase().includes(q)) ||
      (m.shipment_code && m.shipment_code.toLowerCase().includes(q)) ||
      (m.dispatch_plan_code && m.dispatch_plan_code.toLowerCase().includes(q))
    );
  });

  const filteredLpns = lpns.filter(l => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (l.barcode && l.barcode.toLowerCase().includes(q)) ||
      (l.current_ref_id && l.current_ref_id.toLowerCase().includes(q)) ||
      (l.current_container && l.current_container.toLowerCase().includes(q)) ||
      (l.site_code && l.site_code.toLowerCase().includes(q)) ||
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
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Planned Orders</label>
                    <input
                      type="number"
                      value={newPlan.planned_orders}
                      onChange={(e) => setNewPlan({ ...newPlan, planned_orders: e.target.value })}
                      min="0"
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Target LPNs</label>
                    <input
                      type="number"
                      value={newPlan.target_lpns}
                      onChange={(e) => setNewPlan({ ...newPlan, target_lpns: e.target.value })}
                      min="0"
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Plan Date</label>
                    <input
                      type="date"
                      value={newPlan.plan_date}
                      onChange={(e) => setNewPlan({ ...newPlan, plan_date: e.target.value })}
                      required
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Wave Code</label>
                    <input
                      type="text"
                      value={newPlan.wave_code}
                      onChange={(e) => setNewPlan({ ...newPlan, wave_code: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Cutoff</label>
                    <input
                      type="datetime-local"
                      value={newPlan.cutoff_at}
                      onChange={(e) => setNewPlan({ ...newPlan, cutoff_at: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Status</label>
                    <select
                      value={newPlan.status}
                      onChange={(e) => setNewPlan({ ...newPlan, status: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                    >
                      <option value="DRAFT">DRAFT</option>
                      <option value="OPEN">OPEN</option>
                      <option value="LOCKED">LOCKED</option>
                      <option value="DISPATCHED">DISPATCHED</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Notes</label>
                  <input
                    type="text"
                    value={newPlan.notes}
                    onChange={(e) => setNewPlan({ ...newPlan, notes: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                  />
                </div>
                {createError && <div className="form-error-banner">{createError}</div>}
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
