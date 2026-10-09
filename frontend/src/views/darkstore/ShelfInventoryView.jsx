import React, { useMemo, useState } from 'react';
import {
  Layers, RefreshCw, AlertTriangle, Search, Package, TrendingDown, Check,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useDarkStore, useAsyncData, dsShelfInventory, num } from './useDarkStore';

/**
 * What is actually on this store's shelves, lot by lot.
 *
 * `stock_qty` is the number the operator has to act on: it is the summed
 * StockBalance for the lot across every container at this site.
 *
 * The status is recomputed here rather than rendered as sent, because the
 * threshold that matters is a judgment about this store's shelf, and the
 * endpoint's own `status` uses one flat network-wide cut. The server's
 * `min_threshold` is deliberately null — the catalog has no per-SKU reorder
 * point (it used to send `Sku.min_age_years`, an age-restriction field, which
 * is not a stock threshold at all).
 *
 * `shelf_bin` is the BIN container's ref. Note the server also sends
 * `lot_bucket` (Good / BAD / QC_Hold), which is a quality state and was
 * previously published as `shelf_bin`, so every row read "Bin: Good".
 */

const TONES = { OPTIMAL: 'success', LOW_STOCK: 'warning', OUT_OF_STOCK: 'danger' };

const LOW_STOCK_CUTOFF = 10;

function statusFor(row) {
  const qty = num(row.stock_qty);
  if (qty <= 0) return 'OUT_OF_STOCK';
  if (qty <= LOW_STOCK_CUTOFF) return 'LOW_STOCK';
  return 'OPTIMAL';
}

function Shelf({ storeCode }) {
  const { data, error, loading, reload } = useAsyncData(
    () => dsShelfInventory(storeCode),
    [storeCode],
    { pollMs: 60000 }
  );

  const [category, setCategory] = useState('ALL');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => data || [], [data]);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category || 'General'))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== 'ALL' && (r.category || 'General') !== category) return false;
      if (!q) return true;
      return (
        String(r.product_name || '').toLowerCase().includes(q) ||
        String(r.sku_code || '').toLowerCase().includes(q) ||
        String(r.batch_code || '').toLowerCase().includes(q) ||
        String(r.shelf_bin || '').toLowerCase().includes(q)
      );
    });
  }, [rows, category, query]);

  const summary = useMemo(() => {
    let units = 0;
    let low = 0;
    let out = 0;
    for (const r of rows) {
      const q = num(r.stock_qty);
      units += q;
      const s = statusFor(r);
      if (s === 'OUT_OF_STOCK') out += 1;
      else if (s === 'LOW_STOCK') low += 1;
    }
    return { units, low, out, skus: rows.length };
  }, [rows]);

  return (
    <>
      {error && (
        <div className="wf-panel">
          <div className="scan-feedback scan-feedback--error" data-testid="ds-shelf-error">
            <AlertTriangle size={14} /> {error}
          </div>
        </div>
      )}

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><Layers size={17} /> Shelf Inventory</div>
            <div className="wf-panel__hint">
              Lot-level position for <StoreBadge />
            </div>
          </div>
          <div className="wf-panel__actions">
            {loading && <span className="scan-feedback scan-feedback--hint">Loading…</span>}
            <button
              className="btn-secondary"
              onClick={() => reload()}
              disabled={loading}
              data-testid="ds-shelf-refresh"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <div className="tally-grid" data-testid="ds-shelf-summary">
          <div className="tally-tile">
            <div className="tally-tile__label">Units on shelf</div>
            <div className="tally-tile__value" data-testid="ds-shelf-units">
              {summary.units.toLocaleString('en-IN')}
            </div>
          </div>
          <div className="tally-tile">
            <div className="tally-tile__label">Lots tracked</div>
            <div className="tally-tile__value">{summary.skus}</div>
          </div>
          <div className={`tally-tile${summary.low ? ' tally-tile--over' : ''}`}>
            <div className="tally-tile__label">Running low</div>
            <div className="tally-tile__value" data-testid="ds-shelf-low">{summary.low}</div>
          </div>
          <div className={`tally-tile${summary.out ? ' tally-tile--short' : ''}`}>
            <div className="tally-tile__label">Out of stock</div>
            <div className="tally-tile__value" data-testid="ds-shelf-out">{summary.out}</div>
          </div>
        </div>

        <div className="form-group" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <Search
                size={15}
                style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-muted)', pointerEvents: 'none',
                }}
              />
              <input
                className="form-input"
                data-testid="ds-shelf-search"
                style={{ paddingLeft: 34, minHeight: 42 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search product, SKU, batch or bin"
                autoComplete="off"
              />
            </div>
            <select
              className="form-input"
              data-testid="ds-shelf-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{ minHeight: 42, maxWidth: 200 }}
              aria-label="Filter by category"
            >
              <option value="ALL">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="wf-panel">
        {rows.length === 0 && !error ? (
          <div className="wf-empty" data-testid="ds-shelf-empty">
            <Package size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">No stock recorded</div>
            <div className="wf-empty__text">
              This store has no inventory lots yet. Receive and shelve a tote, or check
              that the hub replenished against this site.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="wf-empty" data-testid="ds-shelf-no-match">
            <Search size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">Nothing matches</div>
            <div className="wf-empty__text">
              {rows.length} lot{rows.length === 1 ? '' : 's'} are on the shelf but none
              match this filter.
            </div>
          </div>
        ) : (
          <div className="form-group">
            <div className="item-list" data-testid="ds-shelf-rows">
              {filtered.map((r, i) => {
                const s = statusFor(r);
                return (
                  <div
                    key={r.id || `${r.sku}-${r.batch_code}-${i}`}
                    className="entity-card"
                    data-testid={`ds-shelf-row-${i}`}
                    data-status={s}
                  >
                    <div className="entity-card__thumb">
                      {s === 'OPTIMAL' ? <Check size={22} /> : <TrendingDown size={22} />}
                    </div>
                    <div className="entity-card__body">
                      <div className="entity-card__title">{r.product_name || 'Unnamed product'}</div>
                      <div className="entity-card__meta">
                        <span>SKU <strong>{r.sku_code}</strong></span>
                        {r.batch_code && <span>Batch <strong>{r.batch_code}</strong></span>}
                        {r.expiry_date && <span>Exp <strong>{r.expiry_date}</strong></span>}
                        {r.shelf_bin && <span>Bin <strong>{r.shelf_bin}</strong></span>}
                        {r.lot_bucket && <span>Condition <strong>{r.lot_bucket}</strong></span>}
                        {r.storage_zone && <span>Zone <strong>{r.storage_zone}</strong></span>}
                        {r.category && <span>Category <strong>{r.category}</strong></span>}
                      </div>
                    </div>
                    <div className="entity-card__actions">
                      <div style={{ textAlign: 'right' }}>
                        <div
                          data-testid={`ds-shelf-qty-${i}`}
                          style={{
                            fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                            color: s === 'OPTIMAL' ? 'var(--text-primary)' : `var(--${TONES[s] === 'warning' ? 'warning' : 'danger'})`,
                          }}
                        >
                          {num(r.stock_qty)}
                        </div>
                        <StatusBadge status={s} tone={TONES[s]} dataTestId={`ds-shelf-status-${i}`} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function ShelfInventoryView() {
  const { storeCode } = useDarkStore();

  return (
    <StoreGate>
      {storeCode && <Shelf storeCode={storeCode} />}
    </StoreGate>
  );
}
