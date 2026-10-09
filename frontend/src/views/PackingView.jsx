import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Package, Printer, Plus, X, Check, Trash2, Box as BoxIcon, ArrowRightLeft,
  ShieldCheck, ScanLine, AlertTriangle, CheckCircle2, Search, Layers
} from 'lucide-react';

// lucide's Box is an <svg>; used as a layout wrapper its children land in the
// SVG namespace and never render (the buttons were "not visible" in the DOM).
// Layout boxes here are plain divs; the icon stays available as BoxIcon.
const Box = ({ children, ...rest }) => <div {...rest}>{children}</div>;

import DataTable from '../components/ui/DataTable';
import BarcodeGenerator from '../components/ui/BarcodeGenerator';
import BarcodeScannerModal from '../components/ui/BarcodeScannerModal';
import BinTransferView from './BinTransferView';
import { fetchApi, postApi, unwrapList, describeError } from '../api/client';
import { openBarcodePrintWindow } from '../utils/barcodeUtils';
import { resolveBin } from '../utils/bins';

const emptyPack = (siteId = '') => ({
  batch_no: `BATCH-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`,
  site: siteId,
  type: 'MANUAL',
  processing_type: 'LPN_BASED',
  destinations: '',
  ordered_skus: 0,
  lpn_id: `LPN${new Date().getFullYear()}${String(Date.now()).slice(-6)}`,
  lpn_type: 'TOTE',
  barcode: '',
  items: [], // { sku, sku_code, sku_name, lot, batch_number, qty, location }
});

/**
 * Outbound Packing â€” build a multi-product outbound unit.
 *
 * Rewritten against the real API. The previous version:
 *  - POSTed {batch_code, batch_type, destination_id, barcode, lpn_type,
 *    gross_weight_kg, items[]} to /fulfilment/batches/, none of which exist on
 *    Batch (it is batch_no + site + type + ...), so every save 400'd;
 *  - rendered a hardcoded fake line ("SKU-MILK-500 / Amul Taaza Toned Fresh
 *    Milk 500ml / A-01-02-04") as if it were real stock;
 *  - read inv.location_code / inv.location, but /inventory/positions returns
 *    a nested location object and no location_code at all;
 *  - used stores[0].id and r.id, but Site and Batch key on site_id / batch_id;
 *  - mounted the full-page BinTransferView as a modal, passing an onSubmit it
 *    does not accept and a duplicate onClose prop.
 *
 * A Batch has no line items and no barcode, so packing is now modelled as the
 * three records it actually is: Batch -> LPN -> LPN contents.
 */
export default function PackingView() {
  const [batches, setBatches] = useState([]);
  const [lpns, setLpns] = useState([]);
  const [sites, setSites] = useState([]);
  const [allStock, setAllStock] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [selectedBatch, setSelectedBatch] = useState(null);
  const [showPackModal, setShowPackModal] = useState(false);
  const [showBinTransfer, setShowBinTransfer] = useState(false);
  const [showStockBrowser, setShowStockBrowser] = useState(false);

  const [pack, setPack] = useState(emptyPack());
  const [stockFilter, setStockFilter] = useState('');
  const [scanning, setScanning] = useState(null); // 'item' | 'lpn' | 'bin'

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [bRes, lpnRes, stRes, invRes] = await Promise.all([
        fetchApi('/fulfilment/batches/'),
        fetchApi('/inventory/lpns/'),
        fetchApi('/network/sites/'),
        fetchApi('/inventory/positions?container=BIN'),
      ]);
      const b = unwrapList(bRes);
      const l = unwrapList(lpnRes);
      const s = unwrapList(stRes);
      const inv = unwrapList(invRes);
      setBatches(Array.isArray(b) ? b : []);
      setLpns(Array.isArray(l) ? l : []);
      setSites(Array.isArray(s) ? s : []);
      setAllStock(Array.isArray(inv) ? inv : []);
      setLoadError('');
    } catch (err) {
      console.error('Packing load error:', err);
      setLoadError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // First site by default; Site keys on site_id, not id.
  const defaultSiteId = sites.find(s => s.site_type === 'MH')?.site_id
    || sites[0]?.site_id
    || '';

  useEffect(() => {
    if (defaultSiteId) setPack(p => (p.site ? p : { ...p, site: defaultSiteId }));
  }, [defaultSiteId]);

  const availableStock = useMemo(() => {
    const q = stockFilter.trim().toLowerCase();
    const rows = allStock.filter(r => (Number(r.qty) || 0) > 0);
    if (!q) return rows;
    return rows.filter(r => `${r.sku_code ?? ''} ${r.sku_name ?? ''} ${r.lot ?? ''} ${r.batch_number ?? ''}`
      .toLowerCase().includes(q));
  }, [allStock, stockFilter]);

  const openPackModal = () => {
    setPack({
      ...emptyPack(defaultSiteId),
      barcode: `LPN-RJY-${new Date().getFullYear()}-${String(lpns.length + 101).padStart(3, '0')}`,
    });
    setError('');
    setShowPackModal(true);
  };

  const addItem = (row) => {
    if (!row?.sku) return;
    setPack(prev => {
      const existing = prev.items.findIndex(
        i => i.sku === row.sku && i.lot === row.lot
      );
      const items = [...prev.items];
      if (existing >= 0) {
        const maxQty = Number(row.qty) || 0;
        items[existing] = {
          ...items[existing],
          qty: Math.min(items[existing].qty + 1, maxQty),
        };
      } else {
        items.push({
          sku: row.sku,
          sku_code: row.sku_code,
          sku_name: row.sku_name,
          lot: row.lot,
          batch_number: row.batch_number || '',
          qty: 1,
          available: Number(row.qty) || 0,
          location: row.location?.barcode || row.container_ref || '',
        });
      }
      return { ...prev, items, ordered_skus: items.length };
    });
  };

  const setItemQty = (idx, qty) => {
    setPack(prev => {
      const items = [...prev.items];
      const max = Number(items[idx]?.available) || 0;
      items[idx] = { ...items[idx], qty: Math.max(1, Math.min(Number(qty) || 1, max)) };
      return { ...prev, items };
    });
  };

  const removeItem = (idx) => {
    setPack(prev => {
      const items = prev.items.filter((_, i) => i !== idx);
      return { ...prev, items, ordered_skus: items.length };
    });
  };

  const handleScan = async (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    // Clear the previous attempt's error up front, then only leave a message
    // behind if this attempt actually fails. Clearing at the end wiped out the
    // very errors set above.
    setError('');
    setScanning(null);
    if (scanning === 'lpn') {
      setPack(p => ({ ...p, barcode: value.toUpperCase() }));
      return;
    }
    if (scanning === 'bin') {
      try {
        const bin = await resolveBin(value);
        if (!bin || bin.candidates) {
          setError(
            bin?.candidates?.length
              ? `"${value}" matches ${bin.candidates.length} bins. Scan the bin barcode, or type it exactly.`
              : `No bin matches "${value}".`
          );
          return;
        }
        const res = unwrapList(await fetchApi(
          `/inventory/positions?location_id=${encodeURIComponent(bin.location_id)}`
        ));
        const rows = Array.isArray(res) ? res : [];
        setPack(p => {
          const items = [...p.items];
          rows.forEach(r => {
            if (!items.some(i => i.sku === r.sku && i.lot === r.lot)) {
              items.push({
                sku: r.sku, sku_code: r.sku_code, sku_name: r.sku_name,
                lot: r.lot, batch_number: r.batch_number || '', qty: 1,
                available: Number(r.qty) || 0,
                location: bin.label,
              });
            }
          });
          return { ...p, items, ordered_skus: items.length };
        });
      } catch (err) {
        setError(describeError(err));
      }
      return;
    }
    const row = allStock.find(r => [r.sku_code, r.sku, r.lot, r.batch_number]
      .some(f => String(f ?? '').toUpperCase() === value.toUpperCase()));
    if (row) addItem(row);
    else setError(`"${value}" was not found in any bin.`);
  };

  const totalPackedQty = pack.items.reduce((t, i) => t + (Number(i.qty) || 0), 0);

  const submitPack = async (e) => {
    e.preventDefault();
    if (!pack.batch_no) { setError('Batch number is required.'); return; }
    if (!pack.site) { setError('Choose the site this batch belongs to.'); return; }
    if (!pack.items.length) { setError('Add at least one product before packing.'); return; }
    if (!pack.barcode) { setError('LPN barcode is required.'); return; }
    const withoutLot = pack.items.find(i => !i.lot);
    if (withoutLot) {
      setError(`${withoutLot.sku_code || 'A product'} has no lot, so it cannot go into an LPN.`);
      return;
    }

    setLoading(true);
    setError('');
    try {
      // 1. The batch itself.
      const batch = await postApi('/fulfilment/batches/', {
        batch_no: pack.batch_no,
        site: pack.site,
        type: pack.type,
        processing_type: pack.processing_type,
        destinations: pack.destinations || '',
        ordered_qty: totalPackedQty,
        ordered_skus: pack.items.length,
        status: 'UPLOADED',
      });

      // 2. The container that carries the barcode operators scan.
      const lpn = await postApi('/inventory/lpns/', {
        lpn_id: pack.lpn_id,
        barcode: pack.barcode,
        lpn_type: pack.lpn_type,
        current_site: pack.site,
        current_container: 'LPN',
        current_ref_id: batch.batch_id,
        status: 'PACKED',
        created_by: 'console',
      });

      // 3. What is actually inside it.
      for (const item of pack.items) {
        await postApi('/inventory/lpn-contents/', {
          lpn: lpn.lpn_id,
          sku: item.sku,
          lot: item.lot,
          qty: Number(item.qty) || 1,
        });
      }

      setShowPackModal(false);
      await loadData();
      showToast(`Packed ${pack.items.length} product(s), ${totalPackedQty} unit(s) into ${pack.barcode}.`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const printBarcode = (row) => {
    if (!row) return;
    openBarcodePrintWindow({
      barcode: row.lpn_id || `LPN-${row.batch_no}`,
      batch_code: row.batch_no,
      destination_name: row.destinations || 'Mother Hub',
      total_units: row.ordered_qty || 0,
      sku_count: row.ordered_skus || 0,
    });
  };

  const batchColumns = [
    {
      header: 'Batch No',
      key: 'batch_no',
      render: r => (
        <button
          onClick={() => setSelectedBatch(r)}
          className="code-cell"
          style={{ background: 'none', border: 'none', color: 'var(--accent-purple)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
        >
          {r.batch_no}
        </button>
      ),
    },
    { header: 'Site', key: 'site', render: r => <span className="code-cell">{String(r.site ?? 'â€”')}</span> },
    { header: 'Type', key: 'type', render: r => <span className="badge badge-info">{r.type || 'MANUAL'}</span> },
    { header: 'Products', key: 'ordered_skus', align: 'right', render: r => <span className="badge badge-purple">{r.ordered_skus ?? 0} SKUs</span> },
    { header: 'Units', key: 'ordered_qty', align: 'right', render: r => <strong className="mono-num">{r.ordered_qty ?? 0}</strong> },
    { header: 'Destinations', key: 'destinations', render: r => r.destinations || 'â€”' },
    {
      header: 'Status',
      key: 'status',
      render: r => <span className={`badge ${r.status === 'CLOSED' ? 'badge-default' : 'badge-success'}`}>{r.status || 'UPLOADED'}</span>,
    },
    {
      header: 'Action',
      render: r => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }}
            onClick={(e) => { e.stopPropagation(); setSelectedBatch(r); }}>
            View Products
          </button>
          <button className="btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} title="Print LPN label"
            onClick={(e) => { e.stopPropagation(); printBarcode(r); }}>
            <Printer size={12} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="workspace-viewport">
      {toast && (
        <div className="alert alert-success" data-testid="packing-toast" style={{ marginBottom: 12 }}>
          <CheckCircle2 size={16} /><span>{toast}</span>
        </div>
      )}
      {loadError && (
        <div className="alert alert-danger" style={{ marginBottom: 12 }}>
          <AlertTriangle size={16} /><span>{loadError}</span>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Outbound Packing</h1>
          <p className="page-subtitle">Assemble a multi-product outbound unit and generate its LPN label</p>
        </div>
        <Box style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => setShowBinTransfer(true)} data-testid="open-bin-transfer">
            <ArrowRightLeft size={14} /> Bin Transfer
          </button>
          <button className="btn-primary" onClick={openPackModal} data-testid="open-pack-modal">
            <Package size={14} /> Pack Outbound Unit
          </button>
        </Box>
      </div>

      <DataTable columns={batchColumns} data={batches} />

      {/* ---------- Pack modal ---------- */}
      {showPackModal && (
        <div className="modal-overlay" onClick={() => setShowPackModal(false)}>
          <div className="modal-card" style={{ maxWidth: 900, width: '94vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Pack Outbound Unit</div>
              <button className="modal-close" onClick={() => setShowPackModal(false)} aria-label="Close"><X size={18} /></button>
            </div>

            <form onSubmit={submitPack} data-testid="pack-form">
              <div style={{ padding: 16 }}>
                {error && (
                  <div className="alert alert-danger" data-testid="pack-error" style={{ marginBottom: 12 }}>
                    <AlertTriangle size={16} /><span>{error}</span>
                  </div>
                )}

                <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="pk-batch">Batch no *</label>
                    <input id="pk-batch" className="form-input" value={pack.batch_no} required
                      onChange={e => setPack(p => ({ ...p, batch_no: e.target.value }))} data-testid="pack-batch-no" />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="pk-site">Site *</label>
                    <select id="pk-site" className="form-input" value={pack.site} required
                      onChange={e => setPack(p => ({ ...p, site: e.target.value }))} data-testid="pack-site">
                      <option value="">â€” Select site â€”</option>
                      {sites.map(s => <option key={s.site_id} value={s.site_id}>{s.code} â€” {s.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="pk-lpn">LPN id *</label>
                    <input id="pk-lpn" className="form-input mono-num" value={pack.lpn_id} required
                      onChange={e => setPack(p => ({ ...p, lpn_id: e.target.value }))} data-testid="pack-lpn-id" />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="pk-lpntype">Container type</label>
                    <select id="pk-lpntype" className="form-input" value={pack.lpn_type}
                      onChange={e => setPack(p => ({ ...p, lpn_type: e.target.value }))}>
                      {['TOTE', 'CARTON', 'PALLET', 'BAG', 'RIDER_BIN'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="pk-barcode">LPN barcode *</label>
                    <Box style={{ display: 'flex', gap: 6 }}>
                      <select id="pk-barcode" className="form-input mono-num" value={pack.barcode} required
                        onChange={e => setPack(p => ({ ...p, barcode: e.target.value }))} data-testid="pack-barcode" />
                      <button type="button" className="btn-secondary" title="Scan LPN"
                        onClick={() => setScanning('lpn')} data-testid="pack-scan-lpn">
                        <ScanLine size={14} />
                      </button>
                    </Box>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="pk-dest">Destinations</label>
                    <input id="pk-dest" className="form-input" value={pack.destinations} placeholder="Optional, free text"
                      onChange={e => setPack(p => ({ ...p, destinations: e.target.value }))} />
                  </div>
                </Box>

                {pack.barcode && (
                  <div className="card" style={{ textAlign: 'center', marginBottom: 12 }}>
                    <option value={pack.barcode} height={48} />
                  </div>
                )}

                <Box style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 12, textTransform: 'uppercase' }}>
                    Products ({pack.items.length}) Â· {totalPackedQty} unit(s)
                  </strong>
                  <Box style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn-scanner" onClick={() => setScanning('item')} data-testid="pack-scan-item">
                      <ScanLine size={14} /> Scan Item
                    </button>
                    <button type="button" className="btn-scanner" onClick={() => setScanning('bin')} data-testid="pack-scan-bin">
                      <ScanLine size={14} /> Scan Bin
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setShowStockBrowser(true)} data-testid="pack-browse-all">
                      <Plus size={14} /> Browse All Bins
                    </button>
                  </Box>
                </Box>

                <Box style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: 240, overflowY: 'auto', marginBottom: 14 }}>
                  <table className="data-table" data-testid="pack-items">
                    <thead>
                      <tr><th>Product</th><th>Lot / Batch</th><th>Source bin</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 36 }}></th></tr>
                    </thead>
                    <tbody>
                      {pack.items.map((item, idx) => (
                        <tr key={`${item.sku}-${item.lot}`}>
                          <td>
                            <div className="code-cell">{item.sku_code || String(item.sku)}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.sku_name || ''}</div>
                          </td>
                          <td className="code-cell">{item.lot}{item.batch_number ? ` / ${item.batch_number}` : ''}</td>
                          <td className="code-cell">{item.location || 'â€”'}</td>
                          <td>
                            <input type="number" min="1" max={item.available} className="form-input mono-num"
                              value={item.qty} onChange={e => setItemQty(idx, e.target.value)}
                              aria-label={`Quantity for ${item.sku_code}`} />
                          </td>
                          <td>
                            <button type="button" className="icon-btn" onClick={() => removeItem(idx)} aria-label="Remove line">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!pack.items.length && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                          No products yet â€” scan an item or a bin, or browse all bins.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </Box>

                <Box style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowPackModal(false)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={loading} data-testid="pack-submit">
                    <Check size={14} /> {loading ? 'Packing...' : 'Pack Unit & Generate LPN'}
                  </button>
                </Box>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- All-bins stock browser ---------- */}
      {showStockBrowser && (
        <div className="modal-overlay" onClick={() => setShowStockBrowser(false)}>
          <div className="modal-card" style={{ maxWidth: 900, width: '94vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                All Bins â€” {availableStock.length} stock line(s)
                <div className="page-subtitle" style={{ fontSize: 12 }}>Every bin holding sellable stock, with product detail</div>
              </div>
              <button className="modal-close" onClick={() => setShowStockBrowser(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <div style={{ padding: 16 }}>
              <div className="table-toolbar" style={{ marginBottom: 10 }}>
                <div className="search-box">
                  <Search size={14} />
                  <input placeholder="Filter by product, SKU, lot or batchâ€¦" value={stockFilter}
                    onChange={e => setStockFilter(e.target.value)} data-testid="stock-filter" />
                </div>
                <span className="badge badge-default">Source: /inventory/positions?container=BIN</span>
              </div>
              <div className="table-container" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="data-table" data-testid="all-bins-table">
                  <thead>
                    <tr><th>Product</th><th>Lot / Batch</th><th>Expiry</th><th>Bin</th><th>MRP</th><th>Qty</th><th style={{ width: 76 }}></th></tr>
                  </thead>
                  <tbody>
                    {availableStock.map((r, i) => (
                      <tr key={`${r.sku}-${r.lot}-${i}`}>
                        <td>
                          <div className="code-cell">{r.sku_code || String(r.sku)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.sku_name || ''}</div>
                        </td>
                        <td className="code-cell">{r.lot}{r.batch_number ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Batch {r.batch_number}</div> : null}</td>
                        <td className="code-cell">{r.expiry_date || 'â€”'}</td>
                        <td className="code-cell">{r.location?.barcode || r.container_ref || 'â€”'}</td>
                        <td className="mono-num">{r.mrp ? `â‚¹${r.mrp}` : 'â€”'}</td>
                        <td className="mono-num">{r.qty}</td>
                        <td>
                          <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '2px 6px' }}
                            onClick={() => { addItem(r); setShowStockBrowser(false); }} data-testid="add-stock-line">
                            <Plus size={12} /> Add
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!availableStock.length && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                        No stock matches.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Batch detail (real fields only) ---------- */}
      {selectedBatch && (
        <div className="modal-overlay" onClick={() => setSelectedBatch(null)}>
          <div className="modal-card" style={{ maxWidth: 700, width: '94vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Package size={18} />
                  <span>Batch {selectedBatch.batch_no}</span>
                </Box>
              </div>
              <Box style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-secondary" onClick={() => printBarcode(selectedBatch)}>
                  <Printer size={13} /> Print LPN
                </button>
                <button className="modal-close" onClick={() => setSelectedBatch(null)} aria-label="Close"><X size={18} /></button>
              </Box>
            </div>
            <div style={{ padding: 16 }}>
              <div className="metrics-grid" style={{ marginBottom: 12 }}>
                <div className="stat-card"><div className="stat-value">{selectedBatch.ordered_skus ?? 0}</div><div className="stat-label">Products</div></div>
                <div className="stat-card"><div className="stat-value">{selectedBatch.ordered_qty ?? 0}</div><div className="stat-label">Units</div></div>
                <div className="stat-card"><div className="stat-value">{selectedBatch.picked_qty ?? 0}</div><div className="stat-label">Picked</div></div>
                <div className="stat-card"><div className="stat-value">{selectedBatch.short_qty ?? 0}</div><div className="stat-label">Short</div></div>
              </div>
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="drawer-field">
                  <div className="drawer-field-label">Site</div>
                  <div className="drawer-field-value mono-num">{String(selectedBatch.site ?? 'â€”')}</div>
                </div>
                <div className="drawer-field">
                  <div className="drawer-field-label">Destinations</div>
                  <div className="drawer-field-value">{selectedBatch.destinations || 'â€”'}</div>
                </div>
                <div className="drawer-field">
                  <div className="drawer-field-label">Processing type</div>
                  <div className="drawer-field-value">{selectedBatch.processing_type || 'â€”'}</div>
                </div>
                <div className="drawer-field">
                  <div className="drawer-field-label">Status</div>
                  <div className="drawer-field-value">{selectedBatch.status || 'â€”'}</div>
                </div>
              </div>
              <a style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                A batch has no line items of its own â€” the contents live on the LPN that carries it.
                Scan the LPN barcode to see what is inside.
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Bin transfer (real component, in a modal shell) ---------- */}
      {showBinTransfer && (
        <div className="modal-overlay" onClick={() => setShowBinTransfer(false)}>
          <div className="modal-card" style={{ maxWidth: 980, width: '95vw', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BoxIcon size={18} /><span>Bin Transfer</span>
                </Box>
              </div>
              <button className="modal-close" onClick={() => setShowBinTransfer(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <div style={{ padding: 16 }}>
              <BinTransferView onClose={() => setShowBinTransfer(false)} />
            </div>
          </div>
        </div>
      )}

      {scanning && (
        <BarcodeScannerModal
          title={scanning === 'lpn' ? 'Scan LPN Barcode' : scanning === 'bin' ? 'Scan Bin' : 'Scan Product'}
          expected={scanning === 'lpn' ? 'LPN barcode' : scanning === 'bin' ? 'bin code or barcode' : 'product barcode, SKU code or lot'}
          onClose={() => setScanning(null)}
          onScan={handleScan}
        />
      )}
    </div>
  );
}
