import React, { useCallback, useMemo, useState } from 'react';
import { ScanLine, RefreshCw, AlertTriangle, Package, Boxes, MapPin, Layers, X } from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
import StatusBadge from '../../components/ui/StatusBadge';
import { fetchApi, unwrapList, describeError } from '../../api/client';
import { resolveBin, binLabel } from '../../utils/bins';

/**
 * Scan any bin, see what is inside it.
 *
 * The resolution is the same one BinContentsView uses (utils/bins.js +
 * /inventory/positions?location_id=) because a bin label is never the value
 * stock is keyed by: StockBalance.container_ref holds a Location.location_id,
 * while the label carries a barcode or an A-01-01-01 coordinate. Comparing the
 * scanned text straight against container_ref is the bug that made this screen
 * look permanently empty.
 *
 * Presented scan-first, on the shared workflow primitives, and it never renders
 * a blank table: a bin with no stock says so, and a failed request shows the
 * real error instead of an empty result.
 */
export default function BinLookupView() {
  const [scanText, setScanText] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const [bin, setBin] = useState(null);
  const [locationId, setLocationId] = useState('');
  const [rows, setRows] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  /**
   * Fetch the joined position rows for a resolved location_id.
   * Split out from the scan handler so re-rendering after setLocationId()
   * cannot kick off a second resolve round-trip.
   */
  const loadPositions = useCallback(async (locId, label, loc) => {
    setBusy(true);
    setError('');
    try {
      // `location_id` is the only stock filter that maps to container_ref; the
      // viewset forces container='BIN' behind it.
      const data = unwrapList(
        await fetchApi(`/inventory/positions?location_id=${encodeURIComponent(locId)}`)
      );
      if (!Array.isArray(data)) throw new Error('/inventory/positions returned an unrecognised payload shape.');
      setRows(data);
      setBin({ ...(loc || {}), barcode: (loc && loc.barcode) || label || locId, location_id: locId });
      setLoaded(true);
    } catch (e) {
      setRows([]);
      setLoaded(false);
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = () => {
    setScanText('');
    setBin(null);
    setLocationId('');
    setRows([]);
    setCandidates([]);
    setError('');
    setFeedback(null);
    setLoaded(false);
  };

  const onScan = async (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;

    setBusy(true);
    setError('');
    setFeedback(null);
    setCandidates([]);
    setRows([]);
    setLoaded(false);
    try {
      const hit = await resolveBin(value);
      if (!hit) {
        setError(`No bin matches "${value}". Check the label, or try the bin code (e.g. A-01-01-01).`);
        return;
      }
      if (hit.candidates) {
        // Offer the real matches as choices instead of telling the operator to
        // "pick the right one" with no way to do so.
        setCandidates(hit.candidates);
        setError(`"${value}" matched ${hit.candidates.length} bins. Pick the right one.`);
        return;
      }
      setScanText('');
      setLocationId(hit.location_id);
      await loadPositions(hit.location_id, hit.label, hit.location);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseCandidate = async (loc) => {
    setCandidates([]);
    setError('');
    setScanText('');
    setLocationId(loc.location_id);
    await loadPositions(loc.location_id, binLabel(loc), loc);
  };

  const totals = useMemo(
    () => ({
      skus: new Set(rows.map((r) => String(r.sku))).size,
      lots: new Set(rows.map((r) => String(r.lot ?? ''))).size,
      qty: rows.reduce((t, r) => t + (Number(r.qty) || 0), 0),
      held: rows.filter((r) => r.sellable).length,
    }),
    [rows]
  );

  return (
    <div className="workspace-viewport">
      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-panel__title"><ScanLine size={17} /> Bin Lookup</div>
            <div className="wf-panel__hint">
              Scan a bin barcode or type a bin code to see everything held in it
            </div>
          </div>
          <div className="wf-panel__actions">
            <button className="btn-secondary" onClick={reset} disabled={busy} data-testid="bin-lookup-reset">
              <X size={14} /> Clear
            </button>
            <button
              className="btn-secondary"
              onClick={() => (locationId ? loadPositions(locationId, binLabel(bin), bin) : onScan(scanText))}
              disabled={busy || (!locationId && !scanText.trim())}
              data-testid="bin-lookup-refresh"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <ScanInput
          label="Scan the bin"
          placeholder="Scan a bin barcode, or type A-01-01-01"
          value={scanText}
          onChange={setScanText}
          onScan={onScan}
          busy={busy}
          feedback={feedback}
          dataTestId="bin-lookup-scan"
        />

        {error && (
          <div className="form-group">
            <div className="scan-feedback scan-feedback--error" data-testid="bin-lookup-error">
              <AlertTriangle size={14} /> {error}
            </div>
          </div>
        )}

        {candidates.length > 0 && (
          <div className="form-group">
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th>Bin</th><th>Zone</th><th></th></tr>
                </thead>
                <tbody data-testid="bin-lookup-candidates">
                  {candidates.map((c) => (
                    <tr
                      key={c.location_id}
                      data-testid={`bin-lookup-candidate-${c.location_id}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => chooseCandidate(c)}
                    >
                      <td className="mono-num">{binLabel(c)}</td>
                      <td>{c.zone || '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: 12, padding: '6px 12px' }}
                          data-testid={`bin-lookup-candidate-${c.location_id}-open`}
                          onClick={(e) => { e.stopPropagation(); chooseCandidate(c); }}
                        >
                          <Package size={13} /> Contents
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!bin && !candidates.length && !error && (
          <div className="wf-empty" data-testid="bin-lookup-idle">
            <MapPin size={40} className="wf-empty__icon" />
            <div className="wf-empty__title">No bin scanned yet</div>
            <div className="wf-empty__text">
              Scan the label on the bin face. The bin is resolved through
              {' '}<span className="mono-num">/network/locations</span> and its stock read from the
              real position ledger.
            </div>
          </div>
        )}
      </div>

      {bin && (
        <div className="wf-panel" data-testid="bin-lookup-result">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><MapPin size={17} /> {binLabel(bin) || bin.barcode}</div>
              <div className="wf-panel__hint mono-num" data-testid="bin-lookup-location">
                {locationId}
              </div>
            </div>
          </div>

          <div className="form-group">
            <div className="entity-card" data-testid="bin-lookup-summary">
              <div className="entity-card__thumb"><Package size={22} /></div>
              <div className="entity-card__body">
                <div className="entity-card__title">
                  {totals.skus} product{totals.skus === 1 ? '' : 's'} · {totals.qty} unit{totals.qty === 1 ? '' : 's'}
                </div>
                <div className="entity-card__meta">
                  <span>Lots <strong data-testid="bin-lookup-lots">{totals.lots}</strong></span>
                  <span>
                    Sellable <strong data-testid="bin-lookup-sellable">{totals.held}</strong> of {rows.length} line{rows.length === 1 ? '' : 's'}
                  </span>
                  {bin.site && <span>Site <strong>{bin.site}</strong></span>}
                  {bin.zone && <span>Zone <strong>{bin.zone}</strong></span>}
                </div>
              </div>
            </div>
          </div>

          {rows.length === 0 ? (
            /* A resolved bin with no rows really is empty. Say so — an empty
               table here reads as a broken query. */
            <div className="wf-empty" data-testid="bin-lookup-empty">
              <Boxes size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">This bin is empty</div>
              <div className="wf-empty__text">
                {binLabel(bin) || bin.barcode} is a real location but holds no stock right now.
              </div>
            </div>
          ) : (
            <div className="form-group">
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Batch</th>
                      <th>Expiry</th>
                      <th>Qty</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody data-testid="bin-lookup-rows">
                    {rows.map((r, i) => (
                      <tr key={`${r.sku}-${r.lot}-${i}`} data-testid={`bin-lookup-row-${i}`}>
                        <td data-testid={`bin-lookup-row-${i}-name`}>{r.sku_name}</td>
                        <td className="code-cell">{r.sku_code}</td>
                        <td className="code-cell">{r.batch_number || '—'}</td>
                        <td className="code-cell">{r.expiry_date || '—'}</td>
                        <td className="mono-num" data-testid={`bin-lookup-row-${i}-qty`}>
                          {Number(r.qty) || 0}
                        </td>
                        <td><StatusBadge status={r.sellable ? 'SELLABLE' : 'HOLD'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {busy && loaded === false && (
            <div className="form-group">
              <div className="scan-feedback scan-feedback--hint" data-testid="bin-lookup-loading">
                <MapPin size={14} /> Reading the position ledger…
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
