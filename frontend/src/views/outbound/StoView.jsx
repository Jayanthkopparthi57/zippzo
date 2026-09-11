import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { RefreshCw, Download, Search, Plus, X, Package, CheckCircle2 } from 'lucide-react';

export default function StoView({ initialTab = 'sto' }) {
  const [activeSubtab, setActiveSubtab] = useState(initialTab);
  const [orders, setOrders] = useState([]);
  const [cancelPutaways, setCancelPutaways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedDetailRow, setSelectedDetailRow] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sites, setSites] = useState([]);

  // New STO state
  const [newOrder, setNewOrder] = useState({
    order_no: `SHYD08000E${Math.floor(100 + Math.random() * 900)}`,
    type: 'REGULAR',
    section: 'GROCERY',
    ordered_qty: 200,
    ordered_skus: 1,
    final_dest: '',
  });

  useEffect(() => {
    if (initialTab) setActiveSubtab(initialTab);
  }, [initialTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeSubtab === 'cancellation-putaway') {
        const cpData = await apiClient.get('/outbound/cancellation-putaways/');
        setCancelPutaways(cpData.results || []);
      } else {
        const data = await apiClient.get('/outbound/orders/');
        setOrders(data.results || []);
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
        setNewOrder(prev => ({ ...prev, final_dest: data.results[0].site_id }));
      }
    } catch (err) {
      console.error('Failed loading sites:', err);
    }
  };

  useEffect(() => {
    loadData();
    loadSites();
  }, [activeSubtab]);

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    try {
      await apiClient.post('/outbound/orders/', {
        order_no: newOrder.order_no,
        type: newOrder.type,
        section: newOrder.section,
        ordered_qty: parseInt(newOrder.ordered_qty) || 100,
        ordered_skus: parseInt(newOrder.ordered_skus) || 1,
        final_dest: newOrder.final_dest || null,
        status: 'CREATED',
      });
      setShowCreateModal(false);
      setNewOrder(prev => ({
        ...prev,
        order_no: `SHYD08000E${Math.floor(100 + Math.random() * 900)}`,
      }));
      await loadData();
    } catch (err) {
      console.error('Failed creating STO:', err);
      alert('Error creating STO.');
    }
  };

  const handleCompleteCp = async (cp) => {
    try {
      await apiClient.patch(`/outbound/cancellation-putaways/${cp.cp_id}/`, {
        status: 'COMPLETED',
      });
      await loadData();
    } catch (err) {
      console.error('Failed completing cancellation putaway:', err);
    }
  };

  const handleDownloadCsv = () => {
    if (activeSubtab === 'cancellation-putaway') {
      if (cancelPutaways.length === 0) return;
      const headers = ['CP ID', 'Order No', 'Status', 'Pending SKUs', 'Remaining Qty', 'Pending LPNs', 'Created At'];
      const rows = cancelPutaways.map(c => [
        c.cp_id,
        c.order_no || '—',
        c.status,
        c.pending_skus || 0,
        c.remaining_qty || 0,
        c.pending_lpns || 0,
        c.created_at,
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `Cancellation_Putaway_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      if (orders.length === 0) return;
      const headers = ['Order No', 'Status', 'Type', 'Section', 'Source', 'Destination', 'Ordered Qty', 'Allocated Qty', 'Shipped Qty'];
      const rows = orders.map(o => [
        o.order_no,
        o.status,
        o.type,
        o.section || 'GROCERY',
        o.source_site_code || 'HYD080M',
        o.final_dest_code || '—',
        o.ordered_qty || 0,
        o.allocated_qty || 0,
        o.shipped_qty || 0,
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `Zippzo_STOs_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const orderColumns = [
    {
      label: 'STO ID',
      key: 'order_no',
      render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Type',
      key: 'type',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || 'REGULAR'}</span>,
    },
    {
      label: 'Section',
      key: 'section',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{val || 'GROCERY'}</span>,
    },
    {
      label: 'Source',
      key: 'source_site_code',
      render: (val, row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {row.source_site_code ? `${row.source_site_code}${row.source_site_name ? ' - ' + row.source_site_name : ''}` : 'HYD080M'}
        </span>
      ),
    },
    {
      label: 'Destination',
      key: 'final_dest_code',
      render: (val, row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)', fontWeight: 500 }}>
          {row.final_dest_code ? `${row.final_dest_code}${row.final_dest_name ? ' - ' + row.final_dest_name : ''}` : '—'}
        </span>
      ),
    },
    {
      label: 'Ordered Qty',
      key: 'ordered_qty',
      render: (val, row) => {
        const qty = val ?? (row.lines?.reduce((s, l) => s + (l.ordered_qty || 0), 0) ?? 0);
        const skus = row.ordered_skus ?? (row.lines?.length || 0);
        return (
          <div>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{qty}</span>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{skus} SKU{skus === 1 ? '' : 's'}</div>
          </div>
        );
      },
    },
    {
      label: 'Allocated Qty',
      key: 'allocated_qty',
      render: (val, row) => <span style={{ fontFamily: 'var(--font-mono)' }}>{row.allocated_qty ?? 0}</span>,
    },
    {
      label: 'Picked Qty',
      key: 'picked_qty',
      render: (val, row) => <span style={{ fontFamily: 'var(--font-mono)' }}>{row.picked_qty ?? 0}</span>,
    },
    {
      label: 'Shipped Qty',
      key: 'shipped_qty',
      render: (val, row) => <span style={{ fontFamily: 'var(--font-mono)' }}>{row.shipped_qty ?? 0}</span>,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => (
        <button
          className="btn-ui neutral"
          style={{ padding: '2px 8px', fontSize: 10.5 }}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedDetailRow(row);
          }}
        >
          Details
        </button>
      ),
    },
  ];

  const cpColumns = [
    {
      label: 'Task ID',
      key: 'cp_id',
      render: (val) => <strong style={{ color: 'var(--c-rust)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? val.slice(0, 12) : '—'}</strong>,
    },
    {
      label: 'Order Reference',
      key: 'order_no',
      render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val || '—'}</strong>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Pending SKUs',
      key: 'pending_skus',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ?? 0}</span>,
    },
    {
      label: 'Remaining Units',
      key: 'remaining_qty',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ?? 0}</span>,
    },
    {
      label: 'Pending LPNs',
      key: 'pending_lpns',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</span>,
    },
    {
      label: 'Created Date',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => row.status !== 'COMPLETED' ? (
        <button
          className="btn-ui neutral"
          style={{ padding: '2px 8px', fontSize: 10.5 }}
          onClick={(e) => {
            e.stopPropagation();
            handleCompleteCp(row);
          }}
        >
          <CheckCircle2 size={11} style={{ color: '#48a968' }} />
          <span>Complete Restock</span>
        </button>
      ) : (
        <span style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)' }}>Restocked</span>
      ),
    },
  ];

  const filteredOrders = orders.filter(o => {
    if (activeSubtab === 'returns' && o.type !== 'RETURN') return false;
    const matchesFilter = statusFilter === 'ALL' || o.status === statusFilter;
    if (!matchesFilter) return false;
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (o.order_no && o.order_no.toLowerCase().includes(q)) ||
      (o.final_dest_code && o.final_dest_code.toLowerCase().includes(q)) ||
      (o.section && o.section.toLowerCase().includes(q))
    );
  });

  const filteredCps = cancelPutaways.filter(c => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (c.order_no && c.order_no.toLowerCase().includes(q)) ||
      (c.status && c.status.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      {/* Subtab navigation */}
      <div className="subtabs-rail" style={{ marginBottom: 12 }}>
        <div className="subtabs-list">
          <button
            className={`subtab-btn ${activeSubtab === 'sto' ? 'active' : ''}`}
            onClick={() => setActiveSubtab('sto')}
          >
            STO Requisitions
          </button>
          <button
            className={`subtab-btn ${activeSubtab === 'transfer-orders' ? 'active' : ''}`}
            onClick={() => setActiveSubtab('transfer-orders')}
          >
            Transfer Orders
          </button>
          <button
            className={`subtab-btn ${activeSubtab === 'returns' ? 'active' : ''}`}
            onClick={() => setActiveSubtab('returns')}
          >
            Returns
          </button>
          <button
            className={`subtab-btn ${activeSubtab === 'cancellation-putaway' ? 'active' : ''}`}
            onClick={() => setActiveSubtab('cancellation-putaway')}
          >
            Cancellation Putaway ({cancelPutaways.length})
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
          {activeSubtab !== 'cancellation-putaway' && (
            <button className="btn-ui primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={13} />
              <span>New STO</span>
            </button>
          )}
        </div>
      </div>

      {/* Screen Header Description */}
      <div className="screen-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="screen-title">
            <span>
              {activeSubtab === 'cancellation-putaway'
                ? 'CANCELLATION PUTAWAY & RESTOCKING'
                : activeSubtab === 'returns'
                ? 'OUTBOUND STORE RETURNS'
                : 'STOCK TRANSFER ORDERS (STO)'}
            </span>
            <span className="screen-count-tag">
              {activeSubtab === 'cancellation-putaway' ? filteredCps.length : filteredOrders.length} Records
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {activeSubtab === 'cancellation-putaway'
              ? 'Restock items from canceled pick waves, short-picks, and damaged tote consolidations.'
              : 'Inter-warehouse stock transfer requisitions and dark store replenishment orders.'}
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

      {/* Filter Tabs for STO status */}
      {activeSubtab !== 'cancellation-putaway' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
          {['ALL', 'CREATED', 'ALLOCATED', 'PICKING', 'SORTED', 'SHIPPED', 'GRN_DONE'].map(status => (
            <button
              key={status}
              className={`subtab-btn ${statusFilter === status ? 'active' : ''}`}
              onClick={() => setStatusFilter(status)}
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              {status}
            </button>
          ))}
        </div>
      )}

      {/* Data Table */}
      {activeSubtab === 'cancellation-putaway' ? (
        <DataTable
          columns={cpColumns}
          data={filteredCps}
          idField="cp_id"
          emptyMessage="No cancellation putaway tasks registered."
        />
      ) : (
        <DataTable
          columns={orderColumns}
          data={filteredOrders}
          idField="order_id"
          selectable={true}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          emptyMessage="No stock transfer orders found."
        />
      )}

      {/* Slide-out Order Detail Drawer */}
      {selectedDetailRow && (
        <div className="drawer-backdrop" onClick={() => setSelectedDetailRow(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
            <div className="drawer-header">
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                  STO ORDER SPECIFICATION
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>
                  {selectedDetailRow.order_no}
                </div>
              </div>
              <button className="btn-ui neutral" onClick={() => setSelectedDetailRow(null)}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, fontSize: 12 }}>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>STATUS</div>
                <div style={{ fontWeight: 600 }}>{selectedDetailRow.status}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>SECTION</div>
                <div style={{ fontWeight: 600 }}>{selectedDetailRow.section || 'GROCERY'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>SOURCE WAREHOUSE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{selectedDetailRow.source_site_code || 'HYD080M'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>DESTINATION</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)' }}>{selectedDetailRow.final_dest_code || '—'}</div>
              </div>
            </div>

            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, marginBottom: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
              Order SKUs & Allocations ({selectedDetailRow.lines?.length || 0})
            </div>

            {selectedDetailRow.lines && selectedDetailRow.lines.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedDetailRow.lines.map((line, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{line.sku_name || line.sku_code || 'SKU Item'}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      <span>Ordered: {line.ordered_qty}</span>
                      <span>Allocated: {line.allocated_qty || 0}</span>
                      <span style={{ color: 'var(--c-teal)' }}>{line.line_status || 'OPEN'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No line item allocations registered for this order.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create STO Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <div className="modal-title">Create New Stock Transfer Order</div>
              <button className="btn-ui neutral" onClick={() => setShowCreateModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateOrder}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Order Number</label>
                  <input
                    type="text"
                    value={newOrder.order_no}
                    onChange={(e) => setNewOrder({ ...newOrder, order_no: e.target.value })}
                    required
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Section</label>
                    <select
                      value={newOrder.section}
                      onChange={(e) => setNewOrder({ ...newOrder, section: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                    >
                      <option value="GROCERY">GROCERY</option>
                      <option value="DAIRY">DAIRY</option>
                      <option value="FROZEN">FROZEN</option>
                      <option value="NON_FOOD">NON_FOOD</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Type</label>
                    <select
                      value={newOrder.type}
                      onChange={(e) => setNewOrder({ ...newOrder, type: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                    >
                      <option value="REGULAR">REGULAR</option>
                      <option value="RETURN">RETURN</option>
                      <option value="ADHOC">ADHOC</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Destination Dark Store</label>
                    <select
                      value={newOrder.final_dest}
                      onChange={(e) => setNewOrder({ ...newOrder, final_dest: e.target.value })}
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
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Ordered Units</label>
                    <input
                      type="number"
                      value={newOrder.ordered_qty}
                      onChange={(e) => setNewOrder({ ...newOrder, ordered_qty: e.target.value })}
                      required
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary">
                  Generate STO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
