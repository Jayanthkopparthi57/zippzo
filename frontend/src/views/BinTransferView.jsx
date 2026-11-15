import React, { useCallback, useMemo, useState } from 'react';
import {
  X, RotateCcw, MapPin, AlertTriangle, CheckCircle2, ArrowRightLeft,
  ArrowRight, Undo2, PackageCheck, Boxes,
} from 'lucide-react';
import BarcodeScannerModal from '../components/ui/BarcodeScannerModal';
import ScanInput from '../components/ui/ScanInput';
// WorkflowStepper chrome removed.
import { fetchApi, postApi, unwrapList, describeError } from '../api/client';
import { resolveBin } from '../utils/bins';

// Stage order kept for reference; the stepper chrome no longer renders.

const norm = (v) => String(v ?? '').trim().toUpperCase();

function matchesLine(line, code) {
  return [line.sku_code, line.sku, line.lot, line.batch_number]
    .some((field) => norm(field) === norm(code));
}

/**
 * Bin-to-bin transfer, scan-first and all-or-nothing.
 *
 * The physical order is fixed and the button cannot skip it:
 *   scan source bin -> scan every unit taken out -> scan target bin ->
 *   scan every unit put in -> Sort.
 *
 * Nothing moves until Sort. Before this rewrite the screen POSTed one
 * /inventory/relocate per line in a loop, so a failure on the third line left
 * the first two already moved with no way back. Sort now sends the complete
 * manifest to /inventory/bin-sort, which validates every line and commits both
 * legs in a single transaction.
 */
export default function BinTransferView({ onClose = null }) {
  const [sourceBin, setSourceBin] = useState(null);   // {location_id, label, site_id}
  const [targetBin, setTargetBin] = useState(null);
  const [lines, setLines] = useState([]);             // positions + out/in scan counts
  const [stage, setStage] = useState('source');
  const [scanText, setScanText] = useState('');
  const [scanning, setScanning] = useState(null);     // camera modal target
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [result, setResult] = useState(null);

  const loadBinContents = useCallback(async (bin) => {
    setBusy(true);
    setError('');
    try {
      const res = unwrapList(await fetchApi(
        `/inventory/positions?location_id=${encodeURIComponent(bin.location_id)}`
      ));
      const rows = Array.isArray(res) ? res : [];
      // Both counters start at zero: scanning a bin never implies "move
      // everything in it", and nothing is counted as placed before it is
      // physically scanned into the target.
      setLines(rows.map((r) => ({ ...r, out: 0, in: 0 })));
      if (!rows.length) {
        setError(`${bin.label} is empty — there is nothing to move out of it.`);
      }
      return rows;
    } catch (err) {
      setError(describeError(err));
      return [];
    } finally {
      setBusy(false);
    }
  }, []);

  const takeSource = useCallback(async (value) => {
    setResult(null);
    setError('');
    setBusy(true);
    try {
      const bin = await resolveBin(value);
      if (!bin) { setError(`No bin matches "${value}".`); return; }
      if (bin.candidates) {
        setError(`"${value}" matched ${bin.candidates.length} bins. Scan the full bin barcode.`);
        return;
      }
      setSourceBin(bin);
      setTargetBin(null);
      setStage('remove');
      setScanText('');
      setFeedback(null);
      await loadBinContents(bin);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [loadBinContents]);

  const takeTarget = useCallback(async (value) => {
    setError('');
    setBusy(true);
    try {
      const bin = await resolveBin(value);
      if (!bin) { setError(`No bin matches "${value}".`); return; }
      if (bin.candidates) {
        setError(`"${value}" matched ${bin.candidates.length} bins. Scan the full bin barcode.`);
        return;
      }
      if (sourceBin && bin.location_id === sourceBin.location_id) {
        setError('Target and source bin must be different.');
        return;
      }
      // The backend refuses cross-site sorts; catch it before the operator
      // scans twenty units into a bin the server will reject.
      if (sourceBin?.site_id && bin.site_id && sourceBin.site_id !== bin.site_id) {
        setError(`Bins belong to different sites (${sourceBin.site_id} vs ${bin.site_id}). Use a transfer order instead.`);
        return;
      }
      setTargetBin(bin);
      setLines((prev) => prev.map((l) => ({ ...l, in: 0 })));
      setStage('place');
      setScanText('');
      setFeedback({ type: 'ok', message: `Target ${bin.label} confirmed. Scan each unit into it.` });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [sourceBin]);

  /* ---- scan handlers: every quantity is the result of a scan ---- */

  const scanOut = useCallback((code) => {
    const idx = lines.findIndex((l) => matchesLine(l, code));
    if (idx < 0) return false;
    const line = lines[idx];
    if ((line.out || 0) >= (Number(line.qty) || 0)) {
      setFeedback({
        type: 'error',
        message: `${line.sku_code || line.sku} only has ${line.qty} in this bin — all of them are already scanned out.`,
      });
      return true;
    }
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, out: (l.out || 0) + 1 } : l)));
    setFeedback({ type: 'ok', message: `${line.sku_code || line.sku}: ${(line.out || 0) + 1} of ${line.qty} scanned out.` });
    return true;
  }, [lines]);

  const scanIn = useCallback((code) => {
    const idx = lines.findIndex((l) => (l.out || 0) > 0 && matchesLine(l, code));
    if (idx < 0) return false;
    const line = lines[idx];
    if ((line.in || 0) >= (line.out || 0)) {
      setFeedback({
        type: 'error',
        message: `${line.sku_code || line.sku}: ${line.out} scanned out and ${line.out} already scanned in. Scan out more first.`,
      });
      return true;
    }
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, in: (l.in || 0) + 1 } : l)));
    setFeedback({ type: 'ok', message: `${line.sku_code || line.sku}: ${(line.in || 0) + 1} of ${line.out} placed in ${targetBin?.label}.` });
    return true;
  }, [lines, targetBin]);

  const onScan = useCallback(async (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    setError('');
    if (stage === 'source') { await takeSource(value); return; }
    if (stage === 'target') { await takeTarget(value); return; }
    if (stage === 'remove') {
      setScanText('');
      if (scanOut(value)) return;
      // A bin barcode scanned while picking is unambiguous: it is the target.
      const maybeBin = await resolveBin(value);
      if (maybeBin && !maybeBin.candidates) {
        await takeTarget(value);
        return;
      }
      setFeedback({
        type: 'error',
        message: `"${value}" is not in ${sourceBin?.label || 'the source bin'}. Scan a product from the list, or scan the target bin.`,
      });
      return;
    }
    if (stage === 'place') {
      setScanText('');
      if (scanIn(value)) return;
      setFeedback({
        type: 'error',
        message: `"${value}" was not scanned out of ${sourceBin?.label}. Only units taken from the source can be placed.`,
      });
    }
  }, [stage, takeSource, takeTarget, scanOut, scanIn, sourceBin]);

  const undoLastOut = () => {
    setLines((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if ((prev[i].out || 0) > (prev[i].in || 0)) { idx = i; break; }
      }
      if (idx < 0) return prev;
      return prev.map((l, i) => (i === idx ? { ...l, out: l.out - 1 } : l));
    });
    setFeedback(null);
  };

  const undoLastIn = () => {
    setLines((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if ((prev[i].in || 0) > 0) { idx = i; break; }
      }
      if (idx < 0) return prev;
      return prev.map((l, i) => (i === idx ? { ...l, in: l.in - 1 } : l));
    });
    setFeedback(null);
  };

  const outLines = useMemo(() => lines.filter((l) => (l.out || 0) > 0), [lines]);
  const outTotal = outLines.reduce((t, l) => t + (Number(l.out) || 0), 0);
  const inTotal = lines.reduce((t, l) => t + (Number(l.in) || 0), 0);
  const allPlaced = outTotal > 0 && outTotal === inTotal && outLines.every((l) => (l.in || 0) === (l.out || 0));
  const canSort = Boolean(sourceBin && targetBin && allPlaced && !busy);

  const submitSort = async () => {
    if (!sourceBin || !targetBin) {
      setError('Scan a source bin, scan every unit out, then scan the target bin.');
      return;
    }
    if (!outTotal) {
      setError('Scan at least one unit out of the source bin first.');
      return;
    }
    if (!allPlaced) {
      setError(`Scan every unit into ${targetBin.label} before sorting: ${inTotal} of ${outTotal} placed.`);
      return;
    }
    const missingLot = outLines.find((l) => !l.lot);
    if (missingLot) {
      setError(`${missingLot.sku_code || 'A line'} has no lot recorded, so it cannot be moved.`);
      return;
    }

    setBusy(true);
    setError('');
    setFeedback(null);
    try {
      const res = await postApi('/inventory/bin-sort', {
        from_location_id: sourceBin.location_id,
        to_location_id: targetBin.location_id,
        ref_id: `SORT:${sourceBin.location_id.slice(0, 8)}:${targetBin.location_id.slice(0, 8)}:${Date.now()}`,
        items: outLines.map((l) => ({
          sku: l.sku,
          lot: l.lot,
          qty: Number(l.out) || 0,
        })),
      });
      setResult({
        qty: Number(res?.total_qty ?? outTotal),
        lines: outLines.length,
        from: sourceBin.label,
        to: targetBin.label,
        ref: res?.ref_id || '',
      });
      // Clear the session but keep the result banner: the operator needs the
      // confirmation, not a stale table they might sort twice.
      setSourceBin(null);
      setTargetBin(null);
      setLines([]);
      setStage('source');
      setScanText('');
    } catch (err) {
      setError(`${describeError(err)} — nothing moved; both bins are unchanged.`);
      // Keep every scan on screen so the operator can correct and retry.
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setSourceBin(null);
    setTargetBin(null);
    setLines([]);
    setStage('source');
    setScanText('');
    setScanning(null);
    setError('');
    setFeedback(null);
    setResult(null);
  };

  const cameraScan = (raw) => {
    setScanning(null);
    onScan(raw);
  };

  const scanLabel = {
    source: 'Scan the source bin',
    remove: 'Scan each unit out of the source bin',
    target: 'Scan the target bin',
    place: 'Scan each unit into the target bin',
  }[stage];

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
          <p className="page-subtitle">Scan out, scan in, then Sort — nothing moves before Sort</p>
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
          <span>
            Moved {result.qty} unit(s) across {result.lines} line(s) from {result.from} to {result.to}
            {result.ref ? ` (sort ${result.ref})` : ''}.
          </span>
        </div>
      )}

      <div className="wf-split">
        {/* ---------- left: the scan workflow ---------- */}
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek"> {scanLabel}</div>
              <div className="wf-panel__hint">
                {stage === 'source' && 'Scan the bin barcode you are taking stock from.'}
                {stage === 'remove' && `${outTotal} unit(s) scanned out. Scan each physical unit once.`}
                {stage === 'target' && 'Scan the bin the stock is going into.'}
                {stage === 'place' && `${inTotal} of ${outTotal} unit(s) placed in ${targetBin?.label || 'the target'}.`}
                {stage === 'sort' && 'Ready to commit.'}
              </div>
            </div>
            <div className="wf-panel__actions">
              {stage === 'remove' && (
                <button
                  type="button"
                  className="btn-scanner"
                  onClick={() => { setStage('target'); setScanText(''); setFeedback(null); }}
                  disabled={!outTotal || busy}
                  data-testid="scan-target-bin"
                >
                  <MapPin size={15} /> Scan Target Bin
                </button>
              )}
              {stage === 'place' && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setStage('remove'); setScanText(''); setFeedback(null); }}
                  disabled={busy}
                  data-testid="bin-transfer-back-to-pick"
                >
                  <Undo2 size={14} /> Back to scanning out
                </button>
              )}
            </div>
          </div>

          <ScanInput
            label={scanLabel}
            placeholder={
              stage === 'source' || stage === 'target'
                ? 'Scan the bin barcode, then press Enter'
                : 'Scan a product barcode, then press Enter'
            }
            value={scanText}
            onChange={setScanText}
            onScan={onScan}
            busy={busy}
            feedback={feedback}
            dataTestId="bin-transfer-scan"
            autoFocus
          >
            <div className="scan-field-row" style={{ marginTop: 10, gap: 8 }}>
              {stage === 'source' && (
                <button
                  type="button"
                  className="btn-scanner"
                  onClick={() => setScanning('source')}
                  data-testid="scan-source-bin"
                >
                  <MapPin size={15} /> Camera Scan Source Bin
                </button>
              )}
              {stage === 'target' && (
                <button
                  type="button"
                  className="btn-scanner"
                  onClick={() => setScanning('target')}
                  data-testid="scan-target-bin"
                >
                  <MapPin size={15} /> Camera Scan Target Bin
                </button>
              )}
              {stage === 'remove' && (
                <>
                  <button type="button" className="btn-secondary" onClick={undoLastOut} disabled={!outTotal || busy}
                    data-testid="bin-transfer-undo-out">
                    <Undo2 size={14} /> Undo last unit out
                  </button>
                  <button
                    type="button"
                    className="btn-scanner"
                    onClick={() => setScanning('item')}
                    data-testid="scan-item"
                  >
                    <PackageCheck size={15} /> Camera Scan Unit
                  </button>
                </>
              )}
              {stage === 'place' && (
                <>
                  <button type="button" className="btn-secondary" onClick={undoLastIn} disabled={!inTotal || busy}
                    data-testid="bin-transfer-undo-in">
                    <Undo2 size={14} /> Undo last unit in
                  </button>
                  <button
                    type="button"
                    className="btn-scanner"
                    onClick={() => setScanning('item')}
                    data-testid="scan-item-in"
                  >
                    <PackageCheck size={15} /> Camera Scan Unit
                  </button>
                </>
              )}
            </div>
          </ScanInput>

          {sourceBin && (
            <div className="entity-card" style={{ marginTop: 14 }} data-testid="bin-transfer-source">
              <div className="entity-card__thumb"><Boxes size={20} /></div>
              <div className="entity-card__body">
                <div className="entity-card__title mono-num">{sourceBin.label}</div>
                <div className="entity-card__meta">
                  <span>Source bin</span>
                  <span>{lines.length} line(s) · {outTotal} unit(s) scanned out</span>
                </div>
              </div>
            </div>
          )}

          {targetBin && (
            <div className="entity-card entity-card--active" style={{ marginTop: 10 }} data-testid="bin-transfer-target">
              <div className="entity-card__thumb"><MapPin size={20} /></div>
              <div className="entity-card__body">
                <div className="entity-card__title mono-num">{targetBin.label}</div>
                <div className="entity-card__meta">
                  <span>Target bin</span>
                  <span>{inTotal} of {outTotal} unit(s) placed</span>
                </div>
              </div>
            </div>
          )}

          <div className="wf-panel__actions" style={{ marginTop: 18, gap: 10 }}>
            <button
              type="button"
              className="scan-btn scan-btn--success"
              style={{ flex: 1 }}
              onClick={submitSort}
              disabled={!canSort}
              data-testid="execute-bin-transfer"
            >
              <ArrowRight size={16} /> {busy ? 'Sorting…' : `Sort ${outTotal || ''} unit(s) across both bins`}
            </button>
          </div>
          <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 8 }}>
            Sort is all-or-nothing: both bins are written in one transaction, and a
            failure leaves them exactly as they were.
          </div>
        </div>

        {/* ---------- right: the scanned manifest ---------- */}
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek"> Sort manifest</div>
              <div className="wf-panel__hint">
                Out and in counts come only from scans. They must match before Sort.
              </div>
            </div>
            <span className={`badge ${allPlaced ? 'badge-success' : 'badge-default'}`} data-testid="bin-transfer-total">
              {outTotal} out · {inTotal} in
            </span>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Lot / Batch</th>
                  <th>In bin</th>
                  <th>Scanned out</th>
                  <th>Scanned in</th>
                </tr>
              </thead>
              <tbody data-testid="bin-transfer-lines">
                {lines.map((l, i) => {
                  const out = Number(l.out) || 0;
                  const inn = Number(l.in) || 0;
                  const complete = out > 0 && inn === out;
                  return (
                    <tr key={`${l.sku}-${l.lot}-${i}`} style={complete ? { background: 'var(--accent-purple-light)' } : undefined}>
                      <td>
                        <div className="code-cell">{l.sku_code || String(l.sku ?? '—')}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.sku_name || ''}</div>
                      </td>
                      <td className="code-cell">
                        {String(l.lot ?? '—')}
                        {l.batch_number ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Batch {l.batch_number}</div> : null}
                      </td>
                      <td className="mono-num">{Number(l.qty) || 0}</td>
                      <td className="mono-num">{out}</td>
                      <td className="mono-num">
                        {inn}
                        {out > 0 && (
                          <span style={{ fontSize: 11, color: complete ? 'var(--success-text, #1a7f37)' : 'var(--text-muted)' }}>
                            {' '}/ {out}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!lines.length && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 22, color: 'var(--text-muted)' }}>
                      Scan a source bin to list what is in it. Nothing is movable until then.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="metrics-grid" style={{ marginTop: 14 }}>
            <div className="stat-card">
              <div className="stat-value mono-num">{outTotal}</div>
              <div className="stat-label">Scanned out</div>
            </div>
            <div className="stat-card">
              <div className="stat-value mono-num">{inTotal}</div>
              <div className="stat-label">Scanned in</div>
            </div>
            <div className="stat-card">
              <div className="stat-value mono-num">{outTotal - inTotal}</div>
              <div className="stat-label">Still to place</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{allPlaced ? 'Ready' : outTotal ? 'In progress' : 'Idle'}</div>
              <div className="stat-label">Sort state</div>
            </div>
          </div>
        </div>
      </div>

      {scanning && (
        <BarcodeScannerModal
          title={
            scanning === 'source' ? 'Scan Source Bin'
              : scanning === 'target' ? 'Scan Target Bin'
                : 'Scan Unit'
          }
          expected={scanning === 'item' ? 'product barcode, SKU code, lot or batch' : 'bin code or barcode'}
          onClose={() => setScanning(null)}
          onScan={cameraScan}
        />
      )}
    </div>
  );
}
