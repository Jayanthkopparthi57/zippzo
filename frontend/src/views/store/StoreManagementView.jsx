import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { Plus, RefreshCw, Download, Search, X, Trash2, Edit2, Truck, ArrowUpDown } from 'lucide-react';

const STORAGE_KEY = 'zippzo_controlled_darkhouses';

export default function StoreManagementView() {
  const [activeTab, setActiveTab] = useState('controlled-darkhouses');
  const [records, setRecords] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Form State for User-Created / Edited Darkhouse Stock
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    location: '',
    zone: 'Urban',
    distance_km: '',
    ordered_stock: '',
    shipped_stock: '',
    carrier: '',
    vehicle_no: '',
    driver_name: '',
    driver_phone: '',
    dispatch_plan: '',
    trip_id: '',
    status: 'PLANNED',
    dock_info: '',
  });

  // Load records from localStorage
  useEffect(() => {
    loadData();
    loadSites();
  }, []);

  const loadData = () => {
    setLoading(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Filter out legacy dummy demo entries (dh-1, dh-2, dh-3, dh-4)
        const userOnly = parsed.filter(r => !['dh-1', 'dh-2', 'dh-3', 'dh-4'].includes(r.id));
        setRecords(userOnly);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(userOnly));
      } else {
        setRecords([]);
      }
    } catch (err) {
      console.error('Failed reading darkhouses from storage:', err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSites = async () => {
    try {
      const data = await apiClient.get('/master/sites/');
      const dsSites = (data.results || data || []).filter(s => s.type === 'DS' || s.code.includes('DS') || s.code.includes('S'));
      setSites(dsSites);
    } catch (err) {
      console.error('Failed fetching master sites:', err);
    }
  };

  const saveRecords = (newRecords) => {
    setRecords(newRecords);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newRecords));
  };

  const handleOpenAddModal = () => {
    setEditingId(null);
    setFormData({
      code: sites[0]?.code || 'HYD078S',
      name: sites[0]?.name || '',
      location: '',
      zone: 'Urban',
      distance_km: 15,
      ordered_stock: 500,
      shipped_stock: 0,
      carrier: 'Zippzo Dedicated Fleet',
      vehicle_no: '',
      driver_name: '',
      driver_phone: '',
      dispatch_plan: `DP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
      trip_id: `TRIP-${Math.floor(1000 + Math.random() * 9000)}`,
      status: 'PLANNED',
      dock_info: 'Assigned to Dock 1',
    });
    setShowAddModal(true);
  };

  const handleEditRecord = (row) => {
    setEditingId(row.id);
    setFormData({
      code: row.code,
      name: row.name,
      location: row.location,
      zone: row.zone || 'Urban',
      distance_km: row.distance_km || '',
      ordered_stock: row.ordered_stock,
      shipped_stock: row.shipped_stock,
      carrier: row.carrier,
      vehicle_no: row.vehicle_no,
      driver_name: row.driver_name,
      driver_phone: row.driver_phone,
      dispatch_plan: row.dispatch_plan,
      trip_id: row.trip_id,
      status: row.status,
      dock_info: row.dock_info || '',
    });
    setShowAddModal(true);
  };

  const handleDeleteRecord = (id) => {
    if (!window.confirm('Remove this darkhouse replenishment record?')) return;
    const updated = records.filter(r => r.id !== id);
    saveRecords(updated);
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    const ordered = parseInt(formData.ordered_stock) || 0;
    const shipped = parseInt(formData.shipped_stock) || 0;

    if (editingId) {
      const updated = records.map(r => {
        if (r.id === editingId) {
          return {
            ...r,
            ...formData,
            ordered_stock: ordered,
            shipped_stock: shipped,
            distance_km: parseInt(formData.distance_km) || 0,
          };
        }
        return r;
      });
      saveRecords(updated);
    } else {
      const newEntry = {
        id: `dh-${Date.now()}`,
        ...formData,
        ordered_stock: ordered,
        shipped_stock: shipped,
        distance_km: parseInt(formData.distance_km) || 0,
      };
      saveRecords([newEntry, ...records]);
    }
    setShowAddModal(false);
  };

  const handleClearAll = () => {
    if (records.length === 0) return;
    if (window.confirm('Clear all darkhouse records?')) {
      saveRecords([]);
    }
  };

  const handleExportCsv = () => {
    if (records.length === 0) return;
    const headers = [
      'Darkhouse Code',
      'Name',
      'Location',
      'Ordered Stock',
      'Shipped Stock',
      'Remaining Stock',
      'Fulfillment %',
      'Carrier',
      'Vehicle No',
      'Driver Name',
      'Driver Phone',
      'Dispatch Plan',
      'Trip ID',
      'Status',
    ];
    const rows = records.map(r => {
      const remaining = Math.max(0, (r.ordered_stock || 0) - (r.shipped_stock || 0));
      const pct = r.ordered_stock > 0 ? ((r.shipped_stock / r.ordered_stock) * 100).toFixed(1) + '%' : '0%';
      return [
        r.code,
        r.name,
        r.location,
        r.ordered_stock,
        r.shipped_stock,
        remaining,
        pct,
        r.carrier,
        r.vehicle_no,
        r.driver_name,
        r.driver_phone,
        r.dispatch_plan,
        r.trip_id,
        r.status,
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Zippzo_Controlled_Darkhouses_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Aggregated totals
  const totalOrdered = records.reduce((acc, r) => acc + (parseInt(r.ordered_stock) || 0), 0);
  const totalShipped = records.reduce((acc, r) => acc + (parseInt(r.shipped_stock) || 0), 0);
  const totalRemaining = Math.max(0, totalOrdered - totalShipped);
  const overallRate = totalOrdered > 0 ? ((totalShipped / totalOrdered) * 100).toFixed(1) : '0.0';

  // Filter query logic
  const filteredRecords = records.filter(r => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (r.code && r.code.toLowerCase().includes(q)) ||
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.location && r.location.toLowerCase().includes(q)) ||
      (r.carrier && r.carrier.toLowerCase().includes(q)) ||
      (r.vehicle_no && r.vehicle_no.toLowerCase().includes(q)) ||
      (r.driver_name && r.driver_name.toLowerCase().includes(q)) ||
      (r.status && r.status.toLowerCase().includes(q))
    );
  });

  // Table Column Definitions
  const columns = [
    {
      label: 'Darkhouse (Spoke)',
      key: 'code',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-amber)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{row.name}</div>
        </div>
      ),
    },
    {
      label: 'Location / Zone',
      key: 'location',
      render: (val, row) => (
        <div>
          <div style={{ fontSize: 12 }}>{val || '—'}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Zone: {row.zone || 'Urban'} {row.distance_km ? `• ${row.distance_km} km` : ''}
          </div>
        </div>
      ),
    },
    {
      label: 'Ordered Stock',
      key: 'ordered_stock',
      render: (val) => (
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
          {Number(val || 0).toLocaleString()} units
        </strong>
      ),
    },
    {
      label: 'Shipped Stock',
      key: 'shipped_stock',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--c-teal)', fontWeight: 600 }}>
          {Number(val || 0).toLocaleString()} units
        </span>
      ),
    },
    {
      label: 'Remaining (Backlog)',
      key: 'remaining',
      render: (_, row) => {
        const remaining = Math.max(0, (row.ordered_stock || 0) - (row.shipped_stock || 0));
        return (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            fontWeight: 700,
            color: remaining > 0 ? 'var(--c-coral, #ef4444)' : 'var(--c-teal, #10b981)'
          }}>
            {remaining.toLocaleString()} units
          </span>
        );
      },
    },
    {
      label: 'Fulfillment',
      key: 'fulfillment_pct',
      render: (_, row) => {
        const pct = row.ordered_stock > 0
          ? Math.min(100, Math.round((row.shipped_stock / row.ordered_stock) * 100))
          : 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 60, height: 6, background: 'var(--bg-panel)', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--c-teal)' : pct > 60 ? 'var(--c-amber)' : 'var(--c-coral, #ef4444)' }}></div>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>{pct}%</span>
          </div>
        );
      },
    },
    {
      label: 'Carrier & Vehicle',
      key: 'carrier',
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 12 }}>{val || '—'}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)' }}>{row.vehicle_no || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Driver & Contact',
      key: 'driver_name',
      render: (val, row) => (
        <div>
          <div style={{ fontSize: 12 }}>{val || '—'}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>{row.driver_phone || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Dispatch Plan / Trip',
      key: 'dispatch_plan',
      render: (val, row) => (
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.trip_id || '—'}</span>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Plan: {val || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Actions',
      key: 'actions',
      render: (_, row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className="btn-ui neutral"
            onClick={() => handleEditRecord(row)}
            title="Edit Stock & Shipping Info"
            style={{ padding: '3px 6px', fontSize: 11 }}
          >
            <Edit2 size={12} />
          </button>
          <button
            className="btn-ui neutral"
            onClick={() => handleDeleteRecord(row.id)}
            title="Delete Record"
            style={{ padding: '3px 6px', fontSize: 11, color: 'var(--c-coral, #ef4444)' }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Subtabs Rail (Identical to other pages) */}
      <div className="subtabs-rail" style={{ marginBottom: 12 }}>
        <div className="subtabs-list">
          <button
            className={`subtab-btn ${activeTab === 'controlled-darkhouses' ? 'active' : ''}`}
            onClick={() => setActiveTab('controlled-darkhouses')}
          >
            Controlled Darkhouses ({records.length})
          </button>
        </div>

        <div className="screen-actions" style={{ paddingBottom: 6 }}>
          {records.length > 0 && (
            <button className="btn-ui neutral" onClick={handleClearAll} title="Clear all darkhouse records">
              <Trash2 size={12} />
              <span>Clear All</span>
            </button>
          )}
          <button className="btn-ui neutral" onClick={handleExportCsv} disabled={records.length === 0}>
            <Download size={12} />
            <span>Export CSV</span>
          </button>
          <button className="btn-ui primary" onClick={handleOpenAddModal}>
            <Plus size={13} />
            <span>Add Darkhouse Stock</span>
          </button>
        </div>
      </div>

      {/* Screen Header */}
      <div className="screen-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="screen-title">
            <span>WAREHOUSE CONTROL: SPOKE DARKHOUSES REPLENISHMENT</span>
            <span className="screen-count-tag">{filteredRecords.length} SPOKES</span>
          </div>
          <div className="screen-subtitle">
            Mother Hub: HYD080M (Hyderabad Mother Hub) • Central replenishment, ordered stock vs shipped, and linehaul fleet status
          </div>
        </div>

        {/* Aggregate KPI Strip */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: '6px 12px' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>Controlled Spokes</span>
            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{records.length}</strong>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: '6px 12px' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>Total Ordered</span>
            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--c-amber)' }}>{totalOrdered.toLocaleString()}</strong>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: '6px 12px' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>Shipped Out</span>
            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--c-teal)' }}>{totalShipped.toLocaleString()}</strong>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: '6px 12px' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>Remaining Backlog</span>
            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: totalRemaining > 0 ? 'var(--c-coral, #ef4444)' : 'var(--c-teal)' }}>
              {totalRemaining.toLocaleString()}
            </strong>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: '6px 12px' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>Fulfillment Rate</span>
            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--c-teal)' }}>{overallRate}%</strong>
          </div>
        </div>
      </div>

      {/* Table Toolbar */}
      <div className="table-toolbar" style={{ marginBottom: 8 }}>
        <div className="search-input-wrap">
          <Search size={13} className="search-icon" />
          <input
            type="text"
            placeholder="Filter by Darkhouse code, name, location, driver, carrier..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
          {filterQuery && (
            <button className="clear-search-btn" onClick={() => setFilterQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Standard DataTable */}
      <DataTable
        columns={columns}
        data={filteredRecords}
        idField="id"
        emptyMessage="No darkhouse replenishment records found. Click 'Add Darkhouse Stock' to add one."
      />

      {/* Add / Edit Darkhouse Replenishment Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <div className="modal-title">
                {editingId ? 'Edit Darkhouse Stock & Transit Record' : 'Add Darkhouse Replenishment Record'}
              </div>
              <button className="btn-ui neutral" onClick={() => setShowAddModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleFormSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Darkhouse Code
                    </label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      placeholder="e.g. HYD078S"
                      required
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Darkhouse Name
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Hyderabad Dark Store 78"
                      required
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Location / Area
                    </label>
                    <input
                      type="text"
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      placeholder="e.g. Madhapur Sector, Hyderabad"
                      required
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Distance (km)
                    </label>
                    <input
                      type="number"
                      value={formData.distance_km}
                      onChange={(e) => setFormData({ ...formData, distance_km: e.target.value })}
                      placeholder="e.g. 18"
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Ordered Stock (Units)
                    </label>
                    <input
                      type="number"
                      value={formData.ordered_stock}
                      onChange={(e) => setFormData({ ...formData, ordered_stock: e.target.value })}
                      placeholder="e.g. 1500"
                      required
                      min="1"
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Shipped Stock (Units)
                    </label>
                    <input
                      type="number"
                      value={formData.shipped_stock}
                      onChange={(e) => setFormData({ ...formData, shipped_stock: e.target.value })}
                      placeholder="e.g. 1200"
                      min="0"
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Carrier / Transporter
                    </label>
                    <input
                      type="text"
                      value={formData.carrier}
                      onChange={(e) => setFormData({ ...formData, carrier: e.target.value })}
                      placeholder="e.g. SpeedCargo Linehaul"
                      required
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Linehaul Vehicle No
                    </label>
                    <input
                      type="text"
                      value={formData.vehicle_no}
                      onChange={(e) => setFormData({ ...formData, vehicle_no: e.target.value })}
                      placeholder="e.g. TS12UC7777"
                      required
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Driver Name
                    </label>
                    <input
                      type="text"
                      value={formData.driver_name}
                      onChange={(e) => setFormData({ ...formData, driver_name: e.target.value })}
                      placeholder="e.g. Ramesh Naidu"
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Driver Phone
                    </label>
                    <input
                      type="text"
                      value={formData.driver_phone}
                      onChange={(e) => setFormData({ ...formData, driver_phone: e.target.value })}
                      placeholder="e.g. +91 98480 11223"
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Dispatch Plan
                    </label>
                    <input
                      type="text"
                      value={formData.dispatch_plan}
                      onChange={(e) => setFormData({ ...formData, dispatch_plan: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Trip ID
                    </label>
                    <input
                      type="text"
                      value={formData.trip_id}
                      onChange={(e) => setFormData({ ...formData, trip_id: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Transit Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <option value="PLANNED">PLANNED</option>
                      <option value="LOADING">LOADING</option>
                      <option value="IN_TRANSIT">IN_TRANSIT</option>
                      <option value="DOCKED_AT_BAY">DOCKED_AT_BAY</option>
                      <option value="COMPLETED">COMPLETED</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                    Dock / Transit Info Note
                  </label>
                  <input
                    type="text"
                    value={formData.dock_info}
                    onChange={(e) => setFormData({ ...formData, dock_info: e.target.value })}
                    placeholder="e.g. Departed Dock Door 3 • ETA: 25 mins"
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-xs)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary">
                  {editingId ? 'Save Changes' : 'Add Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
