import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, History, AlertTriangle, Info } from 'lucide-react';
import DataTable from '../../components/ui/DataTable';
import {
  fetchApiPage, fetchApiOr, describeError,
} from '../../api/client';

/**
 * Shared shell behind the Inbound and Outbound ledger screens.
 *
 * The platform records who touched every operational row (created_by,
 * received_by, tested_by, confirmed_by, started_by, completed_by,
 * dispatched_by — stamped server-side, see bounded.iam.names), but those
 * columns only answer "who" if they render as people and only answer "when"
 * over a window. This screen is the read side of that contract:
 *
 *   * one filter bar (status / actor / date window) applied server-side, so
 *     a date range narrows the query instead of paging through everything;
 *   * bare UUIDs resolved to names through the endpoints' `*_name` fields;
 *   * related ids (site / SKU / ASN / order) resolved through small index
 *     maps loaded once, optional — a failed index degrades to a short id
 *     rather than breaking the screen;
 *   * up to PAGE_SIZE rows handed to DataTable for search/sort/client
 *     paging, with an explicit "showing X of Y" strip when the server holds
 *     more, because silently rendering page 1 of a ledger defeats the point.
 *
 * Each feed declares its endpoint, the actor column it filters on, and its
 * columns. Switching tabs resets the filters: a status valid for picks may
 * not exist on transfers, and carrying a window across feeds implies a
 * comparison the data cannot support.
 */

const PAGE_SIZE = 500;

function fmtWhen(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function shortId(value) {
  return value ? String(value).slice(0, 8) : '—';
}

/** Fetch an index map for one of INDEX_LOADERS; never throws. */
async function loadIndex(kind) {
  switch (kind) {
    case 'staff': {
      const rows = await fetchApiOr('/iam/users/?page_size=500', []);
      return {
        list: rows
          .filter((u) => u && u.role !== 'CUSTOMER')
          .map((u) => ({ id: u.user_id, label: u.full_name || u.email })),
        map: {},
      };
    }
    case 'sites': {
      const rows = await fetchApiOr('/network/sites/?page_size=500', []);
      return { list: [], map: Object.fromEntries(rows.map((s) => [s.site_id, s.code])) };
    }
    case 'skus': {
      const rows = await fetchApiOr('/catalog/skus/?page_size=500', []);
      return { list: [], map: Object.fromEntries(rows.map((s) => [s.sku_id, s.sku_code])) };
    }
    case 'asns': {
      const rows = await fetchApiOr('/supply/asns/?page_size=500', []);
      return { list: [], map: Object.fromEntries(rows.map((a) => [a.asn_id, a.asn_no])) };
    }
    case 'orders': {
      const rows = await fetchApiOr('/orders/orders/?page_size=500', []);
      return { list: [], map: Object.fromEntries(rows.map((o) => [o.order_id, o.order_no])) };
    }
    default:
      return { list: [], map: {} };
  }
}

export default function LedgerScreen({
  feeds,
  initialFeed,
  prefix,
  title,
  subtitle,
  indexes = [],
}) {
  const [activeFeedId, setActiveFeedId] = useState(initialFeed || feeds[0].id);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('ALL');
  const [actor, setActor] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [staff, setStaff] = useState([]);
  const [maps, setMaps] = useState({});
  const [indexesLoaded, setIndexesLoaded] = useState(false);

  const feed = useMemo(
    () => feeds.find((f) => f.id === activeFeedId) || feeds[0],
    [feeds, activeFeedId],
  );

  // Index maps are per-screen, not per-feed: load once, survive tab flips.
  useEffect(() => {
    let alive = true;
    (async () => {
      const results = await Promise.all(indexes.map((kind) => loadIndex(kind)));
      if (!alive) return;
      const nextMaps = {};
      let nextStaff = [];
      indexes.forEach((kind, i) => {
        nextMaps[kind] = results[i].map;
        if (kind === 'staff') nextStaff = results[i].list;
      });
      setMaps(nextMaps);
      setStaff(nextStaff);
      setIndexesLoaded(true);
    })();
    return () => { alive = false; };
  }, [indexes]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page_size', String(PAGE_SIZE));
      if (status !== 'ALL') params.set('status', status);
      if (actor !== 'ALL' && feed.actorParam) params.set(feed.actorParam, actor);
      const dateParam = feed.dateParam || 'created_at';
      if (dateFrom) params.set(`${dateParam}__gte`, `${dateFrom}T00:00:00`);
      if (dateTo) params.set(`${dateParam}__lte`, `${dateTo}T23:59:59`);
      const page = await fetchApiPage(`${feed.endpoint}?${params.toString()}`);
      setRows(page.results);
      setCount(page.count);
    } catch (e) {
      setRows([]);
      setCount(0);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [feed, status, actor, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const switchFeed = (id) => {
    setActiveFeedId(id);
    setStatus('ALL');
    setActor('ALL');
    setDateFrom('');
    setDateTo('');
  };

  const clearFilters = () => {
    setStatus('ALL');
    setActor('ALL');
    setDateFrom('');
    setDateTo('');
  };

  // Status options come from the rows actually in hand (like the stock
  // ledger does): the set of legal statuses differs per feed and no screen
  // should hardcode a list that drifts from the backend's choices.
  const statusOptions = useMemo(
    () => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(),
    [rows],
  );

  const columns = useMemo(
    () => (indexesLoaded ? feed.columns({ maps, fmtWhen, shortId }) : []),
    [feed, maps, indexesLoaded],
  );

  const filtersActive = status !== 'ALL' || actor !== 'ALL' || dateFrom || dateTo;
  const truncated = count > rows.length;

  return (
    <>
      <div className="subtabs-bar" style={{ marginBottom: 16 }}>
        {feeds.map((f) => (
          <button
            key={f.id}
            data-testid={`${prefix}-tab-${f.id}`}
            className={`subtab-btn ${activeFeedId === f.id ? 'active' : ''}`}
            onClick={() => switchFeed(f.id)}
          >
            {f.label}
          </button>
        ))}
        <button
          className="subtab-btn"
          data-testid={`${prefix}-refresh`}
          onClick={load}
          disabled={loading}
          style={{ marginLeft: 'auto' }}
        >
          <RefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><History size={17} /> {title}</div>
            <div className="wf-panel__hint">{feed.hint || subtitle}</div>
          </div>
          {filtersActive && (
            <div className="wf-panel__actions">
              <button
                className="btn-secondary"
                data-testid={`${prefix}-clear`}
                onClick={clearFilters}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        <div className="form-group">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="form-input"
              data-testid={`${prefix}-status`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ minHeight: 42, minWidth: 180 }}
              aria-label="Filter by status"
            >
              <option value="ALL">All statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select
              className="form-input"
              data-testid={`${prefix}-actor`}
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              style={{ minHeight: 42, minWidth: 220 }}
              aria-label="Filter by person"
            >
              <option value="ALL">All people</option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            <input
              type="date"
              className="form-input"
              data-testid={`${prefix}-from`}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ minHeight: 42 }}
              aria-label="From date"
            />
            <input
              type="date"
              className="form-input"
              data-testid={`${prefix}-to`}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ minHeight: 42 }}
              aria-label="To date"
            />
          </div>
        </div>

        {error && (
          <div className="scan-feedback scan-feedback--error" data-testid={`${prefix}-error`}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}
      </div>

      {!indexesLoaded || loading ? (
        <div className="wf-panel">
          <div className="scan-feedback scan-feedback--hint" data-testid={`${prefix}-loading`}>
            Loading ledger…
          </div>
        </div>
      ) : (
        <DataTable
          data-testid={`${prefix}-table`}
          title={`${feed.label} ledger`}
          subtitle={subtitle}
          columns={columns}
          data={rows}
          searchPlaceholder="Search this page…"
        />
      )}

      {indexesLoaded && !loading && truncated && (
        <div
          className="scan-feedback scan-feedback--hint"
          data-testid={`${prefix}-truncated`}
          style={{ marginTop: 12 }}
        >
          <Info size={14} /> Showing {rows.length} of {count.toLocaleString('en-IN')}{' '}
          records — narrow the date window to reach older ones.
        </div>
      )}
    </>
  );
}
