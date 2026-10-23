import React, { useCallback, useMemo, useState } from 'react';
import {
  Undo2, AlertTriangle, Check, RefreshCw, Package, MapPin, X,
  ClipboardCheck,
} from 'lucide-react';
import StoreGate from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { postApi } from '../../api/client';
import { resolveBin } from '../../utils/bins';
import { useDarkStore, useAsyncData, allReturns, siteOrderIds, num } from './useDarkStore';

/**
 * Take returned goods back into sellable stock, in the three steps they
 * actually move: the store receives them, the store inspects them, the store
 * puts what passed back on the shelf.
 *
 *   POST /reverse/returns/{id}/receive/   goods arrive at the store
 *   POST /reverse/returns/{id}/qc/        inspection, sets qc_disposition
 *   POST /reverse/returns/{id}/restock/   units go back on the shelf
 *
 * Only the last one used to be wired up, and it demanded a disposition that
 * only `qc` could set, while `qc` demanded a receipt that nothing could give
 * it. Each gate blocked the other, so this screen could show a return it had
 * no way to act on. The two missing steps are buttons on the row now.
 *
 * Restock is strict on two points:
 *  - `qc_disposition` must be `RESTOCK`. Anything else is shown as blocked
 *    with the reason rather than given a button that will 400.
 *  - Stock is attributed from the *original order lines* (`shipped_qty`),
 *    which is why a return whose lines carry no lot is refused server-side.
 *
 * Double-submits are absorbed: the endpoint short-circuits on the return's
 * own state and `apply_stock` keys each movement on (type, ref, sku, lot,
 * site, direction, container, container_ref).
 */

const DISPOSITIONS = [
  { value: 'RESTOCK', label: 'Restock — put it back on the shelf' },
  { value: 'SCRAP', label: 'Scrap — write it off' },
  { value: 'DAMAGED', label: 'Damaged — not sellable' },
  { value: 'RETURN_TO_VENDOR', label: 'Return to vendor' },
];

const NOT_RESTOCKABLE = {
  SCRAP: 'QC disposition is SCRAP. These goods are not returned to sellable stock.',
  REFURBISH: 'QC disposition is REFURBISH. These goods need refurbishment before they can be sold.',
  DAMAGED: 'QC disposition is DAMAGED. These goods are not returned to sellable stock.',
  RETURN_TO_VENDOR: 'QC disposition is RETURN_TO_VENDOR. These go back to the supplier, not to the shelf.',
};

function dispositionReason(r) {
  const d = r.qc_disposition;
  return (
    NOT_RESTOCKABLE[String(d).toUpperCase()] ||
    `QC disposition is ${d}. Only RESTOCK puts goods back into sellable stock.`
  );
}

function Returns({ siteId, storeCode }) {
  const toast = useToast();
  const { user } = useAuth();

  // Returns are scoped by intersecting with this site's orders (see siteOrderIds).
  const { data, error, loading, reload } = useAsyncData(
    async () => {
      const [ids, all] = await Promise.all([siteOrderIds(siteId), allReturns()]);
      return all.filter((r) => ids.has(String(r.order)));
    },
    [siteId],
    { pollMs: 60000 }
  );

  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState(null);          // 'qc' | 'restock'
  const [disposition, setDisposition] = useState('RESTOCK');
  const [refund, setRefund] = useState('');
  const [binText, setBinText] = useState('');
  const [bin, setBin] = useState(null);
  const [binError, setBinError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyFor, setBusyFor] = useState(null);    // a row mid-receive
  const [feedback, setFeedback] = useState(null);

  const rows = useMemo(() => data || [], [data]);

  const openBin = useCallback(async () => {
    if (!binText.trim()) {
      setBin({ location_id: '', label: 'site stock (no bin)' });
      setBinError('');
      return;
    }
    try {
      const hit = await resolveBin(binText);
      if (!hit) {
        setBin(null);
        setBinError(`No bin matches "${binText}". Leave it empty to put the units back into site stock.`);
        return;
      }
      if (hit.candidates) {
        setBin(null);
        setBinError(`"${binText}" matched ${hit.candidates.length} bins. Scan a unique label.`);
        return;
      }
      setBin({ location_id: hit.location_id, label: hit.label || hit.location_id });
      setBinError('');
    } catch (err) {
      setBin(null);
      setBinError(err?.message || 'Bin lookup failed.');
    }
  }, [binText]);

  const receive = async (r) => {
    setBusyFor(r.return_id);
    setFeedback(null);
    try {
      await postApi(`/reverse/returns/${r.return_id}/receive/`, { site_code: storeCode });
      toast.success('Return received', `Goods are at ${storeCode} and ready to inspect.`);
      await reload({ quiet: true });
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'Receipt failed.';
      setFeedback({ type: 'error', message: msg });
      toast.error('Receipt failed', msg);
    } finally {
      setBusyFor(null);
    }
  };

  const recordInspection = async () => {
    if (!selected) return;
    setBusy(true);
    setFeedback(null);
    try {
      const payload = { qc_disposition: disposition };
      if (disposition === 'RESTOCK' && refund.trim()) payload.refund_amount = refund.trim();
      await postApi(`/reverse/returns/${selected.return_id}/qc/`, payload);
      toast.success('Inspection recorded', `Disposition: ${disposition}.`);
      close();
      await reload({ quiet: true });
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'Inspection failed.';
      setFeedback({ type: 'error', message: msg });
      toast.error('Inspection failed', msg);
    } finally {
      setBusy(false);
    }
  };

  const restock = async () => {
    if (!selected) return;
    if (binError) {
      setFeedback({ type: 'error', message: binError });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await postApi(
        `/reverse/returns/${selected.return_id}/restock/`,
        {
          site_code: storeCode,
          // Empty bin is valid and means site-level stock rather than a pick face.
          bin: bin?.location_id || '',
          actor_id: user?.user_id || '',
        }
      );
      if (res?.already_restocked) {
        toast.success('Already restocked', 'These units were back on the shelf before.');
      } else {
        const units = (res?.restocked || []).reduce((t, m) => t + num(m.qty), 0);
        toast.success(
          'Return restocked',
          `${units} unit${units === 1 ? '' : 's'} back into ${storeCode}` +
            (bin?.location_id ? ` at bin ${bin.label}.` : ' as site stock.')
        );
      }
      close();
      await reload({ quiet: true });
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'Restock failed.';
      setFeedback({ type: 'error', message: msg });
      toast.error('Restock failed', msg);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setSelected(null);
    setMode(null);
    setDisposition('RESTOCK');
    setRefund('');
    setBin(null);
    setBinText('');
    setBinError('');
    setFeedback(null);
  };

  const open = (r, next) => {
    setSelected(r);
    setMode(next);
    setDisposition('RESTOCK');
    setRefund('');
    setFeedback(null);
    if (next === 'restock') {
      setBin(null);
      setBinText('');
      setBinError('');
    }
  };

  const isRestocked = (r) => r.status === 'CLOSED';
  const pending = rows.filter((r) => !isRestocked(r));
  const settled = rows.filter((r) => isRestocked(r));

  const Row = ({ r, index }) => {
    const restocked = isRestocked(r);
    const awaitingReceipt = !r.received_at_ds;
    const awaitingInspection = !!r.received_at_ds && !r.qc_disposition;
    const awaitingRestock = !!r.received_at_ds && r.qc_disposition === 'RESTOCK' && !restocked;
    const refused = !!r.qc_disposition && r.qc_disposition !== 'RESTOCK' && !restocked;
    const receiving = busyFor === r.return_id;

    return (
      <tr data-testid={`ds-return-row-${index}`}>
        <td className="mono-num">{r.return_id.slice(0, 8)}</td>
        <td>{r.fault}</td>
        <td>{r.qc_disposition || '—'}</td>
        <td className="mono-num">
          {r.refund_amount != null
            ? `₹${num(r.refund_amount).toLocaleString('en-IN')}`
            : '—'}
        </td>
        <td>{r.received_at_ds ? new Date(r.received_at_ds).toLocaleString() : '—'}</td>
        <td>
          <StatusBadge status={r.status} dataTestId={`ds-return-status-${index}`} />
        </td>
        <td>
          <div className="scan-feedback scan-feedback--hint">
            {String(r.reason || '').slice(0, 160) || 'No reason recorded.'}
          </div>
          {!restocked && (
            <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 6 }}>
              {awaitingReceipt
                ? 'Waiting for the goods to arrive at this store.'
                : awaitingInspection
                  ? 'Received. An inspection decides whether it goes back on the shelf.'
                  : refused
                    ? dispositionReason(r)
                    : 'Inspected for restock. Put the units back on the shelf.'}
            </div>
          )}
        </td>
        <td>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {awaitingReceipt && (
              <button
                className="scan-btn"
                style={{ minHeight: 34, fontSize: 12 }}
                onClick={() => receive(r)}
                disabled={receiving}
                data-testid={`ds-return-receive-${index}`}
              >
                {receiving ? 'Receiving…' : 'Receive'}
              </button>
            )}
            {awaitingInspection && (
              <button
                className="scan-btn"
                style={{ minHeight: 34, fontSize: 12 }}
                onClick={() => open(r, 'qc')}
                data-testid={`ds-return-open-${index}`}
              >
                Inspect
              </button>
            )}
            {awaitingRestock && (
              <button
                className="scan-btn"
                style={{ minHeight: 34, fontSize: 12 }}
                onClick={() => open(r, 'restock')}
                data-testid={`ds-return-open-${index}`}
              >
                Restock
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <>
      {error && (
        <div className="wf-panel">
          <div className="scan-feedback scan-feedback--error" data-testid="ds-return-error">
            <AlertTriangle size={14} /> {error}
          </div>
        </div>
      )}

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><Undo2 size={17} /> Returns at this store</div>
            <div className="wf-panel__hint">
              {pending.length} awaiting action · {settled.length} settled · <AlertTriangle size={14} />
            </div>
          </div>
          <div className="wf-panel__actions">
            {loading && <span className="scan-feedback scan-feedback--hint">Loading…</span>}
            <button className="btn-secondary" onClick={() => reload()} disabled={loading} data-testid="ds-return-refresh">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {rows.length === 0 && !error ? (
          <div className="wf-empty" data-testid="ds-return-empty">
            <Package size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">No returns</div>
            <div className="wf-empty__text">
              No orders fulfilled by {storeCode} have a return raised against them.
            </div>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="form-group">
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Return</th>
                        <th>Fault</th>
                        <th>QC</th>
                        <th>Refund</th>
                        <th>Received</th>
                        <th>Status</th>
                        <th>Details</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody data-testid="ds-return-pending">
                      {pending.map((r, i) => <Row key={r.return_id} r={r} index={i} />)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {settled.length > 0 && (
              <div className="form-group" style={{ marginTop: 12 }}>
                <div className="scan-feedback scan-feedback--hint" style={{ marginBottom: 8 }}>
                  Already restocked — these units are back in stock and must not be added again
                </div>
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Return</th>
                        <th>Fault</th>
                        <th>QC</th>
                        <th>Refund</th>
                        <th>Received</th>
                        <th>Status</th>
                        <th>Details</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody data-testid="ds-return-settled">
                      {settled.map((r, i) => <Row key={r.return_id} r={r} index={pending.length + i} />)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {feedback && (
        <div className="wf-panel">
          <div className="scan-feedback scan-feedback--error" data-testid="ds-return-action-error">
            <AlertTriangle size={14} /> <span>{feedback.message}</span>
          </div>
        </div>
      )}

      {selected && mode === 'qc' && (
        <div className="wf-panel" data-testid="ds-return-work">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                Inspecting return <span className="mono-num">{selected.return_id.slice(0, 8)}</span>
              </div>
              <div className="wf-panel__hint">
                The store's decision on goods it has physically received
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={close} disabled={busy} data-testid="ds-return-close">
                <X size={14} /> Close
              </button>
            </div>
          </div>

          {feedback && (
            <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
              <AlertTriangle size={14} /> <span>{feedback.message}</span>
            </div>
          )}

          <div className="form-group">
            <label className="scan-field-label" htmlFor="ds-return-disposition">
              <ClipboardCheck size={13} /> Inspection result
            </label>
            <select
              id="ds-return-disposition"
              className="form-input"
              data-testid="ds-return-qc-disposition"
              value={disposition}
              onChange={(e) => setDisposition(e.target.value)}
              disabled={busy}
              style={{ minHeight: 44, fontSize: 15, marginTop: 6 }}
            >
              {DISPOSITIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          {disposition === 'RESTOCK' && (
            <div className="form-group">
              <label className="scan-field-label" htmlFor="ds-return-refund">
                Refund to the customer (optional)
              </label>
              <input
                id="ds-return-refund"
                data-testid="ds-return-qc-refund"
                className="scan-input"
                style={{ minHeight: 44, fontSize: 15, marginTop: 6 }}
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
                inputMode="decimal"
                placeholder="Amount, or leave empty"
                autoComplete="off"
                disabled={busy}
              />
            </div>
          )}

          <div className="wf-panel__actions">
            <button
              className="scan-btn"
              onClick={recordInspection}
              disabled={busy}
              data-testid="ds-return-qc-confirm"
            >
              {busy ? 'Recording…' : 'Record inspection'}
            </button>
          </div>
        </div>
      )}

      {selected && mode === 'restock' && (
        <div className="wf-panel" data-testid="ds-return-work">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                Restocking return <span className="mono-num">{selected.return_id.slice(0, 8)}</span>
              </div>
              <div className="wf-panel__hint">
                Units are attributed from the original shipped order lines
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={close} disabled={busy} data-testid="ds-return-close">
                <X size={14} /> Close
              </button>
            </div>
          </div>

          {feedback && (
            <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
              <AlertTriangle size={14} /> <span>{feedback.message}</span>
            </div>
          )}

          <div className="form-group">
            <label className="scan-field-label" htmlFor="ds-return-bin">
              <MapPin size={13} /> Putaway bin (optional)
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input
                id="ds-return-bin"
                data-testid="ds-return-bin"
                className="scan-input"
                style={{ minHeight: 44, fontSize: 15 }}
                value={binText}
                onChange={(e) => {
                  // The resolution belongs to the text that produced it. Keep
                  // it and the operator can scan a *different* bin, press
                  // Confirm without hitting Resolve, and the units would be
                  // booked into the bin they resolved first.
                  setBinText(e.target.value);
                  setBin(null);
                  setBinError('');
                }}
                placeholder="Scan a bin, or leave empty for site stock"
                autoComplete="off"
              />
              <button
                type="button"
                className="scan-btn scan-btn--ghost"
                onClick={openBin}
                disabled={busy}
                data-testid="ds-return-bin-resolve"
              >
                Resolve
              </button>
            </div>
            {binError && (
              <div className="scan-feedback scan-feedback--error" style={{ marginTop: 8 }}>
                <AlertTriangle size={14} /> <span>{binError}</span>
              </div>
            )}
            {!binError && bin && (
              <div className="scan-feedback scan-feedback--ok" style={{ marginTop: 8 }} data-testid="ds-return-bin-ok">
                <Check size={14} />
                <span>
                  Into {bin.location_id ? `bin ${bin.label}` : 'site stock (no bin)'}
                </span>
              </div>
            )}
          </div>

          <div className="wf-panel__actions">
            <button
              className="scan-btn"
              onClick={restock}
              disabled={busy || !!binError || (Boolean(binText.trim()) && !bin)}
              data-testid="ds-return-confirm"
            >
              {busy ? 'Restocking…' : 'Confirm restock'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default function ReturnsView() {
  const { siteId, storeCode } = useDarkStore();

  return (
    <StoreGate>
      {siteId && <Returns siteId={siteId} storeCode={storeCode} />}
    </StoreGate>
  );
}
