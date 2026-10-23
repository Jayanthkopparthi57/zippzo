import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, Check, X, AlertTriangle, MapPin, Package, Layers,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import ScanInput from '../../components/ui/ScanInput';
import WorkflowStepper from '../../components/ui/WorkflowStepper';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { postApi } from '../../api/client';
import { resolveBin, binLabel } from '../../utils/bins';
import {
  useDarkStore, useAsyncData, receivedLpns, lpnManifest, loadSkuIndex, num,
} from './useDarkStore';

/**
 * Break a received tote down onto the dark store's pick-face bins.
 *
 * This is the gated step: `POST /ds-ops/shelf-putaway` moves stock out of the
 * LPN container and into a BIN container, and only that IN leg is what makes it
 * sellable. Receipt alone deliberately does not.
 *
 * Two rules the screen enforces rather than trusting the operator:
 *
 *  - A scanned product that is not on the tote's manifest is refused. Accepting
 *    it would either silently drop the unit or invent a stock line the hub
 *    never sent.
 *  - Bins go through `resolveBin`, because stock is keyed by
 *    `Location.location_id` and the label carries a barcode or a coordinate.
 *    Sending the raw scanned text makes the server reject the whole placement.
 *
 * Placement is accumulated locally and posted in one call, so a half-finished
 * putaway never leaves stock split across containers in the ledger.
 */

const STEPS = [
  { key: 'tote', title: 'Pick a tote', description: 'Choose a received tote to break down' },
  { key: 'items', title: 'Shelve each line', description: 'Scan the product, then the bin it goes in' },
  { key: 'confirm', title: 'Confirm', description: 'Post every placement to the stock ledger' },
];

function norm(v) {
  return String(v || '').trim().toUpperCase();
}

function Putaway({ siteId, storeCode, operatorId }) {
  const toast = useToast();
  const { data: totes, error: totesError, reload: reloadTotes } = useAsyncData(
    () => receivedLpns(siteId),
    [siteId],
    { pollMs: 60000 }
  );

  const [step, setStep] = useState(0);
  const [tote, setTote] = useState(null);
  const [lines, setLines] = useState([]);
  const [skuIndex, setSkuIndex] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [scanText, setScanText] = useState('');
  const [focused, setFocused] = useState(null);

  const toteRows = useMemo(() => totes || [], [totes]);

  // One SKU lookup for the session: the manifest and the scans both speak in
  // bare uuid/barcodes, so a local index is what makes a scan resolvable.
  useEffect(() => {
    let live = true;
    loadSkuIndex()
      .then((idx) => { if (live) setSkuIndex(idx); })
      .catch(() => { if (live) setSkuIndex(null); });
    return () => { live = false; };
  }, []);

  const openTote = async (row) => {
    setBusy(true);
    setFeedback(null);
    setTote(row);
    setScanText('');
    setFocused(null);
    try {
      const manifest = await lpnManifest(row.lpn_id);
      if (manifest.length === 0) {
        // An empty manifest is a real data problem, not an empty tote: the hub
        // said this tote has contents. Say so instead of showing an empty form.
        setFeedback({
          type: 'error',
          message: `Tote ${row.barcode} has an empty manifest. Check the hub-side packing record before shelving.`,
        });
        setLines([]);
      } else {
        setLines(
          manifest.map((m, i) => ({
            key: `${m.id ?? m.lot ?? i}`,
            lot: m.lot,
            sku: m.sku,
            qty: num(m.qty),
            placedQty: 0,
            bin: '',
            binLabel: '',
          }))
        );
      }
      setStep(1);
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Could not read the tote manifest.' });
    } finally {
      setBusy(false);
    }
  };

  const shelvedCount = lines.filter((l) => l.bin).length;
  const totalUnits = lines.reduce((t, l) => t + l.qty, 0);
  const placedUnits = lines.reduce((t, l) => t + (l.bin ? l.placedQty : 0), 0);

  const onScan = useCallback(
    async (raw) => {
      const value = norm(raw);
      setFeedback(null);
      if (!value) return;
      if (lines.length === 0) {
        setFeedback({ type: 'error', message: 'Open a tote first — there is nothing to shelve.' });
        return;
      }

      const sku = skuIndex?.skuFor(value);
      if (sku) {
        // A product scan focuses the line so the *next* scan, the bin, has an
        // unambiguous target. Scanning an unlisted unit is refused rather than
        // guessed at.
        const line = lines.find((l) => String(l.sku) === String(sku.sku_id));
        if (!line) {
          setFeedback({
            type: 'error',
            message: `${sku.sku_code} is not on this tote's manifest. Put it aside for discrepancy handling.`,
          });
          return;
        }
        setFocused(line.key);
        setScanText('');
        setFeedback({
          type: 'ok',
          message: `${sku.sku_code} selected. Now scan the bin it goes into.`,
        });
        return;
      }

      // Not a product: treat it as a bin label and resolve it properly.
      const target = focused == null ? null : lines.find((l) => l.key === focused);
      try {
        const hit = await resolveBin(raw);
        if (!hit) {
          setFeedback({
            type: 'error',
            message: `No bin matches "${raw}". Scan the bin label, or type its code (e.g. A-01-01-01).`,
          });
          return;
        }
        if (hit.candidates) {
          setFeedback({
            type: 'error',
            message: `"${raw}" matched ${hit.candidates.length} bins. Scan a unique label.`,
          });
          return;
        }
        if (!target) {
          setFeedback({
            type: 'error',
            message: 'Scan the product first, then scan the bin it goes into.',
          });
          return;
        }
        setLines((prev) =>
          prev.map((l) =>
            l.key === target.key
              ? {
                  ...l,
                  bin: hit.location_id,
                  binLabel: hit.label || binLabel(hit.location),
                  // Default the whole line: partial shelving needs a deliberate
                  // edit, which the qty field below makes possible.
                  placedQty: l.qty,
                }
              : l
          )
        );
        setScanText('');
        setFeedback({
          type: 'ok',
          message: `${skuIndex?.byId.get(String(target.sku))?.sku_code || 'Line'} → ${hit.label || hit.location_id}`,
        });
        setStep(2);
      } catch (err) {
        setFeedback({ type: 'error', message: err?.message || 'Bin lookup failed.' });
      }
    },
    [lines, focused, skuIndex]
  );

  const setQty = (key, value) => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, placedQty: n } : l)));
  };

  const confirm = async () => {
    const placements = lines
      .filter((l) => l.bin && l.placedQty > 0)
      .map((l) => ({ sku: l.sku, lot: l.lot, bin: l.bin, qty: l.placedQty }));
    if (placements.length === 0) {
      setFeedback({ type: 'error', message: 'Nothing is shelved yet. Scan a bin for at least one line.' });
      return;
    }
    setBusy(true);
    try {
      const res = await postApi('/ds-ops/shelf-putaway', {
        lpn: tote.lpn_id,
        placements,
        // Named so the ledger's actor_id says which operator moved the stock.
        actor_id: operatorId || '',
      });
      const units = (res?.shelved || []).reduce((t, m) => t + num(m.qty), 0);
      toast.success(
        `Tote ${tote.barcode} shelved`,
        `${units} unit${units === 1 ? '' : 's'} onto pick faces` +
          (res?.lpn_emptied ? '. Tote is now empty and reusable.' : '. Tote still has stock left in it.')
      );
      setTote(null);
      setLines([]);
      setFocused(null);
      setStep(0);
      setScanText('');
      setFeedback(null);
      await reloadTotes({ quiet: true });
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'Shelf putaway failed.';
      setFeedback({ type: 'error', message: msg });
      toast.error('Shelf putaway failed', msg);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTote(null);
    setLines([]);
    setFocused(null);
    setScanText('');
    setFeedback(null);
    setStep(0);
  };

  return (
    <>
      <WorkflowStepper steps={STEPS} current={step} dataTestId="ds-putaway-stepper" />

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><Boxes size={17} /> Received totes awaiting shelving</div>
            <div className="wf-panel__hint">
              Stock in a tote is in custody but not sellable until it lands on a pick face
            </div>
          </div>
          <div className="wf-panel__actions">
            <span className="scan-feedback scan-feedback--hint">
              <Boxes size={13} /> <MapPin size={13} />
            </span>
          </div>
        </div>

        {totesError && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="ds-putaway-tote-error">
              <AlertTriangle size={14} /> {totesError}
            </div>
          </div>
        )}

        {toteRows.length === 0 && !totesError ? (
          <div className="wf-empty" data-testid="ds-putaway-empty">
            <Boxes size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">Nothing to shelve</div>
            <div className="wf-empty__text">
              No received totes are waiting at {storeCode}. Receive an inbound tote first,
              and its contents will appear here.
            </div>
          </div>
        ) : (
          toteRows.length > 0 && (
            <div className="form-group">
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tote</th>
                      <th>Type</th>
                      <th>Insulated</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody data-testid="ds-putaway-totes">
                    {toteRows.map((t) => (
                      <tr key={t.lpn_id}>
                        <td className="mono-num">{t.barcode}</td>
                        <td>{t.lpn_type}</td>
                        <td>{t.is_insulated ? 'yes' : 'no'}</td>
                        <td>
                          <StatusBadge status={t.status} dataTestId={`ds-putaway-status-${t.barcode}`} />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="scan-btn"
                            style={{ minHeight: 34, fontSize: 12 }}
                            data-testid={`ds-putaway-tote-${t.barcode}`}
                            onClick={() => openTote(t)}
                          >
                            Shelve
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>

      {tote && (
        <div className="wf-panel" data-testid="ds-putaway-work">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                <MapPin size={17} /> Shelving <span className="mono-num">{tote.barcode}</span>
              </div>
              <div className="wf-panel__hint">
                {shelvedCount} of {lines.length} line{lines.length === 1 ? '' : 's'} placed ·{' '}
                {placedUnits} of {totalUnits} unit{totalUnits === 1 ? '' : 's'}
              </div>
            </div>
            <div className="wf-panel__actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={reset}
                disabled={busy}
                data-testid="ds-putaway-clear"
              >
                <X size={14} /> Close
              </button>
            </div>
          </div>

          <div className="tally-grid" style={{ marginBottom: 16 }}>
            <div className={`tally-tile${shelvedCount === lines.length && lines.length ? ' tally-tile--ok' : ''}`}>
              <div className="tally-tile__label">Lines shelved</div>
              <div className="tally-tile__value" data-testid="ds-putaway-progress">
                {shelvedCount} / {lines.length}
              </div>
            </div>
            <div className="tally-tile">
              <div className="tally-tile__label">Units placed</div>
              <div className="tally-tile__value" data-testid="ds-putaway-units">{placedUnits}</div>
            </div>
          </div>

          <ScanInput
            label="Scan the product, then the bin"
            placeholder="Scan a product barcode, then a bin label"
            value={scanText}
            onChange={setScanText}
            onScan={onScan}
            busy={busy}
            feedback={feedback}
            disabled={lines.length === 0}
            dataTestId="ds-putaway-scan"
          />

          {lines.length === 0 ? (
            <div className="wf-empty" data-testid="ds-putaway-no-lines">
              <Boxes size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">This tote has no manifest</div>
              <div className="wf-empty__text">
                Nothing to shelve was recorded against {tote.barcode}. Check the hub-side
                packing record.
              </div>
            </div>
          ) : (
            <div className="form-group">
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU / Batch</th>
                      <th>Qty</th>
                      <th>Bin</th>
                      <th>Status</th>
                      <th>Units to shelve</th>
                    </tr>
                  </thead>
                  <tbody data-testid="ds-putaway-lines">
                    {lines.map((l, i) => {
                      const sku = skuIndex?.byId.get(String(l.sku));
                      const state = l.bin ? 'done' : focused === l.key ? 'active' : 'pending';
                      return (
                        <tr
                          key={l.key}
                          data-testid={`ds-putaway-line-${i}`}
                          data-state={state}
                          onClick={() => setFocused(focused === l.key ? null : l.key)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td data-testid={`ds-putaway-line-${i}-name`}>
                            {sku?.name || 'Unknown product'}
                          </td>
                          <td className="mono-num">
                            {sku?.sku_code || '—'}
                            {l.lot ? (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Batch {l.lot}
                              </div>
                            ) : null}
                          </td>
                          <td className="mono-num" data-testid={`ds-putaway-line-${i}-qty`}>
                            {l.placedQty} / {l.qty}
                          </td>
                          <td
                            className="mono-num"
                            data-testid={`ds-putaway-target-${i}`}
                            style={{ color: l.bin ? 'var(--success)' : 'var(--text-muted)' }}
                          >
                            {l.bin ? `→ ${l.binLabel || l.bin}` : 'no bin assigned'}
                          </td>
                          <td>
                            {l.bin ? (
                              <div data-testid={`ds-putaway-bin-${i}`}>
                                <StatusBadge status="SHELVED" />
                              </div>
                            ) : (
                              <StatusBadge status="PENDING" />
                            )}
                          </td>
                          <td>
                            {l.bin && (
                              <input
                                className="scan-input"
                                data-testid={`ds-putaway-qty-${i}`}
                                type="number"
                                min="0"
                                max={l.qty}
                                value={l.placedQty}
                                onChange={(e) => setQty(l.key, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ minHeight: 34, fontSize: 14, width: 90, padding: '0 10px' }}
                                aria-label={`Units to shelve for line ${i + 1}`}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {lines.length > 0 && (
            <div className="wf-panel__actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="scan-btn"
                onClick={confirm}
                disabled={busy || shelvedCount === 0}
                data-testid="ds-putaway-confirm"
              >
                <Check size={16} />{' '}
                {busy ? 'Posting…' : `Shelve ${shelvedCount} line${shelvedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function ShelfPutawayView() {
  const { siteId, storeCode } = useDarkStore();
  const { user } = useAuth();

  return (
    <StoreGate>
      {siteId && (
        <Putaway siteId={siteId} storeCode={storeCode} operatorId={user?.user_id} />
      )}
    </StoreGate>
  );
}
