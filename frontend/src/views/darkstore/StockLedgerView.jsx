import React, { useMemo, useState } from 'react';
import {
  History, RefreshCw, AlertTriangle, Search, Package, Timer,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import {
  useDarkStore, useAsyncData, stockMovements, stagedAging, loadSkuIndex, num,
} from './useDarkStore';

/**
 * Why this store's stock is what it is.
 *
 * `/inventory/movements` and `/ds-ops/staged-aging` were both reachable and
 * neither had a screen: an operator who wanted to know why a shelf read short
 * had no way to ask, and nobody could see packed orders ageing at the staging
 * point. This is the read side of both.
 *
 * Movement rows carry `sku` and `lot` as UUIDs only, so the SKU index is loaded
 * once and used to name them. Until it arrives the row shows the id rather than
 * pretending to know the product.
 */

// Custody moves (PACK / SHIP of a loose bag) deliberately leave sellable
// stock alone, so sellable_delta is zero and the row used to render "—" for a
// line that really moved units. The custody delta carries the direction there.
function movementDelta(m) {
  const sellable = num(m.sellable_delta);
  if (sellable) return sellable;
  return num(m.site_custody_delta);
}

function directionOf(m) {
  const d = movementDelta(m);
  if (d > 0) return 'IN';
  if (d < 0) return 'OUT';
  return 'MOVE';
}

const STAGE_TONE = { STAGED: 'info', OVER_20_MIN: 'warning', OVER_60_MIN: 'danger' };

function Ledger({ siteId, storeCode }) {
  const { data: moves, error, loading, reload } = useAsyncData(
    () => (siteId ? stockMovements(siteId) : []),
    [siteId],
    { pollMs: 30000 }
  );
  const { data: aging } = useAsyncData(
    () => (storeCode ? stagedAging(storeCode) : []),
    [storeCode],
    { pollMs: 30000 }
  );
  const { data: skus } = useAsyncData(() => loadSkuIndex(), []);

  const [type, setType] = useState('ALL');
  const [query, setQuery] = useState('');

  const skuFor = useMemo(
    () => (id) => (skus ? skus.byId.get(String(id)) : null),
    [skus]
  );
  const rows = useMemo(() => moves || [], [moves]);
  const waiting = useMemo(() => aging || [], [aging]);

  // `apply_stock` records the type in `movement_ref` and leaves `movement_type`
  // blank on every row - `test_ledger_integrity` pins that as deliberate. This
  // screen read the blank column instead, so every row rendered an empty label,
  // the type dropdown offered a single empty option, and the type filter could
  // never match. The WMS ledger next door already reads `movement_ref`.
  const types = useMemo(
    () => [...new Set(rows.map((r) => r.movement_ref))].filter(Boolean).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((m) => {
      if (type !== 'ALL' && m.movement_ref !== type) return false;
      if (!q) return true;
      const sku = skuFor(m.sku);
      return (
        String(movementLabel(m.movement_ref)).toLowerCase().includes(q) ||
        String(sku?.sku_code || m.sku || '').toLowerCase().includes(q) ||
        String(sku?.name || '').toLowerCase().includes(q) ||
        String(m.ref_id || '').toLowerCase().includes(q) ||
        String(m.from_ref_id || '').toLowerCase().includes(q) ||
        String(m.to_ref_id || '').toLowerCase().includes(q)
      );
    });
  }, [rows, type, query, skuFor]);

  const summary = useMemo(() => {
    let inQty = 0;
    let outQty = 0;
    let overdue = 0;
    for (const m of rows) {
      const d = num(m.sellable_delta);
      if (d > 0) inQty += d;
      else outQty += -d;
    }
    for (const w of waiting) {
      if (w.current_stage === 'OVER_60_MIN') overdue += 1;
    }
    return { inQty, outQty, rows: rows.length, overdue, waiting: waiting.length };
  }, [rows, waiting]);

  return (
    <>
      {error && (
        <div className="wf-panel">
          <div className="scan-feedback scan-feedback--error" data-testid="ds-ledger-error">
            <AlertTriangle size={14} /> {error}
          </div>
        </div>
      )}

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-peek"> Stock Ledger</div>
            <div className="wf-panel__hint">
              Every balance change at <StoreBadge />
            </div>
          </div>
          <div className="wf-panel__actions">
            {loading && <span className="scan-feedback scan-feedback--hint">Loading…</span>}
            <button
              className="btn-secondary"
              onClick={() => reload()}
              disabled={loading}
              data-testid="ds-ledger-refresh"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <div className="ledger-flow" aria-label="How to read the stock ledger">
          <span><b>1.</b> Filter by movement type or search a SKU / reference.</span>
          <span><b>2.</b> Check the direction and units to see what changed.</span>
          <span><b>3.</b> Review staged bags below — anything over an hour needs attention.</span>
        </div>

        <div className="tally-grid" data-testid="ds-ledger-summary">
          <div className="tally-tile">
            <div className="tally-tile__label">Movements</div>
            <div className="tally-tile__value" data-testid="ds-ledger-count">
              {summary.rows.toLocaleString('en-IN')}
            </div>
          </div>
          <div className="tally-tile">
            <div className="tally-tile__label">Units in</div>
            <div className="tally-tile__value" data-testid="ds-ledger-in">
              {summary.inQty.toLocaleString('en-IN')}
            </div>
          </div>
          <div className="tally-tile">
            <div className="tally-tile__label">Units out</div>
            <div className="tally-tile__value" data-testid="ds-ledger-out">
              {summary.outQty.toLocaleString('en-IN')}
            </div>
          </div>
          <div className={`tally-tile${summary.overdue ? ' tally-tile--short' : ''}`}>
            <div className="tally-tile__label">Over an hour staged</div>
            <div className="tally-tile__value" data-testid="ds-ledger-overdue">
              {summary.overdue}
            </div>
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
                data-testid="ds-ledger-search"
                style={{ paddingLeft: 34, minHeight: 42 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search product, SKU, reference or bin"
                autoComplete="off"
              />
            </div>
            <select
              className="form-input"
              data-testid="ds-ledger-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={{ minHeight: 42, maxWidth: 220 }}
              aria-label="Filter by movement type"
            >
              <option value="ALL">All movement types</option>
              {types.map((t) => (
                <option key={t} value={t}>{movementLabel(t)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {waiting.length > 0 && (
        <div className="wf-panel" data-testid="ds-ledger-staged">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek"> Waiting for a rider</div>
              <div className="wf-panel__hint">
                Packed and staged, oldest first
              </div>
            </div>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Staged at</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((w, i) => (
                  <tr
                    key={w.aging_id}
                    data-testid={`ds-ledger-staged-${i}`}
                    data-status={w.current_stage}
                  >
                    <td>
                      <div className="entity-card__title mono-num">
                        {String(w.order_id).slice(0, 8)}
                      </div>
                    </td>
                    <td className="mono-num">
                      <strong>{new Date(w.staged_at).toLocaleString()}</strong>
                    </td>
                    <td>
                      <StatusBadge
                        status={w.current_stage}
                        tone={STAGE_TONE[w.current_stage]}
                        dataTestId={`ds-ledger-staged-status-${i}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="wf-panel">
        {rows.length === 0 && !error ? (
          <div className="wf-empty" data-testid="ds-ledger-empty">
            <Package size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">Nothing has moved</div>
            <div className="wf-empty__text">
              This store has no stock movements yet. Receive a tote and the ledger
              starts recording from there.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="wf-empty" data-testid="ds-ledger-no-match">
            <Search size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">Nothing matches</div>
            <div className="wf-empty__text">
              {rows.length} movement{rows.length === 1 ? '' : 's'} are recorded but none
              match this filter.
            </div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Movement</th>
                  <th>SKU</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Ref</th>
                  <th>Qty</th>
                  <th>Actor</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody data-testid="ds-ledger-rows">
                {filtered.map((m, i) => {
                  const dir = directionOf(m);
                  const sku = skuFor(m.sku);
                  const delta = movementDelta(m);
                  const qty = num(m.qty);
                  return (
                    <tr
                      key={m.entry_id}
                      data-testid={`ds-ledger-row-${i}`}
                      data-status={dir}
                    >
                      <td>
                        <div className="entity-card__title">
                          {movementLabel(m.movement_ref)}
                          {sku?.name ? ` · ${sku.name}` : ''}
                        </div>
                      </td>
                      <td className="mono-num">
                        <strong>{sku?.sku_code || String(m.sku).slice(0, 8)}</strong>
                      </td>
                      <td className="mono-num">
                        {m.from_ref_id
                          ? <strong>{m.from_container}:{String(m.from_ref_id).slice(0, 8)}</strong>
                          : '—'}
                      </td>
                      <td className="mono-num">
                        {m.to_ref_id
                          ? <strong>{m.to_container}:{String(m.to_ref_id).slice(0, 8)}</strong>
                          : '—'}
                      </td>
                      <td className="mono-num">
                        {m.ref_id ? <strong>{String(m.ref_id).slice(0, 8)}</strong> : '—'}
                      </td>
                      <td>
                        <div
                          data-testid={`ds-ledger-qty-${i}`}
                          style={{
                            fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                            color: delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-muted)',
                          }}
                        >
                          {qty > 0
                            ? (delta > 0 ? `+${qty}` : delta < 0 ? `−${qty}` : qty)
                            : '—'}
                        </div>
                      </td>
                      <td>{m.actor_type}</td>
                      <td className="mono-num">{new Date(m.created_at).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const WORDS = {
  RECEIPT: 'Receipt into store',
  RECEIVE: 'Receipt into store',
  SHIP: 'Shipped out',
  PUTAWAY: 'Putaway to shelf',
  PICK: 'Picked for an order',
  RESERVE: 'Reserved',
  RELEASE: 'Reservation released',
  ADJUST: 'Adjustment',
  TRANSFER: 'Transfer',
  RETURN: 'Return to shelf',
  DAMAGE: 'Damaged / written off',
};

function movementLabel(type) {
  return WORDS[type] || String(type || '').replace(/_/g, ' ');
}

export default function StockLedgerView() {
  const { storeCode, siteId } = useDarkStore();

  return (
    <StoreGate>
      {storeCode && <Ledger siteId={siteId} storeCode={storeCode} />}
    </StoreGate>
  );
}
