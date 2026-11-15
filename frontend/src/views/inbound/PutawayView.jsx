import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MapPin, RefreshCw, AlertTriangle, ScanLine, CheckCircle2,
  Send, Layers, XCircle, Warehouse, ArrowDownToLine,
} from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
// WorkflowStepper / ProgressRing chrome removed.
import ProductCard from '../../components/ui/ProductCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { PageHead, SubTabs, FilterBar } from '../../components/ui/WmsUI';
import { useToast } from '../../components/ui/Toast';
import { useTabs } from '../../context/TabContext';
import { fetchApi, postApi, unwrapList, describeError } from '../../api/client';

/**
 * Guided putaway: choose a bin from the bin list, scan the unit, Proceed.
 *
 * The screen is bin-first because that is the physical job. Opening a task
 * lists every bin with its capacity, free space and what is already inside it;
 * scanning (or clicking) one starts a bin session. Each Proceed writes that
 * unit to the ledger immediately — occupancy and stock move before the bin is
 * closed — and the operator is asked for the next product in the same bin.
 *
 * `Next bin` ends the bin session without completing the task. `Drop`
 * completes it, and is refused until every unit has been placed.
 */

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

const binLabel = (b) => b?.barcode || b?.label || b?.location_id || '';

export default function PutawayView({ siteId = '', darkStoreMode = false }) {
  const toast = useToast();
  // This view is reused from the legacy store shell (which provides the
  // shared TabProvider) and from the Dark Store console (which owns a
  // separate TabProvider). Without a provider useTabs() returns undefined,
  // so degrade to a no-op instead of crashing the whole console.
  const tabCtx = useTabs();
  const openTab = tabCtx?.openTab || (() => {});
  const [queueFilter, setQueueFilter] = useState('');

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

  const [bins, setBins] = useState([]);
  const [binsLoading, setBinsLoading] = useState(false);
  const [binsError, setBinsError] = useState('');
  const [binSearch, setBinSearch] = useState('');

  const [bin, setBin] = useState(null);
  const [pendingSku, setPendingSku] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);

  const loadOpenTasks = useCallback(async () => {
    const statusLists = await Promise.all(
      OPEN_TASK_STATUS.map((status) => fetchApi(
        `/supply/putaway-tasks/?status=${status}&page_size=100` +
        (siteId ? `&grn_line__grn__asn__dest_site=${encodeURIComponent(siteId)}` : '')
      ))
    );
    const seen = new Set();
    const open = [];
    statusLists.forEach((payload, index) => {
      asList(payload, `/supply/putaway-tasks/?status=${OPEN_TASK_STATUS[index]}`).forEach((row) => {
        const id = String(row.task_id);
        if (seen.has(id)) return;
        seen.add(id);
        open.push(row);
      });
    });
    return open;
  }, [siteId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    if (darkStoreMode && !siteId) {
      setTasks([]);
      setLoadError('Select an active Darkstore to view putaway work.');
      setLoading(false);
      return;
    }
    try {
      const [openTasks, skuRows, staffRows] = await Promise.all([
        loadOpenTasks(),
        // PutawayTask.sku is a Sku UUID; resolve the scannable codes.
        fetchApi('/catalog/skus/?page_size=1000'),
        // Who a putaway can be handed to — the assignment board's staff list.
        fetchApi('/iam/users/?page_size=500'),
      ]);
      setTasks(openTasks);
      setSkus(asList(skuRows, '/catalog/skus/'));
      setStaff(asList(staffRows, '/iam/users/').filter((u) => u.role !== 'CUSTOMER'));
    } catch (e) {
      setLoadError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [darkStoreMode, loadOpenTasks, siteId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!darkStoreMode || !siteId) return undefined;
    let active = true;
    const syncTasks = async () => {
      if (document.hidden) return;
      try {
        const nextTasks = await loadOpenTasks();
        if (active) {
          setTasks(nextTasks);
          setLoadError('');
        }
      } catch (error) {
        if (active) setLoadError(describeError(error));
      }
    };
    const timer = window.setInterval(syncTasks, 30000);
    window.addEventListener('zippzo:live-event', syncTasks);
    document.addEventListener('visibilitychange', syncTasks);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('zippzo:live-event', syncTasks);
      document.removeEventListener('visibilitychange', syncTasks);
    };
  }, [darkStoreMode, loadOpenTasks, siteId]);

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

  const skuFor = useCallback((t) => t ? (skuById[String(t.sku)] || null) : null, [skuById]);

  const loadBins = useCallback(async (siteId) => {
    setBinsLoading(true);
    setBinsError('');
    try {
      const qs = new URLSearchParams({ limit: '200' });
      if (siteId) qs.set('site', siteId);
      const rows = asList(
        await fetchApi(`/supply/putaway-bins/?${qs.toString()}`),
        '/supply/putaway-bins/'
      );
      setBins(rows);
      return rows;
    } catch (e) {
      setBinsError(describeError(e));
      return [];
    } finally {
      setBinsLoading(false);
    }
  }, []);

  const openTask = async (t) => {
    setTask(t);
    setBin(null);
    setPendingSku(null);
    setScanText('');
    setFeedback(null);
    setStep(1);
    await loadBins(t.site_id);
  };

  const resetSession = () => {
    setTask(null);
    setBin(null);
    setPendingSku(null);
    setScanText('');
    setFeedback(null);
    setBins([]);
    setBinsError('');
    setStep(0);
  };

  /* ── Step 2: scan or click a bin to start the bin session ── */
  const openBin = (row) => {
    setBin(row);
    setPendingSku(null);
    setScanText('');
    setFeedback({
      type: 'ok',
      message: `${binLabel(row)} selected. Scan the product to put away.`,
    });
    setStep(2);
  };

  const onScanBin = async (code) => {
    if (!task) return;
    const want = norm(code);
    const local = bins.find((b) => norm(b.barcode) === want || norm(b.location_id) === want);
    if (local) {
      setScanText('');
      openBin(local);
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const found = asList(
        await fetchApi(`/supply/putaway-bins/?search=${encodeURIComponent(code)}&limit=25`),
        '/supply/putaway-bins/?search='
      );
      const hit = found.find((b) => norm(b.barcode) === want || norm(b.location_id) === want);
      if (!hit) {
        setFeedback({ type: 'error', message: `No bin matches "${code}". Scan a bin barcode from the list.` });
        return;
      }
      setBins((prev) => (prev.some((b) => b.location_id === hit.location_id) ? prev : [hit, ...prev]));
      setScanText('');
      openBin(hit);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 3: the product must be the one the task is for ── */
  const onScanProduct = (code) => {
    if (!task || !bin) return;
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
    const placed = Number(task.placed_qty) || 0;
    if (placed >= Number(task.qty || 0)) {
      setFeedback({ type: 'error', message: `All ${task.qty} unit(s) are already placed. Press Drop to complete.` });
      return;
    }
    setPendingSku(sku);
    setScanText('');
    setFeedback({
      type: 'ok',
      message: `${sku.sku_code} scanned. Press Proceed to store 1 unit in ${binLabel(bin)}.`,
    });
  };

  /* ── Step 3b: Proceed — post this unit to the ledger immediately ── */
  const proceed = async () => {
    if (!task || !bin) return;
    if (!pendingSku) {
      setFeedback({ type: 'error', message: 'Scan a product unit into your hand before pressing Proceed.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await postApi(`/supply/putaway-tasks/${task.task_id}/place/`, {
        destination_location_id: bin.location_id,
        qty: 1,
      });
      const nextPlaced = Number(saved.placed_qty) || (Number(task.placed_qty) || 0) + 1;
      setTask((prev) => ({ ...prev, ...saved, placed_qty: nextPlaced }));
      setPendingSku(null);
      setScanText('');
      if (saved.bin) {
        setBin((prev) => ({ ...prev, ...saved.bin }));
        setBins((prev) => prev.map((b) => (
          b.location_id === bin.location_id ? { ...b, ...saved.bin } : b
        )));
      }
      setStep(2);
      setFeedback({
        type: 'ok',
        message: nextPlaced >= Number(task.qty || 0)
          ? `All ${task.qty} unit(s) placed. Press Drop to complete the task.`
          : `Stored 1 unit in ${binLabel(bin)} (${nextPlaced} of ${task.qty}). Scan the next product.`,
      });
      // The next physical action is another product scan in the same bin.
      window.setTimeout(() => document.getElementById('put-product-scan-text')?.focus(), 0);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 4a: Next bin — end this bin session, keep the task open ── */
  const nextBin = async () => {
    if (!task) return;
    if (pendingSku) {
      setFeedback({
        type: 'error',
        message: 'A product is scanned but not stored yet. Press Proceed, or scan the product again.',
      });
      return;
    }
    const placed = Number(task.placed_qty) || 0;
    if (placed <= 0) {
      setFeedback({ type: 'error', message: 'Nothing has been stored yet. Proceed at least one unit first.' });
      return;
    }
    setBin(null);
    setPendingSku(null);
    setScanText('');
    setStep(1);
    setFeedback({
      type: 'ok',
      message: placed >= Number(task.qty || 0)
        ? `Bin closed with all ${task.qty} unit(s). Press Drop to complete the task.`
        : `Bin closed with ${placed} of ${task.qty}. Pick another bin for the rest.`,
    });
    await loadBins(task.site_id);
  };

  /* ── Step 4b: Drop — complete the putaway task ── */
  const drop = async () => {
    if (!task) return;
    const placed = Number(task.placed_qty) || 0;
    const need = Number(task.qty) || 0;
    if (placed < need) {
      setFeedback({
        type: 'error',
        message: `${need - placed} of ${need} unit(s) still to place. Drop is only allowed once every unit is stored.`,
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const closed = await postApi(`/supply/putaway-tasks/${task.task_id}/complete/`, {
        destination_location_id: bin?.location_id || closedBinId(task),
      });
      toast.success(
        'Putaway complete',
        `${closed.qty} unit(s) of ${skuFor(task)?.sku_code || task.sku} shelved.`
      );
      setSessionCount((n) => n + 1);
      await load();
      resetSession();
    } catch (e) {
      const msg = describeError(e);
      setFeedback({ type: 'error', message: msg });
      toast.error('Could not complete putaway', msg);
    } finally {
      setBusy(false);
    }
  };

  const need = task ? Number(task.qty) || 0 : 0;
  const placed = task ? Number(task.placed_qty) || 0 : 0;
  const remaining = Math.max(0, need - placed);
  const filteredBins = useMemo(() => {
    const q = norm(binSearch);
    if (!q) return bins;
    return bins.filter((b) => `${b.barcode} ${b.zone || ''} ${b.aisle || ''} ${(b.contents || [])
      .map((c) => `${c.sku_code} ${c.sku_name}`).join(' ')}`.toUpperCase().includes(q));
  }, [bins, binSearch]);

  const taskRows = tasks.filter((t) => {
    const q = queueFilter.trim().toLowerCase();
    if (!q) return true;
    return [skuFor(t)?.name, skuFor(t)?.sku_code, t.sku, t.status, t.assigned_to]
      .some((v) => String(v ?? '').toLowerCase().includes(q));
  });

  /* ── No task: the queue ── */
  if (!task) {
    return (
      <div>
        <PageHead
          title="Putaway Tasks"
          count={tasks.length}
          subtitle="Place QC-accepted units into bins. Every scan moves real stock and updates bin occupancy."
          actions={(
            <button className="btn-ui" onClick={load} disabled={loading} data-testid="put-refresh">
              <RefreshCw size={13} /> Sync
            </button>
          )}
        />

        <SubTabs
          search={queueFilter}
          onSearch={setQueueFilter}
          active="putaway-tasks"
          onChange={(id) => { if (id !== 'putaway-tasks' && tabCtx?.openTab) openTab(id, id === 'asns' ? 'Consignments' : id === 'qc-testing' ? 'QC Testing' : 'Inbound Ledger'); }}
          tabs={[
            { id: 'asns', label: 'ASNs (Advance Shipping)' },
            { id: 'qc-testing', label: 'QC Testing' },
            { id: 'putaway-tasks', label: 'Putaway Tasks', count: tasks.length },
            { id: 'inbound-ledger', label: 'Inbound Ledger' },
          ]}
        />

        <div className="wf-panel" style={{ padding: 0 }}>
          <div className="wms-table-card__head">
            <div>
              <div className="wms-table-card__title">
                <span>Guided Putaway</span>
                <span className="screen-count-tag">{tasks.length} records</span>
              </div>
              <div className="wms-table-card__sub">
                {loading ? 'Loading putaway tasks…' : `${tasks.length} open task${tasks.length === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>

          {loadError && (
            <div className="scan-feedback scan-feedback--error" data-testid="put-load-error" style={{ margin: 12 }}>
              <AlertTriangle size={14} /> {loadError}
            </div>
          )}

          {!loading && !loadError && tasks.length === 0 && (
            <div className="wf-empty" data-testid="put-empty">
              <MapPin size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">No open putaway tasks</div>
              <div className="wf-empty__text">
                Tasks appear once QC has accepted units from a receipt. Confirmed tasks are excluded.
              </div>
            </div>
          )}

          {tasks.length > 0 && (
            <>
              <FilterBar value={queueFilter} onChange={setQueueFilter} shown={taskRows.length} total={tasks.length} />
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Qty</th>
                      <th>Placed</th>
                      <th>Status</th>
                      <th>Assignee</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody data-testid="put-queue">
                    {taskRows.map((t) => (
                      <tr
                        key={t.task_id}
                        data-testid={`put-queue-${t.task_id}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => openTask(t)}
                      >
                        <td data-testid={`put-queue-${t.task_id}-name`}>
                          {skuFor(t)?.name || `SKU ${t.sku}`}
                        </td>
                        <td><span className="link-cell">{skuFor(t)?.sku_code || t.sku}</span></td>
                        <td className="mono-num" data-testid={`put-queue-${t.task_id}-qty`}>
                          {Number(t.qty) || 0}
                        </td>
                        <td className="mono-num">{Number(t.placed_qty) || 0}</td>
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
                        <td>
                          <button type="button" className="row-action-btn" onClick={(e) => { e.stopPropagation(); openTask(t); }}>
                            Putaway
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="wms-pager">
                <div className="wms-shown">Showing <b>{taskRows.length}</b> of <b>{tasks.length}</b> records</div>
                <div className="wms-pager__pages">
                  <button className="wms-page-btn" disabled>Prev</button>
                  <button className="wms-page-btn active">1</button>
                  <button className="wms-page-btn" disabled>Next</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ── Active task: bins, then the guided put loop ── */
  return (
    <div className="workspace-viewport">


      <div className="wf-split">
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek"> Scan</div>
              <div className="wf-panel__hint">
                Task {String(task.task_id).slice(0, 8)}
                {task.site_code ? ` · ${task.site_code}` : ''}
              </div>
            </div>
          </div>

          {step === 1 && (
            <>
              <ScanInput
                key="put-bin"
                label="Scan"
                placeholder="Scan a bin barcode, or pick one from the list"
                value={scanText}
                onChange={setScanText}
                onScan={onScanBin}
                busy={busy || binsLoading}
                feedback={feedback}
                dataTestId="put-bin-scan"
              />

              <div className="table-toolbar" style={{ marginTop: 12 }}>
                <div className="search-box">
                  <ScanLine size={14} />
                  <input
                    placeholder="Filter bins by barcode, zone, or product…"
                    value={binSearch}
                    onChange={(e) => setBinSearch(e.target.value)}
                    data-testid="put-bin-filter"
                  />
                </div>
                <button className="btn-secondary" onClick={() => loadBins(task.site_id)} disabled={binsLoading} data-testid="put-bin-refresh">
                  <RefreshCw size={14} /> Bins
                </button>
              </div>

              {binsError && (
                <div className="scan-feedback scan-feedback--error" data-testid="put-bin-error">
                  <AlertTriangle size={14} /> {binsError}
                </div>
              )}

              {!binsLoading && !binsError && filteredBins.length === 0 && (
                <div className="wf-empty" data-testid="put-bin-empty">
                  <Warehouse size={36} className="wf-empty__icon" />
                  <div className="wf-empty__title">No bins found</div>
                  <div className="wf-empty__text">No active bins match this site or filter.</div>
                </div>
              )}

              {filteredBins.length > 0 && (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Bin</th>
                        <th>Zone</th>
                        <th>Capacity</th>
                        <th>Free</th>
                        <th>Products</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody data-testid="put-bin-list">
                      {filteredBins.map((b) => (
                        <tr key={b.location_id} data-testid={`put-bin-row-${b.location_id}`}>
                          <td className="mono-num" data-testid={`put-bin-row-${b.location_id}-barcode`}>
                            {b.barcode}
                          </td>
                          <td className="code-cell">{b.zone || '—'}</td>
                          <td className="mono-num">{b.capacity_qty ?? '—'}</td>
                          <td className="mono-num" data-testid={`put-bin-row-${b.location_id}-free`}>
                            {b.free_qty ?? '—'}
                          </td>
                          <td data-testid={`put-bin-row-${b.location_id}-products`}>
                            {b.product_count > 0
                              ? `${b.product_count} · ${(b.contents || []).slice(0, 3).map((c) => c.sku_code).join(', ')}`
                              : 'Empty'}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="scan-btn"
                              style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                              onClick={() => openBin(b)}
                              data-testid={`put-bin-select-${b.location_id}`}
                            >
                              Put away here
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="scan-feedback scan-feedback--ok" data-testid="put-ready">
                <CheckCircle2 size={14} />
                <span>
                  {binLabel(bin)} · {bin.occupied_qty ?? 0}/{bin.capacity_qty ?? '—'} units
                  {bin.free_qty != null ? ` · ${bin.free_qty} free` : ''}
                </span>
              </div>

              <ScanInput
                key="put-product"
                label="Scan"
                placeholder="Scan the unit you are putting into this bin"
                value={scanText}
                onChange={setScanText}
                onScan={onScanProduct}
                busy={busy}
                feedback={feedback}
                dataTestId="put-product-scan"
              />

              {feedback?.message && (
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
                <button
                  className="scan-btn"
                  onClick={proceed}
                  disabled={busy || !pendingSku}
                  data-testid="put-proceed"
                >
                  <ArrowDownToLine size={16} /> Proceed
                </button>
                <button
                  className="scan-btn scan-btn--success"
                  onClick={nextBin}
                  disabled={busy}
                  data-testid="put-next-bin"
                >
                  <Send size={16} /> Next / Drop Bin
                </button>
                <button
                  className="scan-btn scan-btn--neutral"
                  onClick={drop}
                  disabled={busy || remaining > 0}
                  data-testid="put-drop"
                >
                  Drop
                </button>
                <button className="btn-secondary" onClick={resetSession} disabled={busy} data-testid="put-abort">
                  Back to queue
                </button>
              </div>

              {pendingSku && (
                <div className="scan-feedback scan-feedback--hint" data-testid="put-need-proceed">
                  <AlertTriangle size={14} />
                  <span>{pendingSku.sku_code} is in hand. Press Proceed to store one unit.</span>
                </div>
              )}

              {remaining > 0 && (
                <div className="scan-feedback scan-feedback--hint" data-testid="put-need-rest">
                  <AlertTriangle size={14} />
                  <span>{remaining} unit{remaining === 1 ? '' : 's'} still to place before Drop.</span>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <div className="wf-panel__actions">
              <button className="scan-btn scan-btn--neutral" onClick={drop} disabled={busy || remaining > 0} data-testid="put-drop">
                <Send size={16} /> Drop
              </button>
              <button className="btn-secondary" onClick={resetSession} disabled={busy} data-testid="put-abort">
                Back to queue
              </button>
            </div>
          )}
        </div>

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek">
 {skuFor(task)?.name || `SKU ${task.sku}`}
              </div>
              <div className="wf-panel__hint mono-num">{skuFor(task)?.sku_code || task.sku}</div>
            </div>
            <span className="mono-num" style={{ fontSize: 12, color: 'var(--text-muted)' }} data-testid="put-progress">
              {placed} of {need}
            </span>
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
            onScan={step === 2 ? () => document.getElementById('put-product-scan-text')?.focus() : undefined}
          />

          <div className="wf-empty__text" data-testid="put-remaining">
            {remaining === 0
              ? 'Every unit is stored. Press Drop to complete the putaway task.'
              : `${remaining} unit${remaining === 1 ? '' : 's'} still to place. Each Proceed stores one unit in the bin you selected.`}
          </div>

          <div className="entity-card">
            <div className="entity-card__thumb"><MapPin size={20} /></div>
            <div className="entity-card__body">
              <div className="entity-card__title">Current bin</div>
              <div className="entity-card__meta">
                <span className="mono-num" data-testid="put-current-bin">
                  {binLabel(bin) || 'Not selected yet'}
                </span>
              </div>
            </div>
            <div className="entity-card__actions">
              {bin ? <StatusBadge status="verified" /> : <StatusBadge status="pending" />}
            </div>
          </div>

          <div className="entity-card">
            <div className="entity-card__thumb"><Layers size={20} /></div>
            <div className="entity-card__body">
              <div className="entity-card__title">In hand</div>
              <div className="entity-card__meta">
                <span className="mono-num" data-testid="put-current-sku">
                  {pendingSku?.sku_code || skuFor(task)?.sku_code || task.sku}
                </span>
                {pendingSku && <StatusBadge status="verified" />}
              </div>
            </div>
          </div>

          {bin && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Bin</th><th>Capacity</th><th>Stored</th><th>Free</th></tr>
                </thead>
                <tbody data-testid="put-bin-card">
                  <tr data-testid="bin-card">
                    <td className="mono-num">{bin.barcode}</td>
                    <td className="mono-num" data-testid="put-bin-capacity">{bin.capacity_qty ?? '—'}</td>
                    <td className="mono-num" data-testid="put-bin-occupied">{bin.occupied_qty ?? 0}</td>
                    <td className="mono-num" data-testid="put-bin-free">{bin.free_qty ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {bin?.contents?.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Product</th><th>SKU</th><th>Qty</th></tr>
                </thead>
                <tbody data-testid="put-bin-contents">
                  {bin.contents.map((c, i) => (
                    <tr key={`${c.sku_code}-${c.lot}-${i}`}>
                      <td>{c.sku_name}</td>
                      <td className="code-cell">{c.sku_code}</td>
                      <td className="mono-num">{c.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sessionCount > 0 && (
            <div className="scan-feedback scan-feedback--ok" data-testid="put-session">
              <CheckCircle2 size={14} />
              <span>{sessionCount} putaway task(s) already completed this session.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Last bin a task was actually confirmed into, for a Drop from the bin list. */
function closedBinId(task) {
  return task?.confirmed_bin || undefined;
}
