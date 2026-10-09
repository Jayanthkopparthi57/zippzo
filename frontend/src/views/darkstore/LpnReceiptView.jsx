import React, { useCallback, useMemo, useState } from 'react';
import {
  PackageCheck, ScanLine, Truck, Check, X, AlertTriangle, Package,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import ScanInput from '../../components/ui/ScanInput';
import WorkflowStepper from '../../components/ui/WorkflowStepper';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { postApi } from '../../api/client';
import { useDarkStore, useAsyncData, dsIncomingLpns, num, clockOf } from './useDarkStore';

/**
 * Receive replenishment totes from the mother hub.
 *
 * Receipt is custody, not availability: `POST /ds-ops/receive-lpn` moves the
 * stock into the LPN container and flips the tote to RECEIVED. It is still not
 * pickable until ShelfPutawayView breaks it down onto pick-face bins, so this
 * screen deliberately stops at "in our custody".
 *
 * The scan resolves against the inbound queue, because a tote that is not on
 * this store's inbound list has not been dispatched here and accepting it on
 * the operator's word would put stock in the store with no hub-side paperwork
 * behind it.
 */

const STEPS = [
  { key: 'queue', title: 'Awaiting arrival', description: 'Totes the hub has dispatched to this store' },
  { key: 'scan', title: 'Scan the tote', description: 'Scan the LPN label on the cage or tote' },
  { key: 'confirm', title: 'Confirm custody', description: 'Check the seal, then take it in' },
];

function norm(v) {
  return String(v || '').trim().toUpperCase();
}

function Receipt({ storeCode, storeName, operatorName }) {
  const toast = useToast();
  const { data: queue, error, reload } = useAsyncData(
    () => dsIncomingLpns(storeCode),
    [storeCode],
    { pollMs: 60000 }
  );

  const [step, setStep] = useState(0);
  const [scanText, setScanText] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tote, setTote] = useState(null);
  const [seal, setSeal] = useState('');

  const rows = useMemo(() => queue || [], [queue]);

  // Scans arrive as a bare barcode, so accept either the printed LPN barcode or
  // the internal lpn_id: operators read both off the same label in practice.
  const onScan = useCallback(
    (raw) => {
      const value = norm(raw);
      setFeedback(null);
      if (!value) {
        setFeedback({ type: 'error', message: 'Scan a tote label first.' });
        return;
      }
      const hit = rows.find((r) => norm(r.barcode) === value || norm(r.id) === value);
      if (!hit) {
        setFeedback({
          type: 'error',
          message:
            `No inbound tote matches "${raw}". It is not on this store's inbound ` +
            'list — check the label, or that the hub dispatched it here.',
        });
        return;
      }
      setTote(hit);
      setScanText('');
      setStep(2);
    },
    [rows]
  );

  const receive = async () => {
    if (!tote) return;
    setBusy(true);
    try {
      const res = await postApi('/ds-ops/receive-lpn', {
        barcode: tote.barcode,
        seal_number: seal.trim(),
        // Recorded as the movement's actor_id so the ledger names who took
        // custody. Blank is allowed; a wrong-but-plausible name is not.
        received_by: operatorName || '',
        store_code: storeCode,
      });
      const units = (res?.stock_moved || []).reduce((t, m) => t + num(m.qty), 0);
      toast.success(
        `Tote ${res?.lpn_barcode || tote.barcode} received`,
        units
          ? `${units} unit${units === 1 ? '' : 's'} now in ${storeCode}'s custody. Next: shelf putaway.`
          : 'Received with no stock movement. Check the manifest before shelving.'
      );
      setTote(null);
      setSeal('');
      setStep(0);
      setFeedback(null);
      await reload({ quiet: true });
    } catch (err) {
      // A failed receipt must never be reported as success.
      const msg = err?.body?.error || err?.message || 'Receipt failed.';
      setFeedback({ type: 'error', message: msg });
      toast.error('Receipt failed', msg);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTote(null);
    setSeal('');
    setScanText('');
    setFeedback(null);
    setStep(0);
  };

  const inboundUnits = rows.reduce((t, r) => t + num(r.total_units), 0);

  return (
    <>
      <WorkflowStepper steps={STEPS} current={step} dataTestId="ds-receipt-stepper" />

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><Truck size={17} /> Inbound from Mother Hub</div>
            <div className="wf-panel__hint">
              {rows.length} tote{rows.length === 1 ? '' : 's'} in transit ·{' '}
              {inboundUnits} unit{inboundUnits === 1 ? '' : 's'} expected
            </div>
          </div>
          <div className="wf-panel__actions">
            <span className="scan-feedback scan-feedback--hint">
              <ScanLine size={13} /> <Truck size={13} />
            </span>
          </div>
        </div>

        {error && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="ds-receipt-queue-error">
              <AlertTriangle size={14} /> {error}
            </div>
          </div>
        )}

        {rows.length === 0 && !error ? (
          <div className="wf-empty" data-testid="ds-receipt-empty">
            <PackageCheck size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">Nothing inbound</div>
            <div className="wf-empty__text">
              The hub has not dispatched any totes to {storeName || storeCode}. Totes
              appear here the moment a transfer order is marked in transit.
            </div>
          </div>
        ) : (
          rows.length > 0 && (
            <div className="form-group">
              <div className="item-list" data-testid="ds-receipt-queue">
                {rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="entity-card"
                    style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                    data-testid={`ds-inbound-tote-${r.barcode}`}
                    onClick={() => {
                      setTote(r);
                      setStep(2);
                      setFeedback(null);
                    }}
                  >
                    <div className="entity-card__thumb"><Package size={22} /></div>
                    <div className="entity-card__body">
                      <div className="entity-card__title mono-num">{r.barcode}</div>
                      <div className="entity-card__meta">
                        <span>From <strong>{r.mother_hub || 'UNKNOWN'}</strong></span>
                        <span>Lines <strong>{num(r.item_count)}</strong></span>
                        <span>Units <strong>{num(r.total_units)}</strong></span>
                        <span>Type <strong>{r.lpn_type}</strong></span>
                        {r.created_at && <span>Built <strong>{clockOf(r.created_at)}</strong></span>}
                      </div>
                    </div>
                    <div className="entity-card__actions">
                      <StatusBadge status={r.status} dataTestId={`ds-inbound-status-${r.barcode}`} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        )}
      </div>

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><ScanLine size={17} /> Receive a tote</div>
            <div className="wf-panel__hint">
              Scan the label on the tote, or pick it from the queue above
            </div>
          </div>
        </div>

        <ScanInput
          label="Scan the inbound tote"
          placeholder="Scan an LPN label, or type its barcode"
          value={scanText}
          onChange={setScanText}
          onScan={onScan}
          busy={busy}
          feedback={feedback}
          disabled={!rows.length}
          dataTestId="ds-receipt-scan"
        />

        {tote && (
          <>
            <div className="form-group">
              <div className="entity-card entity-card--active" data-testid="ds-receipt-tote">
                <div className="entity-card__thumb"><Package size={22} /></div>
                <div className="entity-card__body">
                  <div className="entity-card__title mono-num">{tote.barcode}</div>
                  <div className="entity-card__meta">
                    <span>From <strong>{tote.mother_hub || 'UNKNOWN'}</strong></span>
                    <span>Lines <strong>{num(tote.item_count)}</strong></span>
                    <span>Units <strong>{num(tote.total_units)}</strong></span>
                  </div>
                </div>
                <div className="entity-card__actions">
                  <StatusBadge status={tote.status} />
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="scan-field-label" htmlFor="ds-receipt-seal">
                Seal number
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input
                  id="ds-receipt-seal"
                  data-testid="ds-receipt-seal"
                  className="scan-input"
                  style={{ minHeight: 44, fontSize: 15 }}
                  value={seal}
                  onChange={(e) => setSeal(e.target.value)}
                  placeholder="Scan or type the seal number"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="scan-btn"
                  onClick={receive}
                  disabled={busy}
                  data-testid="ds-receipt-confirm"
                >
                  {busy ? 'Receiving…' : 'Receive into store'}
                </button>
              </div>
              <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 8 }}>
                Taking custody parks the stock in the tote. It becomes pickable only
                after shelf putaway.
              </div>
            </div>

            <div className="wf-panel__actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={reset}
                disabled={busy}
                data-testid="ds-receipt-clear"
              >
                <X size={14} /> Clear
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function LpnReceiptView() {
  const { storeCode, storeName } = useDarkStore();
  const { user } = useAuth();

  return (
    <StoreGate>
      {storeCode && (
        <Receipt storeCode={storeCode} storeName={storeName} operatorName={user?.full_name} />
      )}
    </StoreGate>
  );
}
