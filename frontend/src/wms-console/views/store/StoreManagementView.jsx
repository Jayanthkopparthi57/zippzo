import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { Plus, RefreshCw, Download, Search, X, Trash2, Edit2 } from 'lucide-react';

export default function StoreManagementView() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSite, setEditingSite] = useState(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    address: '',
    status: 'ONBOARDING',
    is_accepting_orders: false,
  });
  const [formError, setFormError] = useState('');

  const resultsFrom = (data) => Array.isArray(data) ? data : data.results || [];

  const loadData = async () => {
    setLoading(true);
    try {
      const [sitesData, transfersData] = await Promise.all([
        apiClient.get('/network/sites/', { site_type: 'DS', page_size: 500 }),
        apiClient.get('/ds-ops/transfer-orders/', { page_size: 1000 }),
      ]);
      const transfers = resultsFrom(transfersData);
      const aggregateBySite = new Map();
      transfers.forEach(transfer => {
        const key = transfer.dest_site;
        const existing = aggregateBySite.get(key) || {
          transfer_count: 0,
          ordered_stock: 0,
          shipped_stock: 0,
          received_stock: 0,
        };
        existing.transfer_count += 1;
        existing.ordered_stock += Number(transfer.ordered_units ?? transfer.total_qty ?? 0);
        existing.shipped_stock += Number(transfer.shipped_units ?? 0);
        existing.received_stock += Number(transfer.received_units ?? 0);
        aggregateBySite.set(key, existing);
      });

      setRecords(resultsFrom(sitesData).map(site => {
        const aggregate = aggregateBySite.get(site.site_id) || {
          transfer_count: 0,
          ordered_stock: 0,
          shipped_stock: 0,
          received_stock: 0,
        };
        return {
          ...site,
          id: site.site_id,
          location: site.address || '—',
          ...aggregate,
        };
      }));
    } catch (err) {
      console.error('Failed loading darkhouses:', err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingSite(null);
    setFormError('');
    setFormData({
      code: '',
      name: '',
      address: '',
      status: 'ONBOARDING',
      is_accepting_orders: false,
    });
    setShowAddModal(true);
  };

  const openEditModal = (row) => {
    setEditingSite(row);
    setFormError('');
    setFormData({
      code: row.code,
      name: row.name,
      address: row.address || '',
      status: row.status || 'ONBOARDING',
      is_accepting_orders: Boolean(row.is_accepting_orders),
    });
    setShowAddModal(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    try {
      const payload = {
        code: formData.code.trim(),
        name: formData.name.trim(),
        address: formData.address.trim(),
        status: formData.status,
        is_accepting_orders: formData.is_accepting_orders,
      };
      if (editingSite) {
        await apiClient.patch(`/network/sites/${editingSite.site_id}/`, payload);
      } else {
        await apiClient.post('/network/sites/', {
          ...payload,
          site_type: 'DS',
        });
      }
      setShowAddModal(false);
      await loadData();
    } catch (err) {
      console.error('Failed saving darkhouse:', err);
      setFormError(err.message || 'Failed saving darkhouse.');
    }
  };

  const handleDelete = async (record) => {
    if (!window.confirm(`Delete darkhouse ${record.code}?`)) return;
    try {
      await apiClient.delete(`/network/sites/${record.site_id}/`);
      await loadData();
    } catch (err) {
      console.error('Failed deleting darkhouse:', err);
      setFormError(err.message || 'Failed deleting darkhouse.');
    }
  };

  const handleExportCsv = () => {
    if (records.length === 0) return;
    const headers = [
      'Darkhouse Code',
      'Name',
      'Address',
      'Ordered Stock',
      'Shipped Stock',
      'Received Stock',
      'Remaining Stock',
      'Fulfillment %',
      'Transfer Orders',
      'Status',
    ];
    const rows = records.map(r => {
      const remaining = Math.max(0, (r.ordered_stock || 0) - (r.shipped_stock || 0));
      const pct = r.ordered_stock > 0 ? ((r.shipped_stock / r.ordered_stock) * 100).toFixed(1) + '%' : '0%';
      return [
        r.code,
        r.name,
        r.address || '—',
        r.ordered_stock || 0,
        r.shipped_stock || 0,
        r.received_stock || 0,
        remaining,
        pct,
        r.transfer_count || 0,
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

  const totalOrdered = records.reduce((acc, r) => acc + Number(r.ordered_stock || 0), 0);
  const totalShipped = records.reduce((acc, r) => acc + Number(r.shipped_stock || 0), 0);
  const totalRemaining = Math.max(0, totalOrdered - totalShipped);
  const overallRate = totalOrdered > 0 ? ((totalShipped / totalOrdered) * 100).toFixed(1) : '0.0';

  const filteredRecords = records.filter(r => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (r.code && r.code.toLowerCase().includes(q)) ||
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.address && r.address.toLowerCase().includes(q)) ||
      (r.status && r.status.toLowerCase().includes(q))
    );
  });

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
      label: 'Address',
      key: 'address',
      render: (val) => <span style={{ fontSize: 12 }}>{val || '—'}</span>,
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
      label: 'Transfer Orders',
      key: 'transfer_count',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong>,
    },
    {
      label: 'Received Stock',
      key: 'received_stock',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>{Number(val || 0).toLocaleString()} units</span>,
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
            onClick={() => openEditModal(row)}
            title="Edit Darkhouse"
            style={{ padding: '3px 6px', fontSize: 11 }}
          >
            <Edit2 size={12} />
          </button>
          <button
            className="btn-ui neutral"
            onClick={() => handleDelete(row)}
            title="Delete Darkhouse"
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
      <div className="subtabs-rail" style={{ marginBottom: 12 }}>
        <div className="subtabs-list">
          <button className="subtab-btn active">
            Controlled Darkhouses ({records.length})
          </button>
        </div>

        <div className="screen-actions" style={{ paddingBottom: 6 }}>
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          <button className="btn-ui neutral" onClick={handleExportCsv} disabled={records.length === 0}>
            <Download size={12} />
            <span>Export CSV</span>
          </button>
          <button className="btn-ui primary" onClick={openCreateModal}>
            <Plus size={13} />
            <span>Add Darkhouse</span>
          </button>
        </div>
      </div>

      <div className="screen-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="screen-title">
            <span>WAREHOUSE CONTROL: SPOKE DARKHOUSES REPLENISHMENT</span>
            <span className="screen-count-tag">{filteredRecords.length} SPOKES</span>
          </div>
          <div className="screen-subtitle">
            Dark-store network and transfer-order stock movement
          </div>
        </div>

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

      <div className="table-toolbar" style={{ marginBottom: 8 }}>
        <div className="search-input-wrap">
          <Search size={13} className="search-icon" />
          <input
            type="text"
            placeholder="Filter by Darkhouse code, name, address, or status..."
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

      {formError && <div className="form-error-banner" style={{ marginBottom: 12 }}>{formError}</div>}

      <DataTable
        columns={columns}
        data={filteredRecords}
        idField="site_id"
        emptyMessage="No darkhouses found. Click 'Add Darkhouse' to create one."
      />

      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <div className="modal-title">
                {editingSite ? 'Edit Darkhouse' : 'Add Darkhouse'}
              </div>
              <button className="btn-ui neutral" onClick={() => setShowAddModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {formError && <div className="form-error-banner">{formError}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Darkhouse Code
                    </label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      required
                      disabled={Boolean(editingSite)}
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

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                    Address
                  </label>
                  <textarea
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    rows={3}
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Status
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
                      <option value="ONBOARDING">ONBOARDING</option>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="SUSPENDED">SUSPENDED</option>
                      <option value="RETIRED">RETIRED</option>
                    </select>
                  </div>
                  <label className="crud-checkbox" style={{ alignSelf: 'end' }}>
                    <input
                      type="checkbox"
                      checked={formData.is_accepting_orders}
                      onChange={(e) => setFormData({ ...formData, is_accepting_orders: e.target.checked })}
                    />
                    <span>Accepting Orders</span>
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary">
                  {editingSite ? 'Save Changes' : 'Add Darkhouse'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
