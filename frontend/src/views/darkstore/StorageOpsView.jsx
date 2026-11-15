import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, RefreshCw, MapPin, ArrowRightLeft, ClipboardCheck, Boxes, ScanLine, Plus, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import StoreGate from './StoreGate';
import { useDarkStore, useAsyncData, asList, resolveStoreBin } from './useDarkStore';
import { fetchApi, fetchApiPage, postApi, patchApi } from '../../api/client';
import DataTable from '../../ds-console/components/ui/DataTable';
import BinContentsModal from '../../components/ui/BinContentsModal';

function Locations({ siteId, storeCode }) {
  const { data, error, loading, reload } = useAsyncData(
    () => fetchApi(`/network/locations/?site=${encodeURIComponent(siteId)}&page_size=500`).then((r) => asList(r, '/network/locations')),
    [siteId],
    { pollMs: 60000 },
  );
  const rows = useMemo(() => data || [], [data]);
  const [showNewBin, setShowNewBin] = useState(false);
  const [created, setCreated] = useState(null); // { location_id, barcode, qr_payload, container, aisle, rack, level }
  const [binForm, setBinForm] = useState({ container: 'PICK_FACE', aisle: '', rack: '', level: '', position: '', capacity_qty: '', is_sellable_bin: true, is_active: true });
  const [binError, setBinError] = useState('');
  const [binBusy, setBinBusy] = useState(false);
  const [contentBin, setContentBin] = useState(null); // barcode to look up

  const printBinSlip = (created) => {
    const w = window.open('', '_blank', 'width=460,height=560');
    if (!w) return;
    const payload = created.qr_payload || created.barcode || created.location_id;
    w.document.write(`<!doctype html><html><head><title>BIN ${created.barcode}</title>
<style>@page{size:100mm 150mm;margin:10mm}body{font-family:system-ui;-apple-system,"Segoe UI",sans-serif;text-align:center}h2{margin:6mm 0 1mm;font-size:13mm}p{font-size:5mm;margin:0 0 5mm}img{width:60mm;height:60mm}small{font-size:4mm;color:#555}</style>
</head><body>
<small>ZIPPZO · ${storeCode || ''}</small>
<h2>${created.barcode}</h2>
<p>${created.container}${created.aisle ? ` · Aisle ${created.aisle}` : ''}${created.rack ? ` · Rack ${created.rack}` : ''}${created.level ? ` · Level ${created.level}` : ''}</p>
<div id="qr"></div>
<p>Scan for location details and contents</p>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></scr' + 'ipt>
<script>QRCode.toCanvas(document.getElementById('qr'), ${JSON.stringify(payload)}, { width: 240, margin: 1 }, function(){})</scr' + 'ipt>
</body></html>`);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 400);
  };
  const createBin = async (event) => {
    event.preventDefault();
    if (!siteId) return;
    setBinBusy(true);
    setBinError('');
    try {
      const payload = {
        site: siteId,
        location_type: 'BIN',
        container: binForm.container.trim() || 'PICK_FACE',
        aisle: binForm.aisle.trim() || undefined,
        rack: binForm.rack.trim() || undefined,
        level: binForm.level.trim() || undefined,
        position: binForm.position.trim() || undefined,
        capacity_qty: binForm.capacity_qty ? Number(binForm.capacity_qty) : undefined,
        is_sellable_bin: !!binForm.is_sellable_bin,
        is_active: !!binForm.is_active,
      };
      const createdRow = await postApi('/network/locations/', payload);
      setCreated(createdRow);
      setShowNewBin(false);
      setBinForm({ container: 'PICK_FACE', aisle: '', rack: '', level: '', position: '', capacity_qty: '', is_sellable_bin: true, is_active: true });
      await reload({ quiet: true });
    } catch (err) {
      setBinError(err?.message || 'Could not create the bin.');
    } finally {
      setBinBusy(false);
    }
  };
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Create a bin, then print its QR slip — scan it to see what’s inside.
        </div>
        <button className="btn-ui primary" onClick={() => setShowNewBin(true)}><Plus size={13} /> <span>New bin</span></button>
      </div>

      {binError && <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 8 }}><AlertTriangle size={13} /> {binError}</div>}
      {created && (
        <div className="wf-panel" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
              <QRCodeSVG value={created.qr_payload || created.barcode || created.location_id} size={120} />
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="mono-num" style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>{created.barcode}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {created.location_type} · {created.container}{created.aisle ? ` · Aisle ${created.aisle}` : ''}{created.rack ? ` · Rack ${created.rack}` : ''}{created.level ? ` · Level ${created.level}` : ''}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
                Paste this slip on the shelf. Scanning the QR opens the bin’s contents.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn-ui primary" onClick={() => printBinSlip(created)}><Printer size={13} /> <span>Print QR slip</span></button>
                <button className="btn-ui neutral" onClick={() => setContentBin(created.barcode)}><ScanLine size={13} /> <span>View contents</span></button>
                <button className="btn-ui neutral" onClick={() => setCreated(null)}><Check size={13} /> <span>Done</span></button>
              </div>
            </div>
          </div>
        </div>
      )}

      <StorageTable
        title="STORAGE LOCATIONS & BINS"
        sub="Shelf storage registered for this dark store. Click a row to see what is in it."
        rows={rows}
        loading={loading}
        error={error}
        reload={reload}
        columns={[
          { label: 'Bin', key: 'barcode', render: (v, r) => <button type="button" className="code-link" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }} onClick={() => setContentBin(v || r.location_id)}>{v || r.location_id}</button> },
          { label: 'Type', key: 'location_type', badge: true },
          { label: 'Container', key: 'container', badge: true },
          { label: 'Zone', key: 'zone', render: (v) => <span className="mono-num">{v?.code || v || '—'}</span> },
          { label: 'Capacity', key: 'capacity_qty', render: (v) => <span className="mono-num">{v ?? '—'}</span> },
          { label: 'Sellable', key: 'is_sellable_bin', render: (v) => <span className="mono-num">{v ? 'YES' : 'NO'}</span> },
          { label: 'Active', key: 'is_active', render: (v) => <span className="mono-num">{v ? 'YES' : 'NO'}</span> },
        ]}
        empty="No storage bins registered for this store."
      />

      {showNewBin && (
        <div className="modal-overlay" onClick={() => (binBusy ? undefined : setShowNewBin(false))}>
          <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title"><Plus size={16} /> New storage bin</div>
              <button type="button" className="icon-btn" onClick={() => setShowNewBin(false)} disabled={binBusy}>×</button>
            </div>
            <form onSubmit={createBin} style={{ padding: 16, display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Barcode auto-generates as BIN-{storeCode || 'SITE'}-0001 … — or leave default and use that.
              </div>
              <label className="form-label">Aisle <input className="form-input" value={binForm.aisle} onChange={(e) => setBinForm((cur) => ({ ...cur, aisle: e.target.value }))} placeholder="A" /></label>
              <label className="form-label">Rack <input className="form-input" value={binForm.rack} onChange={(e) => setBinForm((cur) => ({ ...cur, rack: e.target.value }))} placeholder="01" /></label>
              <label className="form-label">Level <input className="form-input" value={binForm.level} onChange={(e) => setBinForm((cur) => ({ ...cur, level: e.target.value }))} placeholder="02" /></label>
              <label className="form-label">Position <input className="form-input" value={binForm.position} onChange={(e) => setBinForm((cur) => ({ ...cur, position: e.target.value }))} placeholder="04" /></label>
              <label className="form-label">Container <input className="form-input" value={binForm.container} onChange={(e) => setBinForm((cur) => ({ ...cur, container: e.target.value }))} placeholder="PICK_FACE" /></label>
              <label className="form-label">Capacity (units) <input className="form-input mono-num" type="number" min="0" value={binForm.capacity_qty} onChange={(e) => setBinForm((cur) => ({ ...cur, capacity_qty: e.target.value }))} placeholder="e.g. 50" /></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><input type="checkbox" style={{ accentColor: 'var(--c-teal)' }} checked={binForm.is_sellable_bin} onChange={(e) => setBinForm((cur) => ({ ...cur, is_sellable_bin: e.target.checked }))} /> Sellable bin</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><input type="checkbox" style={{ accentColor: 'var(--c-teal)' }} checked={binForm.is_active} onChange={(e) => setBinForm((cur) => ({ ...cur, is_active: e.target.checked }))} /> Active</label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                <button type="button" className="btn-ui neutral" onClick={() => setShowNewBin(false)} disabled={binBusy}>Cancel</button>
                <button type="submit" className="btn-ui primary" disabled={binBusy}>{binBusy ? 'Creating…' : 'Create bin'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {contentBin && (
        <BinContentsModal
          initialBinCode={contentBin}
          onClose={() => setContentBin(null)}
        />
      )}
    </>
  );
}

function BinTransfers() {
  const { siteId, storeCode } = useDarkStore();
  const { data, error, loading, reload } = useAsyncData(
    () => fetchApi('/ds-ops/bin-transfers/?page_size=200').then((r) => asList(r, '/ds-ops/bin-transfers')),
    [],
    { pollMs: 60000 },
  );
  const [sourceScan, setSourceScan] = useState('');
  const [source, setSource] = useState(null);
  const [items, setItems] = useState([]);
  const [scanned, setScanned] = useState({});
  const [productScan, setProductScan] = useState('');
  const [destScan, setDestScan] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const rows = useMemo(() => data || [], [data]);

  const loadSource = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const matches = await resolveStoreBin(storeCode, sourceScan.trim());
      if (matches.length !== 1) {
        throw new Error(matches.length
          ? 'This source-bin label matches multiple locations; use a unique bin barcode.'
          : `No source bin at ${storeCode} matches "${sourceScan.trim()}".`);
      }
      const sourceLocation = matches[0];
      const balanceResponse = await fetchApi(`/inventory/balances/?site=${encodeURIComponent(siteId)}` +
        `&container=BIN&container_ref=${encodeURIComponent(sourceLocation.location_id)}&page_size=1000`);
      const balances = asList(balanceResponse, '/inventory/balances')
        .filter((balance) => Number(balance.qty || 0) > 0);
      const totals = new Map();
      for (const balance of balances) {
        const skuId = String(balance.sku);
        const current = totals.get(skuId) || {
          sku_id: skuId,
          sku_code: balance.sku_code || skuId,
          sku_name: balance.sku_name || 'Unknown product',
          ean: balance.sku_ean || '',
          qty: 0,
        };
        current.qty += Number(balance.qty || 0);
        totals.set(skuId, current);
      }
      setSource(sourceLocation);
      setItems([...totals.values()]);
      setScanned({});
      setProductScan('');
      setDestScan('');
    } catch (err) {
      setSource(null);
      setItems([]);
      setScanned({});
      setFeedback(err.message || 'Could not load source-bin stock.');
    } finally {
      setBusy(false);
    }
  };

  const scanProduct = (event) => {
    event.preventDefault();
    const barcode = productScan.trim().toLowerCase();
    if (!barcode) return;
    const item = items.find((row) =>
      [row.ean, row.sku_code].some((value) => String(value || '').trim().toLowerCase() === barcode)
    );
    if (!item) {
      setFeedback({ type: 'error', message: `${productScan.trim()} is not stock in the selected source bin.` });
      setProductScan('');
      return;
    }
    const count = Number(scanned[item.sku_id] || 0);
    if (count >= item.qty) {
      setFeedback({ type: 'error', message: `${item.sku_code} has already reached its source-bin quantity (${item.qty}).` });
      setProductScan('');
      return;
    }
    setScanned((current) => ({ ...current, [item.sku_id]: count + 1 }));
    setProductScan('');
    setFeedback(null);
  };

  const completeTransfer = async (event) => {
    event.preventDefault();
    if (!source) return;
    const incomplete = items.find((item) => Number(scanned[item.sku_id] || 0) !== item.qty);
    if (incomplete) {
      setFeedback({ type: 'error', message: `Scan all ${incomplete.qty} unit(s) of ${incomplete.sku_code} before moving stock.` });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const destinations = await resolveStoreBin(storeCode, destScan.trim());
      if (destinations.length !== 1) {
        throw new Error(destinations.length
          ? 'This destination-bin label matches multiple locations; use a unique bin barcode.'
          : `No destination bin at ${storeCode} matches "${destScan.trim()}".`);
      }
      if (destinations[0].location_id === source.location_id) {
        throw new Error('Source and destination bins must be different.');
      }
      const transfer = await postApi('/ds-ops/bin-transfers/', {
        source_bin: source.location_id,
        dest_bin: destinations[0].location_id,
      });
      await patchApi(`/ds-ops/bin-transfers/${transfer.transfer_id}/`, {
        status: 'COMPLETED',
        scanned_items: Object.fromEntries(items.map((item) => [item.sku_id, item.qty])),
      });
      setSource(null);
      setItems([]);
      setScanned({});
      setSourceScan('');
      setProductScan('');
      setDestScan('');
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Could not complete the scanned bin transfer.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {feedback && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} /> {typeof feedback === 'string' ? feedback : feedback.message}
        </div>
      )}
      <section className="wf-panel" style={{ marginBottom: 16 }}>
        <form onSubmit={loadSource} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>1. Scan source bin</label>
            <input className="table-filter-input" value={sourceScan} onChange={(e) => setSourceScan(e.target.value)} placeholder="Scan source bin barcode" disabled={busy} />
          </div>
          <button type="submit" className="btn-ui neutral" disabled={busy || !sourceScan.trim()}>
            <ScanLine size={12} /> <span>{busy ? 'Loading...' : 'Load bin contents'}</span>
          </button>
        </form>
        {source && (
          <>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              Source: <strong className="mono-num">{source.label}</strong> · Scan each unit before continuing.
            </div>
            <form onSubmit={scanProduct} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '1 1 220px' }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>2. Scan products out</label>
                <input className="table-filter-input" value={productScan} onChange={(e) => setProductScan(e.target.value)} placeholder="Scan product barcode" disabled={busy} />
              </div>
              <button type="submit" className="btn-ui neutral" disabled={!productScan.trim() || busy}><ScanLine size={12} /> Scan unit</button>
            </form>
            <div className="table-container" style={{ marginBottom: 12 }}>
              <table className="data-table">
                <thead><tr><th>SKU</th><th>Source quantity</th><th>Scanned</th></tr></thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.sku_id}>
                      <td>{item.sku_name}<div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.sku_code}</div></td>
                      <td className="mono-num">{item.qty}</td>
                      <td className="mono-num">{scanned[item.sku_id] || 0}</td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={3}>This source bin has no stock.</td></tr>}
                </tbody>
              </table>
            </div>
            <form onSubmit={completeTransfer} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px' }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>3. Scan destination bin</label>
                <input className="table-filter-input" value={destScan} onChange={(e) => setDestScan(e.target.value)} placeholder="Scan destination bin barcode" disabled={busy} />
              </div>
              <button type="submit" className="btn-ui primary" disabled={busy || !destScan.trim()}>
                <ArrowRightLeft size={12} /> <span>{busy ? 'Moving...' : 'Complete transfer'}</span>
              </button>
            </form>
          </>
        )}
      </section>
      <StorageTable
        title="BIN TRANSFERS"
        sub="Internal shelf-to-shelf movement instructions for this store."
        rows={rows}
        loading={loading}
        error={error}
        reload={reload}
        columns={[
          { label: 'Transfer ID', key: 'transfer_id', render: (v) => <strong className="mono-num">{String(v).slice(0, 8)}…</strong> },
          { label: 'Source Bin', key: 'source_bin', render: (v) => <span className="mono-num">{v}</span> },
          { label: 'Destination Bin', key: 'dest_bin', render: (v) => <span className="mono-num">{v}</span> },
          { label: 'Scanned SKUs', key: 'scanned_items', render: (v) => <span className="mono-num">{Object.keys(v || {}).length}</span> },
          { label: 'Status', key: 'status', badge: true },
          { label: 'Created By', key: 'created_by_name', render: (v) => <span>{v || '—'}</span> },
          { label: 'Completed By', key: 'completed_by_name', render: (v) => <span>{v || '—'}</span> },
          { label: 'Created At', key: 'created_at', render: (v) => <span className="mono-num">{v ? new Date(v).toLocaleString() : '—'}</span> },
        ]}
        empty="No bin transfers registered."
      />
    </div>
  );
}

function Replenishment({ siteId }) {
  const { data, error, loading, reload } = useAsyncData(
    () => fetchApi(`/inventory/replenishment-tasks/?site=${encodeURIComponent(siteId)}&page_size=200`).then((r) => asList(r, '/inventory/replenishment-tasks')),
    [siteId],
    { pollMs: 60000 },
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const rows = useMemo(() => data || [], [data]);

  const complete = async (task) => {
    setBusy(true);
    setFeedback(null);
    try {
      await postApi(`/inventory/replenishment-tasks/${task.task_id}/complete/`, {});
      await reload();
    } catch (err) {
      setFeedback(err.message || 'Could not complete replenishment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {feedback && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} /> {feedback}
        </div>
      )}
      <StorageTable
        title="REPLENISHMENT TASKS"
        sub="Reserve-to-pick-face work for this store."
        rows={rows}
        loading={loading}
        error={error}
        reload={reload}
        columns={[
          { label: 'Task ID', key: 'task_id', render: (v) => <strong className="mono-num">{String(v).slice(0, 8)}…</strong> },
          { label: 'SKU', key: 'sku_code', render: (v, r) => <span>{v || r.sku} — {r.sku_name || ''}</span> },
          { label: 'Lot', key: 'lot_number', render: (v) => <span className="mono-num">{v || '—'}</span> },
          { label: 'From', key: 'from_container_ref', render: (v, r) => <span className="mono-num">{r.from_container}: {v || '—'}</span> },
          { label: 'To', key: 'to_container_ref', render: (v, r) => <span className="mono-num">{r.to_container}: {v || '—'}</span> },
          { label: 'Qty', key: 'qty', render: (v) => <strong className="mono-num">{v}</strong> },
          { label: 'Status', key: 'status', badge: true },
          {
            label: 'Action', key: 'action',
            render: (_, r) => ['COMPLETED', 'CANCELLED'].includes(r.status) ? (
              <span style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)' }}>Completed</span>
            ) : (
              <button type="button" className="btn-ui primary" style={{ padding: '3px 10px', fontSize: 11 }} disabled={busy} onClick={() => complete(r)}>
                <Check size={11} /> Complete
              </button>
            ),
          },
        ]}
        empty="No replenishment tasks for this store."
      />
    </div>
  );
}

function groupCycleCountLines(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = `${line.location || 'SITE'}:${line.sku}`;
    const group = groups.get(key) || {
      key,
      location: line.location,
      location_barcode: line.location_barcode || line.location || 'Site stock',
      sku: line.sku,
      sku_code: line.sku_code,
      sku_name: line.sku_name,
      sku_ean: line.sku_ean,
      system_qty: 0,
      lines: [],
    };
    group.system_qty += Number(line.system_qty || 0);
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function loadAllCycleCountLines(countId) {
  const lines = [];
  let page = 1;
  let hasNext = true;
  while (hasNext) {
    const result = await fetchApiPage('/counting/cycle-count-lines/', {
      count: countId,
      page,
      page_size: 1000,
    });
    lines.push(...result.results);
    hasNext = Boolean(result.next);
    page += 1;
  }
  return lines;
}

function CycleCounts({ siteId, storeCode }) {
  const { data, error, loading, reload } = useAsyncData(
    () => fetchApi(`/counting/cycle-counts/?site=${encodeURIComponent(siteId)}&page_size=200`).then((r) => asList(r, '/counting/cycle-counts')),
    [siteId],
    { pollMs: 60000 },
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [selectedCount, setSelectedCount] = useState(null);
  const [countLines, setCountLines] = useState([]);
  const [currentBin, setCurrentBin] = useState(null);
  const [binScan, setBinScan] = useState('');
  const [productScan, setProductScan] = useState('');
  const [physicalCounts, setPhysicalCounts] = useState({});
  const rows = useMemo(() => data || [], [data]);

  const createCount = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const code = `CC-${Date.now()}`;
      const count = await postApi('/counting/cycle-counts/', {
        site: siteId,
        code,
        count_type: 'FULL',
        scope: { limit: 5000 },
        notes: `Darkstore physical count at ${storeCode}`,
      });
      await postApi(`/counting/cycle-counts/${count.count_id}/generate/`, {});
      await reload();
    } catch (err) {
      setFeedback(err.message || 'Could not create the cycle count.');
    } finally {
      setBusy(false);
    }
  };

  const generate = async (count) => {
    setBusy(true);
    setFeedback(null);
    try {
      await postApi(`/counting/cycle-counts/${count.count_id}/generate/`, {});
      await reload();
    } catch (err) {
      setFeedback(err.message || 'Could not generate cycle-count lines.');
    } finally {
      setBusy(false);
    }
  };

  const openCount = async (count) => {
    setBusy(true);
    setFeedback(null);
    try {
      const lines = await loadAllCycleCountLines(count.count_id);
      setCountLines(lines);
      setSelectedCount(count);
      setCurrentBin(null);
      setPhysicalCounts(Object.fromEntries(
        groupCycleCountLines(lines).map((group) => {
          const fullyCounted = group.lines.every((line) => line.counted_qty != null);
          return [group.key, fullyCounted
            ? group.lines.reduce((total, line) => total + Number(line.counted_qty || 0), 0)
            : undefined];
        }),
      ));
    } catch (err) {
      setFeedback(err.message || 'Could not open cycle-count lines.');
    } finally {
      setBusy(false);
    }
  };

  const selectCountBin = async (event) => {
    event.preventDefault();
    setFeedback(null);
    try {
      const matches = await resolveStoreBin(storeCode, binScan.trim());
      if (matches.length !== 1) {
        throw new Error(matches.length
          ? 'This bin barcode matches multiple locations; use a unique label.'
          : `No bin at ${storeCode} matches "${binScan.trim()}".`);
      }
      const target = matches[0];
      setCurrentBin(target);
      setBinScan('');
      setProductScan('');
    } catch (err) {
      setFeedback(err.message || 'Could not select the count bin.');
    }
  };

  const recordCountScan = async (event) => {
    event.preventDefault();
    const barcode = productScan.trim().toLowerCase();
    if (!currentBin || !barcode) return;
    const group = groupCycleCountLines(countLines).find((row) =>
      row.location === currentBin.location_id
      && [row.sku_code, row.sku_ean].some((value) => String(value || '').trim().toLowerCase() === barcode)
    );
    if (!group) {
      setBusy(true);
      setFeedback(null);
      try {
        const candidates = asList(
          await fetchApi(`/catalog/skus/?search=${encodeURIComponent(productScan.trim())}&page_size=20`),
          '/catalog/skus',
        ).filter((sku) => [sku.sku_code, sku.ean]
          .some((value) => String(value || '').trim().toLowerCase() === barcode));
        if (candidates.length !== 1) {
          throw new Error(`${productScan.trim()} does not identify one catalog product.`);
        }
        const sku = candidates[0];
        await postApi('/counting/cycle-count-lines/', {
          count: selectedCount.count_id,
          location: currentBin.location_id,
          sku: sku.sku_id,
          system_qty: 0,
        });
        const refreshed = await loadAllCycleCountLines(selectedCount.count_id);
        const added = groupCycleCountLines(refreshed).find((row) =>
          row.location === currentBin.location_id && row.sku === sku.sku_id);
        setCountLines(refreshed);
        if (added) {
          setPhysicalCounts((current) => ({ ...current, [added.key]: Number(current[added.key] || 0) + 1 }));
        }
        setProductScan('');
      } catch (err) {
        setFeedback({ type: 'error', message: err.message || 'Could not record an unexpected product.' });
        setProductScan('');
      } finally {
        setBusy(false);
      }
      return;
    }
    setPhysicalCounts((current) => ({
      ...current,
      [group.key]: Number(current[group.key] || 0) + 1,
    }));
    setProductScan('');
    setFeedback(null);
  };

  const saveCurrentBin = async () => {
    if (!currentBin) return;
    setBusy(true);
    setFeedback(null);
    try {
      const groups = groupCycleCountLines(countLines)
        .filter((group) => group.location === currentBin.location_id);
      for (const group of groups) {
        let remaining = Number(physicalCounts[group.key] || 0);
        const updates = group.lines.map((line, index) => {
          const systemQty = Number(line.system_qty || 0);
          const countedQty = Math.min(systemQty, remaining) + (index === 0 ? Math.max(0, remaining - systemQty) : 0);
          remaining = Math.max(0, remaining - countedQty);
          return { line, countedQty };
        });
        for (const { line, countedQty } of updates) {
          await patchApi(`/counting/cycle-count-lines/${line.line_id}/`, { counted_qty: countedQty });
        }
      }
      const refreshed = await loadAllCycleCountLines(selectedCount.count_id);
      setCountLines(refreshed);
      setCurrentBin(null);
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Could not save this bin count.' });
    } finally {
      setBusy(false);
    }
  };

  const completeCount = async () => {
    if (!selectedCount || countLines.some((line) => line.counted_qty == null)) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postApi(`/counting/cycle-counts/${selectedCount.count_id}/complete/`, {});
      setSelectedCount(null);
      setCountLines([]);
      setCurrentBin(null);
      await reload();
    } catch (err) {
      // A field associate's variance stops at REVIEW with `approval_required`;
      // flip the modal to the manager's approve action without making them
      // close and reopen the count.
      setFeedback({ type: 'error', message: err.message || 'Could not complete the cycle count.' });
      if (err?.body?.code === 'approval_required') {
        setSelectedCount((current) => (current ? { ...current, status: 'REVIEW' } : current));
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const approveCount = async () => {
    if (!selectedCount) return;
    setBusy(true);
    setFeedback(null);
    try {
      await postApi(`/counting/cycle-counts/${selectedCount.count_id}/approve/`, {});
      setSelectedCount(null);
      setCountLines([]);
      setCurrentBin(null);
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Could not approve the cycle count.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {feedback && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} /> {typeof feedback === 'string' ? feedback : feedback.message}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button type="button" className="btn-ui primary" disabled={busy || !siteId} onClick={createCount}>
          <ClipboardCheck size={12} /> Start full cycle count
        </button>
      </div>
      <StorageTable
        title="CYCLE COUNTS"
        sub="Physical verification for this store."
        rows={rows}
        loading={loading}
        error={error}
        reload={reload}
        columns={[
          { label: 'Count Code', key: 'code', render: (v) => <strong className="mono-num">{v}</strong> },
          { label: 'Type', key: 'count_type', badge: true },
          { label: 'Status', key: 'status', badge: true },
          { label: 'Assigned To', key: 'assigned_to_email', render: (v) => <span>{v || '—'}</span> },
          { label: 'Lines', key: 'line_count', render: (v) => <strong className="mono-num">{v ?? 0}</strong> },
          {
            label: 'Actions', key: 'actions',
            render: (_, c) => (
              <div style={{ display: 'flex', gap: 6 }}>
                {!['CLOSED', 'CANCELLED'].includes(c.status) && (
                  <>
                    {c.line_count === 0 && (
                      <button type="button" className="btn-ui neutral" style={{ padding: '3px 8px', fontSize: 11 }} disabled={busy} onClick={() => generate(c)}>Generate</button>
                    )}
                    {c.line_count > 0 && (
                      <button type="button" className="btn-ui primary" style={{ padding: '3px 8px', fontSize: 11 }} disabled={busy} onClick={() => openCount(c)}>Scan count</button>
                    )}
                  </>
                )}
              </div>
            ),
          },
        ]}
        empty="No cycle counts for this store."
      />
      {selectedCount && (
        <div className="modal-backdrop" onClick={() => !busy && setSelectedCount(null)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="modal-header">
              <div className="modal-title">Cycle count: {selectedCount.code}</div>
              <button type="button" className="btn-ui neutral" onClick={() => setSelectedCount(null)} disabled={busy}>Close</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <form onSubmit={selectCountBin} style={{ display: 'flex', gap: 8 }}>
                <input className="table-filter-input" value={binScan} onChange={(event) => setBinScan(event.target.value)} placeholder="Scan bin barcode" />
                <button type="submit" className="btn-ui neutral" disabled={busy || !binScan.trim()}><ScanLine size={12} /> Select bin</button>
              </form>
              {currentBin && (
                <>
                  <div style={{ fontSize: 12 }}>Counting bin <strong className="mono-num">{currentBin.label}</strong></div>
                  <form onSubmit={recordCountScan} style={{ display: 'flex', gap: 8 }}>
                    <input className="table-filter-input" value={productScan} onChange={(event) => setProductScan(event.target.value)} placeholder="Scan each product unit" />
                    <button type="submit" className="btn-ui neutral" disabled={busy || !productScan.trim()}><ScanLine size={12} /> Scan</button>
                  </form>
                  <div className="table-container">
                    <table className="data-table">
                      <thead><tr><th>SKU</th><th>System</th><th>Physical count</th></tr></thead>
                      <tbody>
                        {groupCycleCountLines(countLines).filter((group) => group.location === currentBin.location_id).map((group) => (
                          <tr key={group.key}>
                            <td>{group.sku_name}<div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{group.sku_code}</div></td>
                            <td className="mono-num">{group.system_qty}</td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                className="table-filter-input"
                                value={physicalCounts[group.key] ?? ''}
                                onChange={(event) => setPhysicalCounts((current) => ({
                                  ...current,
                                  [group.key]: event.target.value === '' ? undefined : Math.max(0, Number(event.target.value)),
                                }))}
                                aria-label={`Physical count for ${group.sku_code}`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" className="btn-ui primary" onClick={saveCurrentBin} disabled={busy}>
                    Save this bin count
                  </button>
                </>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {countLines.filter((line) => line.counted_qty != null).length} / {countLines.length} stock lines counted.
              </div>
            </div>
            <div className="modal-footer">
              {selectedCount.status === 'REVIEW' ? (
                <button
                  type="button"
                  className="btn-ui primary"
                  onClick={approveCount}
                  disabled={busy}
                >
                  {busy ? 'Approving...' : 'Approve variance & post'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-ui primary"
                  onClick={completeCount}
                  disabled={busy || countLines.length === 0 || countLines.some((line) => line.counted_qty == null)}
                >
                  {busy ? 'Saving...' : 'Complete count & post variances'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StorageTable({ title, sub, rows, columns, loading, error, reload, empty }) {
  const tableRows = useMemo(
    () => rows.map((row, index) => ({
      ...row,
      _tableId: row.task_id || row.transfer_id || row.count_id || row.location_id || row.code || index,
    })),
    [rows],
  );

  return (
    <div>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>{title}</span>
            <span className="screen-count-tag">{rows.length} records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
        </div>
        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => reload()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
        </div>
      </div>
      {error && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      <DataTable
        columns={columns}
        data={tableRows}
        idField="_tableId"
        emptyMessage={`[ ${empty} ]`}
      />
    </div>
  );
}

export default function StorageOpsView({ initialTab = 'locations' }) {
  const { siteId, storeCode } = useDarkStore();
  const [tab, setTab] = useState(initialTab);

  return (
    <StoreGate>
      {siteId && (
        <div>
          <div className="subtabs-rail" style={{ marginBottom: 12 }}>
            <div className="subtabs-list">
              <button className={`subtab-btn ${tab === 'locations' ? 'active' : ''}`} onClick={() => setTab('locations')}><MapPin size={12} /> Locations</button>
              <button className={`subtab-btn ${tab === 'bin-transfers' ? 'active' : ''}`} onClick={() => setTab('bin-transfers')}><ArrowRightLeft size={12} /> Bin Transfers</button>
              <button className={`subtab-btn ${tab === 'replenishment' ? 'active' : ''}`} onClick={() => setTab('replenishment')}><Boxes size={12} /> Replenishment</button>
              <button className={`subtab-btn ${tab === 'cycle-counts' ? 'active' : ''}`} onClick={() => setTab('cycle-counts')}><ClipboardCheck size={12} /> Cycle Counts</button>
            </div>
          </div>
          {tab === 'locations' && <Locations siteId={siteId} storeCode={storeCode} />}
          {tab === 'bin-transfers' && <BinTransfers />}
          {tab === 'replenishment' && <Replenishment siteId={siteId} />}
          {tab === 'cycle-counts' && <CycleCounts siteId={siteId} storeCode={storeCode} />}
        </div>
      )}
    </StoreGate>
  );
}
