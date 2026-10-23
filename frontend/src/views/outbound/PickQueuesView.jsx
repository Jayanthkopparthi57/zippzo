import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList, RefreshCw, AlertTriangle, CheckCircle2, Boxes,
  ScanLine, Layers, CircleSlash,
} from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { fetchApi, postApi, unwrapList, describeError } from '../../api/client';

/**
 * Outbound pick and sort queues, table first.
 *
 *   PickTask      one pick line (PK `id`). 71 of them are COMPLETED in this
 *                 database and PickTask ordering is -created_at, so an unfiltered
 *                 first page would be nothing but finished history. The two open
 *                 statuses are fetched with their own server-side filters instead.
 *   SortingWave   a cluster sort wave (PK `wave_id`, NOT `id`).
 *
 * PickTask.sku is a bare Sku UUID with no readable code on the task row, so the
 * scannable sku_code / ean is resolved from /catalog/skus/. Nothing is
 * fabricated: if a SKU is not in the catalog, the row shows the real UUID.
 */

/** Pick statuses that are still work. COMPLETED / CANCELLED are history. */
const OPEN_PICK = ['NOT_STARTED', 'IN_PROGRESS'];

const norm = (v) => String(v ?? '').trim().toUpperCase();

/**
 * unwrapList() returns null for a payload shape it does not recognise. Collapsing
 * that to [] would make a broken endpoint look like an empty queue, so an
 * unrecognisable shape is raised and shown instead.
 */
function asList(payload, what) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${what} returned an unrecognised payload shape.`);
  return rows;
}

const dt = (v) => (v ? new Date(v).toLocaleString() : '—');

/**
 * The sidebar exposes three separate destinations that all open this screen:
 *   batches      "Batches & Waves"  -> both queues
 *   picklists    "Picklists"        -> the pick queue only
 *   sorting-list "Sorting"          -> the sorting waves only
 * Before this mapping the prop was ignored and all three rendered an identical
 * page. The panel a tab owns is the only thing hidden; both reads still run so
 * switching tabs is instant and a failed read stays visible on its own panel.
 */
const panelFor = (tab) => {
  if (tab === 'picklists') return 'picks';
  if (tab === 'sorting-list') return 'waves';
  return 'both';
};

export default function PickQueuesView({ initialTab = 'batches' }) {
  const toast = useToast();

  const [panel, setPanel] = useState(panelFor(initialTab));

  useEffect(() => { setPanel(panelFor(initialTab)); }, [initialTab]);

  const [picks, setPicks] = useState([]);
  const [waves, setWaves] = useState([]);
  const [skus, setSkus] = useState([]);
  const [staff, setStaff] = useState([]);
  const [assignBusy, setAssignBusy] = useState('');

  const [loading, setLoading] = useState(true);
  // One error slot per section: a failing read never blanks the other table.
  const [errs, setErrs] = useState({ picks: '', waves: '', skus: '' });
  const hasErr = Boolean(errs.picks || errs.waves || errs.skus);

  const [scanText, setScanText] = useState('');
  const [feedback, setFeedback] = useState(null);

  // { key: string, label: string, count: number } — the product a scan pointed at.
  const [hit, setHit] = useState(null);
  // The pick task read back from the API after completing it.
  const [result, setResult] = useState(null);
  const [busyId, setBusyId] = useState('');

  const picksRef = useRef(null);

  /**
   * Each group settles on its own.
   *
   * A single Promise.all meant one transient 500 from the backend left the screen
   * with no tables at all. The pick queue, the wave list and the SKU catalog are
   * independent: a failed catalog read still renders every pick row, showing the
   * real sku uuid instead of a resolved code, rather than hiding the work.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setErrs({ picks: '', waves: '', skus: '' });

    const [statusLists, waveRes, skuRes, staffRes] = await Promise.all([
      Promise.all(
        OPEN_PICK.map((s) =>
          fetchApi(`/ds-ops/pick-tasks/?status=${s}&page_size=200`).then(
            (payload) => ({ payload, err: '' }),
            (e) => ({ payload: null, err: `${describeError(e)}` })
          )
        )
      ),
      fetchApi('/ds-ops/sorting-waves/?page_size=200').then(
        (payload) => ({ payload, err: '' }),
        (e) => ({ payload: null, err: `${describeError(e)}` })
      ),
      fetchApi('/catalog/skus/?page_size=500').then(
        (payload) => ({ payload, err: '' }),
        (e) => ({ payload: null, err: `${describeError(e)}` })
      ),
      // The assignee dropdown's staff list — independent of the pick data.
      fetchApi('/iam/users/?page_size=500').then(
        (payload) => ({ payload, err: '' }),
        (e) => ({ payload: null, err: `${describeError(e)}` })
      ),
    ]);

    const seen = new Set();
    const open = [];
    const pickErrors = [];
    statusLists.forEach((res, i) => {
      if (res.err) {
        pickErrors.push(`${OPEN_PICK[i]}: ${res.err}`);
        return;
      }
      try {
        asList(res.payload, `/ds-ops/pick-tasks/?status=${OPEN_PICK[i]}`).forEach((p) => {
          const key = String(p.id ?? '');
          if (!key || seen.has(key)) return;
          seen.add(key);
          open.push(p);
        });
      } catch (e) {
        pickErrors.push(`${OPEN_PICK[i]}: ${describeError(e)}`);
      }
    });

    const next = { picks: pickErrors.join(' — '), waves: waveRes.err, skus: skuRes.err };

    if (!next.picks) setPicks(open);
    if (!waveRes.err) {
      try {
        setWaves(asList(waveRes.payload, '/ds-ops/sorting-waves/'));
      } catch (e) {
        next.waves = describeError(e);
      }
    }
    if (!skuRes.err) {
      try {
        setSkus(asList(skuRes.payload, '/catalog/skus/'));
      } catch (e) {
        next.skus = describeError(e);
      }
    }
    if (!staffRes.err) {
      try {
        setStaff(asList(staffRes.payload, '/iam/users/').filter((u) => u.role !== 'CUSTOMER'));
      } catch (e) { /* an unavailable staff list degrades to unassignable rows */ }
    }

    setErrs(next);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Hand a pick line to one worker (or clear it) — the board's assign action. */
  const assignPick = async (p, userId) => {
    setAssignBusy(String(p.id));
    try {
      await postApi(`/ds-ops/pick-tasks/${p.id}/assign/`, { user: userId || null });
      await load();
    } catch (e) {
      toast.error('Could not assign pick', describeError(e));
    } finally {
      setAssignBusy('');
    }
  };

  const skuById = useMemo(() => {
    const map = {};
    skus.forEach((s) => { map[String(s.sku_id)] = s; });
    return map;
  }, [skus]);

  const skuFor = useCallback((id) => skuById[String(id)] || null, [skuById]);

  /* ── scroll the scanned product's rows into view ── */
  useEffect(() => {
    if (!hit) return;
    const raf = requestAnimationFrame(() => {
      const el = picksRef.current?.querySelector('[data-scan-hit="true"]');
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [hit]);

  /* ── the one scan input: point at a product's rows, never gate the tables ── */

  const onScan = (code) => {
    const want = norm(code);
    if (!want) return;

    const hitSku =
      skus.find((s) => [s.sku_code, s.ean, s.sku_id].some((v) => norm(v) === want)) || null;
    const hitSkuId = hitSku ? String(hitSku.sku_id) : null;

    // A raw task sku uuid also resolves, so a label printed with the id still works.
    const rows = picks.filter((p) => {
      if (hitSkuId) return String(p.sku) === hitSkuId;
      return String(p.sku) === want;
    });

    if (!hitSkuId && rows.length === 0) {
      setHit(null);
      setFeedback({
        type: 'error',
        message: `No pick line in the open queues matches “${String(code).trim()}”. Scan a SKU code, its EAN, or the raw sku id.`,
      });
      return;
    }

    setHit({
      key: hitSkuId || want,
      label: hitSku ? `${hitSku.sku_code} — ${hitSku.name}` : `sku ${String(code).trim()}`,
    });
    picksRef.current = document.getElementById('pq-picks-table');
    setScanText('');
    setFeedback(
      rows.length === 0
        ? {
            type: 'hint',
            message: `${hitSku?.sku_code || String(code).trim()} is in the catalog but has no open pick line right now.`,
          }
        : {
            type: 'ok',
            message: `${rows.length} pick line${rows.length === 1 ? '' : 's'} for ${hitSku?.sku_code || String(code).trim()} highlighted.`,
          }
    );
  };

  /* ── complete a pick ── */

  const completePick = async (row) => {
    const id = row?.id;
    // Never build /ds-ops/pick-tasks/undefined/complete/ — that 404s.
    if (id === undefined || id === null || id === '') {
      toast.error('Cannot complete pick', 'This pick row has no id.');
      setFeedback({ type: 'error', message: 'This pick row has no id, so it cannot be completed.' });
      return;
    }
    setBusyId(String(id));
    setFeedback(null);
    try {
      await postApi(`/ds-ops/pick-tasks/${encodeURIComponent(String(id))}/complete/`, {});
      // Read the persisted task back and reload both queues, so the table shows
      // what the database holds rather than what the action claimed.
      const persisted = await fetchApi(
        `/ds-ops/pick-tasks/${encodeURIComponent(String(id))}/`
      );
      await load();
      setResult({
        id: String(id),
        sku: skuFor(persisted.sku)?.sku_code || String(persisted.sku ?? '—'),
        status: persisted.status ?? 'unknown',
        picked: persisted.picked_qty ?? 0,
        qty: persisted.qty ?? 0,
      });
      toast.success(
        'Pick completed',
        `Task ${id} · ${skuFor(persisted.sku)?.sku_code || String(persisted.sku ?? '')} is now ${persisted.status}.`
      );
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
      toast.error('Could not complete pick', describeError(e));
    } finally {
      setBusyId('');
    }
  };

  const hitCell = (p) =>
    hit?.key === String(p.sku) ? (
      <span className="status-badge status-badge--accent" data-testid="pq-scan-match">
        Scan match
      </span>
    ) : null;

  /** Named per section, so the operator knows which read failed. */
  const sectionErrors = [
    errs.picks ? `open picks — ${errs.picks}` : '',
    errs.waves ? `sorting waves — ${errs.waves}` : '',
    errs.skus ? `SKU catalog — ${errs.skus} (pick rows show the raw sku id instead)` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div data-testid="pq-root" data-loading={loading ? 'true' : 'false'}>
      {/* ── Which queue this destination opens with ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="subtabs-bar" style={{ marginBottom: 0 }} data-testid="pq-tabs">
          <button type="button" className={`subtab-btn ${panel === 'picks' ? 'active' : ''}`}
            data-testid="pq-tab-picks" onClick={() => setPanel('picks')}>
            Pick queue
          </button>
          <button type="button" className={`subtab-btn ${panel === 'waves' ? 'active' : ''}`}
            data-testid="pq-tab-waves" onClick={() => setPanel('waves')}>
            Sorting waves
          </button>
          <button type="button" className={`subtab-btn ${panel === 'both' ? 'active' : ''}`}
            data-testid="pq-tab-both" onClick={() => setPanel('both')}>
            All queues
          </button>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading} data-testid="pq-refresh-tabs"
          title="Reload both queues">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* ── Scan: a pointer at the queues below, not a gate in front of them ── */}
      {panel !== 'waves' && (
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><ScanLine size={17} /> Outbound queues</div>
            <div className="wf-panel__hint">
              Every row below is real API data. Scanning is optional — it highlights that product's lines.
            </div>
          </div>
          <div className="wf-panel__actions">
            <button className="btn-secondary" onClick={load} disabled={loading} data-testid="pq-refresh">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <ScanInput
          label="Scan a SKU code / EAN"
          placeholder="Scan or type a product code, then press Enter"
          value={scanText}
          onChange={setScanText}
          onScan={onScan}
          busy={false}
          feedback={feedback}
          hint="Tables below are always visible — scanning only points at a product's rows."
          dataTestId="pq-scan"
        />

        {hasErr && (
          <div  className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="pq-load-error">
              <AlertTriangle size={14} />
              <span data-testid="pq-load-error-text">{sectionErrors}</span>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── 1. Open picks ── */}
      {panel !== 'waves' && (
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div >
            <div className="wf-panel__title"><ClipboardList size={17} /> Open picks</div>
            <div className="wf-panel__hint">
              {loading
                ? 'Loading pick tasks…'
                : errs.picks
                  ? 'Pick read failed — the wave table below is unaffected'
                  : `${picks.length} open line${picks.length === 1 ? '' : 's'} in ${OPEN_PICK.join(' / ')} · completed history excluded`}
            </div>
          </div>
        </div>

        {errs.picks && (
          <div  className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="pq-picks-error">
              <AlertTriangle size={14} /> <span>Could not read open picks — {errs.picks}</span>
            </div>
          </div>
        )}

        {!loading && !errs.picks && picks.length === 0 && (
          <div  className="wf-empty" data-testid="pq-picks-empty">
            <ClipboardList size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">No open pick lines</div>
            <div className="wf-empty__text">
              Every pick task is COMPLETED or CANCELLED. The queue is filtered server-side so
              finished history cannot masquerade as open work.
            </div>
          </div>
        )}

        {picks.length > 0 && (
          <div  className="table-container" id="pq-picks-table">
            <table className="data-table" data-testid="pq-picks">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Picklist</th>
                  <th>SKU</th>
                  <th>Product</th>
                  <th>Bin</th>
                  <th>Qty</th>
                  <th>Picked</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Assignee</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {picks.map((p) => {
                  const id = String(p.id);
                  const sku = skuFor(p.sku);
                  const matched = hit?.key === String(p.sku);
                  const inProgress = String(p.status).toUpperCase() === 'IN_PROGRESS';
                  const picked = Number(p.picked_qty) || 0;
                  const canComplete = inProgress && picked > 0;
                  const why = !inProgress
                    ? `Pick is ${p.status}; only IN_PROGRESS lines can be completed.`
                    : 'No picked_qty recorded yet — a complete would post the full qty.';
                  return (
                    <tr
                      key={id}
                      data-testid={`pq-row-${id}`}
                      data-scan-hit={matched ? 'true' : undefined}
                      aria-selected={matched || undefined}
                    >
                      <td>
                        {matched && hitCell(p)}
                        <span className="code-cell">{id}</span>
                      </td>
                      <td className="mono-num">{String(p.picklist_id ?? '—').slice(0, 8)}</td>
                      <td data-testid={`pq-sku-${id}`}>
                        <span className="code-cell">{sku?.sku_code || String(p.sku ?? '—')}</span>
                        {sku?.ean && <div className="wf-panel__hint">{sku.ean}</div>}
                      </td>
                      <td>{sku?.name || <span className="wf-panel__hint">not in catalog</span>}</td>
                      <td>
                        <span className="code-cell">{p.bin || '—'}</span>
                      </td>
                      <td className="mono-num">{Number(p.qty) || 0}</td>
                      <td className="mono-num" data-testid={`pq-picked-${id}`}>{picked}</td>
                      <td><StatusBadge status={p.status} dataTestId={`pq-status-${id}`} /></td>
                      <td className="mono-num">{dt(p.started_at)}</td>
                      <td>
                        <select
                          className="form-input"
                          data-testid={`pq-assign-${id}`}
                          disabled={assignBusy === id}
                          value={p.assigned_to ? String(p.assigned_to) : ''}
                          onChange={(e) => assignPick(p, e.target.value)}
                          style={{ height: 26, fontSize: 11, padding: '0 6px', minWidth: 130 }}>
                          <option value="">— Unassigned —</option>
                          {staff.map((u) => (
                            <option key={u.user_id} value={String(u.user_id)}>{u.full_name || u.email}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className="btn-secondary"
                          onClick={() => completePick(p)}
                          disabled={!canComplete || busyId !== ''}
                          title={
                            canComplete
                              ? `POST /ds-ops/pick-tasks/${id}/complete/`
                              : why
                          }
                          data-testid={`pq-complete-${id}`}
                        >
                          <CheckCircle2 size={14} /> Complete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── 2. Sorting waves ── */}
      {panel !== 'picks' && (
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div >
            <div className="wf-panel__title"><Layers size={17} /> Sorting waves</div>
            <div className="wf-panel__hint">
              {loading
                ? 'Loading sorting waves…'
                : errs.waves
                  ? 'Wave read failed — the pick table above is unaffected'
                  : `${waves.length} wave${waves.length === 1 ? '' : 's'} from /ds-ops/sorting-waves/`}
            </div>
          </div>
        </div>

        {errs.waves && (
          <div  className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="pq-waves-error">
              <AlertTriangle size={14} /> <span>Could not read sorting waves — {errs.waves}</span>
            </div>
          </div>
        )}

        {!loading && !errs.waves && waves.length === 0 && (
          <div  className="wf-empty" data-testid="pq-waves-empty">
            <Layers size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">No sorting waves</div>
            <div className="wf-empty__text">
              /ds-ops/sorting-waves/ returned zero rows, so there is no sort work to release.
            </div>
          </div>
        )}

        {waves.length > 0 && (
          <div  className="table-container">
            <table className="data-table" data-testid="pq-waves">
              <thead>
                <tr>
                  <th>Wave</th>
                  <th>Batch</th>
                  <th>Cluster zone</th>
                  <th>Type</th>
                  <th>Assigned</th>
                  <th>Sorted</th>
                  <th>Created</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {waves.map((w) => {
                  const id = String(w.wave_id ?? '');
                  return (
                    <tr key={id} data-testid={`pq-wave-${id}`}>
                      <td><span className="code-cell">{id.slice(0, 8)}</span></td>
                      <td className="mono-num">{String(w.batch ?? '—').slice(0, 8)}</td>
                      <td>{w.cluster_zone || '—'}</td>
                      <td>{w.type || '—'}</td>
                      <td className="mono-num">{Number(w.assigned_qty) || 0}</td>
                      <td className="mono-num">{Number(w.sorted_qty) || 0}</td>
                      <td className="mono-num">{dt(w.created_at)}</td>
                      <td><StatusBadge status={w.status} dataTestId={`pq-wave-status-${id}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── last persisted result, read back from the API after the write ── */}
      {result && (
        <div className="wf-panel" data-testid="pq-result">
          <div  className="wf-panel__header">
            <div >
              <div className="wf-panel__title"><ClipboardList size={17} /> Last persisted pick</div>
              <div className="wf-panel__hint">Read back from the API after the write, not the request body</div>
            </div>
            <div  className="wf-panel__actions">
              <button className="btn-secondary" onClick={() => setResult(null)} data-testid="pq-result-clear">
                Clear
              </button>
            </div>
          </div>
          <div  className="entity-card">
            <div  className="entity-card__thumb"><Boxes size={20} /></div>
            <div  className="entity-card__body">
              <div className="entity-card__title mono-num" data-testid="pq-result-title">
                Task {result.id} · {result.sku}
              </div>
              <div className="entity-card__meta">
                <span>Picked <strong className="mono-num" data-testid="pq-result-picked">{result.picked}</strong> of {result.qty}</span>
              </div>
            </div>
            <div  className="entity-card__actions">
              <StatusBadge status={result.status} dataTestId="pq-result-status" />
            </div>
          </div>
        </div>
      )}

      {!loading && !hasErr && picks.length === 0 && waves.length === 0 && (
        <div className="wf-panel">
          <div  className="wf-empty" data-testid="pq-nothing-open">
            <CircleSlash size={40} className="wf-empty__icon" />
            <div  className="wf-empty__title">Nothing open in the outbound queues</div>
            <div  className="wf-empty__text">
              No pick line is {OPEN_PICK.join(' or ')} and no sorting wave exists. Both endpoints
              answered successfully — this is a real empty queue, not a failed read.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
