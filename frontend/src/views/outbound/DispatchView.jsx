import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Truck, RefreshCw, AlertTriangle, CheckCircle2, Boxes, ScanLine, Route, Search, Package } from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';

/**
 * Dispatch board for the mother hub: everything that can physically leave the
 * site, as a real table, with scanning as an ADDITIONAL way to point at a row.
 *
 * Three independent record families are on this screen and none of them is
 * invented:
 *
 *   TransferOrder   the outbound lane itself (PK `transfer_id`). `dispatch` is a
 *                   real @action on TransferOrderViewSet that flips the order to
 *                   IN_TRANSIT and publishes every LPN packed against it.
 *   Batch           a shipment batch at this site (PK `batch_id`, human code
 *                   `batch_no`). `dispatch` closes it — Batch.STATUS_CHOICES has
 *                   no IN_TRANSIT, so dispatched == CLOSED here.
 *   RoutePlan       a rider's trip (PK `route_id`). See ROUTE_IN_TRANSIT below.
 *
 * Every primary key used in a URL below is the SERIALIZER field name. The old
 * monolith passed `r.id` against a `batch_id` PK and produced
 * `PATCH /fulfilment/batches/undefined/ -> 404`, so each action re-checks its
 * own id and refuses to build a URL without one.
 */

/**
 * Transfer states whose stock is physically at the dock and may leave.
 *
 * Each is fetched with its own server-side filter. TransferOrder ordering is
 * -created_at, so an unfiltered first page in a database where the pipeline has
 * already run is nothing but RECEIVED/CLOSED history and open work looks empty.
 */
const READY_STATUS = ['PACKED', 'LOADED', 'SORTED', 'PACKING'];

/** Batch statuses that still represent work at this site. CLOSED is history. */
const BATCH_OPEN = ['UPLOADED', 'ALLOCATING', 'ALLOCATED', 'IN_PROGRESS'];

/**
 * RoutePlan.STATUS_CHOICES is PLANNED / IN_PROGRESS / COMPLETED / ABORTED —
 * there is no IN_TRANSIT. PATCHing `status: 'IN_TRANSIT'` was verified against
 * the running API and is rejected:
 *   PATCH /delivery/route-plans/{route_id}/ {"status":"IN_TRANSIT"}
 *   -> 400 {"status": ["\"IN_TRANSIT\" is not a valid choice."]}
 * `IN_PROGRESS` is the real "on the road, running" state for this model, so
 * that is what "Mark in transit" writes. Do not change this without a backend
 * migration adding IN_TRANSIT to RoutePlan.STATUS_CHOICES.
 */
const ROUTE_IN_TRANSIT = 'IN_PROGRESS';

const norm = (v) => String(v ?? '').trim().toUpperCase();

/**
 * unwrapList() returns null for a payload shape it does not recognise. Collapsing
 * that to [] makes a broken endpoint indistinguishable from an empty queue, so an
 * unrecognisable shape is raised and surfaced instead of silently emptying a
 * table.
 */
function asList(payload, what) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${what} returned an unrecognised payload shape.`);
  return rows;
}

const dt = (v) => (v ? new Date(v).toLocaleString() : '—');

export default function DispatchView() {
  const toast = useToast();

  const [transfers, setTransfers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [sites, setSites] = useState([]);
  const [riders, setRiders] = useState([]);
  const [lpns, setLpns] = useState([]);

  const [loading, setLoading] = useState(true);
  // One error slot per section, so one failing endpoint never blanks the board.
  const [errs, setErrs] = useState({ transfers: '', batches: '', routes: '', refs: '' });
  const hasErr = Boolean(errs.transfers || errs.batches || errs.routes || errs.refs);

  const [scanText, setScanText] = useState('');
  const [feedback, setFeedback] = useState(null);

  // { kind: 'transfer' | 'batch' | 'route', key: string, label: string }
  const [hit, setHit] = useState(null);
  // The record read back from the API after a mutation, so what is shown is what
  // the database holds rather than what the POST body claimed.
  const [result, setResult] = useState(null);
  const [busyId, setBusyId] = useState('');

  const hitRef = useRef(null);

  /**
   * Every group settles on its own.
   *
   * A single Promise.all over nine endpoints meant one transient 500 from the
   * backend wiped all three tables and left the operator with nothing but an
   * error banner. The three work queues load and fail independently, and the
   * reference lookups (site codes, rider names, tote register) are decoration
   * only — if those fail the rows still render with the raw uuid, which is a
   * true value, rather than the table disappearing.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setErrs({ transfers: '', batches: '', routes: '', refs: '' });

    const [transferRes, batchRes, routeRes, refRes] = await Promise.all([
      Promise.all(
        READY_STATUS.map((s) =>
          fetchApi(`/ds-ops/transfer-orders/?status=${s}&page_size=100`).then(
            (payload) => ({ payload, err: '' }),
            (e) => ({ payload: null, err: `${describeError(e)}` })
          )
        )
      ),
      fetchApi('/fulfilment/batches/?page_size=200').then(
        (payload) => ({ payload, err: '' }),
        (e) => ({ payload: null, err: `${describeError(e)}` })
      ),
      fetchApi('/delivery/route-plans/?page_size=200').then(
        (payload) => ({ payload, err: '' }),
        (e) => ({ payload: null, err: `${describeError(e)}` })
      ),
      Promise.all([
        fetchApi('/network/sites/?page_size=200'),
        fetchApi('/delivery/rider-profiles/?page_size=200'),
        // LpnMasterViewSet.filterset_fields is ['status','lpn_type','current_site']
        // — `transfer` is NOT filterable and `?transfer=` is silently ignored
        // (verified: ?transfer=<ffec> returns the same 45 rows as no filter).
        // So the whole register is read once and grouped client-side below.
        fetchApi('/inventory/lpns/?page_size=500'),
      ]).then(
        ([siteRows, riderRows, lpnRows]) => ({ siteRows, riderRows, lpnRows, err: '' }),
        (e) => ({ siteRows: null, riderRows: null, lpnRows: null, err: `${describeError(e)}` })
      ),
    ]);

    const seen = new Set();
    const open = [];
    const transferErrors = [];
    transferRes.forEach((res, i) => {
      if (res.err) {
        transferErrors.push(`${READY_STATUS[i]}: ${res.err}`);
        return;
      }
      try {
        asList(res.payload, `/ds-ops/transfer-orders/?status=${READY_STATUS[i]}`).forEach((t) => {
          const id = String(t.transfer_id ?? '');
          if (!id || seen.has(id)) return;
          seen.add(id);
          open.push(t);
        });
      } catch (e) {
        transferErrors.push(`${READY_STATUS[i]}: ${describeError(e)}`);
      }
    });

    const next = { transfers: '', batches: '', routes: '', refs: refRes.err };
    if (transferErrors.length) next.transfers = transferErrors.join(' — ');
    if (batchRes.err) next.batches = batchRes.err;
    if (routeRes.err) next.routes = routeRes.err;

    if (!next.transfers) setTransfers(open);
    if (!batchRes.err) {
      try {
        setBatches(asList(batchRes.payload, '/fulfilment/batches/'));
      } catch (e) {
        next.batches = describeError(e);
      }
    }
    if (!routeRes.err) {
      try {
        setRoutes(asList(routeRes.payload, '/delivery/route-plans/'));
      } catch (e) {
        next.routes = describeError(e);
      }
    }
    if (!refRes.err) {
      setSites(asList(refRes.siteRows, '/network/sites/'));
      setRiders(asList(refRes.riderRows, '/delivery/rider-profiles/'));
      setLpns(asList(refRes.lpnRows, '/inventory/lpns/'));
    }

    setErrs(next);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const siteById = useMemo(() => {
    const map = {};
    sites.forEach((s) => { map[String(s.site_id)] = s; });
    return map;
  }, [sites]);

  const riderById = useMemo(() => {
    const map = {};
    riders.forEach((r) => { map[String(r.rider_id)] = r; });
    return map;
  }, [riders]);

  /** Real LPNs naming each transfer. Never invented from the transfer id. */
  const lpnsByTransfer = useMemo(() => {
    const map = new Map();
    lpns.forEach((l) => {
      const key = String(l.transfer ?? '');
      if (!key) return;
      map.set(key, [...(map.get(key) || []), l]);
    });
    return map;
  }, [lpns]);

  const siteCode = useCallback((id) => siteById[String(id ?? '')]?.code || null, [siteById]);

  /* ── scroll the scanned row into view once React has painted it ── */
  useEffect(() => {
    if (!hit) return;
    const raf = requestAnimationFrame(() => {
      const el = hitRef.current?.querySelector('[data-scan-hit="true"]');
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [hit]);

  /* ── the one scan input: select/highlight a row, never gate the tables ── */

  const onScan = (code) => {
    const want = norm(code);
    if (!want) return;

    const matchLpn = lpns.find(
      (l) => [l.barcode, l.lpn_id].some((v) => norm(v) === want)
    );

    if (matchLpn) {
      const owner = transfers.find(
        (t) => String(t.transfer_id) === String(matchLpn.transfer ?? '')
      );
      setHit(
        owner
          ? { kind: 'transfer', key: String(owner.transfer_id), label: `LPN ${matchLpn.lpn_id} · transfer ${String(owner.transfer_id).slice(0, 8)}` }
          : { kind: 'transfer', key: String(matchLpn.transfer ?? ''), label: `LPN ${matchLpn.lpn_id}` }
      );
      hitRef.current = document.getElementById('dispatch-transfers-table');
      setFeedback({
        type: 'ok',
        message: owner
          ? `LPN ${matchLpn.lpn_id} (${matchLpn.status}) → transfer ${String(owner.transfer_id).slice(0, 8)} highlighted.`
          : `LPN ${matchLpn.lpn_id} (${matchLpn.status}) matched, but no ready transfer on this board names it.`,
      });
      setScanText('');
      return;
    }

    const t = transfers.find(
      (x) =>
        norm(x.transfer_id) === want ||
        (want.length >= 8 && String(x.transfer_id).slice(0, 8).toUpperCase() === want)
    );
    if (t) {
      hitRef.current = document.getElementById('dispatch-transfers-table');
      setHit({ kind: 'transfer', key: String(t.transfer_id), label: `Transfer ${String(t.transfer_id).slice(0, 8)}` });
      setFeedback({ type: 'ok', message: `Transfer ${String(t.transfer_id).slice(0, 8)} (${t.status}) highlighted.` });
      setScanText('');
      return;
    }

    const b = batches.find(
      (x) => norm(x.batch_no) === want || norm(x.batch_id) === want
    );
    if (b) {
      hitRef.current = document.getElementById('dispatch-batches-table');
      setHit({ kind: 'batch', key: String(b.batch_id), label: `Batch ${b.batch_no}` });
      setFeedback({ type: 'ok', message: `Batch ${b.batch_no} (${b.status}) highlighted.` });
      setScanText('');
      return;
    }

    const r = routes.find((x) => norm(x.route_id) === want);
    if (r) {
      hitRef.current = document.getElementById('dispatch-routes-table');
      setHit({ kind: 'route', key: String(r.route_id), label: `Route ${String(r.route_id).slice(0, 8)}` });
      setFeedback({ type: 'ok', message: `Route ${String(r.route_id).slice(0, 8)} (${r.status}) highlighted.` });
      setScanText('');
      return;
    }

    setHit(null);
    setFeedback({
      type: 'error',
      message: `No dispatch record matches “${String(code).trim()}”. Scan a batch number, a transfer id, a route id or a tote barcode.`,
    });
  };

  /* ── actions ── */

  const dispatchTransfer = async (row) => {
    const id = row?.transfer_id;
    // Never build /ds-ops/transfer-orders/undefined/dispatch/ — that 404s.
    if (!id) {
      toast.error('Cannot dispatch', 'This transfer row has no transfer_id.');
      setFeedback({ type: 'error', message: 'This transfer row has no transfer_id, so there is nothing to dispatch.' });
      return;
    }
    setBusyId(`transfer:${id}`);
    setFeedback(null);
    try {
      await postApi(`/ds-ops/transfer-orders/${encodeURIComponent(String(id))}/dispatch/`, {});
      // Read the persisted row back and reload the board, so the table shows what
      // the database holds rather than what the action claimed.
      const persisted = await fetchApi(
        `/ds-ops/transfer-orders/${encodeURIComponent(String(id))}/`
      );
      await load();
      setResult({
        kind: 'transfer',
        title: `Transfer ${String(persisted.transfer_id ?? id).slice(0, 8)}`,
        status: persisted.status ?? 'unknown',
        detail: [
          `Total qty ${persisted.total_qty ?? '—'}`,
          `${siteCode(persisted.source_site) || '—'} → ${siteCode(persisted.dest_site) || '—'}`,
        ],
      });
      toast.success('Transfer dispatched', `${String(persisted.transfer_id ?? id).slice(0, 8)} is now ${persisted.status}.`);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
      toast.error('Dispatch failed', describeError(e));
    } finally {
      setBusyId('');
    }
  };

  const dispatchBatch = async (row) => {
    const id = row?.batch_id;
    if (!id) {
      toast.error('Cannot dispatch', 'This batch row has no batch_id.');
      setFeedback({ type: 'error', message: 'This batch row has no batch_id, so there is nothing to dispatch.' });
      return;
    }
    setBusyId(`batch:${id}`);
    setFeedback(null);
    try {
      await postApi(`/fulfilment/batches/${encodeURIComponent(String(id))}/dispatch/`, {});
      const persisted = await fetchApi(
        `/fulfilment/batches/${encodeURIComponent(String(id))}/`
      );
      await load();
      setResult({
        kind: 'batch',
        title: `Batch ${persisted.batch_no ?? row.batch_no ?? id}`,
        status: persisted.status ?? 'unknown',
        detail: [
          `Ordered ${persisted.ordered_qty ?? '—'}`,
          `Picked ${persisted.picked_qty ?? '—'}`,
          `Sorted ${persisted.sorted_qty ?? '—'}`,
        ],
      });
      toast.success('Batch dispatched', `${persisted.batch_no ?? row.batch_no} is now ${persisted.status}.`);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
      toast.error('Dispatch failed', describeError(e));
    } finally {
      setBusyId('');
    }
  };

  const markRouteInTransit = async (row) => {
    const id = row?.route_id;
    if (!id) {
      toast.error('Cannot update route', 'This route row has no route_id.');
      setFeedback({ type: 'error', message: 'This route row has no route_id, so it cannot be updated.' });
      return;
    }
    setBusyId(`route:${id}`);
    setFeedback(null);
    try {
      const saved = await patchApi(
        `/delivery/route-plans/${encodeURIComponent(String(id))}/`,
        { status: ROUTE_IN_TRANSIT }
      );
      await load();
      setResult({
        kind: 'route',
        title: `Route ${String(saved.route_id ?? id).slice(0, 8)}`,
        status: saved.status ?? 'unknown',
        detail: [
          `Stops ${saved.stop_count ?? '—'}`,
          `${saved.total_distance_m ?? '—'} m`,
          `${saved.estimated_min ?? '—'} min est.`,
        ],
      });
      toast.success('Route in transit', `${String(saved.route_id ?? id).slice(0, 8)} is now ${saved.status}.`);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
      toast.error('Route update failed', describeError(e));
    } finally {
      setBusyId('');
    }
  };

  /* ── row helpers ── */
  const isHit = (kind, key) => hit?.kind === kind && hit?.key === String(key);

  const hitCell = (kind, key) =>
    isHit(kind, key) ? (
      <span className="status-badge status-badge--accent" data-testid="dispatch-scan-match">
        Scan match
      </span>
    ) : null;

  const readyCount = transfers.length;
  const openBatches = batches.filter((b) => BATCH_OPEN.includes(String(b.status).toUpperCase())).length;

  /** Named per section, so the operator knows which read failed. */
  const sectionErrors = [
    errs.transfers ? `transfers — ${errs.transfers}` : '',
    errs.batches ? `shipment batches — ${errs.batches}` : '',
    errs.routes ? `route plans — ${errs.routes}` : '',
    errs.refs ? `site / rider / tote lookups — ${errs.refs} (rows below show the raw ids instead)` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div data-testid="dispatch-root" data-loading={loading ? 'true' : 'false'}>
      {/* ── Scan: a pointer at the tables below, not a gate in front of them ── */}
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><ScanLine size={17} /> Dispatch board</div>
            <div className="wf-panel__hint">
              Every row below is real API data. Scanning is optional — it highlights the matching row.
            </div>
          </div>
          <div className="wf-panel__actions">
            <button className="btn-secondary" onClick={load} disabled={loading} data-testid="dispatch-refresh">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <ScanInput
          label="Scan a batch no · transfer id · route id · tote barcode"
          placeholder="Scan or type a code, then press Enter"
          value={scanText}
          onChange={setScanText}
          onScan={onScan}
          busy={false}
          feedback={feedback}
          hint="Tables below are always visible — scanning only points at a row."
          dataTestId="dispatch-scan"
        />

        {hasErr && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="dispatch-load-error">
              <AlertTriangle size={14} /> <span data-testid="dispatch-load-error-text">{sectionErrors}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── 1. Ready to dispatch: transfer orders ── */}
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><Truck size={17} /> Ready to dispatch — transfers out</div>
            <div className="wf-panel__hint">
              {loading
                ? 'Loading transfer orders…'
                : errs.transfers
                  ? 'Transfer read failed — the other tables below are unaffected'
                  : `${readyCount} transfer${readyCount === 1 ? '' : 's'} in ${READY_STATUS.join(' / ')}${errs.refs ? '' : ` · ${lpns.length} tote(s) on file`}`}
            </div>
          </div>
        </div>

        {errs.transfers && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="dispatch-transfers-error">
              <AlertTriangle size={14} /> <span>Could not read ready transfers — {errs.transfers}</span>
            </div>
          </div>
        )}

        {!loading && !errs.transfers && transfers.length === 0 && (
          <div className="wf-empty" data-testid="dispatch-transfers-empty">
            <Package size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">No open transfer to dispatch</div>
            <div className="wf-empty__text">
              A transfer appears here once it is PACKED, LOADED, SORTED or PACKING. RECEIVED and
              CLOSED history is excluded.
            </div>
          </div>
        )}

        {transfers.length > 0 && (
          <div className="table-container" id="dispatch-transfers-table">
            <table className="data-table" data-testid="dispatch-transfers">
              <thead>
                <tr>
                  <td>Transfer</td>
                  <td>Total qty</td>
                  <td>Source</td>
                  <td>Destination</td>
                  <td>Totes (LPNs)</td>
                  <td>Created</td>
                  <td>Status</td>
                  <td>Action</td>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => {
                  const id = String(t.transfer_id);
                  const mine = lpnsByTransfer.get(id) || [];
                  const matched = isHit('transfer', id);
                  return (
                    <tr
                      key={id}
                      data-testid={`dispatch-transfer-${id}`}
                      data-scan-hit={matched ? 'true' : undefined}
                      aria-selected={matched || undefined}
                    >
                      <td>
                        {hitCell('transfer', id)}
                        <div className="code-cell">{id.slice(0, 8)}</div>
                        <div className="mono-num">{id}</div>
                      </td>
                      <td className="mono-num" data-testid={`dispatch-transfer-qty-${id}`}>
                        {Number(t.total_qty) || 0}
                      </td>
                      <td>
                        <div className="code-cell">{siteCode(t.source_site) || String(t.source_site ?? '—')}</div>
                      </td>
                      <td>
                        <div className="code-cell">{siteCode(t.dest_site) || String(t.dest_site ?? '—')}</div>
                      </td>
                      <td data-testid={`dispatch-transfer-lpns-${id}`}>
                        {mine.length === 0 ? (
                          <span className="wf-panel__hint">no tote names this transfer</span>
                        ) : (
                          mine.map((l) => (
                            <span key={l.lpn_id} className="code-cell">{l.barcode || l.lpn_id}</span>
                          ))
                        )}
                        {mine.length > 0 && (
                          <div className="wf-panel__hint">
                            {mine.map((l) => l.status).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="mono-num">{dt(t.created_at)}</td>
                      <td><StatusBadge status={t.status} dataTestId={`dispatch-transfer-status-${id}`} /></td>
                      <td>
                        <button
                          className="btn-secondary"
                          onClick={() => dispatchTransfer(t)}
                          disabled={busyId !== ''}
                          data-testid={`dispatch-transfer-go-${id}`}
                          title={`POST /ds-ops/transfer-orders/${id}/dispatch/`}
                        >
                          <Truck size={14} /> Dispatch
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

      {/* ── 2. Shipment batches ── */}
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><Truck size={17} /> Shipment batches</div>
            <div className="wf-panel__hint">
              {loading
                ? 'Loading batches…'
                : errs.batches
                  ? 'Batch read failed — the other tables below are unaffected'
                  : `${batches.length} batch${batches.length === 1 ? '' : 'es'} · ${openBatches} still open at this site`}
            </div>
          </div>
        </div>

        {errs.batches && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="dispatch-batches-error">
              <AlertTriangle size={14} /> <span>Could not read shipment batches — {errs.batches}</span>
            </div>
          </div>
        )}

        {!loading && !errs.batches && batches.length === 0 && (
          <div className="wf-empty" data-testid="dispatch-batches-empty">
            <Package size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">No shipment batches</div>
            <div className="wf-empty__text">/fulfilment/batches/ returned no rows.</div>
          </div>
        )}

        {batches.length > 0 && (
          <div className="table-container" id="dispatch-batches-table">
            <table className="data-table" data-testid="dispatch-batches">
              <thead>
                <tr>
                  <td>Batch no</td>
                  <td>Batch id</td>
                  <td>Site</td>
                  <td>Type</td>
                  <td>Ordered</td>
                  <td>Picked</td>
                  <td>Sorted</td>
                  <td>Totes</td>
                  <td>Created</td>
                  <td>Status</td>
                  <td>Action</td>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const id = String(b.batch_id ?? '');
                  const matched = isHit('batch', id);
                  const closed = !BATCH_OPEN.includes(String(b.status).toUpperCase());
                  return (
                    <tr
                      key={id}
                      data-testid={`dispatch-batch-${id}`}
                      data-scan-hit={matched ? 'true' : undefined}
                      aria-selected={matched || undefined}
                    >
                      <td>
                        {hitCell('batch', id)}
                        <div className="code-cell" data-testid={`dispatch-batch-no-${id}`}>
                          {b.batch_no || String(b.batch_id)}
                        </div>
                      </td>
                      <td className="mono-num">{id.slice(0, 8)}</td>
                      <td>
                        <div className="code-cell">{siteCode(b.site) || String(b.site ?? '—')}</div>
                      </td>
                      <td>{b.type || '—'}</td>
                      <td className="mono-num">{Number(b.ordered_qty) || 0}</td>
                      <td className="mono-num">{Number(b.picked_qty) || 0}</td>
                      <td className="mono-num">{Number(b.sorted_qty) || 0}</td>
                      <td className="mono-num">{Number(b.totes) || 0}</td>
                      <td className="mono-num">{dt(b.created_at)}</td>
                      <td><StatusBadge status={b.status} dataTestId={`dispatch-batch-status-${id}`} /></td>
                      <td>
                        <button
                          className="btn-secondary"
                          onClick={() => dispatchBatch(b)}
                          disabled={closed || busyId !== ''}
                          data-testid={`dispatch-batch-go-${id}`}
                          title={
                            closed
                              ? `Batch is ${b.status}; only ${BATCH_OPEN.join(' / ')} can be dispatched.`
                              : `POST /fulfilment/batches/${id}/dispatch/ (marks the batch CLOSED)`
                          }
                        >
                          <Truck size={14} /> Dispatch
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

      {/* ── 3. Trips / route plans ── */}
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><Truck size={17} /> Trips — route plans</div>
            <div className="wf-panel__hint">
              {loading
                ? 'Loading route plans…'
                : errs.routes
                  ? 'Route read failed — the other tables below are unaffected'
                  : `${routes.length} route${routes.length === 1 ? '' : 's'} · "Mark in transit" writes IN_PROGRESS, the running state this model has`}
            </div>
          </div>
        </div>

        {errs.routes && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="dispatch-routes-error">
              <AlertTriangle size={14} /> <span>Could not read route plans — {errs.routes}</span>
            </div>
          </div>
        )}

        {!loading && !errs.routes && routes.length === 0 && (
          <div className="wf-empty" data-testid="dispatch-routes-empty">
            <Package size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">No route plans</div>
            <div className="wf-empty__text">/delivery/route-plans/ returned no rows.</div>
          </div>
        )}

        {routes.length > 0 && (
          <div className="table-container" id="dispatch-routes-table">
            <table className="data-table" data-testid="dispatch-routes">
              <thead>
                <tr>
                  <td>Route</td>
                  <td>Rider</td>
                  <td>Site</td>
                  <td>Stops</td>
                  <td>Distance</td>
                  <td>Est. min</td>
                  <td>Started</td>
                  <td>Status</td>
                  <td>Action</td>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => {
                  const id = String(r.route_id ?? '');
                  const matched = isHit('route', id);
                  const running = String(r.status).toUpperCase() === ROUTE_IN_TRANSIT;
                  const done = ['COMPLETED', 'ABORTED'].includes(String(r.status).toUpperCase());
                  return (
                    <tr
                      key={id}
                      data-testid={`dispatch-route-${id}`}
                      data-scan-hit={matched ? 'true' : undefined}
                      aria-selected={matched || undefined}
                    >
                      <td>
                        {hitCell('route', id)}
                        <div className="code-cell">{id.slice(0, 8)}</div>
                        <div className="mono-num">{id}</div>
                      </td>
                      <td data-testid={`dispatch-route-rider-${id}`}>
                        {riderById[String(r.rider ?? '')]?.name || String(r.rider ?? '—')}
                      </td>
                      <td>
                        <div className="code-cell">{siteCode(r.site) || String(r.site ?? '—')}</div>
                      </td>
                      <td className="mono-num">{Number(r.stop_count) || 0}</td>
                      <td className="mono-num">{r.total_distance_m ?? '—'}</td>
                      <td className="mono-num">{r.estimated_min ?? '—'}</td>
                      <td className="mono-num">{dt(r.started_at)}</td>
                      <td><StatusBadge status={r.status} dataTestId={`dispatch-route-status-${id}`} /></td>
                      <td>
                        <button
                          className="btn-secondary"
                          onClick={() => markRouteInTransit(r)}
                          disabled={running || busyId !== ''}
                          data-testid={`dispatch-route-go-${id}`}
                          title={
                            running
                              ? 'Already IN_PROGRESS.'
                              : done
                                ? `Route is ${r.status}; reopen it to PLANNED before dispatching again.`
                                : `PATCH /delivery/route-plans/${id}/ {"status":"${ROUTE_IN_TRANSIT}"}`
                          }
                        >
                          <Truck size={14} /> Mark in transit
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

      {/* ── last persisted result, read back from the API after a mutation ── */}
      {result && (
        <div className="wf-panel" data-testid="dispatch-result">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><CheckCircle2 size={17} /> Last persisted result</div>
              <div className="wf-panel__hint">Read back from the API after the write, not the request body</div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={() => setResult(null)} data-testid="dispatch-result-clear">
                Clear
              </button>
            </div>
          </div>
          <div className="entity-card">
            <div className="entity-card__thumb">
              {result.kind === 'batch' ? <Boxes size={20} /> : result.kind === 'route' ? <Route size={20} /> : <Truck size={20} />}
            </div>
            <div className="entity-card__body">
              <div className="entity-card__title mono-num" data-testid="dispatch-result-title">
                {result.title}
              </div>
              <div className="entity-card__meta">
                {result.detail.map((d) => <span key={d}>{d}</span>)}
              </div>
            </div>
            <div className="entity-card__actions">
              <StatusBadge status={result.status} dataTestId="dispatch-result-status" />
            </div>
          </div>
        </div>
      )}

      {!loading && !hasErr && readyCount === 0 && openBatches === 0 && (
        <div className="wf-panel">
          <div className="wf-empty" data-testid="dispatch-nothing-open">
            <Search size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">Nothing dispatchable right now</div>
            <div className="wf-empty__text">
              No transfer is in {READY_STATUS.join(' / ')} and no batch is in {BATCH_OPEN.join(' / ')}.
              The tables above still show every real batch and route so the board is never blank.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
