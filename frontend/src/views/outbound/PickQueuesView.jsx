import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, RefreshCw, AlertTriangle, CheckCircle2, Boxes,
  ScanLine, Layers, CircleSlash,
} from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';
import { PageHead, FilterBar } from '../../components/ui/WmsUI';
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
 *   batches      "Batches & Waves"  -> the picklists summary
 *   picklists    "Picklists"        -> the grouped picking summary
 *   sorting-list "Sorting"          -> the sorting waves only
 * Before this mapping the prop was ignored and all three rendered an identical
 * page. The panel a tab owns is the only thing rendered (one table per
 * section); all reads still run so switching tabs is instant and a failed
 * read stays visible on its own panel.
 */
const panelFor = (tab) => {
  if (tab === 'sorting-list') return 'waves';
  return 'picklists';
};

export default function PickQueuesView({ initialTab = 'batches' }) {
  const toast = useToast();

  const [panel, setPanel] = useState(panelFor(initialTab));

  useEffect(() => { setPanel(panelFor(initialTab)); }, [initialTab]);

  const [picks, setPicks] = useState([]);
  const [waves, setWaves] = useState([]);
  const [picklists, setPicklists] = useState([]);
  const [showActivity, setShowActivity] = useState(false);
  const [skus, setSkus] = useState([]);
  const [staff, setStaff] = useState([]);
  const [assignBusy, setAssignBusy] = useState('');

  const [loading, setLoading] = useState(true);
  // Per-read readiness so each panel renders the moment its own fetch lands
  // instead of waiting on the slowest one (the user list takes ~16s).
  const [ready, setReady] = useState({ waves: false, skus: false, picklists: false });
  // One error slot per section: a failing read never blanks the other table.
  const [errs, setErrs] = useState({ picks: '', waves: '', skus: '', picklists: '' });
  const hasErr = Boolean(errs.picks || errs.waves || errs.skus || errs.picklists);

  const [tableFilter, setTableFilter] = useState('');

  // The pick task read back from the API after completing it.
  const [result, setResult] = useState(null);
  const [busyId, setBusyId] = useState('');

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
    setErrs({ picks: '', waves: '', skus: '', picklists: '' });
    setReady({ waves: false, skus: false, picklists: false });

    // Each secondary read settles on its own: one slow endpoint (the 500-row
    // user list has taken ~16s) must not hold the picklist summary or the
    // wave table hostage behind it. The pick queue is read first so the
    // operator sees work as soon as it lands.
    fetchApi('/ds-ops/sorting-waves/?page_size=200').then(
      (payload) => {
        try { setWaves(asList(payload, '/ds-ops/sorting-waves/')); }
        catch (e) { setErrs((prev) => ({ ...prev, waves: describeError(e) })); }
        setReady((prev) => ({ ...prev, waves: true }));
      },
      (e) => {
        setErrs((prev) => ({ ...prev, waves: describeError(e) }));
        setReady((prev) => ({ ...prev, waves: true }));
      }
    );
    fetchApi('/catalog/skus/?page_size=500').then(
      (payload) => {
        try { setSkus(asList(payload, '/catalog/skus/')); }
        catch (e) { setErrs((prev) => ({ ...prev, skus: describeError(e) })); }
        setReady((prev) => ({ ...prev, skus: true }));
      },
      (e) => {
        setErrs((prev) => ({ ...prev, skus: describeError(e) }));
        setReady((prev) => ({ ...prev, skus: true }));
      }
    );
    // The assignee dropdown's staff list — independent of the pick data.
    fetchApi('/iam/users/?page_size=500').then(
      (payload) => {
        try {
          setStaff(asList(payload, '/iam/users/').filter((u) => u.role !== 'CUSTOMER'));
        } catch (e) { /* an unavailable staff list degrades to unassignable rows */ }
      },
      () => {}
    );
    // One row per picklist, grouped server-side (see the `picklists`
    // action). Grouping in the browser from a capped line page would
    // silently drop picklists once the page fills.
    fetchApi('/ds-ops/pick-tasks/picklists/').then(
      (payload) => {
        try {
          if (!Array.isArray(payload)) {
            throw new Error('/ds-ops/pick-tasks/picklists/ returned an unrecognised payload shape.');
          }
          setPicklists(payload);
        } catch (e) { setErrs((prev) => ({ ...prev, picklists: describeError(e) })); }
        setReady((prev) => ({ ...prev, picklists: true }));
      },
      (e) => {
        setErrs((prev) => ({ ...prev, picklists: describeError(e) }));
        setReady((prev) => ({ ...prev, picklists: true }));
      }
    );

    const statusLists = await Promise.all(
      OPEN_PICK.map((s) =>
        fetchApi(`/ds-ops/pick-tasks/?status=${s}&page_size=200`).then(
          (payload) => ({ payload, err: '' }),
          (e) => ({ payload: null, err: `${describeError(e)}` })
        )
      )
    );

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

    const pickError = pickErrors.join(' — ');
    if (!pickError) setPicks(open);
    setErrs((prev) => ({ ...prev, picks: pickError }));
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

  /* ── complete a pick ── */

  const completePick = async (row) => {
    const id = row?.id;
    // Never build /ds-ops/pick-tasks/undefined/complete/ — that 404s.
    if (id === undefined || id === null || id === '') {
      toast.error('Cannot complete pick', 'This pick row has no id.');
      return;
    }
    setBusyId(String(id));
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
      toast.error('Could not complete pick', describeError(e));
    } finally {
      setBusyId('');
    }
  };

  /** Named per section, so the operator knows which read failed. */
  const sectionErrors = [
    errs.picks ? `open picks — ${errs.picks}` : '',
    errs.waves ? `sorting waves — ${errs.waves}` : '',
    errs.picklists ? `picklist summary — ${errs.picklists}` : '',
    errs.skus ? `SKU catalog — ${errs.skus} (pick rows show the raw sku id instead)` : '',
  ].filter(Boolean).join(' · ');

  /* ── picker activity: open lines per picker, from the summary payload ── */
  const pickerActivity = useMemo(() => {
    const byPicker = new Map();
    let unassigned = 0;
    picklists.forEach((pl) => {
      if (!pl.pickers?.length) {
        unassigned += Number(pl.open_lines) || 0;
        return;
      }
      pl.pickers.forEach((name) => {
        if (!byPicker.has(name)) byPicker.set(name, { name, picklists: 0, lines: 0, qty: 0 });
        const entry = byPicker.get(name);
        entry.picklists += 1;
        entry.lines += Number(pl.open_lines) || 0;
        entry.qty += Number(pl.pending_qty) || 0;
      });
    });
    return { byPicker: [...byPicker.values()].sort((a, b) => b.lines - a.lines), unassigned };
  }, [picklists]);

  /* ── drill from a summary row into its lines ── */
  const openPicklistLines = (pl) => {
    if (!pl?.picklist_id) return;
    setPanel('picks');
    setTableFilter(String(pl.picklist_id).slice(0, 8));
  };

  const filterText = tableFilter.trim().toLowerCase();
  const filteredPicks = filterText
    ? picks.filter((p) => [
        p.id, p.picklist, p.status, p.bin, p.assigned_to,
        skuFor(p.sku)?.sku_code, skuFor(p.sku)?.name,
      ].some((v) => String(v ?? '').toLowerCase().includes(filterText)))
    : picks;

  const panelTitles = {
    picklists: ['Picking Summary', 'Open picklists grouped server-side by picklist. Opening a row drills into its lines below.'],
    picks: ['Picklists', 'Open pick lines from the fulfilment service.'],
    waves: ['Sorting Waves', 'Open sorting waves from the fulfilment service.'],
  };
  const [headTitle, headSubtitle] = panelTitles[panel] || panelTitles.picklists;

  return (
    <div data-testid="pq-root" data-loading={loading ? 'true' : 'false'}>
      <PageHead
        title={headTitle}
        count={panel === 'waves' ? waves.length : panel === 'picklists' ? picklists.length : picks.length}
        subtitle={headSubtitle}
        actions={(
          <button className="btn-ui" onClick={load} disabled={loading} data-testid="pq-refresh-tabs">
            <RefreshCw size={13} /> Sync
          </button>
        )}
      />
      {/* ── Which queue this destination opens with ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="subtabs-bar" style={{ marginBottom: 0 }} data-testid="pq-tabs">
          <button type="button" className={`subtab-btn ${panel === 'picklists' ? 'active' : ''}`}
            data-testid="pq-tab-picklists" onClick={() => setPanel('picklists')}>
            Picklists
          </button>
          <button type="button" className={`subtab-btn ${panel === 'picks' ? 'active' : ''}`}
            data-testid="pq-tab-picks" onClick={() => setPanel('picks')}>
            Pick lines
          </button>
          <button type="button" className={`subtab-btn ${panel === 'waves' ? 'active' : ''}`}
            data-testid="pq-tab-waves" onClick={() => setPanel('waves')}>
            Sorting waves
          </button>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading} data-testid="pq-refresh-tabs"
          title="Reload both queues">
          <RefreshCw size={14} /> Refresh
        </button>
        <button
          type="button"
          className={`btn-secondary ${showActivity ? 'btn-ui primary' : ''}`}
          onClick={() => setShowActivity((v) => !v)}
          data-testid="pq-activity-toggle"
          title="Open lines per picker"
        >
          Picker activity
        </button>
      </div>

      {/* ── picker activity ── */}
      {showActivity && (
        <div className="wf-panel" data-testid="pq-activity">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek">Picker activity</div>
              <div className="wf-panel__hint">
                Open lines per picker across the picklist summary. Counts only assigned picklists.
              </div>
            </div>
          </div>
          {pickerActivity.byPicker.length === 0 ? (
            <div style={{ fontSize: 12, color: '#64748b', padding: '8px 0' }}>
              No picker is assigned to an open picklist right now.
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table" data-testid="pq-activity-table">
                <thead>
                  <tr>
                    <th>Picker</th>
                    <th style={{ textAlign: 'right' }}>Picklists</th>
                    <th style={{ textAlign: 'right' }}>Open lines</th>
                    <th style={{ textAlign: 'right' }}>Pending units</th>
                  </tr>
                </thead>
                <tbody>
                  {pickerActivity.byPicker.map((p) => (
                    <tr key={p.name} data-testid={`pq-activity-${p.name}`}>
                      <td>{p.name}</td>
                      <td className="mono-num" style={{ textAlign: 'right' }}>{p.picklists}</td>
                      <td className="mono-num" style={{ textAlign: 'right' }}>{p.lines}</td>
                      <td className="mono-num" style={{ textAlign: 'right' }}>{p.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pickerActivity.unassigned > 0 && (
            <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 8 }}>
              {pickerActivity.unassigned} open line{pickerActivity.unassigned === 1 ? '' : 's'} unassigned.
            </div>
          )}
        </div>
      )}

      {/* ── 0. Open picklists, one row per picklist ── */}
      {panel === 'picklists' && (
      <div className="wf-panel" data-testid="pq-picklists-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-peek">Open picklists</div>
            <div className="wf-panel__hint">
              {!ready.picklists && !errs.picklists
                ? 'Loading picklist summary…'
                : errs.picklists
                  ? 'Picklist summary failed — the queues below are unaffected'
                  : `${picklists.length} picklist${picklists.length === 1 ? '' : 's'} with unfinished lines`}
            </div>
          </div>
        </div>

        {errs.picklists && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="pq-picklists-error">
              <AlertTriangle size={14} /> <span>Could not read the picklist summary — {errs.picklists}</span>
            </div>
          </div>
        )}

        {!ready.picklists && !errs.picklists && picklists.length === 0 && (
          <div style={{ fontSize: 12, color: '#64748b', padding: '10px 0' }}>Loading picklist summary…</div>
        )}

        {ready.picklists && !errs.picklists && picklists.length === 0 && (
          <div className="wf-empty" data-testid="pq-picklists-empty">
            <ClipboardList size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">No open picklists</div>
            <div className="wf-empty__text">
              Every picklist is COMPLETED or CANCELLED. The summary only answers for
              unfinished work, so finished history cannot masquerade as open work.
            </div>
          </div>
        )}

        {picklists.length > 0 && (
          <div className="table-container">
            <table className="data-table" data-testid="pq-picklists">
              <thead>
                <tr>
                  <th>Picklist ID</th>
                  <th>Site</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Assigned</th>
                  <th style={{ textAlign: 'right' }}>Picked / Pending</th>
                  <th style={{ textAlign: 'right' }}>Short</th>
                  <th>Picker</th>
                  <th>Zone</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {picklists.map((pl) => {
                  const id = String(pl.picklist_id ?? '');
                  return (
                    <tr
                      key={id}
                      data-testid={`pq-picklist-${id}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => openPicklistLines(pl)}
                      title="Open this picklist's lines"
                    >
                      <td><span className="code-cell">{id.slice(0, 8)}</span></td>
                      <td className="mono-num">{pl.site_code || '—'}</td>
                      <td><StatusBadge status={pl.status} dataTestId={`pq-picklist-status-${id}`} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 13 }}>
                          {Number(pl.assigned_qty) || 0}
                        </div>
                        <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 600 }}>
                          {Number(pl.sku_count) || 0} SKUs · {Number(pl.lines) || 0} lines
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12.5 }}>
                          <span style={{ color: '#047857', fontWeight: 700 }}>{Number(pl.picked_qty) || 0}</span>
                          <span style={{ color: '#94a3b8' }}> / </span>
                          <span style={{ color: Number(pl.pending_qty) > 0 ? '#dc2626' : '#64748b', fontWeight: 700 }}>
                            {Number(pl.pending_qty) || 0}
                          </span>
                        </div>
                        <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 600 }}>
                          {Number(pl.short_qty) || 0} Short
                        </div>
                      </td>
                      <td className="mono-num" style={{ textAlign: 'right' }}>{Number(pl.short_qty) || 0}</td>
                      <td style={{ fontSize: 12 }}>{(pl.pickers || []).join(', ') || '—'}</td>
                      <td style={{ fontSize: 12 }}>{(pl.zones || []).join(', ') || '—'}</td>
                      <td className="mono-num">{dt(pl.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {hasErr && (
        <div className="form-group">
          <div className="scan-feedback scan-feedback--error" data-testid="pq-load-error">
            <AlertTriangle size={14} />
            <span data-testid="pq-load-error-text">{sectionErrors}</span>
          </div>
        </div>
      )}

      {/* ── 1. Open picks ── */}
      {panel === 'picks' && (
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div >
            <div className="wf-peek"> Open picks</div>
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
          <>
            <FilterBar value={tableFilter} onChange={setTableFilter} shown={filteredPicks.length} total={picks.length} />
            <div className="table-container" id="pq-picks-table">
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
                {filteredPicks.map((p) => {
                  const id = String(p.id);
                  const sku = skuFor(p.sku);
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
                    >
                      <td>
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
          </>
        )}
      </div>
      )}

      {/* ── 2. Sorting waves ── */}
      {panel === 'waves' && (
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div >
            <div className="wf-peek"> Sorting waves</div>
            <div className="wf-panel__hint">
              {!ready.waves && !errs.waves
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

        {ready.waves && !errs.waves && waves.length === 0 && (
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
              <div className="wf-peek"> Last persisted pick</div>
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

      {!loading && ready.picklists && ready.waves && !hasErr && picks.length === 0 && waves.length === 0 && picklists.length === 0 && (
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
