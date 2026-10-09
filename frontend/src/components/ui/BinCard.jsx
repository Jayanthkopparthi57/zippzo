import React from 'react';
import { MapPin, Package } from 'lucide-react';

/**
 * Summary of what is physically inside one bin. This is the screen a worker
 * uses to confirm "is the right stock in the right place" after a scan.
 */
export default function BinCard({
  bin,
  lineCount = 0,
  totalQty = 0,
  capacityPct,
  onOpen,
  dataTestId = 'bin-card',
}) {
  const code = bin?.barcode || bin?.code || bin?.location_code || bin?.id || '—';

  return (
    <div
      className="entity-card"
      data-testid={dataTestId}
      onClick={onOpen}
      style={onOpen ? { cursor: 'pointer' } : undefined}
    >
      <div className="entity-card__thumb">
        <MapPin size={22} />
      </div>
      <div className="entity-card__body">
        <div className="entity-card__title mono-num">{code}</div>
        <div className="entity-card__meta">
          <span><strong>{lineCount}</strong> product{lineCount === 1 ? '' : 's'}</span>
          <span><strong>{totalQty}</strong> units</span>
          {bin?.zone && <span>Zone <strong>{bin.zone}</strong></span>}
          {bin?.zone_type && <span>{bin.zone_type}</span>}
        </div>
        {typeof capacityPct === 'number' && (
          <div className="progress-bar" style={{ marginTop: 8 }}>
            <div
              className={`progress-bar__fill${capacityPct >= 90 ? ' progress-bar__fill--danger' : capacityPct >= 70 ? ' progress-bar__fill--warning' : ''}`}
              style={{ width: `${Math.min(100, capacityPct)}%` }}
            />
          </div>
        )}
      </div>
      {onOpen && (
        <div className="entity-card__actions">
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
            data-testid={`${dataTestId}-open`}
            onClick={e => { e.stopPropagation(); onOpen(); }}
          >
            <Package size={13} /> Contents
          </button>
        </div>
      )}
    </div>
  );
}
