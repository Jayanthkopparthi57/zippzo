import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, Check, X, AlertTriangle, Package, Lock, RefreshCw,
  Undo2, MapPin,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import ScanInput from '../../components/ui/ScanInput';
import WorkflowStepper from '../../components/ui/WorkflowStepper';
import ProductCard from '../../components/ui/ProductCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { postApi } from '../../api/client';
import {
  useDarkStore, useAsyncData, loadOrderQueue, loadSkuIndex, loadPickLines,
  resolveStoreBin, allocateOrder, num,
} from './useDarkStore';

/**
 * Pick a customer order for this dark store.
 *
 * Every count on this screen comes from the server, and every scan changes
 * stock. There is no local tally.
 *
 * That used to be the opposite: the screen kept a React-only tally, wrote
 * nothing, and COMPLETE_PICK moved the order to PACKED on the strength of that
 * tally. The order then claimed to be packed while every unit was still on the
 * shelf, so the ledger and the order status disagreed permanently. Now:
 *
 *   - `picked_qty`, the per-bin balance and the ledger move together in one
 *     transaction (POST /ds-ops/pick-line);
 *   - the bin is scanned first and checked against the bin the server says the
 *     lot is shelved in, so a scan cannot be made from the wrong shelf;
 *   - the server refuses COMPLETE_PICK until every line is genuinely full, and
 *     names the short lines if it is not;
 *   - "Drop out" returns the units to the bin they came from instead of
 *     quietly zeroing a counter.
 *
 * Two things the order used to lack now exist, and this screen depends on both:
 *
 *   - The operator is fenced to the store they are assigned to. `requireSiteAccess`
 *     on the server resolves `EmployeeSiteAssignment.user`; an operator with no
 *     assignment gets a 403 naming the gap, not a silently wider view.
 *   - The route is fixed before picking starts. POST /ds-ops/allocate-order
 *     writes an allocation per bin, and the work list below is that allocation.
 *     It is what makes a lot split across two shelves pickable, and it is why
 *     the screen has a real bin to send the operator to.
 *
 * COMPLETE_PICK only reaches PICKED. Packing into a tote is a separate operation
 * with its own screen, because "the units are off the shelf" and "the units are
 * in a tote at slot STAGE-03" are different facts and used to be the same status.
 */

const STEPS = [
  { key: 'order', title: 'Pick an order', description: 'Orders waiting to be picked at this store' },
  { key: 'allocate', title: 'Allocate', description: 'Fix the shelf route before anyone walks' },
  { key: 'bin', title: 'Scan the bin', description: 'Walk to the shelf the lot is shelved in' },
  { key: 'items', title: 'Scan the items', description: 'Each scan takes one unit off the shelf' },
  { key: 'done', title: 'Complete pick', description: 'Units are off the shelf; pack them next' },
];

/** Statuses the server accepts COMPLETE_PICK from. Mirrors ORDER_ACTIONS. */
const COMPLETABLE = new Set([
  'CONFIRMED', 'PICKING', 'INTERRUPTED', 'PARTIALLY_FULFILLED',
]);

/**
 * Why a queued order cannot be picked here.
 *
 * The order queue lists CONFIRMED orders so an operator can inspect them, and
 * they are pickable — PICKABLE_STATUSES on the server includes CONFIRMED.
 */
const BLOCKED_REASON = {
  PACKED: 'Already packed. Its units are in a tote, not on a shelf.',
  STAGED: 'Already staged for a rider.',
  RIDER_ASSIGNED: 'A rider has this order.',
  OUT_FOR_DELIVERY: 'On the road.',
  PICKED_UP: 'Collected by the rider.',
  ARRIVED: 'Out for delivery.',
  DELIVERED: 'Delivered.',
  REFUNDED: 'Refunded, so nothing is owed.',
  CANCELLED: 'Cancelled.',
};

function norm(v) {
  return String(v || '').trim().toUpperCase();
}

/** RFC-4122-ish id, so a retried scan carries the same token as its first try. */
function newScanId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function OrderQueue({ siteId, storeCode }) {
  const toast = useToast();
  const { user } = useAuth();

  const [statuses] = useState(() => ['CONFIRMED', 'PICKING', 'PICKED', 'PARTIALLY_FULFILLED']);
  const { data: orders, error, loading, reload } = useAsyncData(
    () => loadOrderQueue(siteId, statuses),
    [siteId],
    { pollMs: 45000 }
  );

  const [work, setWork] = useState(null);   // the /ds-ops/pick-lines payload
  const [skuIndex, setSkuIndex] = useState(null);
  const [step, setStep] = useState(0);
  const [scanText, setScanText] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmedBin, setConfirmedBin] = useState(null); // {location_id, label}

  const queue = useMemo(() => orders || [], [orders]);

  useEffect(() => {
    let live = true;
    loadSkuIndex()
      .then((idx) => { if (live) setSkuIndex(idx); })
      .catch(() => { if (live) setSkuIndex(null); });
    return () => { live = false; };
  }, []);

  // Memoised because `work?.lines || []` allocates a new array every render,
  // which would make the scan callbacks below re-evaluate on every keystroke.
  const lines = useMemo(() => work?.lines || [], [work?.lines]);
  const outstandingTotal = useMemo(
    () => lines.reduce((t, l) => t + Math.max(0, num(l.outstanding)), 0),
    [lines]
  );

  /** Refresh the server view. Never invents numbers the API did not send. */
  const refresh = useCallback(async (orderId) => {
    const id = orderId || work?.order_id;
    if (!id) return null;
    const next = await loadPickLines(id);
    setWork(next);
    return next;
  }, [work?.order_id]);

  const openOrder = async (order) => {
    setBusy(true);
    setFeedback(null);
    setConfirmedBin(null);
    setScanText('');
    try {
      const next = await loadPickLines(order.order_id);
      setWork(next);
      // Land on the allocate step only when the order has no route yet. The
      // stepper is a reading aid, not the flow: an allocated order goes straight
      // to the shelf.
      setStep(next.lines.some((l) => l.allocated) ? 2 : 1);
      if (!next.pickable) {
        setFeedback({
          type: 'error',
          message: next.blocked_reason || `This order is ${next.status}.`,
        });
      }
    } catch (err) {
      setWork(null);
      setFeedback({ type: 'error', message: err?.message || 'Could not read the pick list.' });
    } finally {
      setBusy(false);
    }
  };

  const allocate = async () => {
    if (!work) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await allocateOrder(work.order_id);
      await refresh();
      setStep(2);
      const created = num(res.created);
      setFeedback({
        type: 'ok',
        message: created
          ? `Route fixed: ${created} bin${created === 1 ? '' : 's'} allocated. Walk the shelf list below.`
          : 'Already allocated. The existing route was kept.',
      });
    } catch (err) {
      const body = err?.body;
      const short = Array.isArray(body?.short_lines) ? body.short_lines : [];
      setFeedback({
        type: 'error',
        message: short.length
          ? `${body.error} ${short
              .map((s) => `${s.sku_code} needs ${s.needed}, ${s.available} shelved`)
              .join('; ')}`
          : body?.error || err?.message || 'Could not allocate this order.',
      });
    } finally {
      setBusy(false);
    }
  };

  /** True when no line has a route, so the order cannot be picked at all. */
  const needsAllocation = useMemo(
    () => lines.length > 0 && !lines.some((l) => l.allocated),
    [lines]
  );

  /** The bin to expect next: the first outstanding line's shelf. */
  const expectedBin = useMemo(() => {
    const line = lines.find((l) => num(l.outstanding) > 0);
    return line ? { location_id: line.bin_location_id, label: line.bin } : null;
  }, [lines]);

  /** Every shelf the route touches, in walk order, for the route summary. */
  const route = useMemo(() => {
    const seen = new Map();
    for (const line of lines) {
      for (const bin of line.bins || []) {
        if (!bin.allocated) continue;
        const prev = seen.get(bin.location_id) || { ...bin, lines: 0, outstanding: 0 };
        prev.lines += 1;
        prev.outstanding += num(bin.outstanding);
        seen.set(bin.location_id, prev);
      }
    }
    return [...seen.values()];
  }, [lines]);

  /* ── phase 1: the operator has to be standing at the right shelf ── */
  const onScanBin = useCallback(
    async (raw) => {
      const value = String(raw || '').trim();
      setFeedback(null);
      setBusy(true);
      try {
        const matches = await resolveStoreBin(storeCode, value);
        if (matches.length !== 1) {
          setFeedback({
            type: 'error',
            message:
              `"${raw}" matched ${matches.length} bins at ${storeCode}. ` +
              'Scan the full label printed on the shelf edge.',
          });
          return;
        }
        const found = matches[0];

        if (!expectedBin) {
          setFeedback({
            type: 'error',
            message: 'Every line on this order is already picked. Nothing to scan.',
          });
          return;
        }
        if (found.location_id !== expectedBin.location_id) {
          setFeedback({
            type: 'error',
            message:
              `Wrong bin. ${expectedBin.label} holds the next item you need. ` +
              `You scanned ${found.label}.`,
          });
          return;
        }

        setConfirmedBin(found);
        setStep(2);
        setScanText('');
        setFeedback({ type: 'ok', message: `Bin ${found.label} confirmed. Scan the items.` });
      } catch (err) {
        setFeedback({
          type: 'error',
          message: err?.body?.error || err?.message || 'Could not read that bin.',
        });
      } finally {
        setBusy(false);
      }
    },
    [storeCode, expectedBin]
  );

  /* ── phase 2: one scan = one unit off the shelf ── */
  const onScanItem = useCallback(
    async (raw) => {
      const value = norm(raw);
      setFeedback(null);
      setScanText('');

      if (!confirmedBin) {
        setFeedback({ type: 'error', message: 'Scan the bin before scanning items.' });
        return;
      }
      const sku = skuIndex?.skuFor(value);
      if (!sku) {
        setFeedback({
          type: 'error',
          message: `"${raw}" is not a known SKU. Scan a product from this order, or type its SKU code.`,
        });
        return;
      }

      // Only lines this bin is actually allocated to, and only while that
      // allocation still owes units. A lot split across two shelves appears on
      // both, so a line is matched through its `bins` list rather than through a
      // single `bin_location_id` — which is only the *next* stop on its route.
      const line = lines.find(
        (l) => String(l.sku) === String(sku.sku_id)
          && num(l.outstanding) > 0
          && (l.bins || []).some(
            (b) => b.location_id === confirmedBin.location_id
              && b.allocated && num(b.outstanding) > 0
          )
      );
      if (!line) {
        const elsewhere = lines.find(
          (l) => String(l.sku) === String(sku.sku_id) && num(l.outstanding) > 0
        );
        setFeedback({
          type: 'error',
          message: elsewhere
            ? `${sku.sku_code} is in bin ${elsewhere.bin}, not ${confirmedBin.label}. ` +
              `Scan bin ${elsewhere.bin} first.`
            : `${sku.sku_code} is not on this order, or it is already fully picked. ` +
              'Set it aside — it does not belong in this tote.',
        });
        return;
      }

      setBusy(true);
      try {
        const res = await postApi('/ds-ops/pick-line', {
          order_id: work.order_id,
          line_id: line.line_id,
          bin_location_id: confirmedBin.location_id,
          qty: 1,
          // One id per physical scan: the server treats a repeat of the same id
          // as a retry, so a dropped response cannot take two units off the
          // shelf.
          scan_id: newScanId(),
        });

        // Re-read rather than patching the line locally. On a split lot the next
        // bin is a server-side decision, and guessing it here is how the picker
        // ends up sent to a shelf the order is not allocated to.
        const next = await refresh();

        const left = num(res.outstanding);
        const nextBin = next?.lines?.find((l) => num(l.outstanding) > 0);
        if (left > 0) {
          setFeedback({
            type: 'ok',
            message: `${sku.sku_code} — ${left} more to go from this bin.`,
          });
        } else if (nextBin) {
          setConfirmedBin(null);
          setStep(3);
          setFeedback({
            type: 'ok',
            message: next.lines.every((l) => num(l.outstanding) === 0)
              ? `${sku.sku_code} complete. This order is fully picked.`
              : `${sku.sku_code} complete. Next: bin ${nextBin.bin}.`,
          });
        } else {
          setConfirmedBin(null);
          setStep(4);
          setFeedback({
            type: 'ok',
            message: `${sku.sku_code} complete. Every line is picked — complete the pick.`,
          });
        }
      } catch (err) {
        const msg = err?.body?.error || err?.message || 'Could not record that scan.';
        setFeedback({ type: 'error', message: msg });
        // A 409 means the server and this screen disagree about the line, so
        // re-read rather than keep offering a stale bin.
        if (err?.status === 409) {
          try { await refresh(); } catch { /* the error above is the useful one */ }
        }
      } finally {
        setBusy(false);
      }
    },
    [confirmedBin, lines, skuIndex, work, refresh]
  );

  const onScan = confirmedBin ? onScanItem : onScanBin;

  const dropOut = async () => {
    if (!work) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await postApi('/ds-ops/pick-abandon', {
        order_id: work.order_id,
        reason: 'picker dropped out',
      });
      await refresh();
      setConfirmedBin(null);
      setStep(1);

      const returned = num(res.units_returned);
      if (!returned && res.nothing_to_revert) {
        setFeedback({ type: 'hint', message: res.message });
        return;
      }
      setFeedback({
        type: returned ? 'ok' : 'error',
        message: res.message
          + (res.skipped?.length
            ? ` ${res.skipped.length} line(s) need a recount: ${res.skipped
                .map((s) => `${s.sku_code} (${s.reason})`).join('; ')}`
            : ''),
      });
      toast.success(
        'Dropped out',
        `${returned} unit${returned === 1 ? '' : 's'} back on the shelf.`
      );
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'Could not drop out.';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!work) return;
    setBusy(true);
    try {
      const res = await postApi('/ds-ops/order-action', {
        order_id: work.order_id,
        action: 'COMPLETE_PICK',
        // A real iam User uuid: the backend looks it up to close out this
        // operator's open PickTasks for this order. A display name matches
        // nothing, so the real user_id is sent.
        picker: user?.user_id || '',
      });
      toast.success(
        `Order ${work.order_no} picked`,
        res?.message || 'Every unit is off the shelf. Pack it on the Packing screen.'
      );
      setWork(null);
      setConfirmedBin(null);
      setStep(0);
      setScanText('');
      setFeedback(null);
      await reload({ quiet: true });
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'Could not complete the pick.';
      setFeedback({ type: 'error', message: msg });
      toast.error('Pick not completed', msg);
      // The server is the authority on what is still short, so re-read rather
      // than guess from the copy on screen.
      try { await refresh(); } catch { /* keep the server's message */ }
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setWork(null);
    setConfirmedBin(null);
    setScanText('');
    setFeedback(null);
    setStep(0);
  };

  const pickedUnits = lines.reduce((t, l) => t + num(l.picked_qty), 0);
  const neededUnits = lines.reduce((t, l) => t + num(l.qty), 0);
  const done = lines.filter((l) => num(l.outstanding) === 0).length;
  const anyPicked = pickedUnits > 0;

  return (
    <>
      <WorkflowStepper steps={STEPS} current={step} dataTestId="ds-pick-stepper" />

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><ClipboardList size={17} /> Pick queue</div>
            <div className="wf-panel__hint">
              {queue.length} order{queue.length === 1 ? '' : 's'} at <StoreBadge />
            </div>
          </div>
          <div className="wf-panel__actions">
            {loading && <span className="scan-feedback scan-feedback--hint">Loading…</span>}
            <button className="btn-secondary" onClick={() => reload()} disabled={loading} data-testid="ds-pick-refresh">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="ds-pick-queue-error">
              <ClipboardList size={14} /> {error}
            </div>
          </div>
        )}

        {queue.length === 0 && !error ? (
          <div className="wf-empty" data-testid="ds-pick-empty">
            <ClipboardList size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">Pick queue is clear</div>
            <div className="wf-empty__text">
              No orders are waiting to be picked at {storeCode}. New orders appear here as
              soon as they are confirmed for this store.
            </div>
          </div>
        ) : (
          <div className="form-group">
            <div className="item-list" data-testid="ds-pick-queue">
              {queue.map((o) => {
                const blocked = !COMPLETABLE.has(o.status);
                return (
                  <div
                    key={o.order_id}
                    className="entity-card"
                    data-testid={`ds-pick-order-${o.order_no}`}
                  >
                    <div className="entity-card__thumb">
                      {blocked ? <Lock size={22} /> : <Package size={22} />}
                    </div>
                    <div className="entity-card__body">
                      <div className="entity-card__title mono-num">{o.order_no}</div>
                      <div className="entity-card__meta">
                        <span>Placed <strong>{o.placed_at ? new Date(o.placed_at).toLocaleString() : '—'}</strong></span>
                        <span>Payment <strong>{o.payment_status}</strong></span>
                        <span>Total <strong>₹{num(o.grand_total).toLocaleString('en-IN')}</strong></span>
                      </div>
                      {blocked && BLOCKED_REASON[o.status] && (
                        <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 8 }}>
                          {BLOCKED_REASON[o.status]}
                        </div>
                      )}
                    </div>
                    <div className="entity-card__actions">
                      <StatusBadge status={o.status} dataTestId={`ds-pick-status-${o.order_no}`} />
                      <button
                        className="scan-btn"
                        style={{ minHeight: 34, fontSize: 12, marginTop: 6 }}
                        onClick={() => openOrder(o)}
                        disabled={busy}
                        data-testid={`ds-pick-open-${o.order_no}`}
                      >
                        {blocked ? 'Inspect' : 'Pick'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {work && (
        <div className="wf-panel" data-testid="ds-pick-work">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                Picking <span className="mono-num">{work.order_no}</span>
              </div>
              <div className="wf-panel__hint">
                {pickedUnits} of {neededUnits} unit{neededUnits === 1 ? '' : 's'} off the shelf
                {` · ${done} of ${lines.length} line${lines.length === 1 ? '' : 's'} complete`}
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={close} disabled={busy} data-testid="ds-pick-close">
                <X size={14} /> Close
              </button>
            </div>
          </div>

          {work.pickable === false && (
            <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }} data-testid="ds-pick-blocked">
              <Lock size={14} />
              <span>{work.blocked_reason || `This order is ${work.status}.`}</span>
            </div>
          )}

          {needsAllocation && (
            <div
              className="scan-feedback scan-feedback--error"
              style={{ marginBottom: 12 }}
              data-testid="ds-pick-needs-allocation"
            >
              <MapPin size={14} />
              <span>
                This order has no shelf route, so no bin scan will be accepted.
                Allocate it first — the server reserves nothing here, it only fixes
                which shelf each line comes from.
              </span>
              <button
                className="scan-btn"
                style={{ minHeight: 30, fontSize: 12, marginLeft: 8 }}
                onClick={allocate}
                disabled={busy || work.pickable === false}
                data-testid="ds-pick-allocate"
              >
                {busy ? 'Allocating…' : 'Allocate route'}
              </button>
            </div>
          )}

          {route.length > 0 && (
            <div
              className="scan-feedback scan-feedback--hint"
              style={{ marginBottom: 12 }}
              data-testid="ds-pick-route"
            >
              <MapPin size={14} />
              <span>
                Route:{' '}
                {route.map((b, i) => (
                  <span key={b.location_id}>
                    {i > 0 && ' → '}
                    <strong>{b.label}</strong> ({num(b.outstanding)} left)
                  </span>
                ))}
              </span>
            </div>
          )}

          <ScanInput
            label={confirmedBin
              ? `Scan items from bin ${confirmedBin.label}`
              : `Scan the bin for ${expectedBin?.label || 'the next item'}`}
            placeholder={confirmedBin
              ? 'Scan a product barcode — each scan takes one unit'
              : 'Scan the bin label printed on the shelf edge'}
            value={scanText}
            onChange={setScanText}
            onScan={onScan}
            busy={busy}
            feedback={feedback}
            disabled={lines.length === 0 || work.pickable === false || needsAllocation}
            dataTestId={confirmedBin ? 'ds-pick-item-scan' : 'ds-pick-bin-scan'}
          >
            {confirmedBin && (
              <div
                className="scan-feedback scan-feedback--hint"
                style={{ marginTop: 8 }}
                data-testid="ds-pick-bin-confirmed"
              >
                <MapPin size={14} /> Standing at {confirmedBin.label}. Scan an item, or{' '}
                <button
                  type="button"
                  className="scan-btn scan-btn--ghost"
                  style={{ minHeight: 26, fontSize: 11 }}
                  onClick={() => { setConfirmedBin(null); setStep(1); }}
                  disabled={busy}
                  data-testid="ds-pick-change-bin"
                >
                  change bin
                </button>
              </div>
            )}
          </ScanInput>

          {lines.length === 0 ? (
            <div className="wf-empty" data-testid="ds-pick-no-lines">
              <ClipboardList size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">This order has no lines</div>
              <div className="wf-empty__text">
                Nothing to pick was recorded against {work.order_no}.
              </div>
            </div>
          ) : (
            <>
              <div className="form-group" style={{ marginTop: 12 }}>
                <div className="item-list" data-testid="ds-pick-lines">
                  {lines.map((l, i) => {
                    const sku = skuIndex?.byId.get(String(l.sku));
                    const outstanding = num(l.outstanding);
                    const active =
                      !!confirmedBin && l.bin_location_id === confirmedBin.location_id;
                    const split = (l.bins || []).filter((b) => b.allocated).length > 1;
                    return (
                      <div key={l.line_id}>
                        <ProductCard
                          dataTestId={`ds-pick-line-${i}`}
                          product={{ name: sku?.name, sku_code: l.sku_code || sku?.sku_code, ean: sku?.ean }}
                          picked={num(l.picked_qty)}
                          expected={num(l.qty)}
                          state={outstanding === 0 ? 'done' : active ? 'active' : 'pending'}
                        />
                        <div
                          className="scan-feedback scan-feedback--hint"
                          style={{ marginTop: 4 }}
                          data-testid={`ds-pick-line-bin-${i}`}
                        >
                          {l.bin ? (
                            <>
                              Bin <strong>{l.bin}</strong>
                              {split && (
                                <> · split across {(l.bins || []).filter((b) => b.allocated).length} bins</>
                              )}
                              {' · '}{num(l.available_qty)} on the shelf
                            </>
                          ) : (
                            'Not shelved in any bin at this store — this line needs a putaway before it can be picked.'
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="scan-feedback scan-feedback--hint" style={{ marginBottom: 12 }} data-testid="ds-pick-server-authoritative">
                Counts come from the server. Every scan writes the pick to the stock
                ledger and to the order line together, so a reload shows the same numbers.
              </div>

              {outstandingTotal > 0 && (
                <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }} data-testid="ds-pick-outstanding">
                  <AlertTriangle size={14} />
                  <span>
                    Still to pick: {outstandingTotal} unit{outstandingTotal === 1 ? '' : 's'} across{' '}
                    {lines.filter((l) => num(l.outstanding) > 0).length} line(s).
                    The order cannot be completed until these are scanned.
                  </span>
                </div>
              )}

              <div className="wf-panel__actions">
                <button
                  className="scan-btn"
                  onClick={complete}
                  disabled={busy || outstandingTotal > 0 || work.pickable === false || needsAllocation}
                  data-testid="ds-pick-complete"
                >
                  <Check size={16} /> {busy ? 'Posting…' : 'Complete pick'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={dropOut}
                  disabled={busy || !anyPicked}
                  data-testid="ds-pick-drop-out"
                >
                  <Undo2 size={14} /> Drop out
                </button>
              </div>

              <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 12 }} data-testid="ds-pick-next-step">
                Completing the pick marks the units as off the shelf. They still have to be
                sealed into a tote on the Packing screen, which is what tells a rider where
                to collect them.
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default function OrderPickingView() {
  const { siteId, storeCode } = useDarkStore();

  return (
    <StoreGate>
      {siteId && <OrderQueue siteId={siteId} storeCode={storeCode} />}
    </StoreGate>
  );
}
