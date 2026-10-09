import React from 'react';
import BarcodeGenerator from './BarcodeGenerator';

/**
 * Printable tote / LPN label.
 *
 * The label is the only thing that travels with the tote, so it carries
 * everything needed to route and audit it without a database lookup: tote id,
 * destination store, the full contents with quantities, and a scannable code.
 */
export default function ToteLabel({
  toteId = '',
  destination = '',
  origin = '',
  lines = [],
  orderRef = '',
  createdAt = '',
  onPrint,
  printing = false,
  dataTestId = 'tote-label',
}) {
  const totalUnits = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  return (
    <div className="wf-panel" data-testid={dataTestId}>
      <div className="wf-panel__header">
        <div>
          <div className="wf-panel__title">Tote / LPN Label</div>
          <div className="wf-panel__hint">
            Scannable receipt of what is physically inside this tote
          </div>
        </div>
        {onPrint && (
          <div className="wf-panel__actions">
            <button
              type="button"
              className="btn-primary"
              onClick={onPrint}
              disabled={printing}
              data-testid={`${dataTestId}-print`}
            >
              {printing ? 'Preparing…' : 'Print Label'}
            </button>
          </div>
        )}
      </div>

      {/* Screen preview. The print stylesheet renders the same node. */}
      <div className="tote-label" data-testid={`${dataTestId}-preview`}>
        <div className="tote-label__title">{toteId || 'TOTE —'}</div>

        <div className="tote-label__meta">
          <span>DEST: {destination || '—'}</span>
          {orderRef && <span>ORDER: {orderRef}</span>}
        </div>
        {origin && (
          <div className="tote-label__meta">
            <span>FROM: {origin}</span>
            <span>UNITS: {totalUnits}</span>
          </div>
        )}

        <div className="tote-label__rows" data-testid={`${dataTestId}-lines`}>
          {lines.length === 0 ? (
            <div className="tote-label__row"><span>No items</span><span>0</span></div>
          ) : lines.map((l, i) => (
            <div className="tote-label__row" key={l.sku_id || l.sku_code || i}>
              <span>{l.sku_code || l.code || '—'} {l.name ? `· ${l.name}` : ''}</span>
              <span>{l.qty}</span>
            </div>
          ))}
        </div>

        {createdAt && (
          <div className="tote-label__meta">
            <span>PACKED: {createdAt}</span>
            <span>LINES: {lines.length}</span>
          </div>
        )}

        <div className="tote-label__barcode">
          <BarcodeGenerator value={toteId || 'TOTE-000000'} format="CODE128" height={58} />
        </div>
      </div>
    </div>
  );
}
