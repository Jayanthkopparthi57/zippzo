import React, { useCallback, useMemo, useState } from 'react';
import {
  Undo2, AlertTriangle, Check, RefreshCw, Package, MapPin, Lock, X,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { postApi } from '../../api/client';
import { resolveBin } from '../../utils/bins';
import { useDarkStore, useAsyncData, allReturns, siteOrderIds, num } from './useDarkStore';

/**
 * Take returned goods back into sellable stock.
 *
 * The only return action the backend exposes is
 * `POST /reverse/returns/{return_id}/restock/`, and it is strict on two points:
 *
 *  - `qc_disposition` must already be `RESTOCK`. The console has no endpoint to
 *    set a disposition, so a return that has not been through QC is shown as
 *    blocked with the reason rather than given a button that will 400.
 *  - Stock is attributed from the *original order lines* (`shipped_qty`), which
 *    is why a return whose lines carry no lot is refused server-side.
 *
 * On double-submits: the endpoint is idempotent, because `apply_stock` keys each
 * movement on (type, ref, sku, lot, site, direction, container, container_ref)
 * and the server now also short-circuits on `received_at_ds`. This screen still
 * locks the action once used, because a restocked return should read as settled
 * to the operator rather than as a button that silently does nothing.
 */

const NOT_RESTOCKABLE = {
  null: 'This return has not been through QC yet, so no disposition says the goods go back into stock.',
  SCRAP: 'QC disposition is SCRAP. These goods are not returned to sellable stock.',
  REFURBISH: 'QC disposition is REFURBISH. These goods need refurbishment before they can be sold.',
  DAMAGED: 'QC disposition is DAMAGED. These goods are not returned to sellable stock.',
};

function dispositionReason(r) {
  const d = r.qc_disposition;
  if (!d) return NOT_RESTOCKABLE.null;
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
  const [binText, setBinText] = useState('');
  const [bin, setBin] = useState(null);
  const [binError, setBinError] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  // Session-locked after a successful restock: the return should read as
  // settled rather than offering an action that will no-op.
  const [done, setDone] = useState(() => new Set());

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
      const units = (res?.restocked || []).reduce((t, m) => t + num(m.qty), 0);
      toast.success(
        'Return restocked',
        `${units} unit${units === 1 ? '' : 's'} back into ${storeCode}` +
          (bin?.location_id ? ` at bin ${bin.label}.` : ' as site stock.')
      );
      setDone((prev) => new Set(prev).add(selected.return_id));
      setSelected(null);
      setBin(null);
      setBinText('');
      setFeedback(null);
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
    setBin(null);
    setBinText('');
    setBinError('');
    setFeedback(null);
  };

  const pending = rows.filter((r) => !r.received_at_ds && !done.has(r.return_id));
  const settled = rows.filter((r) => r.received_at_ds || done.has(r.return_id));

  const Row = ({ r, index }) => {
    const restocked = !!r.received_at_ds || done.has(r.return_id);
    const canRestock = r.qc_disposition === 'RESTOCK' && !restocked;
    return (
      <div className="entity-card" data-testid={`ds-return-row-${index}`}>
        <div className="entity-card__thumb">
          {restocked ? <Check size={22} /> : canRestock ? <Undo2 size={22} /> : <Lock size={22} />}
        </div>
        <div className="entity-card__body">
          <div className="entity-card__title mono-num">{r.return_id.slice(0, 8)}</div>
          <div className="entity-card__meta">
            <span>Fault <strong>{r.fault}</strong></span>
            {r.qc_disposition && <span>QC <strong>{r.qc_disposition}</strong></span>}
            {r.refund_amount != null && (
              <span>Refund <strong>₹{num(r.refund_amount).toLocaleString('en-IN')}</strong></span>
            )}
            {r.received_at_ds && (
              <span>Received <strong>{new Date(r.received_at_ds).toLocaleString()}</strong></span>
            )}
          </div>
          <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 8 }}>
            {String(r.reason || '').slice(0, 160) || 'No reason recorded.'}
          </div>
          {!canRestock && !restocked && (
            <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 6 }}>
              {dispositionReason(r)}
            </div>
          )}
        </div>
        <div className="entity-card__actions">
          <StatusBadge status={r.status} dataTestId={`ds-return-status-${index}`} />
          {canRestock && (
            <button
              className="scan-btn"
              style={{ minHeight: 34, fontSize: 12, marginTop: 6 }}
              onClick={() => { setSelected(r); setFeedback(null); }}
              data-testid={`ds-return-open-${index}`}
            >
              Restock
            </button>
          )}
        </div>
      </div>
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
              {pending.length} awaiting restock · {settled.length} settled · <AlertTriangle size={14} />
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
                <div className="item-list" data-testid="ds-return-pending">
                  {pending.map((r, i) => <Row key={r.return_id} r={r} index={i} />)}
                </div>
              </div>
            )}
            {settled.length > 0 && (
              <div className="form-group" style={{ marginTop: 12 }}>
                <div className="scan-feedback scan-feedback--hint" style={{ marginBottom: 8 }}>
                  Already restocked — these units are back in stock and must not be added again
                </div>
                <div className="item-list" data-testid="ds-return-settled">
                  {settled.map((r, i) => <Row key={r.return_id} r={r} index={pending.length + i} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
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
            <Row style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input
                id="ds-return-bin"
                data-testid="ds-return-bin"
                className="scan-input"
                style={{ minHeight: 44, fontSize: 15 }}
                value={binText}
                onChange={(e) => setBinText(e.target.value)}
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
            </Row>
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
              disabled={busy || !!binError}
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
