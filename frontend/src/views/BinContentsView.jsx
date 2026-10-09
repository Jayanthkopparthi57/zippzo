import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScanLine, Printer, Package, Layers, Search, ArrowLeft, AlertTriangle, X, Boxes, CheckCircle } from 'lucide-react';
import BarcodeScannerModal from '../components/ui/BarcodeScannerModal';
import { fetchApi, unwrapList, describeError } from '../api/client';
import { resolveBin, binLabel } from '../utils/bins';

const PAGE_SIZE = 50;

const sum = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

function SkuCell({ row }) {
  return (
    <>
      <div className="code-cell">{row.sku_code || String(row.sku ?? '—')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.sku_name || ''}</div>
    </>
  );
}

/**
 * Bin Contents — a real page (not a modal).
 *
 * It was previously a modal that destructured an `onClose` prop nobody passed,
 * referenced undefined `Camera`/`QrCode` imports and called bare `fetch`, so
 * every route that mounted it crashed. `BinContentsModal` remains the modal
 * implementation; this is the standalone bin-lookup section.
 *
 * Supports ?bin=BIN-01 / ?location_id=<useM> deep links and scanning.
 */
export default function BinContentsView({ initialBinCode = '', initialLocationId = '', initialCode = '', onBack = null }) {
  // `initialCode` is what the inbound screen passes when it forwards a bin
  // scan; treat it as an alias for the URL-seeded `initialBinCode`.
  const seedCode = initialCode || initialBinCode;
  const params = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch {
      return new URLSearchParams();
    }
  }, []);

  const [code, setCode] = useState(seedCode || params.get('bin') || '');
  const [locationId, setLocationId] = useState(initialLocationId || params.get('location_id') || '');
  const [binLabel, setBinLabel] = useState('');
  const [lotFilter, setLotFilter] = useState('');
  const [skuQuery, setSkuQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /**
   * Fetch the joined position rows for an already-resolved location_id.
   * Split out from load() so that re-rendering after setLocationId() does not
   * kick off a second resolveBin round-trip.
   */
  const fetchPositions = useCallback(async (locId) => {
    setLoading(true);
    try {
      const data = unwrapList(await fetchApi(
        `/inventory/positions?location_id=${encodeURIComponent(locId)}`
      ));
      setRows(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(describeError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Resolve whatever was scanned/typed into a bin's Location location_id.
   * See utils/bins.js — /inventory/positions only filters on `location_id`.
   */
  // Only the seed values feed the first load. Reading `locationId` inside load()
  // would make setLocationId() re-trigger it and double every request.
  const load = useCallback(async (raw) => {
    const value = String(raw || '').trim();
    if (!value) {
      setError('Scan a bin, or type a bin code.');
      return;
    }
    setLoading(true);
    setError('');
    setCandidates([]);
    try {
      const bin = await resolveBin(value);
      if (!bin) {
        setError(`No bin matches "${value}". Check the label, or try the bin code (e.g. A-01-01-01).`);
        setRows([]);
        return;
      }
      if (bin.candidates) {
        // Surface the actual matches as buttons so the operator can choose
        // instead of being told to "pick the right one" with no way to do so.
        setCandidates(bin.candidates);
        setError(`"${value}" matched ${bin.candidates.length} bins. Pick the right one.`);
        setRows([]);
        return;
      }
      setLocationId(bin.location_id);
      setBinLabel(bin.label);
      const data = unwrapList(await fetchApi(
        `/inventory/positions?location_id=${encodeURIComponent(bin.location_id)}`
      ));
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(describeError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (code) {
      load(code);
    } else if (locationId) {
      // Deep-linked straight to a location_id, with no human code to resolve.
      setBinLabel(locationId);
      fetchPositions(locationId);
    } else {
      setError('Scan a bin, or type a bin code.');
    }
  }, [load, code, locationId, fetchPositions]);

  /** Choose one of the ambiguous matches offered by resolveBin(). */
  const chooseCandidate = async (loc) => {
    setCandidates([]);
    setCode('');
    setLocationId(loc.location_id);
    setBinLabel(loc.barcode || binLabel(loc));
    await fetchPositions(loc.location_id);
  };

  const visible = useMemo(() => {
    const q = skuQuery.trim().toLowerCase();
    return rows.filter(r => {
      if (lotFilter.trim()) {
        const lot = `${r.lot ?? ''} ${r.batch_number ?? ''}`.toLowerCase();
        if (!lot.includes(lotFilter.trim().toLowerCase())) return false;
      }
      if (!q) return true;
      return `${r.sku_code ?? ''} ${r.sku_name ?? ''} ${r.sku ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, lotFilter, skuQuery]);

  const totals = useMemo(() => ({
    skus: new Set(visible.map(r => String(r.sku))).size,
    lots: new Set(visible.map(r => String(r.lot ?? ''))).size,
    qty: sum(visible, 'qty'),
    sellable: sum(visible, 'sellable'),
  }), [visible]);

  const onScan = async (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    setCode(value);
    setLocationId('');
    setScanning(false);
  };

  const print = () => {
    const win = window.open('', '_blank');
    if (!win) { setError('Pop-up blocked. Allow pop-ups to print bin contents.'); return; }
    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="utf-8" /><title>Bin Contents ${binLabel || code}</title>
      <style>
        body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; padding: 20px; color: #0f172a; }
        h1 { font-size: 17px; margin: 0 0 4px; }
        .sub { font-size: 12px; color: #64748b; margin-bottom: 14px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: left; background: #f1f5f9; padding: 7px 8px; border-bottom: 2px solid #cbd5e1; font-size: 10px;
             text-transform: uppercase; letter-spacing: .5px; }
        td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        tfoot td { font-weight: 700; background: #f8fafc; }
        .mono { font-family: ui-monospace, Menlo, monospace; }
        @page { margin: 12mm; }
      </style></head><body>
      <h1>Bin Contents</h1>
      <div class="sub">${escapeHtml(binLabel || code || locationId)} • ${visible.length} line(s) • ${totals.qty} qty • printed ${new Date().toLocaleString()}</div>
      <table><thead><tr><th>SKU code</th><th>Product</th><th>Lot / batch</th><th>Expiry</th><th>Qty</th><th>Sellable</th></tr></thead><tbody>
      ${visible.map(r => `<tr>
          <td class="mono">${escapeHtml(r.sku_code ?? String(r.sku ?? '—'))}</td>
          <td>${escapeHtml(r.sku_name ?? '—')}</td>
          <td class="mono">${escapeHtml([r.lot, r.batch_number].filter(Boolean).join(' / ') || '—')}</td>
          <td class="mono">${escapeHtml(r.expiry_date ?? '—')}</td>
          <td class="mono">${Number(r.qty) || 0}</td>
          <td class="mono">${Number(r.sellable) || 0}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">Total</td><td class="mono">${totals.qty}</td><td class="mono">${totals.sellable}</td></tr></tfoot>
      </table></body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div className="workspace-viewport">
      {onBack && (
        <button className="btn-secondary" onClick={onBack} data-testid="bin-contents-back" style={{ marginBottom: 12 }}>
          <ArrowLeft size={14} /> Back
        </button>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Bin Contents</h1>
          <p className="page-subtitle">Everything currently held in a single bin, by SKU and lot</p>
        </div>
        <button className="btn-secondary" onClick={print} disabled={!visible.length} data-testid="print-bin-contents">
          <SkuCell size={14} /> Print
        </button>
      </div>

      <div className="inline-form-card">
        <div className="inline-form-header">
          <div className="inline-form-title">Scan or enter a bin</div>
          <div className="inline-form-subtitle">A bin barcode, bin code, or location UUID</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-scanner" onClick={() => setScanning(true)} data-testid="scan-bin">
            <ScanLine size={16} /> Scan Bin
          </button>
          <input
            className="form-input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="BIN-01 or bin barcode"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); load(code); } }}
            data-testid="bin-code-input"
          />
          {code && (
            <button className="icon-btn" onClick={() => { setCode(''); setLocationId(''); setRows([]); setCandidates([]); setError(''); }} aria-label="Clear bin" title="Clear">
              <X size={14} />
            </button>
          )}
          <button className="btn-primary" onClick={() => load(code)} disabled={loading} data-testid="load-bin">
            {loading ? 'Loading...' : 'View Contents'}
          </button>
        </div>
        {locationId && (
          <div className="location-pill" style={{ marginTop: 8 }} data-testid="bin-location-pill">
            {binLabel && <strong>{binLabel}</strong>} • location_id: {locationId}
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-danger" data-testid="bin-contents-error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={16} /><span>{error}</span>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="panel" data-testid="bin-candidates" style={{ marginBottom: 12 }}>
          <div className="panel-title">Matching bins</div>
          {candidates.map(c => (
            <button
              key={c.location_id}
              type="button"
              className="btn btn-ghost"
              data-testid="bin-candidate"
              onClick={() => chooseCandidate(c)}
              style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}
            >
              <span>{binLabel(c)}</span>
              <span className="muted">{c.barcode || c.location_id}</span>
            </button>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="metrics-grid" style={{ marginBottom: 12 }}>
            <div className="stat-card"><div className="stat-icon"><Package size={16} /></div>
              <div><div className="stat-value">{totals.skus}</div><div className="stat-label">SKUs</div></div></div>
            <div className="stat-card"><div className="stat-icon"><ScanLine size={16} /></div>
              <div><div className="stat-value">{totals.lots}</div><div className="stat-label">Lots</div></div></div>
            <div className="stat-card"><div className="stat-icon"><Boxes size={16} /></div>
              <div><div className="stat-value">{totals.qty}</div><div className="stat-label">Total qty</div></div></div>
            <div className="stat-card"><div className="stat-icon"><CheckCircle size={16} /></div>
              <div><div className="stat-value">{totals.sellable}</div><div className="stat-label">Sellable</div></div></div>
          </div>

          <div className="table-toolbar">
            <div className="search-box">
              <Search size={14} />
              <input placeholder="Filter by SKU or product…" value={skuQuery}
                onChange={e => setSkuQuery(e.target.value)} data-testid="bin-sku-filter" />
            </div>
            <input className="form-input" style={{ maxWidth: 190 }} placeholder="Filter by lot" value={lotFilter}
              onChange={e => setLotFilter(e.target.value)} data-testid="bin-lot-filter" />
            <span className="badge badge-default">{visible.length} line(s)</span>
          </div>

          <div className="table-container">
            <table className="data-table" data-testid="bin-contents-table">
              <thead>
                <tr>
                  <th>Product</th><th>Lot / Batch</th><th>Expiry</th>
                  <th>Qty</th><th>Sellable</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, PAGE_SIZE).map((r, i) => (
                  <tr key={`${r.sku}-${r.lot}-${i}`}>
                    <td><SkuCell row={r} /></td>
                    <td className="code-cell">
                      {String(r.lot ?? '—')}
                      {r.batch_number ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Batch {r.batch_number}</div> : null}
                    </td>
                    <td className="code-cell">{String(r.expiry_date ?? '—')}</td>
                    <td className="mono-num">{Number(r.qty) || 0}</td>
                    <td className="mono-num">{Number(r.sellable) || 0}</td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 22, color: 'var(--text-muted)' }}>
                    {rows.length ? 'No stock matches the current filters.' : 'This bin is empty.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {visible.length > PAGE_SIZE && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              Showing {PAGE_SIZE} of {visible.length} lines — narrow the filters to see the rest.
            </div>
          )}
        </>
      )}

      {!rows.length && !loading && !error && (
        <div className="card" style={{ marginTop: 12, textAlign: 'center', padding: 26, color: 'var(--text-muted)' }}>
          <ScanLine size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>Scan a bin barcode, or type a bin code to see what is inside it.</div>
        </div>
      )}

      {scanning && (
        <BarcodeScannerModal
          title="Scan Bin"
          onClose={() => setScanning(false)}
          onScan={onScan}
          expected="Bin barcode or bin code"
        />
      )}
    </div>
  );
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
