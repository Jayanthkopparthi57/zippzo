import React, { useState, useEffect, useCallback } from 'react';
import { Layers, ClipboardList, MapPin, ArrowRightLeft, Check, X, AlertTriangle, RefreshCw } from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import { fetchApi, postApi, describeError } from '../api/client';

const EMPTY = Symbol('empty');

export default function InventoryView({ initialTab = 'positions' }) {
  const isFloorApp = typeof window !== 'undefined' && (
    document.documentElement.dataset.surface === 'app' || window.Capacitor?.isNativePlatform?.() === true
  );
  const [activeSubtab, setActiveSubtab] = useState(initialTab);
  const [positions, setPositions] = useState([]);
  const [movements, setMovements] = useState([]);
  const [locations, setLocations] = useState([]);
  const [siteCodes, setSiteCodes] = useState([]);
  const [siteCode, setSiteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [moveForm, setMoveForm] = useState({ lineKey: '', to_location_id: '', qty: 1 });
  const [saving, setSaving] = useState(false);

  useEffect(() => { setActiveSubtab(initialTab); }, [initialTab]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pos, feed, locs] = await Promise.all([
        fetchApi(siteCode ? `/inventory/positions?site_code=${encodeURIComponent(siteCode)}` : '/inventory/positions'),
        fetchApi(siteCode ? `/inventory/feed?limit=200&site_code=${encodeURIComponent(siteCode)}` : '/inventory/feed?limit=200'),
        fetchApi('/network/locations/'),
      ]);
      const posRows = pos?.results ?? [];
      setPositions(posRows);
      setMovements(feed?.results ?? []);
      setLocations(locs ?? []);
      if (pos?.site_codes) setSiteCodes(pos.site_codes);
    } catch (err) {
      // A failed load must be visible, not silently rendered as an empty table.
      setError(describeError(err));
      setPositions([]);
      setMovements([]);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, [siteCode]);

  useEffect(() => { loadData(); }, [loadData]);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const bins = locations.filter(l => l.location_type === 'BIN');

  // Only BIN stock can be relocated, and only when it is actually in a bin.
  const movableLines = positions.filter(
    p => p.container === 'BIN' && p.location && p.qty > 0
  );

  const openRelocationModal = (line = null) => {
    const chosen = line || movableLines[0];
    setMoveError('');
    setMoveForm({
      lineKey: chosen ? `${chosen.sku}|${chosen.lot}|${chosen.location?.id}` : '',
      to_location_id: '',
      qty: 1,
    });
    setShowMoveModal(true);
  };

  const selectedLine = (() => {
    if (!moveForm.lineKey) return null;
    return movableLines.find(p => `${p.sku}|${p.lot}|${p.location?.id}` === moveForm.lineKey) || null;
  })();

  const submitRelocation = async (e) => {
    e.preventDefault();
    if (!selectedLine) { setMoveError('Select a stock line to move.'); return; }
    if (!moveForm.to_location_id) { setMoveError('Select a target bin.'); return; }
    const qty = parseInt(moveForm.qty, 10);
    if (!qty || qty < 1) { setMoveError('Quantity must be at least 1.'); return; }
    if (qty > selectedLine.qty) {
      setMoveError(`Only ${selectedLine.qty} unit(s) available in ${selectedLine.location.id}.`);
      return;
    }
    setSaving(true);
    setMoveError('');
    try {
      await postApi('/inventory/relocate', {
        from_location_id: selectedLine.location.id,
        to_location_id: moveForm.to_location_id,
        sku: selectedLine.sku,
        lot: selectedLine.lot,
        qty,
        movement_ref: 'RELOCATION',
      });
      setShowMoveModal(false);
      await loadData();
      notify(`Moved ${qty} unit(s) of ${selectedLine.sku_code} to ${moveForm.to_location_id}`);
    } catch (err) {
      setMoveError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  // Relocation is a same-site transfer, so only offer bins the selected line's
  // stock is actually at; the backend rejects cross-site moves anyway.
  const targetBins = selectedLine
    ? bins.filter(b => b.location_id !== selectedLine.location?.id && b.site_id === selectedLine.site_id)
    : [];

  const dash = (v) => (v === null || v === undefined || v === '' ? <span style={{ color: '#94a3b8' }}>—</span> : v);

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 24, zIndex: 999999,
          background: '#065f46', color: '#fff', padding: '12px 20px',
          borderRadius: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10
        }}>
          <Check size={14} /> {toast}
        </div>
      )}

      {error && (
        <div className="card" style={{
          borderLeft: '3px solid #b91c1c', background: '#fef2f2',
          padding: '12px 16px', marginBottom: 14, display: 'flex',
          alignItems: 'flex-start', gap: 10, fontSize: 12
        }}>
          <AlertTriangle size={16} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#7f1d1d', marginBottom: 2 }}>Could not load inventory</div>
            <div style={{ color: '#991b1b' }}>{error}</div>
          </div>
          <button className="btn-secondary" onClick={loadData} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={12} /> {loading ? 'Retrying' : 'Retry'}
          </button>
        </div>
      )}

      <div className="subtabs-bar">
        <button className={`subtab-btn ${activeSubtab === 'positions' ? 'active' : ''}`} onClick={() => setActiveSubtab('positions')}>
          <MapPin size={14} /> Stock Positions ({positions.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'feed' ? 'active' : ''}`} onClick={() => setActiveSubtab('feed')}>
          <ClipboardList size={14} /> Movement Ledger ({movements.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'bins' ? 'active' : ''}`} onClick={() => setActiveSubtab('bins')}>
          <MapPin size={14} /> Bins & Locations ({locations.length})
        </button>
        {siteCodes.length > 1 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="form-label" style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Site</label>
            <select className="form-input" style={{ height: 30, width: 190, fontSize: 12 }}
              value={siteCode} onChange={e => setSiteCode(e.target.value)}>
              <option value="">All sites</option>
              {siteCodes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>

      {activeSubtab === 'positions' && (
        <DataTable
          title="Live Stock Positions"
          subtitle="Every StockBalance row, joined to SKU, lot and bin. Counts come straight from the ledger."
          searchPlaceholder="Search SKU, batch, bin..."
          onAdd={isFloorApp ? () => openRelocationModal() : undefined}
          addLabel={isFloorApp ? 'Relocate Stock' : undefined}
          columns={[
            { header: 'Site', key: 'site', render: r => <span className="code-cell">{r.site}</span> },
            { header: 'Container', key: 'container', render: r => (
              <span className={`badge ${r.container === 'BIN' ? 'badge-success' : r.container === 'LPN' ? 'badge-warning' : 'badge-default'}`}>
                {r.container}
              </span>
            )},
            { header: 'Bin / LPN', render: r => r.location
              ? <span className="location-pill">{r.location.id}</span>
              : <span className="code-cell">{r.container_ref || '—'}</span> },
            { header: 'Zone', render: r => dash(r.location?.zone) },
            { header: 'Aisle', render: r => dash(r.location?.aisle) },
            { header: 'Rack', render: r => dash(r.location?.rack) },
            { header: 'Level', render: r => dash(r.location?.level) },
            { header: 'SKU Code', key: 'sku_code', render: r => <strong className="code-cell">{r.sku_code}</strong> },
            { header: 'Product', key: 'sku_name', render: r => <strong>{r.sku_name}</strong> },
            { header: 'Batch No.', key: 'batch_number', render: r => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.batch_number}</span> },
            { header: 'Expiry', key: 'expiry_date', render: r => dash(r.expiry_date) },
            { header: 'On Hand', key: 'qty', align: 'right', render: r => <strong className="mono-num" style={{ fontSize: 13 }}>{r.qty}</strong> },
            { header: 'Sellable', key: 'sellable', align: 'center', render: r => (
              <span className={`badge ${r.sellable ? 'badge-success' : 'badge-default'}`}>{r.sellable ? 'Yes' : 'No'}</span>
            )},
            ...(isFloorApp ? [{ header: 'Action', render: r => (
              <button
                className="btn-secondary"
                style={{ fontSize: 11, padding: '2px 8px' }}
                disabled={r.container !== 'BIN' || !r.location || r.qty < 1}
                onClick={(e) => { e.stopPropagation(); openRelocationModal(r); }}
                title={r.container !== 'BIN' ? 'Only bin stock can be relocated' : 'Move to another bin'}
              >
                <ArrowRightLeft size={12} /> Relocate
              </button>
            )}] : [])
          ]}
          data={positions}
        />
      )}

      {activeSubtab === 'feed' && (
        <DataTable
          title="Stock Movement Ledger"
          subtitle="Append-only audit trail. Each row is hash-chained to the previous one for its site."
          searchPlaceholder="Search movement ref, sku, batch, actor..."
          columns={[
            { header: 'Seq', key: 'id', align: 'right', render: r => <span className="mono-num" style={{ fontSize: 11 }}>#{r.id}</span> },
            { header: 'Type', key: 'movement_ref', render: r => (
              <span className={`badge ${r.movement_ref === 'PUTAWAY' ? 'badge-success'
                : r.movement_ref === 'PICK' ? 'badge-info'
                : r.movement_ref === 'RETURN' ? 'badge-purple'
                : r.movement_ref === 'LPN_RECEIPT' ? 'badge-warning'
                : 'badge-default'}`}>
                {r.movement_ref}
              </span>
            )},
            { header: 'Site', key: 'site', render: r => <span className="code-cell">{r.site}</span> },
            { header: 'SKU', key: 'sku_code', render: r => <span className="code-cell">{r.sku_code}</span> },
            { header: 'Product', key: 'sku_name', render: r => r.sku_name },
            { header: 'Batch', key: 'batch_number', render: r => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.batch_number}</span> },
            { header: 'Qty', key: 'qty', align: 'right', render: r => <strong className="mono-num" style={{ color: '#047857' }}>{r.qty}</strong> },
            { header: 'From', render: r => r.from_location
              ? <span className="location-pill">{r.from_location.id}</span>
              : <span className="location-pill">{r.from_container}{r.from_ref_id ? `:${r.from_ref_id}` : ''}</span> },
            { header: 'To', render: r => r.to_location
              ? <span className="location-pill" style={{ borderColor: '#86efac', color: '#15803d' }}>{r.to_location.id}</span>
              : <span className="location-pill" style={{ borderColor: '#86efac', color: '#15803d' }}>{r.to_container}{r.to_ref_id ? `:${r.to_ref_id}` : ''}</span> },
            { header: 'Reference', key: 'ref_id', render: r => <span style={{ fontSize: 11 }}>{r.movement_type} #{r.ref_id}</span> },
            { header: 'Actor', key: 'actor_id', render: r => dash(r.actor_id) },
            { header: 'When', key: 'created_at', render: r => (
              <span style={{ fontSize: 11, color: '#64748b' }}>{new Date(r.created_at).toLocaleString()}</span>
            )},
          ]}
          data={movements}
        />
      )}

      {activeSubtab === 'bins' && (
        <DataTable
          title="Bins, Zones & Dock Doors"
          subtitle="Physical locations registered against each site."
          searchPlaceholder="Search location, barcode, zone..."
          columns={[
            { header: 'Location Code', key: 'location_id', render: r => <strong className="code-cell">{r.location_id}</strong> },
            { header: 'Barcode', key: 'barcode', render: r => <span className="code-cell">{r.barcode}</span> },
            { header: 'Type', key: 'location_type', render: r => (
              <span className={`badge ${r.location_type === 'BIN' ? 'badge-success'
                : r.location_type === 'DOCK' ? 'badge-info'
                : r.location_type === 'ZONE' ? 'badge-purple' : 'badge-warning'}`}>
                {r.location_type}
              </span>
            )},
            { header: 'Site', key: 'site', render: r => dash(r.site) },
            { header: 'Zone', key: 'zone', render: r => dash(r.zone) },
            { header: 'Zone Type', key: 'zone_type', render: r => dash(r.zone_type) },
            { header: 'Aisle', key: 'aisle', render: r => dash(r.aisle) },
            { header: 'Rack', key: 'rack', render: r => dash(r.rack) },
            { header: 'Level', key: 'level', render: r => dash(r.level) },
            { header: 'Sellable Face', key: 'is_sellable_bin', align: 'center', render: r => (
              <span className={`badge ${r.is_sellable_bin ? 'badge-success' : 'badge-default'}`}>
                {r.is_sellable_bin ? 'Yes' : 'No'}
              </span>
            )},
            { header: 'Status', key: 'is_active', render: r => (
              <span className={`badge ${r.is_active ? 'badge-success' : 'badge-danger'}`}>
                {r.is_active ? 'Active' : 'Inactive'}
              </span>
            )},
          ]}
          data={locations}
        />
      )}

      {isFloorApp && showMoveModal && (
        <div className="modal-overlay" onClick={() => setShowMoveModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '90vw' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: '#f5f3ff', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ArrowRightLeft size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Relocate Stock</h3>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Move units between two bins of the same site</div>
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowMoveModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={submitRelocation}>
              {moveError && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                  padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14, fontWeight: 600
                }}>
                  {moveError}
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 12, color: '#0f172a' }}>
                  Stock line (source bin)
                </label>
                <select
                  className="form-input"
                  value={moveForm.lineKey}
                  onChange={e => setMoveForm(prev => ({ ...prev, lineKey: e.target.value, qty: 1 }))}
                  required
                >
                  <option value="" disabled>-- Select a stocked bin --</option>
                  {movableLines.map(p => (
                    <option key={`${p.sku}|${p.lot}|${p.location.id}`} value={`${p.sku}|${p.lot}|${p.location.id}`}>
                      {p.sku_code} | {p.sku_name} | {p.location.id} | Batch {p.batch_number} | {p.qty} unit(s)
                    </option>
                  ))}
                </select>
                {movableLines.length === 0 && (
                  <div style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>
                    No stock currently sits in a bin, so there is nothing to relocate.
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>Target bin</label>
                  <select
                    className="form-input"
                    style={{ borderColor: '#059669', borderWidth: 2 }}
                    value={moveForm.to_location_id}
                    onChange={e => setMoveForm(prev => ({ ...prev, to_location_id: e.target.value }))}
                    required
                  >
                    <option value="">-- Select target bin --</option>
                    {targetBins.map(b => (
                      <option key={b.location_id} value={b.location_id}>
                        {b.location_id} ({b.site})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Quantity</label>
                  <input
                    type="number" className="form-input" min={1}
                    max={selectedLine?.qty || 1}
                    value={moveForm.qty}
                    onChange={e => setMoveForm(prev => ({ ...prev, qty: e.target.value }))}
                    required
                  />
                  {selectedLine && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                  {selectedLine.qty} unit(s) available
                </div>
              )}
            </div>
          </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowMoveModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving || !movableLines.length}
                  style={{ background: '#7c3aed', color: '#fff' }}>
                  <ArrowRightLeft size={14} /> {saving ? 'Moving' : 'Confirm Relocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
