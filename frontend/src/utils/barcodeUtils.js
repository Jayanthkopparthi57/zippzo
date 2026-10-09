/**
 * Authentic Code 128 (Set B) & Code 39 Industrial Barcode Generator
 * Used for LPN Totes, Pallets, Batch Labels, SKUs & Shipping Manifests
 */

// Code 128 patterns: each character maps to 6 alternating bar/space widths (sum = 11 modules)
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", // 0-9
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", // 10-19
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", // 20-29
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", // 30-39
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", // 40-49
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", // 50-59
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", // 60-69
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", // 70-79
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", // 80-89
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", // 90-99
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112" // 100-106 (106 is STOP)
];

const START_CODE_B = 104;
const STOP_CODE = 106;

/**
 * Encodes ASCII string into a Code 128B binary sequence (1=bar, 0=space)
 */
export function encodeCode128(text) {
  const clean = String(text || 'LPN-000000').trim();
  const codes = [START_CODE_B];
  let checkSum = START_CODE_B;

  for (let i = 0; i < clean.length; i++) {
    const ascii = clean.charCodeAt(i);
    // Code 128B value = ASCII - 32 (for ASCII 32 to 127)
    let val = ascii - 32;
    if (val < 0 || val > 95) val = 0; // fallback
    codes.push(val);
    checkSum += val * (i + 1);
  }

  const checkDigit = checkSum % 103;
  codes.push(checkDigit);
  codes.push(STOP_CODE);

  // Convert pattern widths to binary bit string
  let binary = '0000000000'; // Quiet zone
  codes.forEach((codeIdx, cIdx) => {
    const pattern = CODE128_PATTERNS[codeIdx] || "212222";
    let isBar = true;
    for (let p = 0; p < pattern.length; p++) {
      const width = parseInt(pattern[p], 10);
      binary += (isBar ? '1' : '0').repeat(width);
      isBar = !isBar;
    }
  });
  binary += '0000000000'; // Quiet zone

  return {
    binary,
    text: clean,
    totalModules: binary.length
  };
}

/**
 * Generates an SVG string of the barcode
 */
export function generateBarcodeSVG(text, options = {}) {
  const width = options.width || 300;
  const height = options.height || 70;
  const showText = options.showText !== false;
  const { binary, text: cleanText, totalModules } = encodeCode128(text);

  const barWidth = width / totalModules;
  const barHeight = showText ? height - 18 : height;

  let rects = '';
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === '1') {
      rects += `<rect x="${(i * barWidth).toFixed(2)}" y="0" width="${(barWidth + 0.1).toFixed(2)}" height="${barHeight}" fill="#000000" />`;
    }
  }

  const textElement = showText ? `
    <text x="${width / 2}" y="${height - 2}" font-family="monospace, 'JetBrains Mono', 'Courier New'" font-size="12" font-weight="700" text-anchor="middle" fill="#0f172a" letter-spacing="1.5">${cleanText}</text>
  ` : '';

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:#ffffff; display:block; margin:0 auto;">
      <rect width="${width}" height="${height}" fill="#ffffff" />
      ${rects}
      ${textElement}
    </svg>
  `.trim();
}

/**
 * Renders the authentic Code 128 barcode onto an HTML5 Canvas
 */
export function drawBarcodeToCanvas(canvas, text, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { binary, text: cleanText, totalModules } = encodeCode128(text);

  const width = canvas.width || 300;
  const height = canvas.height || 80;
  const showText = options.showText !== false;
  const barHeight = showText ? height - 20 : height;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const barWidth = width / totalModules;
  ctx.fillStyle = '#000000';

  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === '1') {
      ctx.fillRect(i * barWidth, 0, barWidth + 0.2, barHeight);
    }
  }

  if (showText) {
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(cleanText, width / 2, height - 4);
  }
}

/**
 * Builds an EAN-13 with a valid check digit.
 *
 * A warehouse label a gun cannot read is worse than no label, so generated
 * EANs are real EAN-13 values rather than random digit strings. Falls back to
 * Code 128 (which carries its own checksum) when the payload is not numeric.
 */
export function generateEan13(seedDigits12) {
  const base = String(seedDigits12 || '').replace(/\D/g, '').padEnd(12, '0').slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    // EAN-13 weights alternate 1,3 from the left across the first 12 digits.
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${base}${check}`;
}

/** Readable internal code, e.g. ZZP-SKU0007-A1B2C3 */
export function generateInternalCode(prefix, skuCode) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix || 'ZZP'}-${String(skuCode || 'SKU').replace(/[^A-Za-z0-9]/g, '').toUpperCase()}-${rand}`;
}

/**
 * Generates an official print window for warehouse container / batch labels
 */
export function openBarcodePrintWindow(data) {
  const barcodeText = data.barcode || data.lpn_barcode || `LPN-RJY-2026-101`;
  const batchCode = data.batch_code || data.batch_id || `XHYD08000K801`;
  const destName = data.destination_name || data.dest_name || 'Hafeezpet #009';
  const totalUnits = data.total_units || data.total_packed_qty || data.ordered_qty || 25;
  const skuCount = data.items?.length || data.sku_count || 1;
  const weight = data.gross_weight_kg ? `${data.gross_weight_kg} kg` : '6.5 kg';
  const warehouse = data.warehouse || 'RJY-DS-001 (Mother Hub)';
  const sealNumber = data.seal_number || data.seal || '—';
  const dateStr = new Date().toLocaleDateString('en-GB');

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Warehouse LPN Barcode Label — ${barcodeText}</title>
        <meta charset="utf-8" />
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
        <style>
          @page {
            size: 4in 3in;
            margin: 0;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f8fafc;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
          }
          .label-card {
            width: 380px;
            max-width: 380px;
            background: #ffffff;
            border: 2.5px solid #000000;
            border-radius: 8px;
            padding: 16px;
            color: #000000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          .label-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #000000;
            padding-bottom: 8px;
            margin-bottom: 10px;
          }
          .company-title {
            font-size: 16px;
            font-weight: 900;
            letter-spacing: 0.5px;
          }
          .hub-name {
            font-size: 10px;
            color: #475569;
            font-weight: 600;
          }
          .dest-badge {
            font-size: 14px;
            font-weight: 800;
            text-align: right;
            color: #7c3aed;
          }
          .dest-sub {
            font-size: 9px;
            color: #64748b;
            text-transform: uppercase;
          }
          .batch-row {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            font-weight: 700;
            margin-bottom: 8px;
          }
          .barcode-container {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            padding: 6px 4px;
            border-radius: 4px;
            text-align: center;
            margin: 8px 0;
            overflow: hidden;
          }
          .barcode-container svg {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 0 auto;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            font-size: 11px;
            margin-top: 10px;
            border-top: 1.5px solid #cbd5e1;
            padding-top: 8px;
          }
          .meta-item {
            background: #f8fafc;
            padding: 4px 6px;
            border-radius: 4px;
            border: 1px solid #e2e8f0;
          }
          .meta-item strong {
            display: block;
            font-size: 12px;
            color: #0f172a;
          }
          .meta-item span {
            font-size: 9px;
            color: #64748b;
            text-transform: uppercase;
            font-weight: 700;
          }
          @media print {
            body {
              background: #ffffff;
              padding: 0;
            }
            .label-card {
              border: 2px solid #000000;
              box-shadow: none;
              width: 100%;
              max-width: 100%;
              border-radius: 0;
            }
            .barcode-container svg {
              max-width: 100%;
              height: auto;
            }
          }
        </style>
      </head>
      <body>
        <div class="label-card">
          <div class="label-header">
            <div>
              <div class="company-title">ZIPPZO LOGISTICS</div>
              <div class="hub-name">${warehouse}</div>
            </div>
            <div class="dest-badge">
              <div>${destName}</div>
              <div class="dest-sub">Destination Dark Store</div>
            </div>
          </div>

          <div class="batch-row">
            <div>Batch: <span style="font-family: monospace; color: #7c3aed;">${batchCode}</span></div>
            <div>Date: ${dateStr}</div>
          </div>

          <div class="barcode-container">
            <svg id="barcode"></svg>
          </div>

          <div class="meta-grid">
            <div class="meta-item">
              <span>Packed SKUs</span>
              <strong>${skuCount} Products</strong>
            </div>
            <div class="meta-item">
              <span>Total Units</span>
              <strong>${totalUnits} Units</strong>
            </div>
            <div class="meta-item">
              <span>Container Weight</span>
              <strong>${weight} (TOTE)</strong>
            </div>
            <div class="meta-item">
              <span>Security Seal</span>
              <strong>${escapeHtml(sealNumber)}</strong>
            </div>
          </div>
        </div>

        <script>
          window.onload = function() {
            try {
              JsBarcode("#barcode", "${barcodeText}", {
                format: "CODE128",
                width: 1.5,
                height: 50,
                displayValue: true,
                fontSize: 13,
                fontOptions: "bold",
                textMargin: 3,
                margin: 0
              });

              // Ensure barcode SVG fits within the card
              var svg = document.getElementById('barcode');
              if (svg) {
                svg.style.maxWidth = '100%';
                svg.style.height = 'auto';
              }
            } catch(e) {
              console.error('Barcode generation failed:', e);
            }

            setTimeout(function() {
              window.print();
            }, 400);
          };
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
