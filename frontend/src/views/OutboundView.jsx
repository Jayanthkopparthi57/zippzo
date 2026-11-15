import React, { useState, useEffect } from 'react';
import { ArrowRightLeft, Plus, RotateCcw, ArrowLeft, PackageCheck } from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import { fetchApi, postApi } from '../api/client';

export default function OutboundView({ initialTab = 'sto' }) {
  const [activeSubtab, setActiveSubtab] = useState(initialTab);
  const [orders, setOrders] = useState([]);
  const [cancelPutaways, setCancelPutaways] = useState([]);
  const [sites, setSites] = useState([]);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);

  const loadData = () => {
    fetchApi('/outbound/orders/').then(res => {
      if (Array.isArray(res)) setOrders(res);
    });
    fetchApi('/outbound/cancellation-putaways/').then(res => {
      if (Array.isArray(res)) setCancelPutaways(res);
    });
    fetchApi('/master/sites/').then(res => {
      if (Array.isArray(res)) setSites(res);
    });
  };

  useEffect(() => {
    setActiveSubtab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const sourceSiteId = fd.get('source_site') || (sites[0] && sites[0].site_id);
    const destSiteId = fd.get('dest_site') || (sites[1] && sites[1].site_id) || sourceSiteId;
    const orderType = fd.get('order_type') || 'STO';

    const payload = {
      order_no: `ORD-${Date.now().toString().slice(-5)}`,
      type: orderType,
      processing_type: 'LPN_BASED',
      source_site: sourceSiteId,
      final_dest: destSiteId,
      status: 'ALLOCATED',
      ordered_qty: Number(fd.get('qty') || 25),
      ordered_skus: 1
    };

    try {
      await postApi('/outbound/orders/', payload);
      loadData();
      setIsCreatingOrder(false);
    } catch (err) {
      alert(`Error creating STO order: ${err.message}`);
    }
  };

  const stoOrders = orders.filter(o => o.type === 'STO' || o.type === 'REGULAR');
  const returnOrders = orders.filter(o => o.type === 'RETURN' || o.type === 'EXTERNAL_RTV');
  const secondarySalesOrders = orders.filter(o => o.type === 'SECONDARY_SALES');
  const scrapOrders = orders.filter(o => o.type === 'SCRAP');

  // ══════════════════════════════════════════════════════════════════
  // 1. DEDICATED PAGE: CREATE STO ORDER
  // ══════════════════════════════════════════════════════════════════
  if (isCreatingOrder) {
    return (
      <div className="animate-fade" style={{ padding: '24px 32px', maxWidth: 850, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <button
            className="btn-secondary"
            onClick={() => setIsCreatingOrder(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', fontWeight: 600 }}
          >
            <ArrowLeft size={16} /> Back to Outbound Orders
          </button>
          <span className="badge badge-purple" style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700 }}>
            Mother Hub: RJY-DS-001 Requisitions
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
              <PackageCheck size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Create Stock Transfer Order (STO)
              </h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '3px 0 0 0' }}>
                Requisition dark store replenishment transfer from Central Mother Hub
              </p>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0' }} />

          <form onSubmit={handleCreateOrder}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>Order Type</label>
                <select className="form-input" name="order_type" defaultValue="STO">
                  <option value="STO">Stock Transfer Order (STO)</option>
                  <option value="REGULAR">Regular Order</option>
                  <option value="RETURN">Return Order</option>
                  <option value="SECONDARY_SALES">Secondary Sales</option>
                  <option value="SCRAP">Scrap Inventory</option>
                </select>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>Order Quantity (Units)</label>
                <input type="number" className="form-input" name="qty" defaultValue="50" min="1" required />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>Source Facility (Mother Hub)</label>
                <select className="form-input" name="source_site">
                  {sites.map(s => (
                    <option key={s.site_id} value={s.site_id}>{s.name} ({s.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 700, color: '#059669' }}>Destination Dark Store</label>
                <select className="form-input" name="dest_site" style={{ borderColor: '#059669', borderWidth: 2 }}>
                  {sites.map(s => (
                    <option key={s.site_id} value={s.site_id}>{s.name} ({s.code})</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button type="button" className="btn-secondary" onClick={() => setIsCreatingOrder(false)} style={{ padding: '10px 20px', fontWeight: 600 }}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" style={{ background: '#7c3aed', color: '#fff', padding: '10px 24px', fontWeight: 700, fontSize: 14 }}>
                Generate STO Order
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
        <button className={`subtab-btn ${activeSubtab === 'sto' ? 'active' : ''}`} onClick={() => setActiveSubtab('sto')}>STO Requisitions</button>
        <button className={`subtab-btn ${activeSubtab === 'transfer-orders' ? 'active' : ''}`} onClick={() => setActiveSubtab('transfer-orders')}>Transfer Orders</button>
        <button className={`subtab-btn ${activeSubtab === 'returns' ? 'active' : ''}`} onClick={() => setActiveSubtab('returns')}>Returns</button>
        <button className={`subtab-btn ${activeSubtab === 'secondary-sales' ? 'active' : ''}`} onClick={() => setActiveSubtab('secondary-sales')}>Secondary Sales</button>
        <button className={`subtab-btn ${activeSubtab === 'scrap-inventory' ? 'active' : ''}`} onClick={() => setActiveSubtab('scrap-inventory')}>Scrap Inventory</button>
        <button className={`subtab-btn ${activeSubtab === 'cancellation-putaway' ? 'active' : ''}`} onClick={() => setActiveSubtab('cancellation-putaway')}>Cancellation Putaway</button>
      </div>

      {/* STO / Transfer Orders */}
      {(activeSubtab === 'sto' || activeSubtab === 'transfer-orders') && (
        <DataTable
          title="Fulfillment & Stock Transfer Orders (STO)"
          subtitle="Real-time 10-Min Dark Store orders with item picking & dispatch progress (Click row to inspect line items)"
          onAdd={() => setIsCreatingOrder(true)}
          addLabel="Create STO"
          columns={[
            { header: 'Order Ref #', key: 'order_no', render: r => <strong style={{ color: 'var(--accent-purple-dark)', fontFamily: 'monospace', fontSize: '13px' }}>{r.order_no}</strong> },
            { header: 'Delivery Destination', key: 'remarks', render: r => <span>{r.remarks || r.final_dest_name || 'Banjara Hills Hub Drop'}</span> },
            { header: 'Required Units', key: 'ordered_qty', render: r => <span style={{ fontWeight: '700', fontSize: '13px' }}>{r.ordered_qty || 0}</span> },
            { header: 'Picked Units', key: 'picked_qty', render: r => <strong style={{ color: 'var(--accent-purple-dark)', fontSize: '13px' }}>{r.picked_qty || 0}</strong> },
            { header: 'Shipped Units', key: 'shipped_qty', render: r => <strong style={{ color: '#059669', fontSize: '13px' }}>{r.shipped_qty || 0}</strong> },
            {
              header: 'Fulfillment Progress',
              key: 'progress',
              render: r => {
                const req = r.ordered_qty || 1;
                const done = r.shipped_qty || r.picked_qty || 0;
                const pct = Math.min(100, Math.round((done / req) * 100));
                return (
                  <div style={{ minWidth: '110px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: '700', marginBottom: '3px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{r.status}</span>
                      <span style={{ color: 'var(--accent-purple-dark)' }}>{pct}%</span>
                    </div>
                    <div style={{ height: '5px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#059669' : 'var(--accent-purple-dark)', borderRadius: '3px' }} />
                    </div>
                  </div>
                );
              }
            },
            {
              header: 'Status',
              key: 'status',
              render: r => {
                const badgeClass = r.status === 'SHIPPED' ? 'badge-success' : r.status === 'PICKING' ? 'badge-info' : 'badge-warning';
                return <span className={`badge ${badgeClass}`}>{r.status}</span>;
              }
            },
          ]}
          data={stoOrders}
        />
      )}

      {/* Returns */}
      {activeSubtab === 'returns' && (
        <DataTable
          title="Returns & Reverse Logistics (RTV)"
          subtitle="Manage dark-store returns and vendor RMA workflows"
          columns={[
            { header: 'Order Ref #', key: 'order_no', render: r => <strong className="code-cell">{r.order_no}</strong> },
            { header: 'Type', key: 'type', render: r => <span className="badge badge-warning">{r.type}</span> },
            { header: 'Return Quantity', key: 'ordered_qty' },
            { header: 'Status', key: 'status', render: r => <span className="badge badge-info">{r.status}</span> },
            { header: 'Initiated Date', key: 'created_at', render: r => <span>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</span> },
          ]}
          data={returnOrders}
        />
      )}

      {/* Secondary Sales */}
      {activeSubtab === 'secondary-sales' && (
        <DataTable
          title="Secondary Channel Dispatches"
          subtitle="B2B transfers and wholesale liquidations"
          columns={[
            { header: 'Order Ref #', key: 'order_no', render: r => <strong className="code-cell">{r.order_no}</strong> },
            { header: 'Channel Destination', key: 'remarks' },
            { header: 'Volume (Units)', key: 'ordered_qty' },
            { header: 'Status', key: 'status', render: r => <span className="badge badge-purple">{r.status}</span> },
          ]}
          data={secondarySalesOrders}
        />
      )}

      {/* Scrap Inventory */}
      {activeSubtab === 'scrap-inventory' && (
        <DataTable
          title="Scrap & Write-Off Ledger"
          subtitle="Decommissioned stock due to expiry or terminal damage"
          columns={[
            { header: 'Reference', key: 'order_no', render: r => <strong className="code-cell">{r.order_no}</strong> },
            { header: 'Scrap Reason', key: 'remarks' },
            { header: 'Write-off Quantity', key: 'ordered_qty' },
            { header: 'Status', key: 'status', render: r => <span className="badge badge-danger">{r.status}</span> },
          ]}
          data={scrapOrders}
        />
      )}

      {/* Cancellation Putaway */}
      {activeSubtab === 'cancellation-putaway' && (
        <DataTable
          title="Cancelled Order Restocking / Putaway"
          subtitle="Stock recovered from cancelled picks requiring re-binning"
          columns={[
            { header: 'ID', key: 'id', render: r => <span className="code-cell">CP-{r.id}</span> },
            { header: 'Item Name', key: 'sku_name', render: r => <strong>{r.sku_name || 'Standard SKU'}</strong> },
            { header: 'Return Quantity', key: 'qty' },
            { header: 'Suggested Bin', key: 'suggested_bin_code', render: r => <span className="badge badge-info">{r.suggested_bin_code || 'A-01-01-01'}</span> },
            { header: 'Worker Assigned', key: 'assigned_worker_name', render: r => <span>{r.assigned_worker_name || 'Unassigned'}</span> },
            { header: 'Status', key: 'status', render: r => <span className={`badge ${r.status === 'COMPLETED' ? 'badge-success' : 'badge-warning'}`}>{r.status}</span> },
          ]}
          data={cancelPutaways}
        />
      )}
    </div>
  );
}
