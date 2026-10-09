import React, { useState, useEffect } from 'react';
import { X, ArrowRight, Plus, Trash2, Box, Search, MapPin, Package, AlertTriangle, Loader2, Camera, ScanLine } from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import BarcodeScannerModal from '../components/ui/BarcodeScannerModal';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../api/client';

export default function TransferOrderView() {
  const [transferOrderLines, setTransferOrderLines] = useState([{ sku: '', qty: 1, bin: '' }]);
  const [sites, setSites] = useState([]);
  const [skus, setSkus] = useState([]);
  const [locations, setLocations] = useState([]);
  const [sourceSite, setSourceSite] = useState('');
  const [destSite, setDestSite] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  // 'source_site' | 'dest_site' | { bin: lineIdx }
  const [scanningMode, setScanningMode] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const loadData = async () => {
    setLoading(true);
    try {
      const [sitesRes, skusRes, locRes] = await Promise.all([
        fetchApi('/network/sites/'),
        fetchApi('/catalog/skus/'),
        fetchApi('/network/locations/'),
      ]);
      const sitesList = unwrapList(sitesRes) || [];
      const skusList = unwrapList(skusRes) || [];
      const locList = unwrapList(locRes) || [];
      setSites(sitesList);
      setSkus(skusList);
      setLocations(locList);
      if (sitesList.length > 0) {
        const mh = sitesList.find(s => s.site_type === 'MH');
        const ds = sitesList.find(s => s.site_type === 'DS');
        if (mh) setSourceSite(mh.site_id);
        if (ds) setDestSite(ds.site_id);
      }
    } catch (err) {
      console.error('Load data error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const warehouses = sites.filter(s => s.site_type === 'MH');
  const darkStores = sites.filter(s => s.site_type === 'DS');
  const storageBins = locations.filter(l => l.location_type === 'BIN');

  const addLine = () => setTransferOrderLines(prev => [...prev, { sku: '', qty: 1, bin: '' }]);
  const removeLine = (idx) => {
    if (transferOrderLines.length <= 1) return;
    setTransferOrderLines(prev => prev.filter((_, i) => i !== idx));
  };

  const openBinScanner = (idx) => {
    setScanningMode({ bin: idx });
    setShowScanner(true);
  };

  const updateLine = (idx, field, value) => {
    setTransferOrderLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  /**
   * Route a scan into whichever field asked for it. This used to fire a
   * window-level 'open-scanner' CustomEvent that nothing in the app listened
   * for, so every scan button on this page was a dead end.
   */
  const handleScan = async (raw) => {
    const value = String(raw || '').trim();
    if (!value || !scanningMode) return;
    if (scanningMode === 'source_site') {
      const site = sites.find(s => s.code === value || s.site_id === value || s.barcode === value);
      if (site) setSourceSite(site.site_id);
      else setError(`No site matches "${value}".`);
    } else if (scanningMode === 'dest_site') {
      const site = sites.find(s => s.code === value || s.site_id === value || s.barcode === value);
      if (site) setDestSite(site.site_id);
      else setError(`No site matches "${value}".`);
    } else if (typeof scanningMode === 'object' && 'bin' in scanningMode) {
      const loc = locations.find(l => l.barcode === value || l.location_id === value);
      // PickTask.bin is a free-form code; prefer a readable bin code, fall back
      // to the scanned value so an unlabeled scan still records something valid.
      updateLine(scanningMode.bin, 'bin', loc ? (loc.barcode || value) : value);
    }
    setScanningMode(null);
    setShowScanner(false);
  };

  const submitTransferOrder = async (e) => {
    e.preventDefault();
    if (!sourceSite || !destSite) return alert('Select source and destination sites.');
    const validLines = transferOrderLines.filter(l => l.sku && Number(l.qty) > 0);
    if (validLines.length === 0) return alert('Add at least one SKU line with quantity.');

    setLoading(true);
    try {
      const totalQty = validLines.reduce((a, l) => a + Number(l.qty), 0);
      const transfer = await postApi('/ds-ops/transfer-orders/', {
        source_site: sourceSite,
        dest_site: destSite,
        status: 'ALLOCATED',
        total_qty: totalQty,
      });
      // PickTask.picklist_id is a required UUIDField — "PL-1712..." is a 400.
      const picklistId = crypto.randomUUID();
      for (let i = 0; i <BoxlidLines.length; i++) {
        const l = validLines[i];
        await postApi('/ds-ops/pick-tasks/', {
          picklist_id: picklistId,
          batch: transfer.transfer_id,
          sku: l.sku,
          bin: l.bin || '',
          qty: Number(l.qty),
          picked_qty: 0,
          pick_seq: i + 1,
          status: 'NOT_STARTED',
        });
      }
      await patchApi(`/ds-ops/transfer-orders/${transfer.transfer_id}/`, { status: 'PICKING' });
      showToast(`Transfer order created: picklist ${picklistId.slice(0, 8)} with ${validLines.length} lines (${totalQty} units).`);
      setTransferOrderLines([{ sku: '', qty: 1, bin: '' }]);
      setError('');
      await loadData();
    } catch (err) {
      showToast(`Error: ${describeError(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    // view-container is the landmark class every other screen carries; it has
    // no styling of its own, so this is purely so the view participates in the
    // shared layout contract.
    <div className="view-container" style={{ padding: 20, maxWidth: 900 }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 8 }}>Create Dark Store Transfer Order</h3>
        <a style={{ color: '#64748b', fontSize: 14 }}>Create a transfer order to replenish dark store inventory</a>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 24, zIndex: 999999,
          background: '#065f46', color: '#fff', padding: '12px 20px',
          borderRadius: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10
        }}>
          ✓ {toast}
        </div>
      )}

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#991b1b', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Transfer Details</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: 1, minWidth: 200 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Source Warehouse *</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <select value={sourceSite} onChange={e => setSourceSite(e.target.value)} className="form-input" required>
                <option value="">— Select source warehouse —</option>
                {warehouses.map(s => <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>)}
              </select>
              <button type="button" className="btn-secondary" title="Scan source site"
                onClick={() => { setScanningMode('source_site'); setShowScanner(true); }}
                style={{ padding: '8px' }}>
                <ScanLine size={14} />
              </button>
            </div>
          </label>
          <label style={{ flex: 1, minWidth: 200 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Destination Dark Store *</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <select value={destSite} onChange={e => setDestSite(e.target.value)} className="form-input" required>
                <option value="">— Select dark store —</option>
                {darkStores.map(s => <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>)}
              </select>
              <button type="button" className="btn-secondary" title="Scan destination site"
                onClick={() => { setScanningMode('dest_site'); setShowScanner(true); }}
                style={{ padding: '8px' }}>
                <ScanLine size={14} />
              </button>
            </div>
          </label>
        </div>
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Order Lines ({transferOrderLines.length})</h3>
          <button className="btn-secondary" onClick={addLine} style={{ fontSize: 12 }}>
            <Plus size={14} style={{ marginRight: 4 }} /> Add SKU
          </button>
        </div>

        {transferOrderLines.map((line, idx) => (
          <React.Fragment key={idx}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'end', padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>SKU *</label>
                <select value={line.sku} onChange={e => updateLine(idx, 'sku', e.target.value)} className="form-input" required>
                  <option value="">— Select product —</option>
                  {skus.map(s => <option key={s.sku_id} value={s.sku_id}>{s.name} ({s.sku_code})</option>)}
                </select>
              </div>
              <div style={{ width: 80 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Qty *</label>
                <input type="number" min="1" value={line.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} className="form-input" required />
              </div>
              <div style={{ width: 150 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Bin (scan or type)</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input value={line.bin} onChange={e => updateLine(idx, 'bin', e.target.value)} placeholder="A-01-02-04" className="form-input" list="bin-options" />
                  <datalist id="bin-options">
                    {storageBins.map(b => <option key={b.location_id} value={b.location_id} />)}
                  </datalist>
                  <button type="button" className="btn-secondary" onClick={() => openBinScanner(idx)} style={{ padding: '8px' }}>
                    <MapPin size={14} />
                  </button>
                </div>
              </div>
              <button className="btn-secondary" onClick={() => removeLine(idx)} style={{ alignSelf: 'flex-end', padding: '4px 8px', fontSize: 11 }}>
                <MapPin size={14} style={{ color: '#dc2626' }} />
              </button>
            </div>
          </React.Fragment>
        ))}

        {transferOrderLines.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>
            <a>No SKU lines added yet. Click "Add SKU" to add products to the transfer order.</a>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button className="btn-secondary" onClick={() => setTransferOrderLines([{ sku: '', qty: 1, bin: '' }])}>Clear</button>
          <button className="btn-primary" onClick={submitTransferOrder} disabled={loading} style={{ background: '#059669', color: '#fff' }}>
            <span>{loading ? 'Creating...' : 'Create Transfer Order'}</span>
          </button>
        </div>
      </div>

      {showScanner && (
        <BarcodeScannerModal
          title={scanningMode === 'source_site' ? 'Scan Source Site'
            : scanningMode === 'dest_site' ? 'Scan Destination Site' : 'Scan Pick Bin'}
          expected={scanningMode === 'source_site' || scanningMode === 'dest_site' ? 'site code' : 'bin code or barcode'}
          onClose={() => { setScanningMode(null); setShowScanner(false); }}
          onScan={handleScan}
        />
      )}
    </div>
  );
}


