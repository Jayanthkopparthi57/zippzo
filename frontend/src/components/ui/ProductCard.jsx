import React from 'react';
import { Package } from 'lucide-react';

/**
 * A product row in the scan queues. Shows the scanned/expected quantity
 * together, because "100 picked of 100" is the confirmation an operator needs
 * before advancing.
 */
export default function ProductCard({
  product,
  picked = 0,
  expected = 0,
  state = 'pending',   // pending | active | done | error
  onScan,
  onSelect,
  action,
  showImage = false,
  imageUrl,
  dataTestId = 'product-card',
}) {
  const pct = expected > 0 ? Math.min(100, (picked / expected) * 100) : 0;
  const short = expected > 0 && picked < expected;

  return (
    <div
      className={`entity-card${state === 'active' ? ' entity-card--active' : ''}${state === 'done' ? ' entity-card--done' : ''}${state === 'error' ? ' entity-card--error' : ''}`}
      data-testid={dataTestId}
      data-state={state}
      onClick={onSelect}
      style={onSelect ? { cursor: 'pointer' } : undefined}
    >
      <div className="entity-card__thumb">
        {showImage && imageUrl
          ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
          : <Package size={22} />}
      </div>

      <div className="entity-card__body">
        <div className="entity-card__title" data-testid={`${dataTestId}-name`}>
          {product?.name || product?.product_name || 'Unknown product'}
        </div>
        <div className="entity-card__meta">
          {product?.sku_code && <span>SKU <strong>{product.sku_code}</strong></span>}
          {product?.ean && <span>EAN <strong>{product.ean}</strong></span>}
          {product?.batch_no && <span>Batch <strong>{product.batch_no}</strong></span>}
          {product?.expiry_date && <span>Exp <strong>{product.expiry_date}</strong></span>}
        </div>

        <div className="progress-bar" style={{ marginTop: 8 }}>
          <div
            className={`progress-bar__fill${pct >= 100 ? ' progress-bar__fill--success' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="entity-card__actions">
        <div style={{ textAlign: 'right' }}>
          <div
            data-testid={`${dataTestId}-qty`}
            style={{
              fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              color: short ? 'var(--warning)' : pct >= 100 ? 'var(--success)' : 'var(--text-primary)',
            }}
          >
            {picked}
            {expected > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> / {expected}</span>}
          </div>
          {action}
          {onScan && (
            <button
              type="button"
              className="scan-btn"
              style={{ minHeight: 34, padding: '0 12px', fontSize: 12, marginTop: 6 }}
              data-testid={`${dataTestId}-scan`}
              onClick={e => { e.stopPropagation(); onScan(); }}
            >
              Scan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
