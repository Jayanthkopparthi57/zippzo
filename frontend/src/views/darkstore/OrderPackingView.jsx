import React, { useCallback, useMemo, useState } from 'react';
import {
  PackageCheck, Package, AlertTriangle, RefreshCw, MapPin, Check, X,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import ScanInput from '../../components/ui/ScanInput';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import {
  useAsyncData, useDarkStore, loadOrderQueue, emptyLpns, packOrder, num,
} from './useDarkStore';

/**
 * Pack a picked order into a tote and stage it for the rider.
 *
 * This screen exists because COMPLETE_PICK used to set PACKED itself. "Packed"
 * then meant two different things — the units had been scanned off a shelf, and
 * the units were in a tote at a staging slot — and nothing recorded which. A
 * rider could be told to collect from a bin with nothing in it.
 *
 * So the two facts are separated, and this screen is where the second one is
 * established:
 *
 *   - the tote is scanned, so the operator fills the container the rider will
 *     collect, not one they assume is free;
 *   - the staging slot is typed in, because that slot is what goes into the
 *     rider's notification — a pack that does not record one leaves the rider
 *     with a job they cannot act on;
 *   - the server moves the units out of the store's custody into the tote's
 *     balance, records the tote contents, seals the tote and creates the
 *     delivery task, all in one transaction.
 *
 * Nothing here decides anything locally. The queue, the readiness and the
 * response all come from the server; a 409 from /ds-ops/pack-order is shown
 * verbatim because it is the only thing that knows what is actually short.
 */

/** Statuses the server accepts a pack from. Mirrors pack.PACKABLE_STATUSES. */
const PACKABLE = new Set(['PICKED']);

function PackStation({ siteId }) {
  const toast = useToast();

  const { data: orders, error, loading, reload } = useAsyncData(
    () => loadOrderQueue(siteId, ['PICKED']),
    [siteId],
    { pollMs: 45000 }
  );

  const [selected, setSelected] = useState(null);   // the order row
  const [result, setResult] = useState(null);       // the pack response
  const [scanText, setScanText] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tote, setTote] = useState(null);           // {lpn_id, barcode, label}
  const [stagingBin, setStagingBin] = useState('');

  const queue = useMemo(() => orders || [], [orders]);

  const reset = useCallback(() => {
    setSelected(null);
    setResult(null);
    setScanText('');
    setFeedback(null);
    setTote(null);
    setStagingBin('');
  }, []);

  const choose = (order) => {
    reset();
    setSelected(order);
  };

  /* ── phase 1: scan the tote being filled ── */
  const onScanTote = useCallback(
    async (raw) => {
      const value = String(raw || '').trim();
      setFeedback(null);
      setScanText('');
      if (!selected) return;
      setBusy(true);
      try {
        // Resolved against the EMPTY/CREATED totes already at *this* store, so a
        // scan cannot name a tote that is elsewhere or still holding another
        // order's goods. /ds-ops/pack-order re-checks this server-side; matching
        // here just gives the operator a real answer instead of a 404 later.
        const rows = await emptyLpns(siteId);
        const hit = rows.find(
          (l) =>
            String(l.barcode || '').toUpperCase() === value.toUpperCase() ||
            String(l.lpn_id || '').toUpperCase() === value.toUpperCase()
        );
        if (!hit) {
          setFeedback({
            type: 'error',
            message:
              `"${value}" is not an empty tote at this store. ` +
              `Only a tote that is here and EMPTY or CREATED can be filled — ` +
              `filling one that already holds goods would mix two orders.`,
          });
          return;
        }
        // The operator scans the barcode printed on the tote, so that is what
        // gets sent back. pack-order takes `lpn_barcode`, and an lpn_id in that
        // field is a 404 - the two look alike but are not interchangeable.
        setTote({
          lpn_id: hit.lpn_id,
          barcode: hit.barcode || hit.lpn_id,
          label: hit.barcode || hit.lpn_id,
        });
        setFeedback({
          type: 'ok',
          message: `Tote ${hit.barcode || hit.lpn_id} selected. Enter the staging slot.`,
        });
      } catch (err) {
        setFeedback({
          type: 'error',
          message: err?.message || 'Could not read the tote list.',
        });
      } finally {
        setBusy(false);
      }
    },
    [selected, siteId]
  );

  /* ── phase 2: seal it ── */
  const pack = async () => {
    if (!selected || !tote) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await packOrder(selected.order_id, {
        lpnBarcode: tote.barcode,
        stagingBin: stagingBin.trim(),
      });
      setResult(res);
      setFeedback({
        type: 'ok',
        message: `Packed into ${res.lpn.barcode}, staged at ${res.staging_bin}. ` +
          `Delivery task ${res.delivery_task.status.toLowerCase()} — the rider has been queued for a notification.`,
      });
      toast.success(
        `Order ${res.order_no} packed`,
        `${res.lines.length} line(s) sealed into ${res.lpn.barcode} at ${res.staging_bin}.`
      );
      await reload({ quiet: true });
    } catch (err) {
      const body = err?.body;
      const short = Array.isArray(body?.short_lines) ? body.short_lines : [];
      setFeedback({
        type: 'error',
        message: short.length
          ? `${body.error} ${short
              .map((s) => `${s.sku_code}: ${s.picked_qty}/${s.qty}`)
              .join('; ')}`
          : body?.error || err?.message || 'Could not pack this order.',
      });
    } finally {
      setBusy(false);
    }
  };

  const ready = !!selected && !!tote && stagingBin.trim().length > 0;

  return (
    <>
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><PackageCheck size={17} /> Pack station</div>
            <div className="wf-panel__hint">
              {queue.length} picked order{queue.length === 1 ? '' : 's'} waiting to be sealed into
              a tote at <StoreBadge />
            </div>
          </div>
          <div className="wf-panel__actions">
            {loading && <span className="scan-feedback scan-feedback--hint">Loading…</span>}
            <button className="btn-secondary" onClick={() => reload()} disabled={loading} data-testid="ds-pack-refresh">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="ds-pack-queue-error">
              <AlertTriangle size={14} /> {error}
            </div>
          </div>
        )}

        {queue.length === 0 && !error ? (
          <div className="wf-empty" data-testid="ds-pack-empty">
            <PackageCheck size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">Nothing waiting to be packed</div>
            <div className="wf-empty__text">
              An order appears here once every unit has been scanned off a shelf and the
              pick is completed. Part-picked orders are refused: sealing a short tote
              would tell a rider to collect goods that were never there.
            </div>
          </div>
        ) : (
          <div className="form-group">
            <div className="item-list" data-testid="ds-pack-queue">
              {queue.map((o) => (
                <div key={o.order_id} className="entity-card" data-testid={`ds-pack-order-${o.order_no}`}>
                  <div className="entity-card__thumb"><Package size={22} /></div>
                  <div className="entity-card__body">
                    <div className="entity-card__title mono-num">{o.order_no}</div>
                    <div className="entity-card__meta">
                      <span>Picked <strong>{o.placed_at ? new Date(o.placed_at).toLocaleString() : '—'}</strong></span>
                      <span>Payment <strong>{o.payment_method} · {o.payment_status}</strong></span>
                      <span>Total <strong>₹{num(o.grand_total).toLocaleString('en-IN')}</strong></span>
                    </div>
                  </div>
                  <div className="entity-card__actions">
                    <StatusBadge status={o.status} dataTestId={`ds-pack-status-${o.order_no}`} />
                    <button
                      className="scan-btn"
                      style={{ minHeight: 34, fontSize: 12, marginTop: 6 }}
                      onClick={() => choose(o)}
                      disabled={busy || !PACKABLE.has(o.status)}
                      data-testid={`ds-pack-open-${o.order_no}`}
                    >
                      Pack
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="wf-panel" data-testid="ds-pack-work">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                Packing <span className="mono-num">{selected.order_no}</span>
              </div>
              <div className="wf-panel__hint">
                Seal every picked unit into one tote, then say where the rider will find it.
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={reset} disabled={busy} data-testid="ds-pack-close">
                <X size={14} /> Close
              </button>
            </div>
          </div>

          {result ? (
            <div className="scan-feedback scan-feedback--ok" data-testid="ds-pack-done">
              <Check size={14} />
              <div>
                <div>
                  <strong>{result.order_no}</strong> is {result.status}. Tote{' '}
                  <strong>{result.lpn.barcode}</strong> ({result.lpn.status}) staged at{' '}
                  <strong>{result.staging_bin}</strong>, holding {num(result.tote_qty)} unit(s).
                </div>
                <div style={{ marginTop: 4 }}>
                  Delivery task <span className="mono-num">{result.delivery_task.task_id}</span>{' '}
                  is {result.delivery_task.status}. The rider notification and the pack event
                  are queued, not yet sent.
                </div>
                <button
                  className="scan-btn"
                  style={{ minHeight: 30, fontSize: 12, marginTop: 8 }}
                  onClick={reset}
                  data-testid="ds-pack-next"
                >
                  Pack another
                </button>
              </div>
            </div>
          ) : (
            <>
              <ScanInput
                label={tote ? `Tote ${tote.label} selected` : 'Scan the tote you are filling'}
                placeholder={tote ? 'Scan another tote to change it' : 'Scan the tote barcode printed on the container'}
                value={scanText}
                onChange={setScanText}
                onScan={onScanTote}
                busy={busy}
                feedback={feedback}
                disabled={busy}
                dataTestId="ds-pack-tote-scan"
              />

              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label" htmlFor="ds-pack-staging">
                  <MapPin size={14} /> Staging slot
                </label>
                <input
                  id="ds-pack-staging"
                  className="form-input mono-num"
                  value={stagingBin}
                  onChange={(e) => setStagingBin(e.target.value)}
                  placeholder="e.g. STAGE-03"
                  disabled={busy}
                  data-testid="ds-pack-staging-input"
                />
                <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 6 }}>
                  This exact string goes into the rider's notification. A pack without one
                  would create a delivery task the rider cannot act on, so the server
                  refuses it.
                </div>
              </div>

              <div className="wf-panel__actions">
                <button
                  className="scan-btn"
                  onClick={pack}
                  disabled={busy || !ready}
                  data-testid="ds-pack-submit"
                >
                  <PackageCheck size={16} /> {busy ? 'Packing…' : 'Seal tote & stage'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default function OrderPackingView() {
  const { siteId } = useDarkStore();

  return (
    <StoreGate>
      {siteId && <PackStation siteId={siteId} />}
    </StoreGate>
  );
}
