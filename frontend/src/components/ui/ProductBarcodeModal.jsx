import React, { useMemo, useState } from 'react';
import { X, Barcode, Printer, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import BarcodeGenerator from './BarcodeGenerator';
import { postApi, describeError } from '../../api/client';
import { generateEan13, generateInternalCode } from '../../utils/barcodeUtils';

/**
 * Manual-entry fallback for a unit that genuinely has no barcode.
 *
 * This is the "capture details -> generate -> save -> print" loop the operators
 * asked for. The generated code is persisted to /catalog/barcodes/ (the SKU
 * barcode master) so the very next scan of that unit resolves, instead of the
 * operator retyping it forever.
 */
export default function ProductBarcodeModal({
  onClose,
  skus = [],
  preselectedSku = '',
}) {
  const [skuId, setSkuId] = useState(preselectedSku || (skus[0]?.sku_id ?? ''));
  const [symbology, setSymbology] = useState('INTERNAL');
  const [code, setCode] = useState('');
  const [packLevel, setPackLevel] = useState('EACH');
  const [qtyInBase, setQtyInBase] = useState(1);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);

  const selectedSku = useMemo(
    () => skus.find(s => String(s.sku_id) === String(skuId)) || null,
    [skus, skuId]
  );

  // Suggest a code from the selected SKU. Existing barcodes are never
  // regenerated, so the operator's master data is not silently rotated.
  const suggest = () => {
    if (!selectedSku) {
      setError('Select a product first.');
      return;
    }
    if (symbology === 'EAN') {
      setCode(generateEan13(String(selectedSku.sku_code).replace(/\D/g, '').padEnd(12, '0').slice(0, 12)));
    } else {
      setCode(generateInternalCode('ZZP', selectedSku.sku_code));
    }
    setError('');
  };

  const save = async (e) => {
    e.preventDefault();
    if (!skuId) { setError('Select a product to attach this barcode to.'); return; }
    if (!code.trim()) { setError('Generate or enter a barcode first.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await postApi('/catalog/barcodes/', {
        barcode: code.trim(),
        symbology,
        sku: skuId,
        pack_level: packLevel,
        qty_in_base: Number(qtyInBase) || 1,
        is_primary: false,
        is_active: true,
      });
      setSaved({ ...res, barcode: code.trim(), sku: selectedSku });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const printLabel = () => {
    const win = window.open('', '_blank');
    if (!win) {
      setError('Pop-up blocked. Allow pop-ups to print the label.');
      return;
    }
    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="utf-8" />
      <title>Barcode ${code}</title>
      <style>
        body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; padding: 20px; }
        .label { width: 320px; border: 2.5px solid #000; border-radius: 8px; padding: 14px; text-align: center; }
        .title { font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
        .sku { font-size: 15px; font-weight: 800; margin-top: 6px; }
        .name { font-size: 12px; color: #475569; margin-bottom: 8px; }
        .meta { font-size: 10px; text-transform: uppercase; color: #64748b; margin-top: 8px; }
        .meta b { display: block; font-size: 12px; color: #0f172a; text-transform: none; }
        @page { size: 3in 2in; margin: 0; }
        @media print { body { padding: 0; } }
      </style></head>
      <body><div class="label">
        <div class="title">Zippzo Product Label</div>
        <div class="sku">${selectedSku ? selectedSku.sku_code : ''}</div>
        <div class="name">${selectedSku ? selectedSku.name : ''}</div>
        <div id="barcode"></div>
        <div class="meta">Symbology<b>${symbology}</b></div>
        <div class="meta">Pack level<b>${packLevel} (x${qtyInBase})</b></div>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
      <script>
        window.onload = function () {
          var fmt = ${JSON.stringify(symbology === 'EAN' ? 'EAN13' : 'CODE128')};
          try { JsBarcode("#barcode", ${JSON.stringify(code)}, { format: fmt, width: 2, height: 54, displayValue: true, fontSize: 13, margin: 6 }); }
          catch (e) { document.getElementById('barcode').textContent = ${JSON.stringify(code)}; }
          setTimeout(function () { window.print(); }, 300);
        };
      </script></body></html>`);
    win.document.close();
  };

  const printableValue = saved ? saved.barcode : code;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="stat-icon"><Barcode size={18} /></span>
              <span>
                <span className="page-title" style={{ fontSize: 16, display: 'block' }}>Generate Product Barcode</span>
                <span className="page-subtitle" style={{ fontSize: 12, display: 'block' }}>
                  Unit has no barcode — capture details, generate a code, save it to the SKU master
                </span>
              </span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div style={{ padding: 16 }}>
          {saved ? (
            <>
              <div className="alert alert-success" data-testid="barcode-saved" style={{ marginBottom: 12 }}>
                <CheckCircle2 size={16} />
                <span>
                  Barcode <strong className="code-cell">{saved.barcode}</strong> saved to the SKU master.
                  This unit will now resolve on every future scan.
                </span>
              </div>
              <div className="card" style={{ textAlign: 'center', marginBottom: 12 }}>
                <BarcodeGenerator value={saved.barcode} height={54} format={symbology === 'EAN' ? 'EAN13' : 'CODE128'} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn-secondary" onClick={onClose}>Done</button>
                <button className="btn-primary" onClick={printLabel} data-testid="print-barcode">
                  <Printer size={14} /> Print Label
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={save} data-testid="barcode-form">
              <div className="form-group">
                <label className="form-label" htmlFor="bc-sku">Product *</label>
                <select id="bc-sku" className="form-input" value={skuId} onChange={e => setSkuId(e.target.value)} required>
                  <option value="">— Select product —</option>
                  {skus.map(s => (
                    <option key={s.sku_id} value={s.sku_id}>
                      {s.name} ({s.sku_code}){s.ean ? ` • EAN ${s.ean}` : ' • no barcode'}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="bc-symbology">Symbology</label>
                  <select id="bc-symbology" className="form-input" value={symbology} onChange={e => setSymbology(e.target.value)}>
                    <option value="INTERNAL">Internal (Code128)</option>
                    <option value="EAN">EAN-13</option>
                    <option value="CODE128">Code 128</option>
                    <option value="QR">QR</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="bc-pack">Pack level</label>
                  <select id="bc-pack" className="form-input" value={packLevel} onChange={e => setPackLevel(e.target.value)}>
                    <option value="EACH">Each</option>
                    <option value="INNER">Inner</option>
                    <option value="CASE">Case</option>
                    <option value="PALLET">Pallet</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="bc-qty">Qty / base</label>
                  <input id="bc-qty" className="form-input" type="number" min="1" value={qtyInBase}
                    onChange={e => setQtyInBase(e.target.value)} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="bc-code">Barcode value *</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input id="bc-code" className="form-input mono-num" value={code}
                    onChange={e => setCode(e.target.value.toUpperCase())}
                    placeholder="Generate or type a code" required />
                  <button type="button" className="btn-secondary" onClick={suggest} data-testid="generate-barcode">
                    Generate
                  </button>
                </div>
              </div>

              {code && (
                <div className="card" style={{ textAlign: 'center', marginBottom: 12 }} data-testid="barcode-preview">
                  <BarcodeGenerator value={printableValue} height={54} format={symbology === 'EAN' ? 'EAN13' : 'CODE128'} />
                </div>
              )}

              {error && (
                <div className="alert alert-danger" data-testid="barcode-error" style={{ marginBottom: 12 }}>
                  <AlertTriangle size={16} /><span>{error}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving} data-testid="save-barcode">
                  <Save size={14} /> {saving ? 'Saving...' : 'Save Barcode'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
