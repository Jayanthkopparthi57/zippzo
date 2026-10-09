import React, { useState, useEffect } from 'react';
import { X, Barcode, Printer, CheckCircle, Plus, Trash2, Boxes } from 'lucide-react';
import BarcodeGenerator from './BarcodeGenerator';
import { fetchApi, describeError } from '../../api/client';

export default function LpnModal({ mode = 'CREATE', lpnData = null, onClose, onCreateLpn }) {
  // Container metadata
  const [containerType, setContainerType] = useState('TOTE');
  const [destinationId, setDestinationId] = useState('');
  const [stagingLocation, setStagingLocation] = useState('');

  // Multi-product packing lines. Quantity starts at 1; batch is never guessed
  // and is instead selected per stock line so the lot is always a real one.
  const [packItems, setPackItems] = useState([
    { sku: '', lot: '', quantity: 1, source_location_id: '' }
  ]);

  // Catalog, stock and location data from backend
  const [stores, setStores] = useState([]);
  const [locations, setLocations] = useState([]);
  const [stockLines, setStockLines] = useState([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sites, locs, positions] = await Promise.all([
          fetchApi('/network/sites/'),
          fetchApi('/network/locations/'),
          fetchApi('/inventory/positions'),
        ]);
        if (cancelled) return;
        const siteList = sites?.results ?? sites ?? [];
        const locList = locs?.results ?? locs ?? [];
        const posList = positions?.results ?? positions ?? [];

        setStores(siteList);
        setLocations(locList.filter(l => l.location_type === 'BIN'));
        setStockLines(posList.filter(p => p.container === 'BIN' && p.qty > 0));
        if (siteList.length) setDestinationId(siteList[0].site_id ?? siteList[0].id ?? '');
        setLoadError('');
      } catch (err) {
        if (cancelled) return;
        setLoadError(describeError(err));
        setStores([]); setLocations([]); setStockLines([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Selecting a real stock line fills sku/lot/bin from the ledger, never guesses.
  const selectStockLine = (idx, key) => {
    setPackItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const line = stockLines.find(p => `${p.sku}|${p.lot}|${p.location?.id}` === key);
      if (!line) return it;
      return {
        ...it,
        sku: line.sku,
        lot: line.lot,
        source_location_id: line.location.id,
        sku_code: line.sku_code,
        sku_name: line.sku_name,
        batch_number: line.batch_number,
        location_code: line.location.id,
      };
    }));
  };

  const stockKey = (line) => `${line.sku}|${line.lot}|${line.source_location_id}`;

  // PRINT MODE: Warehouse shipping/tote label
  if (mode === 'PRINT' && lpnData) {
    const contents = lpnData.contents || [];
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" style={{ maxWidth: '520px', background: '#ffffff', color: '#0f172a' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px dashed #cbd5e1', paddingBottom: '12px', marginBottom: '14px' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: '900', letterSpacing: '-0.5px', color: '#0f172a' }}>ZIPPZO LOGISTICS</div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '700' }}>WMS OUTBOUND LPN PACKING SLIP & TOTE LABEL</div>
            </div>
            <button className="icon-btn" style={{ background: '#f1f5f9', color: '#0f172a' }} onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div style={{ textAlign: 'center', margin: '12px 0', background: '#ffffff', padding: '10px', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
            <BarcodeGenerator value={lpnData.barcode || lpnData.lpn_code} width={300} height={65} />
            <div style={{ fontFamily: 'monospace', fontWeight: '700', fontSize: '13px', marginTop: '4px' }}>
              {lpnData.barcode || lpnData.lpn_code}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px', marginBottom: '14px' }}>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Container Type</span>
              <strong style={{ color: '#0f172a' }}>{lpnData.type || lpnData.container_type || 'TOTE'}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Target Destination Store</span>
              <strong style={{ color: '#7c3aed' }}>{lpnData.destination_name || 'Banjara Hills Dark Store'}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Current Bin / Staging</span>
              <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{lpnData.current_bin || lpnData.current_location || 'STAGING-01'}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Total Packed Units</span>
              <strong style={{ color: '#059669', fontSize: '14px' }}>{lpnData.total_qty || lpnData.item_count || 0} Units</strong>
            </div>
          </div>

          {/* Table of Contained Products */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: '#475569', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Boxes size={14} style={{ color: '#7c3aed' }} /> Packed Items Manifest ({contents.length || 1})
            </div>
            <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
              <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                  <tr>
                    <th style={{ padding: '6px 8px' }}>Product</th>
                    <th style={{ padding: '6px 8px' }}>Bin</th>
                    <th style={{ padding: '6px 8px' }}>Batch</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {contents.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '14px 8px', textAlign: 'center', color: '#94a3b8' }}>
                        This LPN has no manifest rows recorded against it.
                      </td>
                    </tr>
                  ) : contents.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px', fontWeight: '600' }}>{it.sku_name || it.sku_code || 'SKU Item'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: '#7c3aed' }}>{it.source_location_code || '—'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{it.batch_number || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '700', color: '#059669' }}>{it.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => window.print()}>
              <Printer size={16} /> Print Barcode Label
            </button>
            <button className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  // Multi-item handlers
  const handleAddItem = () => {
    setPackItems([...packItems, { sku: '', lot: '', quantity: 1, source_location_id: '' }]);
  };

  const handleRemoveItem = (index) => {
    if (packItems.length <= 1) return;
    setPackItems(packItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index, field, value) => {
    setPackItems(prev => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  };

  // CREATE LPN MODAL SUBMIT
  const handleSubmit = (e) => {
    e.preventDefault();
    // Every line must reference a real bin stock row so sku/lot stay consistent.
    const incomplete = packItems.findIndex(it => !it.sku || !it.lot || !it.source_location_id);
    if (incomplete !== -1) {
      setLoadError(`Line ${incomplete + 1} must select a stocked bin line.`);
      return;
    }
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const generatedBarcode = `LPN-${randomSuffix}`;

    const payload = {
      barcode: generatedBarcode,
      type: containerType,
      current_bin: stagingLocation || null,
      items: packItems.map(item => ({
        sku: item.sku,
        lot: item.lot,
        quantity: parseInt(item.quantity) || 1,
        source_location_id: item.source_location_id,
      }))
    };

    setLoadError('');
    if (onCreateLpn) onCreateLpn(payload);
    onClose();
  };

  const totalUnits = packItems.reduce((acc, it) => acc + (parseInt(it.quantity) || 0), 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ color: 'var(--accent-purple-dark)' }}>
            <Barcode size={22} /> Pack Outbound Container LPN (Batch / Tote)
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Top Form Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Container Type</label>
              <select className="form-control" value={containerType} onChange={e => setContainerType(e.target.value)}>
                <option value="TOTE">TOTE (Standard Plastic Tote)</option>
                <option value="CARTON">CARTON (Corrugated Shipper Box)</option>
                <option value="PALLET">PALLET (Standard Wooden Pallet)</option>
                <option value="ROLL_CAGE">ROLL CAGE (Mobile Mesh Container)</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Destination Site</label>
              <select className="form-control" value={destinationId} onChange={e => setDestinationId(e.target.value)}>
                <option value="">-- No destination --</option>
                {stores.map(st => (
                  <option key={st.site_id} value={st.site_id}>
                    {st.name || st.code} ({st.site_type})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label>Outbound Staging Bin</label>
            <select
              className="form-control"
              value={stagingLocation}
              onChange={e => setStagingLocation(e.target.value)}
            >
              <option value="">-- No staging bin --</option>
              {locations.map(loc => (
                <option key={loc.location_id} value={loc.location_id}>{loc.location_id}</option>
              ))}
            </select>
          </div>

          {/* Multi-Product Packing Section */}
          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Boxes size={16} style={{ color: '#7c3aed' }} /> Products To Pack Inside Container ({packItems.length})
              </div>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: '11px', padding: '4px 10px', color: '#7c3aed' }}
                onClick={handleAddItem}
              >
                <Plus size={13} /> Add Another Product
              </button>
            </div>

            {loadError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                padding: '7px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600, marginBottom: '10px' }}>
                {loadError}
              </div>
            )}

            {stockLines.length === 0 ? (
              <div style={{ fontSize: 12, color: '#b45309', padding: '10px 0' }}>
                No stock currently sits in a bin, so there is nothing to pack into an LPN.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '230px', overflowY: 'auto', paddingRight: '4px' }}>
                {packItems.map((item, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr auto', gap: '8px', alignItems: 'center', background: '#ffffff', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}>
                    <div>
                      <label style={{ fontSize: '10px', color: '#64748b', display: 'block', marginBottom: '2px' }}>Stock Line (bin / SKU / lot)</label>
                      <select
                        className="form-control"
                        style={{ fontSize: '11px', padding: '4px 6px', height: '32px' }}
                        value={item.sku && item.lot && item.source_location_id ? stockKey(item) : ''}
                        onChange={e => selectStockLine(idx, e.target.value)}
                        required
                      >
                        <option value="">-- Select stocked bin line --</option>
                        {stockLines.map(p => (
                          <option key={`${p.sku}|${p.lot}|${p.location.id}`} value={`${p.sku}|${p.lot}|${p.location.id}`}>
                            {p.location.id} | {p.sku_code} | lot {p.lot} | {p.qty} avail
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '10px', color: '#64748b', display: 'block', marginBottom: '2px' }}>Qty (Units)</label>
                      <input
                        type="number"
                        min="1"
                        className="form-control"
                        style={{ fontSize: '12px', padding: '4px 6px', height: '32px', textAlign: 'center' }}
                        value={item.quantity}
                        onChange={e => handleItemChange(idx, 'quantity', e.target.value)}
                        required
                      />
                    </div>

                    <div style={{ paddingTop: '16px' }}>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ color: '#ef4444', borderColor: '#fca5a5', width: '28px', height: '28px' }}
                        onClick={() => handleRemoveItem(idx)}
                        disabled={packItems.length <= 1}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Total Summary */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #e2e8f0', fontSize: '12px' }}>
              <span style={{ color: '#64748b' }}>
                Packing <strong>{packItems.length}</strong> unique product types
              </span>
              <strong style={{ color: '#059669', fontSize: '14px' }}>
                Total: {totalUnits} Units
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">
              <CheckCircle size={16} /> Pack Products & Generate LPN
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
