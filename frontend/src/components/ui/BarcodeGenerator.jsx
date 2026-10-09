import React from 'react';
import Barcode from 'react-barcode';

/**
 * react-barcode is strict about the value/format pairing and throws on a
 * mismatch, which would blow up the surrounding React tree. These are the
 * combinations we can actually hand it safely.
 */
function isRenderableSymbology(format, value) {
  const v = String(value || '').trim();
  if (!v) return false;
  switch (String(format).toUpperCase()) {
    case 'EAN13':
    case 'EAN':
    case 'UPC':
    case 'UPCA':
      return /^\d{12,14}$/.test(v);
    case 'CODE128':
    case 'CODE39':
    case 'ITF':
      return v.length > 0;
    case 'QR':
      return true;
    default:
      // Unknown/absent format: let the library decide its own default.
      return true;
  }
}

export default function BarcodeGenerator({
  value = 'LPN-RJY-2026-101',
  width = 2,
  height = 65,
  showText = true,
  format = 'CODE128',
}) {
  // react-barcode 'width' = individual bar line width (1-4px typical)
  // Callers may pass total SVG width (e.g. 280, 300) by mistake — normalise to line width
  const lineWidth = width > 10 ? 2 : width;

  // A strict symbology that doesn't match the value (e.g. EAN13 on a
  // Code128-shaped string) throws inside the library and takes the whole
  // render down with it. Validate the pairing ourselves and downgrade to the
  // permissive Code128 rather than letting the library throw.
  const resolved = isRenderableSymbology(format, value) ? format : 'CODE128';

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', background: '#ffffff', padding: '10px 14px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
      <Barcode 
        value={String(value || 'LPN-000000')} 
        format={resolved} 
        width={lineWidth}
        height={height} 
        displayValue={showText}
        fontSize={12}
        font="monospace"
        textMargin={4}
        margin={0}
        background="#ffffff"
        lineColor="#000000"
      />
    </div>
  );
}
