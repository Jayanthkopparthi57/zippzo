import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, MapPin, Package, RefreshCw, AlertTriangle, ScanLine, CheckCircle2,
  Send, ChevronRight, Layers, XCircle,
} from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
import WorkflowStepper from '../../components/ui/WorkflowStepper';
import ProgressRing from '../../components/ui/ProgressRing';
import ProductCard from '../../components/ui/ProductCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';
import { resolveBin } from '../../utils/bins';

/**
 * Guided putaway: scan product → scan target bin → confirm.
 *
 * The loop is per unit into a bin, because that is the physical action: the
 * worker walks to a bin, scans it, puts a unit in, and repeats. `Proceed`
 * commits exactly one confirmed unit, `Next / Drop Bin` closes the bin (which
 * is the real PutawayTaskViewSet.complete action and therefore the point stock
 * is posted to the ledger), and `Drop` finishes the session without leaving a
 * half-confirmed bin behind.
 */
const STEPS = [
  { key: 'task', title: 'Select Task', description: 'Choose an open putaway task' },
  { key: 'product', title: 'Scan Product', description: 'Confirm you are holding the right product' },
  { key: 'bin', title: 'Scan Bin', description: 'Confirm the target location' },
  { key: 'confirm', title: 'Confirm', description: 'Proceed per unit, then drop the bin' },
];

/**
 * PutawayTask.Meta.ordering is -created_at, so an unfiltered
 * /supply/putaway-tasks/ page is entirely CONFIRMED history and the open
 * putaway queue looks empty. Filter per status, server-side.
 */
const OPEN_TASK_STATUS = ['GENERATED', 'ACCEPTED', 'IN_PROGRESS'];

const norm = (v) => String(v ?? '').trim().toUpperCase();

function asList(payload, what) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${what} returned an unrecognised payload shape.`);
  return rows;
}

export default function PutawayView() {
  const toast = useToast();

  const [tasks, setTasks] = useState([]);
  const [skus, setSkus] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [assignBusy, setAssignBusy] = useState('');

  const [task, setTask] = useState(null);
  const [step, setStep] = useState(0);
  const [scanText, setScanText] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const [scannedSku, setScannedSku] = useState(null);
  const [scannedBin, setScannedBin] = useState(null);
  const [placed, setPlaced] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [statusLists, skuRows, staffRows] = await Promise.all([
        Promise.all(
          OPEN_TASK_STATUS.map((s) => fetchApi(`/supply/putaway-tasks/?status=${s}&page_size=100`))
        ),
        // PutawayTask.sku is a Sku UUID; resolve the scannable codes.
        fetchApi('/catalog/skus/?page_size=1000'),
        // Who a putaway can be handed to — the assignment board's staff list.
        fetchApi('/iam/users/?page_size=500'),
      ]);
      const seen = new Set();
      const open = [];
      statusLists.forEach((payload, i) => {
        asList(payload, `/supply/putaway-tasks/?status=${OPEN_TASK_STATUS[i]}`).forEach((t) => {
          const id = String(t.task_id);
          if (seen.has(id)) return;
          seen.add(id);
          open.push(t);
        });
      });
      setTasks(open);
      setSkus(asList(skuRows, '/catalog/skus/'));
      setStaff(asList(staffRows, '/iam/users/').filter((u) => u.role !== 'CUSTOMER'));
    } catch (e) {
      setLoadError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Hand a putaway to one worker (or clear it). Mirrors the assignment board. */
  const assignTask = async (t, userId) => {
    setAssignBusy(String(t.task_id));
    try {
      await postApi(`/supply/putaway-tasks/${t.task_id}/assign/`, { user: userId || null });
      await load();
    } catch (e) {
      toast.error('Could not assign putaway', describeError(e));
    } finally {
      setAssignBusy('');
    }
  };

  const skuById = useMemo(() => {
    const map = {};
    skus.forEach((s) => { map[String(s.sku_id)] = s; });
    return map;
  }, [skus]);

  const skuFor = useCallback((t) => skuById[String(t.sku)] || null, [skuById]);

  const openTask = (t) => {
    setTask(t);
    setScannedSku(null);
    setScannedBin(null);
    setPlaced(0);
    setScanText('');
    setFeedback(null);
    setStep(1);
  };

  const resetSession = () => {
    setTask(null);
    setScannedSku(null);
    setScannedBin(null);
    setPlaced(0);
    setScanText('');
    setFeedback(null);
    setStep(0);
  };

  /* ── Step 2: the product must be the one the task is for ── */
  const onScanProduct = async (code) => {
    if (!task) return;
    const sku = skuFor(task);
    const want = norm(code);
    const accepted = [sku?.sku_code, sku?.ean, task.sku]
      .filter(Boolean)
      .map((v) => norm(v));

    if (!accepted.includes(want)) {
      setFeedback({
        type: 'error',
        message: sku
          ? `Wrong product. This task needs ${sku.sku_code} (${sku.name}); you scanned ${code}.`
          : `Cannot verify ${code} against task #${task.task_id} — its SKU is not in the loaded catalog.`,
      });
      return;
    }

    setScannedSku(sku);
    setScannedBin(null);
    setScanText('');
    setFeedback({ type: 'ok', message: `${sku.sku_code} confirmed. Now scan the target bin.` });
    setStep(2);
  };

  /* ── Step 3: the bin must be a real location ── */
  const onScanBin = async (code) => {
    if (!task) return;
    setBusy(true);
    setFeedback(null);
    try {
      const hit = await resolveBin(code);
      if (!hit) {
        setFeedback({ type: 'error', message: `Bin "${code}" is not a known location.` });
        return;
      }
      if (hit.candidates) {
        setFeedback({
          type: 'error',
          message: `"${code}" matches ${hit.candidates.length} bins (${hit.candidates
            .slice(0, 4)
            .map((c) => c.barcode)
            .join(', ')}). Scan the exact bin barcode.`,
        });
        return;
      }
      setScannedBin(hit);
      setScanText('');
      setFeedback({ type: 'ok', message: `${hit.label} confirmed. Proceed to commit one unit.` });
      setStep(3);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 4a: Proceed — commit exactly one unit into the current bin ── */
  const proceed = async () => {
    if (!task || !scannedBin) return;
    const need = Number(task.qty) || 0;
    if (need > 0 && placed + 1 > need) {
      setFeedback({ type: 'error', message: `All ${need} unit(s) for this task are already placed here. Drop the bin.` });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      // Claim the task so it leaves the GENERATED queue the moment work starts.
      let current = task;
      if (String(current.status).toUpperCase() === 'GENERATED') {
        current = await patchApi(`/supply/putaway-tasks/${task.task_id}/`, { status: 'IN_PROGRESS' });
        setTask(current);
      }
      const next = placed + 1;
      setPlaced(next);
      setScannedSku(null);
      setScanText('');
      // Stay on the confirm step and keep the bin: the operator has physically
      // committed these units into *this* bin, so the bin can only be closed
      // here. Resetting to step 1 would strand the placed count with no way to
      // reach "Next / Drop Bin", which is the only thing that posts the stock.
      setStep(3);
      setFeedback({
        type: 'ok',
        // `remaining` is still the pre-increment value here, so compare `next`.
        message: need > 0 && next >= need
          ? `All ${need} unit(s) confirmed into ${scannedBin?.label}. Drop the bin to post the stock.`
          : `Confirmed ${next} of ${need} into ${scannedBin?.label}. Proceed another unit or drop the bin.`,
      });
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 4b: Next / Drop Bin — close the bin for real ── */
  /** Resolves true only when the stock was actually posted. */
  const closeBin = async (advance) => {
    if (!task || !scannedBin) return false;
    if (placed <= 0) {
      setFeedback({ type: 'error', message: 'Proceed at least one unit into this bin before dropping it.' });
      return false;
    }
    // complete() posts the whole task quantity, so a partly filled bin must not
    // be closed: the ledger would claim units the operator never placed. The
    // task simply stays open for whoever finishes the remaining units.
    const need = Number(task.qty) || 0;
    if (need > 0 && placed < need) {
      setFeedback({
        type: 'error',
        message: `${need - placed} of ${need} unit(s) still to place. Proceed the rest first, or leave the task open for the next operator.`,
      });
      return false;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const closed = await postApi(`/supply/putaway-tasks/${task.task_id}/complete/`, {
        destination_location_id: scannedBin.location_id,
      });
      toast.success(
        'Bin dropped',
        `${closed.qty} unit(s) of ${skuFor(task)?.sku_code || task.sku} posted to ${scannedBin.label}.`
      );
      setSessionCount((n) => n + 1);
      if (advance) {
        await load();
        resetSession();
      } else {
        setPlaced(0);
        setScannedBin(null);
        setScannedSku(null);
        setScanText('');
        setFeedback({ type: 'ok', message: 'Bin closed. Start the next bin with a product scan.' });
        setStep(1);
      }
      return true;
    } catch (e) {
      const msg = describeError(e);
      setFeedback({ type: 'error', message: msg });
      toast.error('Could not drop bin', msg);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 4c: Drop — finish putaway, never leaking a scanned bin ── */
  const drop = async () => {
    if (!task) return;
    // A bin with confirmed units must still be posted, otherwise "drop" throws
    // away work the operator physically did. closeBin refuses a partly filled
    // bin, and then nothing is claimed: the task stays open in the queue.
    if (scannedBin && placed > 0) {
      if (!(await closeBin(false))) return;
    } else {
      toast.info('Putaway dropped', 'Session finished. Refresh the queue for what remains.');
    }
    await load();
    resetSession();
  };

  const need = task ? Number(task.qty) || 0 : 0;
  const remaining = task ? Math.max(0, need - placed) : 0;

  /* ── No task: the queue ── */
  if (!task) {
    return (
      <div>
        <WorkflowStepper steps={STEPS} current={0} dataTestId="put-stepper" />

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><Boxes size={17} /> Guided Putaway</div>
              <div className="wf-panel__hint">
                {loading ? 'Loading putaway tasks…' : `${tasks.length} open task${tasks.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={load} disabled={loading} data-testid="put-refresh">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {loadError && (
            <div className="scan-feedback scan-feedback--error" data-testid="put-load-error">
              <AlertTriangle size={14} /> {loadError}
            </div>
          )}

          {!loading && !loadError && tasks.length === 0 && (
            <div className="wf-empty" data-testid="put-empty">
              <MapPin size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">No open putaway tasks</div>
              <div className="wf-empty__text">
                Tasks are generated when a GRN is completed in Receiving. Confirmed tasks are excluded from this queue.
              </div>
            </div>
          )}

          {tasks.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '100%' }}>Product</th>
                    <th>SKU</th>
                    <th>Qty</th>
                    <th>Status</th>
                    <th>Assignee</th>
                  </tr>
                </thead>
                <tbody data-testid="put-queue">
                  {tasks.map((t) => (
                    <tr
                      key={t.task_id}
                      data-testid={`put-queue-${t.task_id}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => openTask(t)}
                    >
                      <td data-testid={`put-queue-${t.task_id}-name`}>
                        {skuFor(t)?.name || `SKU ${t.sku}`}
                      </td>
                      <td className="code-cell">{skuFor(t)?.sku_code || t.sku}</td>
                      <td className="mono-num" data-testid={`put-queue-${t.task_id}-qty`}>
                        {Number(t.qty) || 0}
                      </td>
                      <td><StatusBadge status={t.status} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            className="form-input"
                            data-testid={`put-assign-${t.task_id}`}
                            disabled={assignBusy === String(t.task_id)}
                            value={t.assigned_to ? String(t.assigned_to) : ''}
                            onChange={(e) => assignTask(t, e.target.value)}
                            style={{ height: 26, fontSize: 11, padding: '0 6px', minWidth: 0 }}>
                            <option value="">— Unassigned —</option>
                            {staff.map((u) => (
                              <option key={u.user_id} value={String(u.user_id)}>{u.full_name || u.email}</option>
                            ))}
                          </select>
                          {assignBusy === String(t.task_id) && <span style={{ fontSize: 11 }}>…</span>}
                        </div>
                      </td>
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
  return (
    <div className="workspace-viewport">
      <WorkflowStepper steps={STEPS} current={step} dataTestId="put-stepper" />

      <div className="wf-split">
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><ScanLine size={17} /> Scan</div>
              <div className="wf-panel__hint">Task {String(task.task_id).slice(0, 8)}</div>
            </div>
          </div>

          {step === 1 && (
            <ScanInput
              key="put-product"
              label="Step 1 · Scan the product"
              placeholder="Scan the unit you are about to put away"
              value={scanText}
              onChange={setScanText}
              onScan={onScanProduct}
              busy={busy}
              feedback={feedback}
              dataTestId="put-product-scan"
            />
          )}

          {step === 2 && (
            <ScanInput
              key="put-bin"
              label="Step 2 · Scan the target bin"
              placeholder="Scan the bin label you are stocking"
              value={scanText}
              onChange={setScanText}
              onScan={onScanBin}
              busy={busy}
              feedback={feedback}
              dataTestId="put-bin-scan"
            />
          )}

          {step === 3 && (
            <div className="scan-feedback scan-feedback--ok" data-testid="put-ready">
              <CheckCircle2 size={14} />
              <span>
                {skuFor(task)?.sku_code || task.sku} → {scannedBin?.label}. Proceed to commit one unit.
              </span>
            </div>
          )}

          {/* The confirm step has no ScanInput, and ScanInput is what renders
              `feedback`. Without this the whole step is mute: Proceed's result
              and every closeBin refusal (including a failed write) were
              swallowed, so the operator saw nothing at all. */}
          {step === 3 && feedback?.message && (
            <div
              className={`scan-feedback scan-feedback--${feedback.type}`}
              data-testid="put-feedback"
              style={{ marginTop: 10 }}
            >
              {feedback.type === 'ok' && <CheckCircle2 size={14} />}
              {feedback.type === 'error' && <XCircle size={14} />}
              <span>{feedback.message}</span>
            </div>
          )}

          <div className="wf-panel__actions">
            {step === 3 && (
              <button className="scan-btn" onClick={proceed} disabled={busy} data-testid="put-proceed">
                <ChevronRight size={16} /> Proceed
              </button>
            )}
            {step === 3 && (
              <button
                className="scan-btn scan-btn--success"
                onClick={() => closeBin(true)}
                disabled={busy || placed <= 0}
                data-testid="put-next-bin"
              >
                <Send size={16} /> Next / Drop Bin
              </button>
            )}
            <button className="scan-btn scan-btn--neutral" onClick={drop} disabled={busy} data-testid="put-drop">
              Drop
            </button>
            <button className="btn-secondary" onClick={resetSession} disabled={busy} data-testid="put-abort">
              Back to queue
            </button>
          </div>

          {step === 3 && placed <need && (
            <div className="scan-feedback scan-feedback--hint" data-testid="put-need-proceed">
              <AlertTriangle size={14} />
              <span>Proceed at least one unit into this bin before dropping it.</span>
            </div>
          )}

          {step === 3 && placed > 0 && need > 0 && placed <need && (
            <div className="scan-feedback scan-feedback--hint" data-testid="put-need-rest">
              <AlertTriangle size={14} />
              <span>
                {need - placed} unit{need - placed === 1 ? '' : 's'} left for this task. The bin posts
                the full {need}, so nothing is confirmed until every unit is in.
              </span>
            </div>
          )}
        </div>

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                <Package size={17} /> {skuFor(task)?.name || `SKU ${task.sku}`}
              </div>
              <div className="wf-panel__hint mono-num">{skuFor(task)?.sku_code || task.sku}</div>
            </div>
            <ProgressRing
              value={placed}
              total={need}
              label={`${placed} of ${need}`}
              sublabel="units into this bin"
              dataTestId="put-progress"
            />
          </div>

          <ProductCard
            dataTestId="put-active-task"
            product={{
              name: skuFor(task)?.name || `SKU ${task.sku}`,
              sku_code: skuFor(task)?.sku_code || task.sku,
              ean: skuFor(task)?.ean,
            }}
            picked={placed}
            expected={need}
            state={remaining === 0 ? 'done' : placed > 0 ? 'active' : 'pending'}
            action={<StatusBadge status={task.status} />}
            onScan={step === 1 ? () => document.getElementById('put-product-scan-text')?.focus() : undefined}
          />

          <div className="wf-empty__text" data-testid="put-remaining">
            {remaining === 0
              ? 'All units for this task are confirmed into the current bin. Drop the bin to post the stock.'
              : `${remaining} unit${remaining === 1 ? '' : 's'} still to place. Each Proceed confirms one unit into the bin you just scanned.`}
          </div>

          <div className="entity-card">
            <div className="entity-card__thumb"><MapPin size={20} /></div>
            <div className="entity-card__body">
              <div className="entity-card__title">Current bin</div>
              <div className="entity-card__meta">
                <span className="mono-num" data-testid="put-current-bin">
                  {scannedBin?.label || 'Not scanned yet'}
                </span>
              </div>
            </div>
            <div className="entity-card__actions">
              {scannedBin ? <StatusBadge status="verified" /> : <StatusBadge status="pending" />}
            </div>
          </div>

          <div className="entity-card">
            <div className="entity-card__thumb"><Layers size={20} /></div>
            <div className="entity-card__body">
              <div className="entity-card__title">In hand</div>
              <div className="entity-card__meta">
                <span className="mono-num" data-testid="put-current-sku">
                  {scannedSku?.sku_code || skuFor(task)?.sku_code || task.sku}
                </span>
                {scannedSku && <StatusBadge status="verified" />}
              </div>
            </div>
          </div>

          {scannedBin && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Bin</th><th>Products</th><th>Units</th></tr>
                </thead>
                <tbody data-testid="put-bin-card">
                  <tr data-testid="bin-card">
                    <td className="mono-num">
                      {scannedBin.location?.barcode || scannedBin.location?.code ||
                        scannedBin.location?.location_code || scannedBin.location?.id || scannedBin.label}
                    </td>
                    <td>1 product</td>
                    <td className="mono-num">{placed + 1} units</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {sessionCount > 0 && (
            <div className="scan-feedback scan-feedback--ok" data-testid="put-session">
              <CheckCircle2 size={14} />
              <span>{sessionCount} bin(s) already dropped this session.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
