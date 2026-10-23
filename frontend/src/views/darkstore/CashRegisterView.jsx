/* The store's cash counter: who is carrying what, and the three counted
 * handovers that move money between the vault and a rider.
 *
 * COD money does not vanish at the door - it lands on the rider who collected
 * it, and it stays there until a person at this counter either takes it back
 * (remit), tops the rider up with change (issue float), or counts unused
 * change back in (return float). Every one of those is a movement row on the
 * ledger, and every balance is capped by the custody ceiling, so this screen
 * is the store's half of a handover the rider's own console can only watch.
 *
 * Nothing here is self-service for the rider: the endpoints refuse anyone who
 * is not an operator at this store, because the person carrying the cash never
 * gets to be the person who counts it.
 */
import React, { useMemo, useState } from 'react';
import {
  Banknote, ArrowUpToLine, ArrowDownToLine, Landmark, RefreshCw,
  AlertTriangle, Check, Users,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import { useToast } from '../../components/ui/Toast';
import {
  useDarkStore, useAsyncData, asList, num,
} from './useDarkStore';
import { fetchApi, postApi } from '../../api/client';

const CUSTODY = '/money/rider-custody/';
const MOVES = '/money/cash-movements/';
const RIDERS = '/delivery/rider-profiles/';

function held(custody) {
  return Number(custody?.current_cash || 0) + Number(custody?.current_float || 0);
}

function short(id) {
  return String(id || '').slice(0, 8);
}

export default function CashRegisterView() {
  const { siteId, storeCode } = useDarkStore();
  const toast = useToast();

  const [riderId, setRiderId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);

  const { data: custodyRows, error: custodyError, loading, reload } =
    useAsyncData(
      () => (siteId
        ? fetchApi(`${CUSTODY}?site=${encodeURIComponent(storeCode)}&page_size=100`).then((r) => asList(r, CUSTODY))
        : Promise.resolve([])),
      [siteId, storeCode],
      { pollMs: 30000 },
    );

  const { data: moveRows } = useAsyncData(
    () => (siteId
      ? fetchApi(`${MOVES}?site=${encodeURIComponent(storeCode)}&page_size=50`).then((r) => asList(r, MOVES))
      : Promise.resolve([])),
    [siteId, storeCode],
    { pollMs: 30000 },
  );

  const { data: riderRows } = useAsyncData(
    () => fetchApi(`${RIDERS}?page_size=200`).then((r) => asList(r, RIDERS)),
    [],
    { pollMs: 0 },
  );

  const nameOf = useMemo(() => {
    const map = {};
    (riderRows || []).forEach((r) => { map[String(r.rider_id)] = r.name; });
    return map;
  }, [riderRows]);

  const act = async (action, label) => {
    if (!riderId) {
      setFeedback({ type: 'error', message: 'Pick a rider first.' });
      return;
    }
    const value = Number(amount);
    if (!amount.trim() || Number.isNaN(value) || value <= 0) {
      setFeedback({ type: 'error', message: 'Enter an amount above zero.' });
      return;
    }
    setBusy(action);
    setFeedback(null);
    try {
      const payload = { amount: amount.trim() };
      if (action === 'issue-float') payload.site_code = storeCode;
      const res = await postApi(`${CUSTODY}${riderId}/${action}/`, payload);
      const custody = res?.custody || {};
      setFeedback({
        type: 'ok',
        message: `${label}. ${nameOf[riderId] || 'Rider'} now holds `
          + `₹${num(custody.current_cash)} cash and ₹${num(custody.current_float)} float.`,
      });
      setAmount('');
      toast.success(label, 'Counted at the counter.');
      await reload({ quiet: true });
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'The cash did not move.';
      setFeedback({ type: 'error', message: msg });
      toast.error(`${label} refused`, msg);
    } finally {
      setBusy('');
    }
  };

  const custody = custodyRows || [];
  const moves = moveRows || [];
  const riders = riderRows || [];

  return (
    <StoreGate>
      {siteId && (
        <>
          <div className="wf-panel">
            <div className="wf-panel__header">
              <div>
                <div className="wf-panel__title">
                  <Banknote size={17} /> Cash register
                </div>
                <div className="wf-panel__hint">
                  Float, remittance and collected cash for <StoreBadge />
                </div>
              </div>
              <div className="wf-panel__actions">
                {loading && <span className="scan-feedback scan-feedback--hint">Loading…</span>}
                <button className="btn-secondary" onClick={() => reload()} disabled={loading}
                        data-testid="cr-refresh">
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>
            </div>

            {custodyError && (
              <div className="scan-feedback scan-feedback--error" data-testid="cr-load-error">
                <AlertTriangle size={14} /> {String(custodyError)}
              </div>
            )}

            {feedback && feedback.type === 'error' && (
              <div className="form-group">
                <div className="scan-feedback scan-feedback--error" data-testid="cr-error">
                  <AlertTriangle size={14} /> {feedback.message}
                </div>
              </div>
            )}
            {feedback && feedback.type === 'ok' && (
              <div className="form-group">
                <div className="scan-feedback scan-feedback--ok" data-testid="cr-feedback">
                  <Check size={14} /> {feedback.message}
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="cr-rider">
                <Users size={14} /> Rider
              </label>
              <select id="cr-rider" className="form-input" value={riderId}
                      onChange={(e) => setRiderId(e.target.value)}
                      data-testid="cr-rider-select">
                <option value="">Pick a rider…</option>
                {riders.map((r) => (
                  <option key={r.rider_id} value={r.rider_id}>
                    {r.name || short(r.rider_id)} ({short(r.rider_id)})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="cr-amount">
                <Banknote size={14} /> Amount (₹)
              </label>
              <input id="cr-amount" className="form-input mono-num" inputMode="decimal"
                     value={amount} onChange={(e) => setAmount(e.target.value)}
                     placeholder="Counted amount" disabled={!!busy}
                     data-testid="cr-amount" />
            </div>

            <div className="wf-panel__actions" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button className="scan-btn" onClick={() => act('issue-float', 'Float issued')}
                      disabled={!!busy} data-testid="cr-issue-float">
                <ArrowUpToLine size={14} /> {busy === 'issue-float' ? 'Recording…' : 'Issue float'}
              </button>
              <button className="btn-secondary" onClick={() => act('return-float', 'Float returned')}
                      disabled={!!busy} data-testid="cr-return-float">
                <ArrowDownToLine size={14} /> {busy === 'return-float' ? 'Recording…' : 'Return float'}
              </button>
              <button className="btn-secondary" onClick={() => act('remit', 'Cash remitted')}
                      disabled={!!busy} data-testid="cr-remit">
                <Landmark size={14} /> {busy === 'remit' ? 'Recording…' : 'Remit cash'}
              </button>
            </div>
            <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 8 }}>
              Float is change money the rider does not keep; remit is the collected
              cash going back to the vault. The server refuses any amount the rider
              is not actually holding, and caps everything at the custody ceiling.
            </div>
          </div>

          <div className="wf-panel">
            <div className="wf-panel__header">
              <div className="wf-panel__title">
                <Banknote size={17} /> Custody board
              </div>
              <div className="wf-panel__hint">
                {custody.length} rider{custody.length === 1 ? '' : 's'} holding cash or float at <StoreBadge />
              </div>
            </div>
            {custody.length === 0 ? (
              <div className="wf-empty" data-testid="cr-empty">
                <Banknote size={40} className="wf-empty__icon" />
                <div className="wf-empty__title">Nobody is carrying cash</div>
                <div className="wf-empty__text">
                  A custody row appears the first time a rider collects a tote or is
                  issued float at this store.
                </div>
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Rider</th>
                      <th>Cash</th>
                      <th>Float</th>
                      <th>Ceiling</th>
                      <th>Bags</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody data-testid="cr-custody">
                    {custody.map((c) => {
                      const over = held(c) > Number(c.ceiling_amount || 0);
                      return (
                        <tr key={c.rider_id} data-testid={`cr-rider-${c.rider_id}`}>
                          <td>
                            <div className="entity-card__title">
                              {nameOf[String(c.rider_id)] || short(c.rider_id)}
                              <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>
                                {short(c.rider_id)}
                              </span>
                            </div>
                          </td>
                          <td className="mono-num"><strong>₹{num(c.current_cash)}</strong></td>
                          <td className="mono-num"><strong>₹{num(c.current_float)}</strong></td>
                          <td className="mono-num"><strong>₹{num(c.ceiling_amount)}</strong></td>
                          <td className="mono-num"><strong>{c.bags_in_custody}</strong></td>
                          <td>
                            <span className={`badge ${over ? 'badge-danger' : 'badge-success'}`}
                                  data-testid={`cr-state-${c.rider_id}`}>
                              {over ? 'OVER CEILING' : 'OK'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="wf-panel">
            <div className="wf-panel__header">
              <div className="wf-panel__title">
                <Landmark size={17} /> Cash movements
              </div>
              <div className="wf-panel__hint">
                {moves.length} most recent at <StoreBadge />
              </div>
            </div>
            {moves.length === 0 ? (
              <div className="wf-empty" data-testid="cr-movements-empty">
                <Landmark size={40} className="wf-empty__icon" />
                <div className="wf-empty__title">No cash has moved</div>
                <div className="wf-empty__text">
                  Float issues, returns, COD collections and remittances all land here
                  as they are counted.
                </div>
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Reference</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody data-testid="cr-movements">
                    {moves.map((m) => (
                      <tr key={m.entry_id} data-testid={`cr-move-${m.entry_id}`}>
                        <td>
                          <span className={`badge ${m.movement_type === 'COD_COLLECT' ? 'badge-info'
                            : m.movement_type === 'REMITTANCE_TO_VAULT' ? 'badge-purple' : 'badge-default'}`}>
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="mono-num"><strong>₹{num(m.amount)}</strong></td>
                        <td>{m.from_container || '—'}</td>
                        <td>{m.to_container || '—'}</td>
                        <td>{m.ref_type ? <strong>{m.ref_type}</strong> : '—'}</td>
                        <td className="mono-num">{new Date(m.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </StoreGate>
  );
}
