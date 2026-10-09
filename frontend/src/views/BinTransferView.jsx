import React, { useCallback, useState } from 'react';
import { X, RotateCcw, Camera, ScanLine, Trash2, ArrowRight, MapPin, AlertTriangle, CheckCircle2, Layers } from 'lucide-react';
import BarcodeScannerModal from '../components/ui/BarcodeScannerModal';
import { fetchApi, postApi, unwrapList, describeError } from '../api/client';
import { resolveBin } from '../utils/bins';

const SCAN_TITLES = {
  source_bin: 'Scan Source Bin',
  target_bin: 'Scan Target Bin',
  item: 'Scan Item to Move',
};

/**
 * Bin Transfer — move stock between two bins at the same site.
 *
 * Two real defects fixed here:
 *  1. BarcodeScannerModal was imported but never rendered, so every scan button
 *     was a dead end.
 *  2. The submit sent {from_location_id, to_location_id, items:[...]} to
 *     /inventory/relocate, which expects ONE top-level {sku, lot, qty} per
 *     request. The whole transfer silently 400'd.
 */
export default function BinTransferView({ onClose = null }) {
  const [sourceBin, setSourceBin] = useState(null);   // {location_id, label, site_id}
  const [targetBin, setTargetBin] = useState(null);
  const [lines, setLines] = useState([]);             // positions rows + move_qty
  const [scanning, setScanning] = useState(null);     // 'source_bin' | 'target_bin' | 'item'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const loadBinContents = useCallback(async (bin) => {
    setLoading(true);
    setError('');
    try {
      const res = unwrapList(await fetchApi(
        `/inventory/positions?location_id=${encodeURIComponent(bin.location_id)}`
      ));
      const rows = Array.isArray(res) ? res : [];
      // move_qty starts at 0: scanning a source bin must not imply
      // "move everything in it".
      setLines(rows.map(r => ({ ...r, move_qty: 0 })));
      if (!rows.length) setError(`${bin.label} is empty — there is nothing to move.`);
      return rows;
    } catch (err) {
      setError(describeError(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const pickBin = async (raw, which) => {
    const value = String(raw || '').trim();
    if (!value) return;
    setResult(null);
    setLoading(true);
    setError('');
    try {
      const bin = await resolveBin(value);
      if (!bin) { setError(`No bin matches "${value}".`); return; }
      if (bin.candidates) {
        setError(`"${value}" matched ${bin.candidates.length} bins. Use the full bin code or location id.`);
        return;
      }
      if (which === 'source_bin') {
        setSourceBin(bin);
        setTargetBin(null);
        setLines([]);
        setLoading(false);
        await loadBinContents(bin);
      } else {
        setTargetBin(bin);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const setMoveQty = (idx, qty) => {
    const available = Number(lines[idx]?.qty) || 0;
    setLines(prev => prev.map((l, i) => (
      i === idx ? { ...l, move_qty: Math.max(0, Math.min(Number(qty) || 0, available)) } : l
    )));
  };

  /**
   * An item scan selects the matching line and bumps its quantity. Matches on
   * the codes an operator can actually hold: SKU code, SKU uuid, lot, or batch.
   */
  const handleItemScan = (raw) => {
    const value = String(raw || '').trim().toUpperCase();
    if (!value) return;
    const idx = lines.findIndex(l => [l.sku_code, l.sku, l.lot, l.batch_number]
      .some(f => String(f ?? '').toUpperCase() === value));
    if (idx < 0) {
      setError(`"${value}" is not in the source bin.`);
      return;
    }
    setError('');
    setLines(prev => prev.map((l, i) => (
      i === idx ? { ...l, move_qty: Math.min((l.move_qty || 0) + 1, Number(l.qty) || 0) } : l
    )));
  };

  const onScan = (raw) => {
    const value = String(raw || '').trim();
    if (!scanning) return;
    if (scanning === 'item') handleItemScan(value);
    else pickBin(value, scanning);
    setScanning(null);
  };

  const moveLines = lines.filter(l => (l.move_qty || 0) > 0);
  const moveTotal = moveLines.reduce((t, l) => t + (Number(l.move_qty) || 0), 0);

  const submitTransfer = async () => {
    if (!sourceBin || !targetBin || moveLines.length === 0) {
      setError('Scan a source bin, a target bin, and set a quantity on at least one line.');
      return;
    }
    if (sourceBin.location_id === targetBin.location_id) {
      setError('Source and target bin must be different.');
      return;
    }
    // The backend rejects cross-site relocations; catch it before 10 round trips.
    if (sourceBin.site_id && targetBin.site_id && sourceBin.site_id !== targetBin.site_id) {
      setError(`Bins belong to different sites (${sourceBin.site_id} vs ${targetBin.site_id}). Use a transfer order instead.`);
      return;
    }
    // A line without a lot cannot be relocated: the endpoint requires one.
    const missingLot = moveLines.find(l => !l.lot);
    if (missingLot) {
      setError(`${missingLot.sku_code || 'A line'} has no lot recorded, so it cannot be moved.`);
      return;
    }

    setLoading(true);
    setError('');
    const done = [];
    try {
      for (const l of moveLines) {
        await postApi('/inventory/relocate', {
          from_location_id: sourceBin.location_id,
          to_location_id: targetBin.location_id,
          sku: l.sku,
          lot: l.lot,
          qty: Number(l.move_qty),
          // relocate is idempotent on ref_id, and the default key omits the SKU
          // — so without a per-line key, two SKUs sharing a lot collide and the
          // second one silently no-ops.
          ref_id: `RELOC:${sourceBin.location_id}->${targetBin.location_id}:${l.sku}:${l.lot}`,
        });
        done.push(l);
      }
      // Audit record for the move itself.
      await postApi('/ds-ops/bin-transfers/', {
        source_bin: sourceBin.location_id,
        dest_bin: targetBin.location_id,
        status: 'COMPLETED',
      });
      setResult({
        lines: done.length,
        qty: moveTotal,
        from: sourceBin.label,
        to: targetBin.label,
      });
      setSourceBin(null);
      setTargetBin(null);
      setLines([]);
    } catch (err) {
      const movedSoFar = done.length;
      setError(
        `${describeError(err)}${movedSoFar ? ` — ${movedSoFar} of ${moveLines.length} line(s) already moved; re-run for the rest.` : ''}`
      );
      setSourceBin(null);
      setTargetBin(null);
      setLines([]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setSourceBin(null);
    setTargetBin(null);
    setLines([]);
    setError('');
    setResult(null);
  };

  return (
    <div className="workspace-viewport">
      {onClose && (
        <button className="btn-secondary" onClick={onClose} style={{ marginBottom: 12 }}>
          <X size={14} /> Close
        </button>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Bin Transfer</h1>
          <p className="page-subtitle">Move stock between two bins at the same site</p>
        </div>
        <button className="btn-secondary" onClick={reset} data-testid="bin-transfer-reset">
          <RotateCcw size={14} /> Reset
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" data-testid="bin-transfer-error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={16} /><span>{error}</span>
        </div>
      )}
      {result && (
        <div className="alert alert-success" data-testid="bin-transfer-success" style={{ marginBottom: 12 }}>
          <CheckCircle2 size={16} />
          <span>Moved {result.qty} unit(s) across {result.lines} line(s) from {result.from} to {result.to}.</span>
        </div>
      )}

      {/* Step 1 - source bin */}
      <div className="inline-form-card">
        <div className="inline-form-header">
          <div className="inline-form-title">Step 1 — Source bin</div>
          <div className="inline-form-subtitle">The bin you are taking stock from</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-scanner" onClick={() => setScanning('source_bin')} data-testid="scan-source-bin">
            <ScanLine size={16} /> Scan Source Bin
          </button>
          <input
            className="form-input" style={{ flex: 1, minWidth: 190 }} placeholder="Bin code or barcode"
            value={sourceBin?.label || ''} readOnly data-testid="source-bin-value"
          />
          <button className="btn-secondary" onClick={() => pickBin(
            window.prompt('Source bin code or barcode:') || '', 'source_bin'
          )}>Look Up</button>
          </div>
      </div>

      {/* Step 2 - quantities */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ fontSize: 16, margin: 0 }}>Step 2 — Quantities to move</h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {sourceBin
                ? `Scan each item, or type the quantity. ${lines.length} line(s) in this bin.`
                : 'Scan a source bin to list its contents.'}
            </div>
          </div>
          <button className="btn-scanner" onClick={() => setScanning('item')} disabled={!lines.length} data-testid="scan-item">
            <MapPin size={16} /> Scan Item
          </button>
        </div>

        {lines.length > 0 && (
          <div className="table-container">
            <table className="data-table" data-testid="bin-transfer-lines">
              <thead>
                <tr><th>Product</th><th>Lot / Batch</th><th>Available</th><th style={{ width: 120 }}>Move qty</th><th style={{ width: 40 }}></th></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={`${l.sku}-${l.lot}-${i}`} style={l.move_qty > 0 ? { background: 'var(--accent-purple-light)' } : undefined}>
                    <td>
                      <div className="code-cell">{l.sku_code || String(l.sku ?? '—')}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.sku_name || ''}</div>
                    </td>
                    <td className="code-cell">
                      {String(l.lot ?? '—')}
                      {l.batch_number ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Batch {l.batch_number}</div> : null}
                    </td>
                    <td className="mono-num">{Number(l.qty) || 0}</td>
                    <td>
                      <input
                        type="number" min="0" max={Number(l.qty) || 0} className="form-input mono-num"
                        value={l.move_qty} onChange={e => setMoveQty(i, e.target.value)}
                        aria-label={`Quantity to move for ${l.sku_code || l.sku}`}
                      />
                    </td>
                    <td>
                      <button className="icon-btn" onClick={() => setMoveQty(i, 0)} title="Exclude this line" aria-label="Exclude line">
                        <MapPin size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!lines.length && (
          <div style={{ textAlign: 'center', padding: 22, color: 'var(--text-muted)' }}>
            <MapPin size={24} style={{ opacity: 0.4, marginBottom: 6 }} />
            <div>No lines yet.</div>
          </div>
        )}
      </div>

      {/* Step 3 - target bin */}
      <div className="inline-form-card" style={{ marginTop: 12 }}>
        <div className="inline-form-header">
          <div className="inline-form-title">Step 3 — Target bin</div>
          <div className="inline-form-subtitle">Where the stock is going. Must be the same site as the source.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-scanner" onClick={() => setScanning('target_bin')} data-testid="scan-target-bin">
            <ScanLine size={16} /> Scan Target Bin
          </button>
          <input
            className="form-input" style={{ flex: 1, minWidth: 190 }} placeholder="Bin code or barcode"
            value={targetBin?.label || ''} readOnly data-testid="target-bin-value"
          />
          <button className="btn-secondary" onClick={() => pickBin(
            window.prompt('Target bin code or barcode:') || '', 'target_bin'
          )}>Look Up</button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 14 }}>
        {moveLines.length > 0 && (
          <span className="badge badge-purple" data-testid="bin-transfer-total">
            {moveLines.length} line(s) · {moveTotal} unit(s)
          </span>
        )}
        <button className="btn-secondary" onClick={reset}>Clear</button>
        <button
          className="btn-primary" onClick={submitTransfer}
          disabled={loading || !sourceBin || !targetBin || moveLines.length === 0}
          data-testid="execute-bin-transfer"
        >
          {loading ? 'Moving...' : <><ArrowRight size={14} /> Execute Transfer</>}
        </button>
      </div>

      {scanning && (
        <BarcodeScannerModal
          title={SCAN_TITLES[scanning] || 'Scan'}
          expected={scanning === 'item' ? 'product barcode, SKU code or lot' : 'bin code or barcode'}
          onClose={() => setScanning(null)}
          onScan={onScan}
        />
      )}
    </div>
  );
}
