import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { QRCodeSVG } from 'qrcode.react';
import Barcode from 'react-barcode';
import {
  RefreshCw,
  Search,
  Plus,
  X,
  Trash2,
  Printer,
  Truck,
  QrCode,
} from 'lucide-react';

const PACKAGE_TYPES = [
  { value: 'TOTE', label: 'Tote', lpn: 'TOTE' },
  { value: 'CARTON', label: 'Carton / Case', lpn: 'CARTON' },
  { value: 'PALLET', label: 'Pallet', lpn: 'PALLET' },
  { value: 'BAG', label: 'Bag', lpn: 'BAG' },
];

const LPN_TYPE_LABEL = PACKAGE_TYPES.reduce((acc, item) => {
  acc[item.lpn] = item.label;
  return acc;
}, {});

function shortId(value) {
  return value ? String(value).slice(0, 8) : '—';
}

function buildAllocation(rows, skuId, needed) {
  const eligible = rows
    .filter(row => row.sku === skuId && row.remaining > 0 && row.location)
    .sort((a, b) => String(a.expiry_date || '9999-12-31').localeCompare(String(b.expiry_date || '9999-12-31')));
  const items = [];
  let remaining = needed;
  for (const row of eligible) {
    if (remaining <= 0) break;
    const qty = Math.min(remaining, row.remaining);
    items.push({
      sku: skuId,
      lot: row.lot,
      qty,
      bin_location_id: row.location.id,
    });
    row.remaining -= qty;
    remaining -= qty;
  }
  return { items, remaining };
}

export default function StoView({ initialTab = 'sto' }) {
  const initial = initialTab === 'transfer-orders' ? 'transfer-orders' : 'bundles';
  const [activeSubtab, setActiveSubtab] = useState(initial);
  const [bundles, setBundles] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [transferLineCounts, setTransferLineCounts] = useState({});
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedDetailRow, setSelectedDetailRow] = useState(null);

  // Bundle builder
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sourceSite, setSourceSite] = useState('');
  const [destSite, setDestSite] = useState('');
  const [packageType, setPackageType] = useState('TOTE');
  const [bundleCount, setBundleCount] = useState(1);
  const [bundleLines, setBundleLines] = useState([]);
  const [lineDraft, setLineDraft] = useState({ sku: '', qty: 1 });
  const [skuOptions, setSkuOptions] = useState([]);
  const [skuSearch, setSkuSearch] = useState('');
  const [positions, setPositions] = useState([]);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdLabels, setCreatedLabels] = useState([]);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const skuSearchTimer = useRef(null);

  useEffect(() => {
    setActiveSubtab(initial);
  }, [initial]);

  const siteById = useCallback((id) => sites.find(s => s.site_id === id), [sites]);

  const loadSites = useCallback(async () => {
    try {
      const res = await apiClient.get('/network/sites/', { page_size: 500 });
      const list = res.results || [];
      setSites(list);
      const motherHubs = list.filter(s => s.site_type === 'MH');
      const darkStores = list.filter(s => s.site_type === 'DS');
      setSourceSite(prev => prev || motherHubs[0]?.site_id || list[0]?.site_id || '');
      setDestSite(prev => prev || darkStores[0]?.site_id || list.find(s => s.site_type !== 'MH')?.site_id || '');
    } catch (err) {
      console.error('Failed loading sites:', err);
    }
  }, []);

  const loadPositions = useCallback(async (siteId) => {
    if (!siteId) {
      setPositions([]);
      return;
    }
    const site = sites.find(s => s.site_id === siteId);
    if (!site) return;
    try {
      const res = await apiClient.get('/inventory/positions', {
        site_code: site.code,
        container: 'BIN',
      });
      setPositions((res.results || []).map(row => ({ ...row, remaining: row.qty })));
    } catch (err) {
      console.error('Failed loading stock positions:', err);
      setPositions([]);
    }
  }, [sites]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeSubtab === 'transfer-orders') {
        const [res, linesRes] = await Promise.all([
          apiClient.get('/ds-ops/transfer-orders/', { page_size: 200 }),
          apiClient.get('/ds-ops/transfer-order-lines/', { page_size: 1000 }),
        ]);
        const counts = {};
        (linesRes.results || []).forEach(line => {
          counts[line.transfer] = (counts[line.transfer] || 0) + 1;
        });
        setTransferLineCounts(counts);
        setTransfers(res.results || []);
      } else {
        const res = await apiClient.get('/inventory/lpns/', { page_size: 200 });
        setBundles(res.results || []);
      }
    } catch (err) {
      console.error('Failed loading outbound data:', err);
      if (activeSubtab === 'transfer-orders') setTransfers([]);
      else setBundles([]);
    } finally {
      setLoading(false);
    }
  }, [activeSubtab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  useEffect(() => {
    if (showCreateModal) loadPositions(sourceSite);
  }, [showCreateModal, sourceSite, loadPositions]);

  const searchSkus = (term) => {
    setSkuSearch(term);
    if (skuSearchTimer.current) clearTimeout(skuSearchTimer.current);
    skuSearchTimer.current = setTimeout(async () => {
      try {
        const res = await apiClient.get('/catalog/skus/', {
          search: term,
          page_size: 100,
        });
        setSkuOptions(res.results || []);
      } catch (err) {
        console.error('SKU search failed:', err);
      }
    }, 250);
  };

  const availableForSku = (skuId) => positions
    .filter(row => row.sku === skuId)
    .reduce((sum, row) => sum + (row.remaining ?? row.qty), 0);

  const openCreate = async () => {
    setFormError('');
    setBundleLines([]);
    setLineDraft({ sku: '', qty: 1 });
    setSkuSearch('');
    setBundleCount(1);
    setPackageType('TOTE');
    setCreatedLabels([]);
    setShowCreateModal(true);
    try {
      const res = await apiClient.get('/catalog/skus/', { page_size: 200 });
      setSkuOptions(res.results || []);
    } catch (err) {
      console.error('Failed loading SKUs:', err);
    }
  };

  const addBundleLine = () => {
    setFormError('');
    const sku = skuOptions.find(item => item.sku_id === lineDraft.sku);
    if (!sku) {
      setFormError('Select a registered SKU first.');
      return;
    }
    const qty = parseInt(lineDraft.qty, 10);
    if (!qty || qty < 1) {
      setFormError('Units per bundle must be at least 1.');
      return;
    }
    if (bundleLines.some(line => line.sku_id === sku.sku_id)) {
      setFormError(`${sku.sku_code} is already in this bundle. Remove it first to change the quantity.`);
      return;
    }
    setBundleLines(prev => ([
      ...prev,
      {
        sku_id: sku.sku_id,
        sku_code: sku.sku_code,
        sku_name: sku.name,
        qty_per_bundle: qty,
      },
    ]));
    setLineDraft({ sku: '', qty: 1 });
  };

  const removeBundleLine = (skuId) => {
    setBundleLines(prev => prev.filter(line => line.sku_id !== skuId));
  };

  const bundlesToCreate = Math.max(1, parseInt(bundleCount, 10) || 1);
  const unitsPerBundle = bundleLines.reduce((sum, line) => sum + line.qty_per_bundle, 0);
  const totalUnits = unitsPerBundle * bundlesToCreate;

  const resetForm = () => {
    setBundleLines([]);
    setLineDraft({ sku: '', qty: 1 });
    setSkuSearch('');
    setBundleCount(1);
    setFormError('');
  };

  const handleCreateBundle = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!sourceSite) {
      setFormError('Select the source facility.');
      return;
    }
    if (!destSite) {
      setFormError('Select the destination facility.');
      return;
    }
    if (sourceSite === destSite) {
      setFormError('Source and destination must be different facilities.');
      return;
    }
    if (bundleLines.length === 0) {
      setFormError('Add at least one SKU to the bundle.');
      return;
    }

    const workingRows = positions.map(row => ({ ...row, remaining: row.qty }));
    const perBundle = [];
    for (let b = 0; b < bundlesToCreate; b += 1) {
      const items = [];
      for (const line of bundleLines) {
        const { items: allocated, remaining } = buildAllocation(workingRows, line.sku_id, line.qty_per_bundle);
        if (remaining > 0) {
          setFormError(
            `Not enough stock for ${line.sku_code}. Need ${line.qty_per_bundle * bundlesToCreate} units across ${bundlesToCreate} bundle(s); only ${availableForSku(line.sku_id)} available at the source.`,
          );
          return;
        }
        items.push(...allocated);
      }
      perBundle.push(items);
    }

    setSubmitting(true);
    const created = [];
    try {
      const lpnType = PACKAGE_TYPES.find(t => t.value === packageType)?.lpn || 'TOTE';
      const transfer = await apiClient.post('/ds-ops/transfer-orders/', {
        source_site: sourceSite,
        dest_site: destSite,
        status: 'APPROVED',
        total_qty: totalUnits,
      });

      const stamp = Date.now().toString(36).toUpperCase();
      for (let i = 0; i < perBundle.length; i += 1) {
        const lpnId = `LPN-${stamp}-${i + 1}`.slice(0, 50);
        const barcode = `ZP${Date.now().toString().slice(-11)}${String(i + 1).padStart(2, '0')}`;
        const res = await apiClient.post('/inventory/pack-lpn', {
          lpn_id: lpnId,
          barcode,
          lpn_type: lpnType,
          dest_site: destSite,
          transfer: transfer.transfer_id,
          items: perBundle[i],
        });
        const destination = res.manifest?.destination || {};
        const source = res.manifest?.source || {};
        const labelPayload = JSON.stringify({
          lpn_id: res.lpn_id,
          barcode: res.barcode,
          destination,
          source,
          items: (res.manifest?.items || []).map(item => ({
            sku: item.sku,
            sku_code: item.sku_code,
            sku_name: item.sku_name,
            qty: item.qty,
          })),
          total_qty: res.total_qty,
        });
        created.push({
          lpn_id: res.lpn_id,
          barcode: res.barcode,
          lpn_type: res.lpn_type || lpnType,
          total_qty: res.total_qty,
          manifest: res.manifest,
          labelPayload,
        });
      }

      setCreatedLabels(created);
      setShowCreateModal(false);
      setShowLabelModal(true);
      resetForm();
      await loadData();
    } catch (err) {
      console.error('Failed creating bundle:', err);
      const message = err?.details?.detail
        || (err?.details && JSON.stringify(err.details))
        || 'Could not create the bundle.';
      if (created.length > 0) {
        setCreatedLabels(created);
        setShowCreateModal(false);
        setShowLabelModal(true);
        setFormError('');
      } else {
        setFormError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDispatch = async (transfer) => {
    try {
      await apiClient.post(`/ds-ops/transfer-orders/${transfer.transfer_id}/dispatch/`, {});
      await loadData();
    } catch (err) {
      console.error('Failed dispatching transfer:', err);
      alert(err?.details?.detail || err?.details?.error || 'Could not dispatch this transfer.');
    }
  };

  const openLabels = (bundle) => {
    const manifest = bundle.manifest || {};
    const labelPayload = JSON.stringify({
      lpn_id: bundle.lpn_id,
      barcode: bundle.barcode,
      destination: manifest.destination || {},
      source: manifest.source || {},
      items: (manifest.items || []).map(item => ({
        sku: item.sku,
        sku_code: item.sku_code,
        sku_name: item.sku_name,
        qty: item.qty,
      })),
      total_qty: manifest.total_qty ?? 0,
    });
    setCreatedLabels([{
      lpn_id: bundle.lpn_id,
      barcode: bundle.barcode,
      lpn_type: bundle.lpn_type,
      total_qty: manifest.total_qty ?? 0,
      manifest,
      labelPayload,
    }]);
    setShowLabelModal(true);
  };

  const bundleColumns = [
    {
      label: 'Bundle',
      key: 'barcode',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {row.lpn_id} · {LPN_TYPE_LABEL[row.lpn_type] || row.lpn_type}
          </div>
        </div>
      ),
    },
    {
      label: 'Destination',
      key: 'dest_site',
      render: (val) => {
        const site = siteById(val);
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)', fontWeight: 600 }}>
            {site ? `${site.code} - ${site.name || site.site_type}` : shortId(val)}
          </span>
        );
      },
    },
    {
      label: 'Contents',
      key: 'manifest',
      render: (val) => {
        const items = val?.items || [];
        const qty = val?.total_qty ?? items.reduce((sum, item) => sum + (item.qty || 0), 0);
        return (
          <div>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{qty} units</span>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{items.length} SKU{items.length === 1 ? '' : 's'}</div>
          </div>
        );
      },
    },
    {
      label: 'Transfer',
      key: 'transfer',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{shortId(val)}</span>,
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
          <button
            className="btn-ui neutral"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={(e) => {
              e.stopPropagation();
              openLabels(row);
            }}
          >
            <Printer size={11} />
            <span>Label</span>
          </button>
        </div>
      ),
    },
  ];

  const transferColumns = [
    {
      label: 'Transfer ID',
      key: 'transfer_id',
      render: (val) => (
        <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {shortId(val)}
        </strong>
      ),
    },
    {
      label: 'Source',
      key: 'source_site_code',
      render: (val, row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {val || siteById(row.source_site)?.code || '—'}
        </span>
      ),
    },
    {
      label: 'Destination',
      key: 'dest_site_code',
      render: (val, row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)', fontWeight: 600 }}>
          {val || siteById(row.dest_site)?.code || '—'}
        </span>
      ),
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Ordered Units',
      key: 'ordered_units',
      render: (val, row) => {
        const skus = transferLineCounts[row.transfer_id] || row.shipped_skus || row.received_skus || row.sku_count || 0;
        return (
          <div>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ?? row.total_qty ?? 0}</span>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {skus > 0 ? `${skus} SKU(s)` : 'Bundle transfer'}
            </div>
          </div>
        );
      },
    },
    {
      label: 'Shipped',
      key: 'shipped_units',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</span>,
    },
    {
      label: 'Received',
      key: 'received_units',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</span>,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => {
        const dispatchable = !['IN_TRANSIT', 'RECEIVED', 'CLOSED', 'CANCELLED'].includes(row.status);
        return dispatchable ? (
          <button
            className="btn-ui primary"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={(e) => {
              e.stopPropagation();
              handleDispatch(row);
            }}
          >
            <Truck size={11} />
            <span>Dispatch</span>
          </button>
        ) : (
          <span style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)' }}>
            {row.status}
          </span>
        );
      },
    },
  ];

  const filteredBundles = bundles.filter(row => {
    const matchesStatus = statusFilter === 'ALL' || row.status === statusFilter;
    if (!matchesStatus) return false;
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    const dest = siteById(row.dest_site);
    return (
      (row.barcode && row.barcode.toLowerCase().includes(q)) ||
      (row.lpn_id && row.lpn_id.toLowerCase().includes(q)) ||
      (dest && dest.code.toLowerCase().includes(q)) ||
      (row.manifest?.items || []).some(item => (item.sku_code || '').toLowerCase().includes(q))
    );
  });

  const filteredTransfers = transfers.filter(row => {
    const matchesStatus = statusFilter === 'ALL' || row.status === statusFilter;
    if (!matchesStatus) return false;
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (row.transfer_id && row.transfer_id.toLowerCase().includes(q)) ||
      (row.source_site_code && row.source_site_code.toLowerCase().includes(q)) ||
      (row.dest_site_code && row.dest_site_code.toLowerCase().includes(q))
    );
  });

  const bundleStatuses = ['ALL', 'PACKED', 'IN_TRANSIT', 'RECEIVED', 'EMPTY'];
  const transferStatuses = ['ALL', 'APPROVED', 'PACKED', 'IN_TRANSIT', 'RECEIVED', 'CLOSED'];

  return (
    <div>
      <div className="subtabs-rail" style={{ marginBottom: 12 }}>
        <div className="subtabs-list">
          <button
            className={`subtab-btn ${activeSubtab === 'bundles' ? 'active' : ''}`}
            onClick={() => setActiveSubtab('bundles')}
          >
            Transfer Bundles
          </button>
          <button
            className={`subtab-btn ${activeSubtab === 'transfer-orders' ? 'active' : ''}`}
            onClick={() => setActiveSubtab('transfer-orders')}
          >
            Transfer Orders
          </button>
        </div>

        <div className="screen-actions" style={{ paddingBottom: 6 }}>
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          {activeSubtab === 'bundles' && (
            <button className="btn-ui primary" onClick={openCreate}>
              <Plus size={13} />
              <span>Create Outbound Bundle</span>
            </button>
          )}
        </div>
      </div>

      <div className="screen-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="screen-title">
            <span>{activeSubtab === 'transfer-orders' ? 'STOCK TRANSFER ORDERS' : 'OUTBOUND TRANSFER BUNDLES'}</span>
            <span className="screen-count-tag">
              {activeSubtab === 'transfer-orders' ? filteredTransfers.length : filteredBundles.length} Records
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Pack multiple SKUs into one labelled tote / carton / pallet and send it to a dark store or another warehouse.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search barcode, destination, SKU..."
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

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
        {(activeSubtab === 'transfer-orders' ? transferStatuses : bundleStatuses).map(status => (
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

      {activeSubtab === 'transfer-orders' ? (
        <DataTable
          columns={transferColumns}
          data={filteredTransfers}
          idField="transfer_id"
          onRowClick={(row) => setSelectedDetailRow({ type: 'transfer', data: row })}
          emptyMessage="No transfer orders found."
        />
      ) : (
        <DataTable
          columns={bundleColumns}
          data={filteredBundles}
          idField="lpn_id"
          onRowClick={(row) => setSelectedDetailRow({ type: 'bundle', data: row })}
          emptyMessage="No outbound bundles found."
        />
      )}

      {/* Detail drawer */}
      {selectedDetailRow && (
        <div className="drawer-backdrop" onClick={() => setSelectedDetailRow(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
            <div className="drawer-header">
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                  {selectedDetailRow.type === 'bundle' ? 'BUNDLE MANIFEST' : 'TRANSFER ORDER'}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>
                  {selectedDetailRow.type === 'bundle'
                    ? selectedDetailRow.data.barcode
                    : shortId(selectedDetailRow.data.transfer_id)}
                </div>
              </div>
              <button className="btn-ui neutral" onClick={() => setSelectedDetailRow(null)}>
                <X size={14} />
              </button>
            </div>

            {selectedDetailRow.type === 'bundle' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, fontSize: 12 }}>
                  <div>
                    <div className="drawer-label">Status</div>
                    <div style={{ fontWeight: 600 }}>{selectedDetailRow.data.status}</div>
                  </div>
                  <div>
                    <div className="drawer-label">Type</div>
                    <div style={{ fontWeight: 600 }}>{LPN_TYPE_LABEL[selectedDetailRow.data.lpn_type] || selectedDetailRow.data.lpn_type}</div>
                  </div>
                  <div>
                    <div className="drawer-label">Destination</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)' }}>
                      {selectedDetailRow.data.manifest?.destination?.code || siteById(selectedDetailRow.data.dest_site)?.code || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="drawer-label">Total Units</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {selectedDetailRow.data.manifest?.total_qty ?? 0}
                    </div>
                  </div>
                </div>

                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, marginBottom: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
                  SKUs inside this bundle ({(selectedDetailRow.data.manifest?.items || []).length})
                </div>

                {(selectedDetailRow.data.manifest?.items || []).length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selectedDetailRow.data.manifest.items.map((line, idx) => (
                      <div key={idx} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{line.sku_name || line.sku_code}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                          <span>{line.sku_code}</span>
                          <span>Qty: {line.qty}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                    No SKUs recorded in this bundle.
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  <button className="btn-ui primary" onClick={() => openLabels(selectedDetailRow.data)}>
                    <Printer size={13} />
                    <span>Open / Print Label</span>
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
                <div>
                  <div className="drawer-label">Status</div>
                  <div style={{ fontWeight: 600 }}>{selectedDetailRow.data.status}</div>
                </div>
                <div>
                  <div className="drawer-label">Source</div>
                  <div style={{ fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.source_site_code || siteById(selectedDetailRow.data.source_site)?.code || '—'}</div>
                </div>
                <div>
                  <div className="drawer-label">Destination</div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>{selectedDetailRow.data.dest_site_code || siteById(selectedDetailRow.data.dest_site)?.code || '—'}</div>
                </div>
                <div>
                  <div className="drawer-label">Ordered Units</div>
                  <div style={{ fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.ordered_units ?? selectedDetailRow.data.total_qty ?? 0}</div>
                </div>
                <div>
                  <div className="drawer-label">Packed Bundles</div>
                  <div style={{ fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.shipped_units ?? 0} units shipped</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create bundle modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <div className="modal-title">Create Outbound Bundle</div>
              <button className="btn-ui neutral" onClick={() => setShowCreateModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateBundle}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {formError && <div className="form-error-banner">{formError}</div>}

                <div className="crud-form-grid">
                  <div className="crud-form-field">
                    <label>Source Facility</label>
                    <select value={sourceSite} onChange={(e) => setSourceSite(e.target.value)} required>
                      <option value="">Select source</option>
                      {sites.filter(s => s.site_type === 'MH').map(s => (
                        <option key={s.site_id} value={s.site_id}>{s.code} - {s.name || s.site_type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="crud-form-field">
                    <label>Destination (DS / WMS)</label>
                    <select value={destSite} onChange={(e) => setDestSite(e.target.value)} required>
                      <option value="">Select destination</option>
                      {sites.filter(s => s.site_id !== sourceSite && ['DS', 'MH'].includes(s.site_type)).map(s => (
                        <option key={s.site_id} value={s.site_id}>
                          {s.code} - {s.name || s.site_type} ({s.site_type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="crud-form-field">
                    <label>Package Type</label>
                    <select value={packageType} onChange={(e) => setPackageType(e.target.value)}>
                      {PACKAGE_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="crud-form-field">
                    <label>Number of Bundles</label>
                    <input
                      type="number"
                      min="1"
                      value={bundleCount}
                      onChange={(e) => setBundleCount(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                    SKUs inside each bundle
                  </div>

                  <div className="bundle-line-grid">
                    <div className="crud-form-field">
                      <label>Search SKU</label>
                      <input
                        type="text"
                        value={skuSearch}
                        onChange={(e) => searchSkus(e.target.value)}
                        placeholder="Type code or product name..."
                      />
                    </div>
                    <div className="crud-form-field">
                      <label>Units / bundle</label>
                      <input
                        type="number"
                        min="1"
                        value={lineDraft.qty}
                        onChange={(e) => setLineDraft({ ...lineDraft, qty: e.target.value })}
                      />
                    </div>
                    <button type="button" className="btn-ui neutral" onClick={addBundleLine} style={{ height: 32 }}>
                      <Plus size={12} /> Add
                    </button>
                  </div>

                  <div className="crud-form-field" style={{ marginTop: 8 }}>
                    <label>SKU</label>
                    <select
                      value={lineDraft.sku}
                      onChange={(e) => setLineDraft({ ...lineDraft, sku: e.target.value })}
                    >
                      <option value="">Select SKU</option>
                      {skuOptions.map(s => (
                        <option key={s.sku_id} value={s.sku_id}>
                          {s.sku_code} - {s.name} (available {availableForSku(s.sku_id)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="bundle-line-list">
                    {bundleLines.length === 0 ? (
                      <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-xs)' }}>
                        No SKUs added yet. A bundle must contain at least one SKU.
                      </div>
                    ) : bundleLines.map(line => (
                      <div className="bundle-line-row" key={line.sku_id}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{line.sku_name}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
                            {line.sku_code} · {line.qty_per_bundle} units/bundle · available {availableForSku(line.sku_id)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-ui danger"
                          style={{ padding: '3px 6px' }}
                          onClick={() => removeBundleLine(line.sku_id)}
                          title="Remove SKU"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bundle-summary">
                  <span><strong>{bundleLines.length}</strong> SKU(s)</span>
                  <span><strong>{unitsPerBundle}</strong> units / bundle</span>
                  <span><strong>{bundlesToCreate}</strong> bundle(s)</span>
                  <span><strong>{totalUnits}</strong> total units</span>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <QrCode size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span>
                    Each bundle is registered with its own barcode and a QR payload holding the full manifest.
                    The destination scans that label once; a repeat scan is reported as already received and never posts stock twice.
                  </span>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary" disabled={submitting}>
                  {submitting ? 'Packing...' : 'Create Bundle & Generate Label'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Label sheet */}
      {showLabelModal && (
        <div className="modal-backdrop" onClick={() => setShowLabelModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="modal-header no-print">
              <div className="modal-title">Bundle Labels</div>
              <button className="btn-ui neutral" onClick={() => setShowLabelModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body">
              <div className="bundle-label-print-area">
                <div className="bundle-label-sheet">
                  {createdLabels.map(label => {
                    const manifest = label.manifest || {};
                    const dest = manifest.destination || {};
                    return (
                      <div className="bundle-label" key={label.lpn_id}>
                        <div className="label-head">
                          <span className="label-title">ZIPPZO BUNDLE</span>
                          <span className="label-dest">{dest.code || '—'}</span>
                        </div>
                        <div className="label-meta">
                          <div>LPN: {label.lpn_id}</div>
                          <div>Type: {LPN_TYPE_LABEL[label.lpn_type] || label.lpn_type || manifest.lpn_type || '—'}</div>
                          <div>Destination: {dest.code || '—'}{dest.name ? ` - ${dest.name}` : ''}</div>
                          <div>Source: {manifest.source?.code || '—'}</div>
                        </div>
                        <div className="label-items">
                          {(manifest.items || []).map((item, idx) => (
                            <div key={idx}>
                              <span>{item.sku_code}</span>
                              <span>{item.qty}</span>
                            </div>
                          ))}
                          <div style={{ borderTop: '1px solid #ccc', marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
                            <span>TOTAL</span>
                            <span>{manifest.total_qty ?? label.total_qty ?? 0}</span>
                          </div>
                        </div>
                        <div className="label-barcode">
                          <QRCodeSVG value={label.labelPayload} size={96} />
                          <div style={{ marginTop: 4 }}>
                            <Barcode value={label.barcode} height={38} width={1.2} fontSize={10} margin={0} />
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, marginTop: 2 }}>{label.barcode}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="modal-footer no-print">
              <button className="btn-ui neutral" onClick={() => setShowLabelModal(false)}>Close</button>
              <button className="btn-ui primary" onClick={() => window.print()}>
                <Printer size={13} />
                <span>Print Labels</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
