import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Truck, RefreshCw, AlertTriangle, Search, Trash2, Send, Building2, Package, CheckCircle2, Boxes, ScanLine, ArrowRight } from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
import WorkflowStepper from '../../components/ui/WorkflowStepper';
import ProductCard from '../../components/ui/ProductCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';

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
const STEPS = [
  { key: 'route', title: 'Choose Lane', description: 'Source warehouse → destination dark store' },
  { key: 'lines', title: 'Build Lines', description: 'Add products from real available stock' },
  { key: 'release', title: 'Release', description: 'Create the order and its pick tasks' },
];

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
      const picklistId = crypto.randomUUID();
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

  const step = result ? 2 : lines.length > 0 ? 1 : 0;

  return (
    <div>
      <WorkflowStepper steps={STEPS} current={step} dataTestId="co-stepper" />

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><ArrowRight size={17} /> Replenishment Lane</div>
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
              <div className="wf-panel__title"><Package size={17} /> Order Lines</div>
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
            <div className="item-list" data-testid="co-lines">
              {lines.map((l) => (
                <div key={lineKey(l)} className="entity-card" data-testid={`co-line-${lineKey(l)}`}>
                  <div className="entity-card__thumb"><Package size={22} /></div>
                  <div className="entity-card__body">
                    <div className="entity-card__title" data-testid={`co-line-name-${lineKey(l)}`}>
                      {l.sku_name}
                    </div>
                    <div className="entity-card__meta">
                      <span>SKU <strong>{l.sku_code}</strong></span>
                      {l.batch_number && <span>Batch <strong>{l.batch_number}</strong></span>}
                      {l.location?.barcode && <span>Bin <strong>{l.location.barcode}</strong></span>}
                      <span>
                        Available <strong>{availableByKey[lineKey(l)] ?? 0}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="entity-card__actions">
                    <div className="scan-field">
                      <label className="form-label" htmlFor={`co-qty-${lineKey(l)}`}>Qty</label>
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
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => removeLine(l)}
                        data-testid={`co-line-remove-${lineKey(l)}`}
                        aria-label={`Remove ${l.sku_code}`}
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <ScanInput
            label="Step 2 · Scan a product to add it"
            placeholder="Scan or type a SKU code / barcode to add that stock"
            value={query}
            onChange={setQuery}
            onScan={async (code) => {
              const want = norm(code);
              const hit =
                stock.find((r) => [r.sku_code, r.sku, r.ean].some((v) => norm(v) === want)) || null;
              if (!hit) {
                setFeedback({
                  type: 'error',
                  message: `"${code}" has no available stock at ${source?.code || 'the source warehouse'}.`,
                });
                return;
              }
              addLine(hit);
              setQuery('');
            }}
            hint="or pick from the available stock list"
            dataTestId="co-scan"
          />

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
              <div className="wf-panel__title">
                <Search size={17} /> Available at {source?.code || '—'}
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
              <div className="item-list" data-testid="co-stock">
                {visibleStock.map((r) => {
                  const key = lineKey(r);
                  const added = requestedByKey[key] || 0;
                  const available = availableByKey[key] ?? 0;
                  return (
                    <ProductCard
                      key={key}
                      dataTestId={`co-stock-${key}`}
                      product={{
                        name: r.sku_name,
                        sku_code: r.sku_code,
                        batch_no: r.batch_number,
                        expiry_date: r.expiry_date,
                      }}
                      picked={added}
                      expected={available}
                      state={added >= available ? 'done' : added > 0 ? 'active' : 'pending'}
                      action={<StatusBadge status={r.sellable ? 'SELLABLE' : 'HOLD'} />}
                      onSelect={added >= available ? undefined : () => addLine(r)}
                    />
                  );
                })}
                {visibleStock.length === 0 && (
                  <div className="wf-empty" data-testid="co-stock-nomatch">
                    <ScanLine size={32} className="wf-empty__icon" />
                    <div className="wf-empty__text">No stock row matches “{query}”.</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="wf-panel" data-testid="co-result">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                <CheckCircle2 size={17} /> Persisted replenishment order
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
            <div className="item-list" data-testid="co-result-tasks">
              {result.persistedTasks.map((t) => (
                <ProductCard
                  key={t.id}
                  dataTestId={`co-result-task-${t.id}`}
                  product={{
                    name: stock.find((r) => String(r.sku) === String(t.sku))?.sku_name || String(t.sku),
                    sku_code: stock.find((r) => String(r.sku) === String(t.sku))?.sku_code || String(t.sku),
                  }}
                  picked={Number(t.picked_qty) || 0}
                  expected={Number(t.qty) || 0}
                  state="pending"
                  action={<StatusBadge status={t.status} />}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
