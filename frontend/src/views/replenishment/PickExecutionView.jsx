import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, Package, MapPin, RefreshCw, CheckCircle2, AlertTriangle,
  Boxes, ScanLine, Play, Send,
} from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
import ProductCard from '../../components/ui/ProductCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';

/**
 * Guided, scan-first picking.
 *
 * The worker never types a quantity for stock that has a barcode: the loop is
 * "go to the bin -> scan the bin -> take the product -> scan it" and the task
 * auto-advances once the line is satisfied. Quantity entry survives only for
 * units that genuinely have no barcode, which is the one case where scanning
 * cannot confirm the count.
 */

export default function PickExecutionView() {
  const toast = useToast();

  const [tasks, setTasks] = useState([]);
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [task, setTask] = useState(null);
  const [step, setStep] = useState(0);

  const [scannedBin, setScannedBin] = useState('');
  const [scanText, setScanText] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [manualQty, setManualQty] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      // PickTask.sku is a UUID, so the human-readable SKU code and the EAN the
      // worker actually scans have to be resolved from the catalog.
      //
      // Filtering server-side is required, not an optimisation: the default
      // ordering is -created_at, so an unfiltered first page is entirely
      // COMPLETED work and the open queue looks empty.
      const [notStarted, inProgress, skuRows] = await Promise.all([
        fetchApi('/ds-ops/pick-tasks/?status=NOT_STARTED&page_size=100'),
        fetchApi('/ds-ops/pick-tasks/?status=IN_PROGRESS&page_size=100'),
        fetchApi('/catalog/skus/?page_size=500'),
      ]);      const merged = [...(unwrapList(notStarted) || []), ...(unwrapList(inProgress) || [])];
      setTasks(merged);
      setSkus(unwrapList(skuRows) || []);
    } catch (e) {
      setLoadError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = Array.isArray(tasks) ? tasks : [];

  // Resolve a pick task's UUID sku reference into the codes a worker would scan.
  const skuFor = useCallback(
    (t) => skus.find(s => String(s.id) === String(t.sku)) || null,
    [skus]
  );

  // Accept a scan if it matches the SKU code or the EAN/barcode for this line.
  const matchesLine = useCallback(
    (t, code) => {
      const scanned = String(code).trim().toUpperCase();
      if (!scanned) return true;
      const s = skuFor(t);
      if (!s) return true; // cannot verify; do not block the operator
      const accepted = [s.sku_code, s.ean, s.id]
        .filter(Boolean)
        .map(v => String(v).trim().toUpperCase());
      return accepted.includes(scanned);
    },
    [skuFor]
  );

  const active = useMemo(
    () => open.filter(t => !['COMPLETED', 'CANCELLED'].includes(String(t.status).toUpperCase())),
    [open]
  );

  const begin = (t) => {
    setTask(t);
    setStep(1);
    setScannedBin('');
    setScanText('');
    setFeedback(null);
    setManualQty('');
    toast.info('Task opened', `Pick task #${t.id}`);
  };

  const onScanBin = async (code) => {
    if (!task) return;
    setBusy(true);
    setFeedback(null);
    try {
      // Resolve the scanned code against real bins server-side. Pulling 500
      // locations on every scan is far too slow against the remote database and
      // made the confirmation feel broken.
      const locs = unwrapList(await fetchApi(
        `/network/locations/?location_type=BIN&search=${encodeURIComponent(code)}&page_size=25`
      ));
      const list = Array.isArray(locs) ? locs : [];
      const want = code.trim().toUpperCase();
      const hit = list.find(l => String(l.barcode || '').trim().toUpperCase() === want);

      if (!hit) {
        setFeedback({ type: 'error', message: `Bin "${code}" is not a known location.` });
        return;
      }
      setScannedBin(hit.barcode || code);
      setStep(2);
      setFeedback({ type: 'ok', message: `Confirmed ${hit.barcode || code}. Now scan the product.` });
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  const onScanItem = async (code) => {
    if (!task) return;
    const sku = skuFor(task);
    if (!matchesLine(task, code)) {
      setFeedback({
        type: 'error',
        message: `Wrong product. This line needs ${sku?.sku_code || task.sku}, you scanned ${code}.`,
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const current = Number(task.picked_qty) || 0;
      const need = Number(task.qty) || 0;
      if (current + 1 > need) {
        setFeedback({ type: 'error', message: 'Line is already complete. Press Drop to finish the bin.' });
        return;
      }
      const next = current + 1;
      await patchApi(`/ds-ops/pick-tasks/${task.id}/`, { picked_qty: next });
      setTask(t => ({ ...t, picked_qty: next }));
      setScanText('');
      if (next >= need) {
        setFeedback({ type: 'ok', message: `Line complete (${next}/${need}). Press Drop to release the bin.` });
      } else {
        setFeedback({ type: 'ok', message: `Scanned ${next} of ${need}.` });
      }
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  // Escape hatch for units with no barcode at all.
  const onManualQty = async () => {
    if (!task) return;
    const qty = parseInt(manualQty, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback({ type: 'error', message: 'Enter a quantity greater than zero.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const need = Number(task.qty) || 0;
      const next = Math.min(qty, need);
      await patchApi(`/ds-ops/pick-tasks/${task.id}/`, { picked_qty: next });
      setTask(t => ({ ...t, picked_qty: next }));
      setManualQty('');
      setFeedback({
        type: 'ok',
        message: `Recorded ${next} of ${need} without a barcode scan. Press Drop when finished.`,
      });
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    if (!task) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postApi(`/ds-ops/pick-tasks/${task.id}/complete/`, {});
      toast.success('Pick complete', `Task #${task.id} released to packing.`);
      setTask(null);
      setStep(0);
      setScannedBin('');
      setScanText('');
      await load();
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
      toast.error('Could not complete pick', describeError(e));
    } finally {
      setBusy(false);
    }
  };

  /* ── No task selected: the queue ── */
  if (!task) {
    return (
      <div>

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek"> Pick Queue</div>
              <div className="wf-panel__hint">
                {loading ? 'Loading tasks…' : `${active.length} open task${active.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={load} disabled={loading} data-testid="pick-refresh">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {loadError && (
            <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 14 }} data-testid="pick-load-error">
              <AlertTriangle size={14} /> {loadError}
            </div>
          )}

          {!loading && !loadError && active.length === 0 && (
            <div className="wf-empty" data-testid="pick-empty">
              <Boxes size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">No open pick tasks</div>
              <div className="wf-empty__text">
                Tasks appear here once a transfer order is created and released for picking.
              </div>
            </div>
          )}

          {active.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Picked / Qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody data-testid="pick-queue">
                  {active.map(t => (
                    <tr
                      key={t.id}
                      data-testid={`pick-queue-${t.id}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => begin(t)}
                    >
                      <td data-testid={`pick-queue-${t.id}-name`}>
                        {t.product_name || t.description || skuFor(t)?.name}
                      </td>
                      <td className="code-cell">{skuFor(t)?.sku_code || t.sku}</td>
                      <td className="mono-num" data-testid={`pick-queue-${t.id}-qty`}>
                        {Number(t.picked_qty) || 0}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {' '}/ {Number(t.qty) || 0}
                        </span>
                      </td>
                      <td><StatusBadge status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Active task: the guided loop ── */
  const need = Number(task.qty) || 0;
  const done = Number(task.picked_qty) || 0;
  const lineDone = need > 0 && done >= need;

  return (
    <div>

      <div className="wf-split">
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div className="wf-peek"> Scan</div>
          </div>

          {step === 1 && (
            <ScanInput
              key="bin"
              label="Scan the bin"
              placeholder="Scan bin barcode to confirm location"
              value={scanText}
              onChange={setScanText}
              onScan={onScanBin}
              busy={busy}
              feedback={feedback}
              dataTestId="pick-bin-scan"
            />
          )}

          {step === 2 && (
            <>
              <ScanInput
                key="item"
                label={`Scan ${need} × ${skuFor(task)?.sku_code || skuFor(task)?.name || task.sku}`}
                placeholder="Scan each product unit"
                value={scanText}
                onChange={setScanText}
                onScan={onScanItem}
                busy={busy}
                feedback={feedback}
                dataTestId="pick-item-scan"
              />

              {/* Only for units with no barcode — deliberately secondary. */}
              <Package style={{ marginTop: 14 }}>
                <Package style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  No barcode on this unit?
                </Package>
                <div className="scan-field" style={{ marginTop: 10 }}>
                  <label className="scan-field-label" htmlFor="pick-manual-qty">Enter quantity</label>
                  <div className="scan-field-row">
                    <input
                      id="pick-manual-qty"
                      data-testid="pick-manual-qty"
                      className="scan-input"
                      type="number"
                      min="1"
                      value={manualQty}
                      onChange={e => setManualQty(e.target.value)}
                      placeholder="Qty"
                    />
                    <button
                      type="button"
                      className="scan-btn scan-btn--neutral"
                      onClick={onManualQty}
                      disabled={busy}
                      data-testid="pick-manual-submit"
                    >
                      Record
                    </button>
                  </div>
                </div>
              </Package>
            </>
          )}

          {step === 3 && (
            <div className="scan-feedback scan-feedback--ok" data-testid="pick-done-msg">
              <CheckCircle2 size={14} />
              <span>Line complete. Drop the bin to send it to packing.</span>
            </div>
          )}

          <div className="wf-panel__actions" style={{ marginTop: 18 }}>
            {lineDone && (
              <button
                className="scan-btn scan-btn--success"
                style={{ flex: 1 }}
                onClick={drop}
                disabled={busy}
                data-testid="pick-drop"
              >
                <Send size={16} /> Drop &amp; Release
              </button>
            )}
            <button
              className="btn-secondary"
              onClick={() => { setTask(null); setStep(0); setFeedback(null); }}
              disabled={busy}
              data-testid="pick-abort"
            >
              Abort
            </button>
          </div>
        </div>

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek">
 {task.product_name || task.description || `Task #${task.id}`}
              </div>
              <div className="wf-panel__hint mono-num">{skuFor(task)?.sku_code || task.sku}</div>
            </div>
            <span className="mono-num" style={{ fontSize: 12, color: 'var(--text-muted)' }} data-testid="pick-progress-value">
              {done} of {need} picked
            </span>
          </div>

          <div className="entity-card" style={{ marginBottom: 12 }}>
            <div className="entity-card__thumb"><MapPin size={20} /></div>
            <div className="entity-card__body">
              <div className="entity-card__title">Current bin</div>
              <div className="entity-card__meta">
                <span className="mono-num" data-testid="pick-current-bin">
                  {scannedBin || task.bin_code || task.location || 'Not scanned yet'}
                </span>
              </div>
            </div>
          </div>

          <ProductCard
            dataTestId="pick-active-line"
            product={{ name: task.product_name || task.description || skuFor(task)?.name, sku_code: skuFor(task)?.sku_code || task.sku, ean: skuFor(task)?.ean }}
            picked={done}
            expected={need}
            state={lineDone ? 'done' : 'active'}
            onScan={step === 2 ? () => document.getElementById('pick-item-scan-text')?.focus() : undefined}
          />

          <div className="wf-panel__actions" style={{ marginTop: 14 }}>
            <button
              className="btn-secondary"
              onClick={() => {
                setStep(1); setScannedBin(''); setScanText(''); setFeedback(null);
              }}
              disabled={busy}
              data-testid="pick-rescan-bin"
            >
              <ScanLine size={14} /> Re-scan bin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
