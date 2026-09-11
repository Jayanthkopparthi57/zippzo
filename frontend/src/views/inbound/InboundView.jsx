import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import {
  RefreshCw,
  Plus,
  ArrowDownToLine,
  CheckCircle2,
  AlertTriangle,
  FileText,
  X,
  Search
} from 'lucide-react';

function makeCode(prefix, value) {
  const slug = String(value || prefix)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 18);
  return `${prefix}-${slug || 'NEW'}-${Date.now().toString().slice(-5)}`;
}

function makeBarcode() {
  return `${Date.now()}${Math.floor(100 + Math.random() * 900)}`.slice(-13);
}

const DEFAULT_WAREHOUSE_CODE = 'HYD080M';

export default function InboundView({ initialSubtab = 'asns' }) {
  const [activeSubtab, setActiveSubtab] = useState(initialSubtab);
  const [loading, setLoading] = useState(true);
  const [dataList, setDataList] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedDetailRow, setSelectedDetailRow] = useState(null);

  // Modals state
  const [showCreateAsnModal, setShowCreateAsnModal] = useState(false);
  const [showInwardModal, setShowInwardModal] = useState(false);
  const [inwardTargetAsn, setInwardTargetAsn] = useState(null);
  const [dockDoors, setDockDoors] = useState([]);

  // New ASN form state
  const [newAsn, setNewAsn] = useState({
    asn_no: `ASN-${Date.now().toString().slice(-6)}`,
    type: 'VENDOR_PO',
    vendor_name: '',
    dest_site: '',
    po_ref: '',
    expected_vehicle: '',
    door: '',
    primary_item_name: '',
    primary_item_code: '',
    qty: 100,
  });

  const loadData = async (subtab = activeSubtab) => {
    setLoading(true);
    setSelectedIds([]);
    try {
      if (subtab === 'asns') {
        const res = await apiClient.get('/inbound/asns/');
        setDataList(res.results || []);
      } else if (subtab === 'grns') {
        const res = await apiClient.get('/inbound/grns/');
        setDataList(res.results || []);
      } else if (subtab === 'putaway') {
        const res = await apiClient.get('/inbound/putaway-tasks/');
        setDataList(res.results || []);
      } else if (subtab === 'discrepancies') {
        const res = await apiClient.get('/inbound/discrepancies/');
        setDataList(res.results || []);
      }
    } catch (err) {
      console.error('Failed loading inbound data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMasterData = async () => {
    try {
      const [dRes, siteRes] = await Promise.all([
        apiClient.get('/master/dock-doors/'),
        apiClient.get('/master/sites/'),
      ]);
      setDockDoors(dRes.results || []);
      if (dRes.results?.length > 0) setNewAsn(prev => ({ ...prev, door: dRes.results[0].door_id }));
      // This deployment operates a single active warehouse, so inbound defaults there.
      const defaultSite = siteRes.results?.find(s => s.code === DEFAULT_WAREHOUSE_CODE) || siteRes.results?.[0];
      if (defaultSite) setNewAsn(prev => ({ ...prev, dest_site: defaultSite.site_id }));
    } catch (err) {
      console.error('Master data fetch error:', err);
    }
  };

  useEffect(() => {
    loadData(activeSubtab);
  }, [activeSubtab]);

  useEffect(() => {
    loadMasterData();
  }, []);

  const handleCreateAsn = async (e) => {
    e.preventDefault();
    try {
      const vendorName = newAsn.vendor_name.trim();
      const itemName = newAsn.primary_item_name.trim();
      const itemCode = newAsn.primary_item_code.trim() || makeCode('SKU', itemName);

      const createdVendor = await apiClient.post('/master/vendors/', {
        code: makeCode('VND', vendorName),
        name: vendorName,
        org_entity: 'INBOUND',
        is_customer: false,
        is_sku_vendor: true,
        status: 'Active',
      });

      const createdSku = await apiClient.post('/master/skus/', {
        sku_code: itemCode,
        name: itemName,
        ean: makeBarcode(),
        sub_category: 'Inbound',
        mrp: 0,
        wac: 0,
        pack_size: '',
        storage_zone: 'DRY',
        shelf_life_days: 365,
        is_food: true,
        status: 'ACTIVE',
      });

      // 1. Create ASN
      const createdAsn = await apiClient.post('/inbound/asns/', {
        asn_no: newAsn.asn_no,
        type: newAsn.type,
        source_vendor: createdVendor.vendor_id,
        dest_site: newAsn.dest_site,
        po_ref: newAsn.po_ref,
        door: newAsn.door || null,
        expected_vehicle: newAsn.expected_vehicle,
        total_skus: 1,
        total_qty: parseInt(newAsn.qty) || 100,
        status: 'ARRIVED',
      });

      // 2. Create ASN Line for the typed primary item.
      if (createdSku.sku_id && createdAsn.asn_id) {
        await apiClient.post('/inbound/asn-lines/', {
          asn: createdAsn.asn_id,
          sku: createdSku.sku_id,
          ean: createdSku.ean,
          ordered_qty: parseInt(newAsn.qty) || 100,
          line_status: 'OPEN',
        });
      }

      setShowCreateAsnModal(false);
      setNewAsn(prev => ({
        ...prev,
        asn_no: `ASN-${Date.now().toString().slice(-6)}`,
        vendor_name: '',
        po_ref: '',
        expected_vehicle: '',
        primary_item_name: '',
        primary_item_code: '',
        qty: 100,
      }));
      loadData('asns');
    } catch (err) {
      console.error('Failed creating ASN:', err);
      alert(err.details ? JSON.stringify(err.details) : 'Error creating ASN. Please verify form values.');
    }
  };

  const handleQuickInward = async (asn) => {
    try {
      const grnNo = `GRN-${Date.now().toString().slice(-6)}`;
      const grn = await apiClient.post('/inbound/grns/', {
        grn_no: grnNo,
        asn: asn.asn_id,
        mode: 'LPN_SCAN',
        status: 'IN_PROGRESS',
        has_discrepancy: false,
      });

      const createdLines = await Promise.all((asn.lines || []).map(line => (
        apiClient.post('/inbound/grn-lines/', {
          grn: grn.grn_id,
          asn_line: line.line_id,
          sku: line.sku,
          ordered_qty: line.ordered_qty || 0,
          received_qty: line.ordered_qty || 0,
          damaged_qty: 0,
          expired_qty: 0,
          excess_qty: 0,
        })
      )));

      await Promise.all(createdLines.map(line => (
        apiClient.post('/inbound/putaway-tasks/', {
          grn_line: line.line_id,
          from_location: 'RECV-STAGE-1',
          priority: 5,
          status: 'CREATED',
        })
      )));

      // Update ASN status to PUTAWAY_PENDING
      await apiClient.patch(`/inbound/asns/${asn.asn_id}/`, {
        status: 'PUTAWAY_PENDING',
      });

      setShowInwardModal(false);
      setActiveSubtab('putaway');
      loadData('putaway');
    } catch (err) {
      console.error('Failed inwarding ASN:', err);
      alert('Error generating GRN.');
    }
  };

  const handleCompletePutaway = async (task) => {
    try {
      await apiClient.patch(`/inbound/putaway-tasks/${task.putaway_id}/`, {
        status: 'COMPLETED',
      });
      loadData('putaway');
    } catch (err) {
      console.error('Failed completing putaway:', err);
    }
  };

  const handleResolveDiscrepancy = async (disc) => {
    try {
      await apiClient.patch(`/inbound/discrepancies/${disc.disc_id}/`, {
        status: 'RESOLVED',
      });
      loadData('discrepancies');
    } catch (err) {
      console.error('Failed resolving discrepancy:', err);
    }
  };

  // Subtab configurations
  const subtabs = [
    { id: 'asns', label: 'ASNs (Advance Shipping)', count: activeSubtab === 'asns' ? dataList.length : undefined },
    { id: 'grns', label: 'Inwarding & GRN', count: activeSubtab === 'grns' ? dataList.length : undefined },
    { id: 'putaway', label: 'Putaway Tasks', count: activeSubtab === 'putaway' ? dataList.length : undefined },
    { id: 'discrepancies', label: 'Dock Discrepancies', count: activeSubtab === 'discrepancies' ? dataList.length : undefined },
  ];

  // Table Columns
  const asnColumns = [
    {
      label: 'ASN Number',
      key: 'asn_no',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>PO: {row.po_ref || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Type',
      key: 'type',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val}</span>,
    },
    {
      label: 'Vendor / Source',
      key: 'source_vendor_name',
      render: (val, row) => <span>{val || row.source_site_code || '—'}</span>,
    },
    {
      label: 'Door / Vehicle',
      key: 'expected_vehicle',
      render: (val, row) => (
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val || '—'}</span>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Door: {row.door_code || '—'}</div>
        </div>
      ),
    },
    {
      label: 'SKUs & Qty',
      key: 'total_qty',
      render: (val, row) => (
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ?? (row.lines?.length ? row.lines.reduce((s, l) => s + (l.ordered_qty || 0), 0) : 0)} Qty</span>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.total_skus ?? (row.lines?.length || 0)} SKUs</div>
        </div>
      ),
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 6 }}>
          {['ARRIVED', 'CHECKED_IN'].includes(row.status) && (
            <button
              className="btn-ui primary"
              style={{ padding: '3px 8px', fontSize: 11 }}
              onClick={(e) => {
                e.stopPropagation();
                setInwardTargetAsn(row);
                setShowInwardModal(true);
              }}
            >
              Inward (GRN)
            </button>
          )}
          <button
            className="btn-ui neutral"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedDetailRow({ type: 'asn', data: row });
            }}
          >
            Lines
          </button>
        </div>
      ),
    },
  ];

  const grnColumns = [
    {
      label: 'GRN Number',
      key: 'grn_no',
      render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'ASN Ref',
      key: 'asn_no',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val}</span>,
    },
    {
      label: 'Mode',
      key: 'mode',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val}</span>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Discrepancy',
      key: 'has_discrepancy',
      render: (val) => (
        <span style={{ color: val ? 'var(--c-rust)' : '#48a968', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          {val ? 'YES (VARIANCE)' : 'CLEAN'}
        </span>
      ),
    },
    {
      label: 'Received By',
      key: 'received_by_name',
      render: (val) => <span>{val || '—'}</span>,
    },
    {
      label: 'Created Time',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
  ];

  const putawayColumns = [
    {
      label: 'Putaway ID',
      key: 'putaway_id',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontSize: 11 }}>{val ? val.slice(0,12) : '—'}</strong>,
    },
    {
      label: 'GRN / ASN',
      key: 'grn_no',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val || '-'}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>ASN: {row.asn_no || '-'}</div>
        </div>
      ),
    },
    {
      label: 'Item',
      key: 'sku_name',
      render: (val, row) => (
        <div>
          <strong>{val || '-'}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{row.sku_code || '-'}</div>
        </div>
      ),
    },
    {
      label: 'From Location',
      key: 'from_location',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val || '—'}</span>,
    },
    {
      label: 'To Bin',
      key: 'to_bin_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontWeight: 600 }}>{val || '—'}</span>,
    },
    {
      label: 'Priority',
      key: 'priority',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: val === 1 ? 'var(--c-rust)' : 'var(--text-secondary)' }}>{val === 1 ? 'HIGH' : val === 2 ? 'MEDIUM' : 'LOW'}</span>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => row.status !== 'COMPLETED' ? (
        <button
          className="btn-ui neutral"
          style={{ padding: '3px 8px', fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            handleCompletePutaway(row);
          }}
        >
          <CheckCircle2 size={11} style={{ color: '#48a968' }} />
          <span>Confirm Putaway</span>
        </button>
      ) : (
        <span style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)' }}>Stored</span>
      ),
    },
  ];

  const discrepancyColumns = [
    {
      label: 'ASN Reference',
      key: 'asn_no',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)', fontWeight: 600 }}>{val}</span>,
    },
    {
      label: 'SKU',
      key: 'sku_name',
      render: (val, row) => (
        <div>
          <span style={{ fontWeight: 600 }}>{val || '—'}</span>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{row.sku_code}</div>
        </div>
      ),
    },
    {
      label: 'Type',
      key: 'type',
      render: (val) => <span className="status-badge rust">{val}</span>,
    },
    {
      label: 'Claimed / Found',
      key: 'claimed_qty',
      render: (val, row) => {
        const variance = (row.found_qty || 0) - (val || 0);
        return (
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {val} claimed / {row.found_qty} found{' '}
            (<strong style={{ color: variance < 0 ? 'var(--c-rust)' : '#48a968' }}>{variance > 0 ? '+' : ''}{variance}</strong>)
          </span>
        );
      },
    },
    {
      label: 'Value',
      key: 'value',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>₹{parseFloat(val || 0).toFixed(2)}</span>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => row.status !== 'RESOLVED' ? (
        <button
          className="btn-ui neutral"
          style={{ padding: '3px 8px', fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            handleResolveDiscrepancy(row);
          }}
        >
          Resolve Variance
        </button>
      ) : (
        <span style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)' }}>Resolved</span>
      ),
    },
  ];

  const getActiveColumns = () => {
    switch (activeSubtab) {
      case 'asns': return asnColumns;
      case 'grns': return grnColumns;
      case 'putaway': return putawayColumns;
      case 'discrepancies': return discrepancyColumns;
      default: return asnColumns;
    }
  };

  const filteredData = dataList.filter(item => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (item.asn_no && item.asn_no.toLowerCase().includes(q)) ||
      (item.grn_no && item.grn_no.toLowerCase().includes(q)) ||
      (item.task_no && item.task_no.toLowerCase().includes(q)) ||
      (item.sku_name && item.sku_name.toLowerCase().includes(q)) ||
      (item.source_vendor_name && item.source_vendor_name.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      {/* Screen Header */}
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>INBOUND WAREHOUSE OPERATIONS</span>
            <span className="screen-count-tag">{filteredData.length} records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Manage Advance Shipping Notices (ASNs), dock gate entry, GRN inwarding, putaway, and discrepancies.
          </div>
        </div>

        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => loadData(activeSubtab)}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>

          {activeSubtab === 'asns' && (
            <button className="btn-ui primary" onClick={() => setShowCreateAsnModal(true)}>
              <Plus size={13} />
              <span>Create Inbound ASN</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-Tabs Rail */}
      <div className="subtabs-rail">
        <div className="subtabs-list">
          {subtabs.map(st => (
            <button
              key={st.id}
              className={`subtab-btn ${activeSubtab === st.id ? 'active' : ''}`}
              onClick={() => setActiveSubtab(st.id)}
            >
              {st.label}
              {st.count != null && <span style={{ marginLeft: 6, opacity: 0.7 }}>({st.count})</span>}
            </button>
          ))}
        </div>

        {/* Quick Search */}
        <div style={{ display: 'flex', alignItems: 'center', position: 'relative', paddingBottom: 6 }}>
          <input
            type="text"
            placeholder="Filter records..."
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

      {/* Data Table */}
      <DataTable
        columns={getActiveColumns()}
        data={filteredData}
        idField={activeSubtab === 'asns' ? 'asn_id' : activeSubtab === 'grns' ? 'grn_id' : activeSubtab === 'putaway' ? 'putaway_id' : 'disc_id'}
        selectable={activeSubtab === 'asns'}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onRowClick={(row) => setSelectedDetailRow({ type: activeSubtab, data: row })}
      />

      {/* Slide-over Detail Drawer */}
      {selectedDetailRow && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 480,
            background: 'var(--bg-card)',
            borderLeft: '1px solid var(--border-mid)',
            boxShadow: 'var(--shadow-modal)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: 16, borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700 }}>
                {selectedDetailRow.type === 'asn' ? `ASN: ${selectedDetailRow.data.asn_no}` : `Details`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                ID: {selectedDetailRow.data.asn_id || selectedDetailRow.data.grn_id || selectedDetailRow.data.task_id}
              </div>
            </div>
            <button className="btn-ui neutral" onClick={() => setSelectedDetailRow(null)} style={{ padding: '4px 6px' }}>
              <X size={14} />
            </button>
          </div>

          <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Status</div>
                <div style={{ marginTop: 4 }}><span className="status-badge teal">{selectedDetailRow.data.status}</span></div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Vehicle No</div>
                <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.expected_vehicle || 'TS12UC0730'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Source Vendor</div>
                <div style={{ marginTop: 4 }}>{selectedDetailRow.data.source_vendor_name || 'Nestle India'}</div>
              </div>
            </div>

            {/* Line Items Table */}
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, marginBottom: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
              Line Items ({selectedDetailRow.data.lines?.length || 1})
            </div>

            {selectedDetailRow.data.lines && selectedDetailRow.data.lines.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedDetailRow.data.lines.map((l, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{l.sku_name || 'Amul Taaza Milk 500ml'}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      <span>Ordered: {l.ordered_qty}</span>
                      <span>Received: {l.received_qty || 0}</span>
                      <span style={{ color: 'var(--c-teal)' }}>{l.line_status || 'OPEN'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No line items recorded for this ASN.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Inbound ASN Modal */}
      {showCreateAsnModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateAsnModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div className="modal-title">Create Inbound ASN</div>
              <button className="btn-ui neutral" onClick={() => setShowCreateAsnModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateAsn}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>ASN Number</label>
                    <input
                      type="text"
                      value={newAsn.asn_no}
                      onChange={(e) => setNewAsn({ ...newAsn, asn_no: e.target.value })}
                      required
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Type</label>
                    <select
                      value={newAsn.type}
                      onChange={(e) => setNewAsn({ ...newAsn, type: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                    >
                      <option value="VENDOR_PO">Vendor PO</option>
                      <option value="MH_TRANSFER">MH Transfer</option>
                      <option value="STORE_RETURN">Store Return</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Vendor</label>
                    <input
                      type="text"
                      value={newAsn.vendor_name}
                      onChange={(e) => setNewAsn({ ...newAsn, vendor_name: e.target.value })}
                      placeholder="e.g. Fresh Farms India"
                      required
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>PO Reference</label>
                    <input
                      type="text"
                      value={newAsn.po_ref}
                      onChange={(e) => setNewAsn({ ...newAsn, po_ref: e.target.value })}
                      required
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Dock Door</label>
                    <select
                      value={newAsn.door}
                      onChange={(e) => setNewAsn({ ...newAsn, door: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                    >
                      {dockDoors.map(d => (
                        <option key={d.door_id} value={d.door_id}>{d.name || d.code}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Vehicle Number</label>
                  <input
                    type="text"
                    value={newAsn.expected_vehicle}
                    onChange={(e) => setNewAsn({ ...newAsn, expected_vehicle: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Primary Item / SKU</label>
                    <input
                      type="text"
                      value={newAsn.primary_item_name}
                      onChange={(e) => setNewAsn({ ...newAsn, primary_item_name: e.target.value })}
                      placeholder="e.g. Tomato 1kg"
                      required
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Item Code</label>
                    <input
                      type="text"
                      value={newAsn.primary_item_code}
                      onChange={(e) => setNewAsn({ ...newAsn, primary_item_code: e.target.value })}
                      placeholder="Auto if blank"
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Quantity</label>
                    <input
                      type="number"
                      value={newAsn.qty}
                      onChange={(e) => setNewAsn({ ...newAsn, qty: e.target.value })}
                      required
                      min="1"
                      style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowCreateAsnModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary">
                  Confirm & Create ASN
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Inward GRN Modal */}
      {showInwardModal && inwardTargetAsn && (
        <div className="modal-backdrop" onClick={() => setShowInwardModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <div className="modal-title">Confirm Inwarding & Generate GRN</div>
              <button className="btn-ui neutral" onClick={() => setShowInwardModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                You are about to inward goods for ASN: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>{inwardTargetAsn.asn_no}</strong>
              </div>

              <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-xs)', fontSize: 12 }}>
                <div><strong>Vendor:</strong> {inwardTargetAsn.source_vendor_name || inwardTargetAsn.source_site_code || '—'}</div>
                <div style={{ marginTop: 4 }}><strong>Vehicle:</strong> {inwardTargetAsn.expected_vehicle || '—'}</div>
                <div style={{ marginTop: 4 }}><strong>Expected Units:</strong> {inwardTargetAsn.total_qty ?? 0}</div>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                This will create a GRN from the ASN lines and open putaway tasks for receiving.
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-ui neutral" onClick={() => setShowInwardModal(false)}>
                Cancel
              </button>
              <button className="btn-ui primary" onClick={() => handleQuickInward(inwardTargetAsn)}>
                Generate GRN & Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
