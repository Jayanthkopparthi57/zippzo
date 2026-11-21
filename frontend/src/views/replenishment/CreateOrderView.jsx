import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Truck, RefreshCw, AlertTriangle, Search, Trash2, Send, Building2, Package, CheckCircle2, Boxes, ArrowRight } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';
import { newId } from '../../utils/id';

/**
 * Build a replenishment (transfer) order from real, available inventory.
 *
 * Nothing here is invented: the product list is the live StockBalance ledger
 * for the source warehouse, read through /inventory/positions?site_code=&
 * container=BIN — the same rows the pick task will later decrement. The order
 * itself is the three real records the platform already uses:
 *
 *   TransferOrder  the replenishment itself (POST /ds-ops/transfer-orders/)
 *   PickTask       one line per product. picklist_id is a *required UUIDField*,
 *                  and `batch` carries the transfer id, which is what
 *                  PackSealView reads back with ?batch= to know what to pack.
 *   status         ALLOCATED -> PICKING once the lines exist, so the pick
 *                  queue has a genuinely releasable order behind it.
 */

/** PickTask.bin is max_length=50; a Location.location_id fits, a barcode may not. */
const BIN_MAX = 50;

const norm = (v) => String(v ?? '').trim().toUpperCase();

function asList(payload, what) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${what} returned an unrecognised payload shape.`);
  return rows;
}

/** Stable identity for a line: the stock row it was added from. */
const lineKey = (r) => `${r.sku}::${r.lot}::${r.container_ref || ''}`;

export default function CreateOrderView() {
  const toast = useToast();

  const [warehouses, setWarehouses] = useState([]);
  const [darkStores, setDarkStores] = useState([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [refError, setRefError] = useState('');

  const [sourceSite, setSourceSite] = useState('');
  const [destSite, setDestSite] = useState('');

  const [stock, setStock] = useState([]);
  const [stockError, setStockError] = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [query, setQuery] = useState('');

  const [lines, setLines] = useState([]);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [result, setResult] = useState(null);

  const loadRefs = useCallback(async () => {
    setLoadingRefs(true);
    setRefError('');
    try {
      // Both are real filterset fields on SiteViewSet. An unfiltered
      // /network/sites/ page is ordered by code and mixes every site type.
      const [mh, ds] = await Promise.all([
        fetchApi('/network/sites/?site_type=MH&page_size=200'),
        fetchApi('/network/sites/?site_type=DS&page_size=200'),
      ]);
      const mhList = asList(mh, '/network/sites/?site_type=MH');
      const dsList = asList(ds, '/network/sites/?site_type=DS');
      setWarehouses(mhList);
      setDarkStores(dsList);
      setSourceSite((prev) => prev || (mhList[0] ? String(mhList[0].site_id) : ''));
      setDestSite((prev) => prev || (dsList[0] ? String(dsList[0].site_id) : ''));
    } catch (e) {
      setRefError(describeError(e));
    } finally {
      setLoadingRefs(false);
    }
  }, []);

  useEffect(() => { loadRefs(); }, [loadRefs]);

  const source = useMemo(
    () => warehouses.find((s) => String(s.site_id) === String(sourceSite)) || null,
    [warehouses, sourceSite]
  );
  const destination = useMemo(
    () => darkStores.find((s) => String(s.site_id) === String(destSite)) || null,
    [darkStores, destSite]
  );

  /**
   * Real available stock at the source warehouse.
   *
   * /inventory/positions returns joined StockBalance rows (sku + lot + bin) and
   * already drops qty<=0, so what is shown is genuinely on the shelf right now.
   */
  const loadStock = useCallback(async (siteId) => {
    const site = warehouses.find((s) => String(s.site_id) === String(siteId));
    if (!site) {
      setStock([]);
      setStockError('Select a source warehouse first.');
      return;
    }
    setStockLoading(true);
    setStockError('');
    try {
      const rows = asList(
        await fetchApi(
          `/inventory/positions?site_code=${encodeURIComponent(site.code)}&container=BIN`
        ),
        '/inventory/positions'
      );
      setStock(rows);
    } catch (e) {
      setStock([]);
      setStockError(describeError(e));
    } finally {
      setStockLoading(false);
    }
  }, [warehouses]);

  useEffect(() => {
    if (sourceSite) loadStock(sourceSite);
    else setStock([]);
  }, [sourceSite, loadStock]);

  const availableByKey = useMemo(() => {
    const map = {};
    stock.forEach((r) => { map[lineKey(r)] = Number(r.qty) || 0; });
    return map;
  }, [stock]);

  const requestedByKey = useMemo(() => {
    const map = {};
    lines.forEach((l) => { map[lineKey(l)] = (map[lineKey(l)] || 0) + (Number(l.qty) || 0); });
    return map;
  }, [lines]);

  const visibleStock = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return stock;
    return stock.filter((r) =>
      `${r.sku_code ?? ''} ${r.sku_name ?? ''} ${r.batch_number ?? ''} ${r.location?.barcode ?? ''}`
        .toUpperCase()
        .includes(q)
    );
  }, [stock, query]);

  const reset = () => {
    setLines([]);
    setResult(null);
    setFeedback(null);
  };

  const addLine = (row) => {
    const key = lineKey(row);
    const available = availableByKey[key] ?? 0;
    const already = requestedByKey[key] || 0;
    if (already >= available) {
      setFeedback({
        type: 'error',
        message: `${row.sku_code} already has all ${available} available unit(s) on this order.`,
      });
      return;
    }
    setLines((prev) => [...prev, { ...row, qty: 1 }]);
    setFeedback({ type: 'ok', message: `${row.sku_code} added. Set the quantity and release the order.` });
  };

  const setLineQty = (row, rawQty) => {
    const key = lineKey(row);
    const available = availableByKey[key] ?? 0;
    const n = parseInt(rawQty, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setLines((prev) => prev.filter((l) => lineKey(l) !== key));
      return;
    }
    if (n > available) {
      setFeedback({
        type: 'error',
        message: `Only ${available} unit(s) of ${row.sku_code} are available in this bin/lot.`,
      });
      return;
    }
    setLines((prev) => prev.map((l) => (lineKey(l) === key ? { ...l, qty: n } : l)));
    setFeedback(null);
  };

  const removeLine = (row) => setLines((prev) => prev.filter((l) => lineKey(l) !== row));

  const totalQty = lines.reduce((t, l) => t + (Number(l.qty) || 0), 0);

  /* ── Create the transfer + its pick tasks, then read the result back ── */
  const createOrder = async () => {
    if (!source || !destination) {
      setFeedback({ type: 'error', message: 'Choose a source warehouse and a destination dark store.' });
      return;
    }
    if (String(source.site_id) === String(destination.site_id)) {
      setFeedback({ type: 'error', message: 'Source and destination must be different sites.' });
      return;
    }
    if (lines.length === 0) {
      setFeedback({ type: 'error', message: 'Add at least one product line from the available stock.' });
      return;
    }

    setCreating(true);
    setFeedback(null);
    try {
      const transfer = await postApi('/ds-ops/transfer-orders/', {
        source_site: source.site_id,
        dest_site: destination.site_id,
        status: 'ALLOCATED',
        total_qty: totalQty,
      });

      // PickTask.picklist_id is a required UUIDField — a "PL-1712" string is a
      // 400. One picklist per order, batch = the transfer id so packing can
      // find these lines again with ?batch=.
      const picklistId = newId();
      const created = [];
      for (const [i, line] of lines.entries()) {
        const task = await postApi('/ds-ops/pick-tasks/', {
          picklist_id: picklistId,
          batch: transfer.transfer_id,
          zone: null,
          sku: line.sku,
          lot: line.lot,
          bin: String(line.container_ref || line.location?.id || '').slice(0, BIN_MAX),
          qty: Number(line.qty),
          picked_qty: 0,
          short_qty: 0,
          pick_seq: i + 1,
          status: 'NOT_STARTED',
        });
        created.push(task);
      }

      // ALLOCATED -> PICKING: the pick queue offers this work for real.
      await patchApi(
        `/ds-ops/transfer-orders/${encodeURIComponent(transfer.transfer_id)}/`,
        { status: 'PICKING' }
      );

      // Read the persisted state back rather than reporting the POST bodies,
      // so what is on screen is what the database actually holds.
      const persisted = await fetchApi(
        `/ds-ops/transfer-orders/${encodeURIComponent(transfer.transfer_id)}/`
      );
      const persistedTasks = asList(
        await fetchApi(
          `/ds-ops/pick-tasks/?batch=${encodeURIComponent(transfer.transfer_id)}&page_size=200`
        ),
        '/ds-ops/pick-tasks/?batch='
      );

      setResult({
        transfer: persisted,
        picklistId,
        createdCount: created.length,
        persistedTasks,
      });
      setLines([]);
      toast.success(
        'Replenishment order created',
        `${persisted.transfer_id.slice(0, 8)} released to picking with ${created.length} line(s).`
      );
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
      toast.error('Could not create order', describeError(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-peek"> Replenishment Lane</div>
            <div className="wf-panel__hint">
              Mother hub warehouse → dark store, replenished from stock that is really on the shelf
            </div>
          </div>
          <div className="wf-panel__actions">
            <button className="btn-secondary" onClick={loadRefs} disabled={loadingRefs} data-testid="co-refresh-refs">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {refError && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="co-refs-error">
              <AlertTriangle size={14} /> {refError}
            </div>
          </div>
        )}

        <div className="wf-split">
          <div className="scan-field">
            <label className="scan-field-label" htmlFor="co-source">
              <Building2 size={13} /> Source warehouse (MH)
            </label>
            <select
              id="co-source"
              className="form-input"
              data-testid="co-source"
              value={sourceSite}
              onChange={(e) => { setSourceSite(e.target.value); setResult(null); setLines([]); }}
              disabled={loadingRefs}
            >
              <option value="">— Select source warehouse —</option>
              {warehouses.map((s) => (
                <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>

          <div className="scan-field">
            <label className="scan-field-label" htmlFor="co-dest">
              <Building2 size={13} /> Destination dark store (DS)
            </label>
            <select
              id="co-dest"
              className="form-input"
              data-testid="co-dest"
              value={destSite}
              onChange={(e) => { setDestSite(e.target.value); setResult(null); }}
              disabled={loadingRefs}
            >
              <option value="">— Select dark store —</option>
              {darkStores.map((s) => (
                <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {source && destination && (
          <div className="form-group">
            <div className="entity-card">
              <div className="entity-card__thumb"><Truck size={20} /></div>
              <div className="entity-card__body">
                <div className="entity-card__title">
                  {source.code} → {destination.code}
                </div>
                <div className="entity-card__meta">
                  <span className="mono-num" data-testid="co-lane">
                    {String(source.site_id).slice(0, 8)} → {String(destination.site_id).slice(0, 8)}
                  </span>
                  <span>
                    Available SKUs <strong data-testid="co-stock-count">{stock.length}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="wf-split">
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek"> Order Lines</div>
              <div className="wf-panel__hint">
                {lines.length
                  ? `${lines.length} line(s) · ${totalQty} unit(s)`
                  : 'No lines yet — add products from the available stock'}
              </div>
            </div>
            <div className="wf-panel__actions">
              <button
                className="btn-secondary"
                onClick={reset}
                disabled={creating || lines.length === 0}
                data-testid="co-clear"
              >
                <Trash2 size={14} /> Clear
              </button>
            </div>
          </div>

          {lines.length === 0 ? (
            <div className="wf-empty" data-testid="co-lines-empty">
              <Package size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">No lines</div>
              <div className="wf-empty__text">
                Add a product from the available stock panel. Quantities are capped at what the
                source warehouse actually holds.
              </div>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Batch</th>
                    <th>Bin</th>
                    <th>Available</th>
                    <th>Qty</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody data-testid="co-lines">
                  {lines.map((l) => (
                    <tr key={lineKey(l)} data-testid={`co-line-${lineKey(l)}`}>
                      <td data-testid={`co-line-name-${lineKey(l)}`}>{l.sku_name}</td>
                      <td className="code-cell">{l.sku_code}</td>
                      <td className="code-cell">{l.batch_number || '—'}</td>
                      <td className="code-cell">{l.location?.barcode || '—'}</td>
                      <td className="mono-num">{availableByKey[lineKey(l)] ?? 0}</td>
                      <td>
                        <input
                          id={`co-qty-${lineKey(l)}`}
                          className="form-input mono-num"
                          type="number"
                          min="1"
                          max={availableByKey[lineKey(l)] ?? 0}
                          value={l.qty}
                          onChange={(e) => setLineQty(l, e.target.value)}
                          data-testid={`co-line-qty-${lineKey(l)}`}
                          aria-label={`Quantity for ${l.sku_code}`}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => removeLine(l)}
                          data-testid={`co-line-remove-${lineKey(l)}`}
                          aria-label={`Remove ${l.sku_code}`}
                        >
                          <Trash2 size={14} /> Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="co-stock-search">Search available stock</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Search size={15} aria-hidden="true" />
              <input
                id="co-stock-search"
                className="form-input"
                type="search"
                placeholder="Search product name, SKU or batch"
                value={query}
                onChange={e => setQuery(e.target.value)}
                data-testid="co-stock-search"
              />
            </div>
            <small className="form-hint">Select a row in the available stock list to add it to this replenishment order.</small>
          </div>

          {feedback && (
            <div className="form-group">
              <div className={`scan-feedback scan-feedback--${feedback.type}`} data-testid="co-feedback">
                {feedback.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                <span>{feedback.message}</span>
              </div>
            </div>
          )}

          <div className="form-group wf-panel__actions">
            <button
              className="scan-btn scan-btn--success"
              onClick={createOrder}
              disabled={creating || lines.length === 0 || !source || !destination}
              data-testid="co-create"
            >
              <Send size={16} /> {creating ? 'Creating…' : 'Create & Release to Picking'}
            </button>
          </div>
        </div>

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek">
 Available at {source?.code || '—'}
              </div>
              <div className="wf-panel__hint">
                {stockLoading
                  ? 'Reading the position ledger…'
                  : `${visibleStock.length} stock row(s) in pick-face bins`}
              </div>
            </div>
            <div className="wf-panel__actions">
              <button
                className="btn-secondary"
                onClick={() => (sourceSite ? loadStock(sourceSite) : null)}
                disabled={stockLoading || !sourceSite}
                data-testid="co-refresh-stock"
              >
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {stockError && (
            <div className="form-group">
              <div className="scan-feedback scan-feedback--error" data-testid="co-stock-error">
                <AlertTriangle size={14} /> {stockError}
              </div>
            </div>
          )}

          {!stockError && !stockLoading && stock.length === 0 && (
            <div className="wf-empty" data-testid="co-stock-empty">
              <Boxes size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">No stock in pick-face bins</div>
              <div className="wf-empty__text">
                {source
                  ? `${source.code} reports no stock in BIN containers, so there is nothing real to replenish from.`
                  : 'Choose a source warehouse to read its stock.'}
              </div>
            </div>
          )}

          {stock.length > 0 && (
            <div className="form-group">
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Batch</th>
                      <th>Expiry</th>
                      <th>Added / Available</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody data-testid="co-stock">
                    {visibleStock.map((r) => {
                      const key = lineKey(r);
                      const added = requestedByKey[key] || 0;
                      const available = availableByKey[key] ?? 0;
                      return (
                        <tr
                          key={key}
                          data-testid={`co-stock-${key}`}
                          onClick={added >= available ? undefined : () => addLine(r)}
                          style={added >= available ? undefined : { cursor: 'pointer' }}
                        >
                          <td data-testid={`co-stock-${key}-name`}>{r.sku_name}</td>
                          <td className="code-cell">{r.sku_code}</td>
                          <td className="code-cell">{r.batch_number || '—'}</td>
                          <td className="code-cell">{r.expiry_date || '—'}</td>
                          <td className="mono-num" data-testid={`co-stock-${key}-qty`}>
                            {added} / {available}
                          </td>
                          <td><StatusBadge status={r.sellable ? 'SELLABLE' : 'HOLD'} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {visibleStock.length === 0 && (
                <div className="wf-empty" data-testid="co-stock-nomatch">
                  <Search size={32} className="wf-empty__icon" />
                  <div className="wf-empty__text">No stock row matches “{query}”.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="wf-panel" data-testid="co-result">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek">
 Persisted replenishment order
              </div>
              <div className="wf-panel__hint">
                Read back from the API after writing — not the POST response
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={reset} data-testid="co-result-clear">
                Build another
              </button>
            </div>
          </div>

          <div className="entity-card">
            <div className="entity-card__thumb"><Truck size={20} /></div>
            <div className="entity-card__body">
              <div className="entity-card__title mono-num" data-testid="co-result-id">
                {result.transfer.transfer_id}
              </div>
              <div className="entity-card__meta">
                <span>Status <strong data-testid="co-result-status">{result.transfer.status}</strong></span>
                <span>Total qty <strong data-testid="co-result-total">{result.transfer.total_qty}</strong></span>
                <span>Picklist <strong className="mono-num">{result.picklistId.slice(0, 8)}</strong></span>
              </div>
            </div>
            <div className="entity-card__actions">
              <StatusBadge status={result.transfer.status} />
            </div>
          </div>

          <div className="form-group">
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Picked / Qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody data-testid="co-result-tasks">
                  {result.persistedTasks.map((t) => (
                    <tr key={t.id} data-testid={`co-result-task-${t.id}`}>
                      <td data-testid={`co-result-task-${t.id}-name`}>
                        {stock.find((r) => String(r.sku) === String(t.sku))?.sku_name || String(t.sku)}
                      </td>
                      <td className="code-cell">
                        {stock.find((r) => String(r.sku) === String(t.sku))?.sku_code || String(t.sku)}
                      </td>
                      <td className="mono-num" data-testid={`co-result-task-${t.id}-qty`}>
                        {Number(t.picked_qty) || 0}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> / {Number(t.qty) || 0}</span>
                      </td>
                      <td><StatusBadge status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
