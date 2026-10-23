import React, { useCallback, useMemo, useState } from 'react';
import {
  Bike, ScanLine, Check, AlertTriangle, PackageCheck, MapPin, RefreshCw,
  IndianRupee, KeyRound,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import ScanInput from '../../components/ui/ScanInput';
import WorkflowStepper from '../../components/ui/WorkflowStepper';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import {
  useDarkStore, useAsyncData, deliveryTasks, riderPickup, deliveryPod,
  assignRiderQr, num,
} from './useDarkStore';

/**
 * Hand staged totes to riders, and close out the deliveries they take.
 *
 * This screen used to be two buttons that called `POST /ds-ops/order-action`
 * with HANDOFF_RIDER and DELIVERED. Both actions are gone from the backend, and
 * they had to go: they set an order's status directly, so one call moved an
 * order to OUT_FOR_DELIVERY with no tote scan and no stock movement, and another
 * marked it DELIVERED with no pickup code and no cash recorded. The order said
 * delivered while the goods were still in the store's custody and the money was
 * still uncollected.
 *
 * Both facts that matter now come from operations that cannot be skipped:
 *
 *   pickup  POST /delivery/handoff/pickup
 *           verifies the scanned tote against the bin the task was staged in,
 *           moves the units out of the store, sets shipped_qty per line and
 *           moves the task to PICKED_UP.
 *
 *   pod     POST /delivery/handoff/pod
 *           refuses without the code the customer reads, refuses a cash order
 *           without the amount actually collected, and only then moves the task
 *           and the order to DELIVERED.
 *
 * The queue is therefore built from DeliveryTask rows rather than orders. The
 * endpoints key on `task_id` and verify against `task.bin`, so there is no
 * honest way to offer an order on this screen without the task behind it.
 *
 * On the pickup code: the first POD call for an order normally comes back 409
 * with `otp_required`, meaning a code was just minted for the customer. The code
 * itself is never in the response, so the operator has to read it off the
 * customer's phone. That is the entire point of the code.
 */

const STEPS = [
  { key: 'queue', title: 'Find the job', description: 'Totes staged at this store, or out on the road' },
  { key: 'scan', title: 'Scan', description: 'Scan the tote, or match the order on the job sheet' },
  { key: 'confirm', title: 'Record it', description: 'The goods and, for cash, the money actually changed hands' },
];

/**
 * Task statuses the backend accepts for each operation. Mirrors handoff.py.
 *
 * Built from the accepted set rather than from a wish list, so no button here
 * can fail by design.
 */
const PICKUP_FROM = ['UNASSIGNED', 'OFFERED', 'ACCEPTED', 'AT_DS'];
const POD_FROM = ['PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'POD_PENDING'];

/** DeliveryTask.status for orders that are closed out, shown as history only. */
const CLOSED = ['DELIVERED', 'FAILED', 'RETURNED', 'WITHDRAWN', 'RECALLED'];

function TaskRow({ task, onOpen, testId, actionLabel, disabled, onAssign }) {
  const orderNo = task.order_no || task.order || '';
  const staged = task.staging_bin || 'not recorded';
  return (
    <tr data-testid={testId}>
      <td className="mono-num">{orderNo || task.task_id}</td>
      <td className="mono-num">{String(task.task_id).slice(0, 8)}</td>
      <td>{staged}</td>
      <td>{task.order_weight_kg != null ? `${num(task.order_weight_kg)} kg` : '—'}</td>
      <td className="mono-num">
        {task.shipped_qty > 0 ? `${num(task.shipped_qty)} units` : '—'}
      </td>
      <td>{task.pickup_at ? new Date(task.pickup_at).toLocaleString() : '—'}</td>
      <td>
        <StatusBadge status={task.status} dataTestId={`${testId}-status`} />
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className="scan-btn"
            style={{ minHeight: 34, fontSize: 12 }}
            onClick={() => onOpen(task)}
            disabled={disabled}
            data-testid={`${testId}-open`}
          >
            {actionLabel}
          </button>
          {onAssign && (
            <button
              className="btn-secondary"
              style={{ minHeight: 34, fontSize: 12 }}
              onClick={() => onAssign(task)}
              disabled={disabled}
              data-testid={`ds-handoff-assign-${orderNo || task.task_id}`}
            >
              Assign rider
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function Counter({ siteId, storeCode, segment }) {
  const toast = useToast();
  const isRoad = segment === 'road';
  const wanted = isRoad ? POD_FROM : PICKUP_FROM;

  const { data: tasks, error, loading, reload } = useAsyncData(
    () => deliveryTasks(siteId, wanted.concat(CLOSED)),
    [siteId, segment],
    { pollMs: 30000 }
  );

  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const [toteText, setToteText] = useState('');
  const [otp, setOtp] = useState('');
  const [cod, setCod] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  // Hand a staged, unassigned job to a rider by scanning their personal QR.
  const [assignFor, setAssignFor] = useState(null);
  const [qrText, setQrText] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState('');

  const all = useMemo(() => tasks || [], [tasks]);
  const actionable = useMemo(() => all.filter((t) => wanted.includes(t.status)), [all, wanted]);
  const closed = useMemo(() => all.filter((t) => CLOSED.includes(t.status)), [all]);

  const reset = useCallback(() => {
    setSelected(null);
    setToteText('');
    setOtp('');
    setCod('');
    setOtpSent(false);
    setFeedback(null);
    setAssignFor(null);
    setQrText('');
    setAssignError('');
    setStep(0);
  }, []);

  /** Match a scan against the job number, the order number or the tote barcode. */
  const onScan = useCallback(
    (raw) => {
      const value = String(raw || '').trim().toUpperCase();
      setFeedback(null);
      if (!value) return;
      if (all.length === 0) {
        setFeedback({
          type: 'error',
          message: `There are no ${isRoad ? 'deliveries' : 'staged totes'} at ${storeCode} right now.`,
        });
        return;
      }
      const hit = all.find(
        (t) =>
          String(t.task_id).toUpperCase() === value ||
          String(t.order_no || '').toUpperCase() === value ||
          String(t.bin || '').toUpperCase() === value ||
          String(t.staging_bin || '').toUpperCase() === value
      );
      if (!hit) {
        setFeedback({
          type: 'error',
          message: `No delivery job at ${storeCode} matches "${raw}". ` +
            'Scan the job sheet, or pick it from the list.',
        });
        return;
      }
      if (!wanted.includes(hit.status)) {
        setFeedback({
          type: 'error',
          message:
            hit.status === 'DELIVERED'
              ? `${hit.order_no || 'That order'} is already delivered.`
              : `This job is ${hit.status} and cannot be ${isRoad ? 'closed out' : 'handed over'} from there.`,
        });
        return;
      }
      setSelected(hit);
      setDone(null);
      setToteText('');
      setOtp('');
      setOtpSent(false);
      setCod('');
      setStep(2);
    },
    [all, isRoad, storeCode, wanted]
  );

  const submitPickup = async () => {
    if (!selected) return;
    const barcode = toteText.trim();
    if (!barcode) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await riderPickup(selected.task_id, barcode);
      toast.success(
        `Tote ${barcode} collected`,
        `${num(res.shipped_qty)} unit(s) left ${storeCode}. The order is now ${res.status}.`
      );
      // reset() clears the form but not `done`, which is the point: the rider
      // needs to see what was just signed for before scanning the next job.
      reset();
      setDone({ kind: 'pickup', res, task: selected });
      await reload({ quiet: true });
    } catch (err) {
      const body = err?.body;
      setFeedback({
        type: 'error',
        message:
          body?.expected_lpn
            ? `Wrong tote. This job is staged in tote ${body.expected_lpn}, not ${barcode}.`
            : body?.error || err?.message || 'The pickup was refused.',
      });
      toast.error('Not collected', body?.error || err?.message || 'The pickup was refused.');
    } finally {
      setBusy(false);
    }
  };

  const submitPod = async () => {
    if (!selected) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await deliveryPod(selected.task_id, {
        otp: otp.trim(),
        codAmount: cod.trim() || undefined,
      });
      toast.success(
        `Order ${res.order_no} delivered`,
        res.cod_variance && res.cod_variance !== '0.00'
          ? `Collected ₹${res.cod_amount} against ₹${res.cod_due} due (${res.cod_variance}).`
          : `Collected ₹${res.cod_amount} in full.`
      );
      // As with pickup: clear the inputs, keep the receipt on screen.
      reset();
      setDone({ kind: 'pod', res, task: selected });
      await reload({ quiet: true });
    } catch (err) {
      const body = err?.body;
      if (body?.otp_required && body?.error) {
        // The normal first attempt: a code was minted and sent to the customer.
        setOtpSent(true);
        setFeedback({ type: 'ok', message: body.error });
      } else if (body?.cod_required) {
        setFeedback({
          type: 'error',
          message: `${body.error} (₹${body.cod_due} due)`,
        });
      } else {
        const msg = body?.error || err?.message || 'The delivery was not closed.';
        setFeedback({ type: 'error', message: msg });
        toast.error('Not recorded', msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitAssign = async () => {
    if (!assignFor || !qrText.trim()) return;
    setAssignBusy(true);
    setAssignError('');
    try {
      const res = await assignRiderQr(assignFor.task_id, qrText.trim());
      const name = res?.rider?.name || 'the rider';
      const orderNo = assignFor.order_no || '';
      setDone({ kind: 'assigned', res, task: assignFor });
      setAssignFor(null);
      setQrText('');
      if (res?.already_assigned) {
        toast.success(`${orderNo} is already with ${name}`, 'Scanned again — nothing changed.');
      } else {
        toast.success(`${orderNo} handed to ${name}`,
          `The job is now accepted on ${name}'s console.`);
      }
      await reload({ quiet: true });
    } catch (err) {
      const body = err?.body;
      const msg = body?.error || err?.message || 'The rider could not be assigned.';
      setAssignError(msg);
      toast.error('Not assigned', msg);
    } finally {
      setAssignBusy(false);
    }
  };

  const podReady = !!selected && otp.trim().length > 0;
  const pickupReady = !!selected && toteText.trim().length > 0;

  return (
    <>
      <WorkflowStepper steps={STEPS} current={step} dataTestId="ds-handoff-stepper" />

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title">
              {isRoad ? <MapPin size={17} /> : <Bike size={17} />}
              {isRoad ? 'Out for delivery' : 'Ready for rider pickup'}
            </div>
            <div className="wf-panel__hint">
              {actionable.length} job{actionable.length === 1 ? '' : 's'} at <StoreBadge />
            </div>
          </div>
          <div className="wf-panel__actions">
            {loading && <span className="scan-feedback scan-feedback--hint">Loading…</span>}
            <button
              className="btn-secondary"
              onClick={() => reload()}
              disabled={loading}
              data-testid="ds-handoff-refresh"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="ds-handoff-error">
              <AlertTriangle size={14} /> {error}
            </div>
          </div>
        )}

        {done && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--ok" data-testid="ds-handoff-done">
              <Check size={14} />
              <div>
                {done.kind === 'pickup'
                  ? `${num(done.res.shipped_qty)} unit(s) collected from tote ${done.res.lpn_barcode || ''}. Order is ${done.res.status}.`
                  : done.kind === 'assigned'
                    ? `${done.task.order_no || 'The job'} ${done.res.already_assigned ? 'is already with' : 'is now with'} ${done.res.rider?.name || 'that rider'}${done.res.already_assigned ? '.' : ' — accepted on their console.'}`
                    : `${done.res.order_no} delivered. Payment ${done.res.payment_status}.`}
              </div>
            </div>
          </div>
        )}

        {actionable.length === 0 && !error ? (
          <div className="wf-empty" data-testid="ds-handoff-empty">
            {isRoad
              ? <MapPin size={40} className="wf-empty__icon" />
              : <Bike size={40} className="wf-empty__icon" />}
            <div className="wf-empty__title">
              {isRoad ? 'Nothing out on the road' : 'No tote waiting'}
            </div>
            <div className="wf-empty__text">
              {isRoad
                ? `No delivery from ${storeCode} has been picked up yet. A job only appears here once its tote has been collected.`
                : `No packed order is waiting for a rider at ${storeCode}. Seal one on the Packing screen first.`}
            </div>
          </div>
        ) : (
          <div className="form-group">
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Job</th>
                    <th>Staging</th>
                    <th>Weight</th>
                    <th>Shipped</th>
                    <th>Picked up</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody data-testid="ds-handoff-queue">
                  {actionable.map((t) => (
                    <TaskRow
                      key={t.task_id}
                      task={t}
                      onOpen={(task) => {
                        setSelected(task);
                        setDone(null);
                        setToteText('');
                        setOtp('');
                        setOtpSent(false);
                        setCod('');
                        setStep(2);
                      }}
                      testId={`ds-handoff-task-${t.order_no || t.task_id}`}
                      actionLabel={isRoad ? 'Close out' : 'Collect'}
                      onAssign={
                        ['UNASSIGNED', 'OFFERED'].includes(t.status)
                          ? (task) => {
                            setAssignFor(task);
                            setQrText('');
                            setAssignError('');
                            setDone(null);
                          }
                          : null
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {assignFor && (
          <div className="form-group" style={{ marginTop: 12 }} data-testid="ds-handoff-assign-panel">
            <label className="form-label" htmlFor="ds-handoff-assign-qr">
              <ScanLine size={14} /> Rider QR code
            </label>
            <input
              id="ds-handoff-assign-qr"
              className="form-input mono-num"
              value={qrText}
              onChange={(e) => setQrText(e.target.value)}
              placeholder="Scan the rider's personal QR"
              disabled={assignBusy}
              data-testid="ds-handoff-assign-input"
              autoFocus
            />
            <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 6 }}>
              Handing <strong className="mono-num">{assignFor.order_no || assignFor.task_id}</strong> to
              the rider whose code you scan. The scan is the acceptance: the job moves to
              accepted straight away, with no dropdown and no second tap.
            </div>
            {assignError && (
              <div className="scan-feedback scan-feedback--error" style={{ marginTop: 6 }}
                   data-testid="ds-handoff-assign-error">
                <AlertTriangle size={14} /> {assignError}
              </div>
            )}
            <div className="wf-panel__actions" style={{ marginTop: 8 }}>
              <button
                className="scan-btn"
                onClick={submitAssign}
                disabled={assignBusy || !qrText.trim()}
                data-testid="ds-handoff-assign-confirm"
              >
                {assignBusy ? 'Assigning…' : 'Assign to rider'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => { setAssignFor(null); setQrText(''); setAssignError(''); }}
                disabled={assignBusy}
                data-testid="ds-handoff-assign-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {closed.length > 0 && (
          <div className="form-group" style={{ marginTop: 12 }}>
            <div className="scan-feedback scan-feedback--hint" style={{ marginBottom: 8 }}>
              {closed.length} closed job{closed.length === 1 ? '' : 's'} — read only
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Job</th>
                    <th>Staging</th>
                    <th>Weight</th>
                    <th>Shipped</th>
                    <th>Picked up</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody data-testid="ds-handoff-closed">
                  {closed.map((t) => (
                    <TaskRow
                      key={t.task_id}
                      task={t}
                      onOpen={() => {}}
                      disabled
                      testId={`ds-handoff-closed-${t.order_no || t.task_id}`}
                      actionLabel="Closed"
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title">
              {isRoad ? <MapPin size={17} /> : <Bike size={17} />} {isRoad ? 'Close out a delivery' : 'Collect a staged tote'}
            </div>
            <div className="wf-panel__hint">
              {isRoad
                ? 'Scan the job sheet to find the delivery, then take the code from the customer'
                : `Scan the tote you are taking from ${storeCode}`}
            </div>
          </div>
        </div>

        <ScanInput
          label="Scan or type the job reference"
          placeholder="Job number, order number, or tote barcode"
          value={toteText}
          onChange={setToteText}
          onScan={onScan}
          busy={busy}
          feedback={feedback}
          disabled={all.length === 0}
          dataTestId="ds-handoff-scan"
        />

        {selected && (
          <>
            <div className="form-group">
              <div className="entity-card entity-card--active" data-testid="ds-handoff-selected">
                <div className="entity-card__thumb"><Check size={22} /></div>
                <div className="entity-card__body">
                  <div className="entity-card__title mono-num">
                    {selected.order_no || selected.task_id}
                  </div>
                  <div className="entity-card__meta">
                    <span>Job <strong className="mono-num">{String(selected.task_id).slice(0, 8)}</strong></span>
                    <span>Staging <strong>{selected.staging_bin || 'not recorded'}</strong></span>
                    <span>Tote <strong className="mono-num">{selected.bin || 'not recorded'}</strong></span>
                  </div>
                </div>
                <div className="entity-card__actions">
                  <StatusBadge status={selected.status} />
                </div>
              </div>
            </div>

            {!isRoad ? (
              <>
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label className="form-label" htmlFor="ds-handoff-tote">
                    <PackageCheck size={14} /> Tote barcode
                  </label>
                  <input
                    id="ds-handoff-tote"
                    className="form-input mono-num"
                    value={toteText}
                    onChange={(e) => setToteText(e.target.value)}
                    placeholder="Scan the tote barcode"
                    disabled={busy}
                    data-testid="ds-handoff-tote-input"
                  />
                  <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 6 }}>
                    The server checks this against the tote the job was staged in and
                    refuses a mismatch, so two orders cannot be swapped at the counter.
                  </div>
                </div>

                <div className="wf-panel__actions">
                  <button
                    className="scan-btn"
                    onClick={submitPickup}
                    disabled={busy || !pickupReady}
                    data-testid="ds-handoff-confirm"
                  >
                    {busy ? 'Recording…' : 'Confirm tote collected'}
                  </button>
                  <button className="btn-secondary" onClick={reset} disabled={busy} data-testid="ds-handoff-clear">
                    Clear
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label className="form-label" htmlFor="ds-handoff-otp">
                    <KeyRound size={14} /> Pickup code from the customer
                  </label>
                  <input
                    id="ds-handoff-otp"
                    className="form-input mono-num"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    maxLength={6}
                    disabled={busy}
                    data-testid="ds-handoff-otp-input"
                  />
                  {otpSent && (
                    <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 6 }}>
                      <KeyRound size={14} /> A code has been sent to the customer. Ask them
                      for it — it is deliberately not shown here.
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="ds-handoff-cod">
                    <IndianRupee size={14} /> Cash collected
                  </label>
                  <input
                    id="ds-handoff-cod"
                    className="form-input mono-num"
                    value={cod}
                    onChange={(e) => setCod(e.target.value)}
                    placeholder="Amount received from the customer"
                    inputMode="decimal"
                    disabled={busy}
                    data-testid="ds-handoff-cod-input"
                  />
                  <div className="scan-feedback scan-feedback--hint" style={{ marginTop: 6 }}>
                    Required on a cash order. The server refuses anything that is not an
                    amount, and reports any shortfall against the order total rather than
                    absorbing it.
                  </div>
                </div>

                <div className="wf-panel__actions">
                  <button
                    className="scan-btn"
                    onClick={submitPod}
                    disabled={busy || !podReady}
                    data-testid="ds-handoff-confirm"
                  >
                    {busy ? 'Recording…' : 'Close out delivery'}
                  </button>
                  <button className="btn-secondary" onClick={reset} disabled={busy} data-testid="ds-handoff-clear">
                    Clear
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function CounterScreen({ siteId, storeCode }) {
  const [segment, setSegment] = useState('handoff');

  return (
    <>
      <div className="form-group" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className={`scan-btn${segment === 'handoff' ? '' : ' scan-btn--ghost'}`}
          onClick={() => setSegment('handoff')}
          data-testid="ds-handoff-tab-handoff"
        >
          <PackageCheck size={16} /> Rider pickup
        </button>
        <button
          className={`scan-btn${segment === 'road' ? '' : ' scan-btn--ghost'}`}
          onClick={() => setSegment('road')}
          data-testid="ds-handoff-tab-road"
        >
          <MapPin size={16} /> On the road
        </button>
      </div>
      <Counter key={segment} siteId={siteId} storeCode={storeCode} segment={segment} />
    </>
  );
}

export default function RiderHandoffView() {
  const { siteId, storeCode } = useDarkStore();

  return (
    <StoreGate>
      {siteId && <CounterScreen siteId={siteId} storeCode={storeCode} />}
    </StoreGate>
  );
}