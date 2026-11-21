import React, { useState, useEffect, useMemo } from 'react';
import DataTable from '../components/ui/DataTable';
import BarcodeGenerator from '../components/ui/BarcodeGenerator';
import { openBarcodePrintWindow } from '../utils/barcodeUtils';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { newId } from '../utils/id';

/**
 * Picklists tab — dark-store replenishment, end to end, all via backend APIs:
 *  1. CREATE: pick a destination dark store, add SKU lines (qty + bin) -> TransferOrder + PickTasks
 *  2. EXECUTE: scan bin barcode, scan each product barcode (or manual qty), proceed to next, drop to finish
 *  3. PACK & DISPATCH: build a TOTE LPN with contents, print its barcode, mark transfer IN_TRANSIT
 */
export default function PickListView() {
  const { facility, facilitiesList } = useAuth();
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);

  const [sites, setSites] = useState([]);
  const [skus, setSkus] = useState([]);
  const [barcodes, setBarcodes] = useState([]);
  const [locations, setLocations] = useState([]);
  const [pickTasks, setPickTasks] = useState([]);
  const [transfers, setTransfers] = useState([]);

  // Create form
  const [sourceSite, setSourceSite] = useState('');
  const [destSite, setDestSite] = useState('');
  const [lines, setLines] = useState([{ sku: '', qty: 10, bin: '' }]);

  // Execute flow
  const [activePicklist, setActivePicklist] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [binScan, setBinScan] = useState('');
  const [binConfirmed, setBinConfirmed] = useState(false);
  const [manualBin, setManualBin] = useState(false);
  const [prodScan, setProdScan] = useState('');
  const [manualQtyMode, setManualQtyMode] = useState(false);
  const [pickQty, setPickQty] = useState(1);

  // Pack flow
  const [packedLpn, setPackedLpn] = useState(null);

  const showNotice = (type, message) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 6000);
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [sitesRes, skusRes, barRes, locRes, tasksRes, trRes] = await Promise.all([
        fetchApi('/network/sites/'),
        fetchApi('/catalog/skus/'),
        fetchApi('/catalog/barcodes/'),
        fetchApi('/network/locations/'),
        fetchApi('/ds-ops/pick-tasks/'),
        fetchApi('/ds-ops/transfer-orders/'),
      ]);
      const sites = unwrapList(sitesRes);
      const skus = unwrapList(skusRes);
      const barcodes = unwrapList(barRes);
      const locations = unwrapList(locRes);
      const tasks = unwrapList(tasksRes);
      const transfers = unwrapList(trRes);
      if (sites) setSites(sites);
      if (skus) setSkus(skus);
      if (barcodes) setBarcodes(barcodes);
      if (locations) setLocations(locations);
      if (tasks) setPickTasks(tasks);
      if (transfers) setTransfers(transfers);
    } catch (e) {
      showNotice('error', `Failed to load data: ${describeError(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const warehouses = useMemo(
    () => sites.filter((s) => s.site_type === 'MH'),
    [sites]
  );
  const darkStores = useMemo(
    () => sites.filter((s) => s.site_type === 'DS'),
    [sites]
  );
  const skuMap = useMemo(() => {
    const m = {};
    skus.forEach((s) => { m[s.sku_id] = s; });
    return m;
  }, [skus]);
  const barcodeToSku = useMemo(() => {
    const m = {};
    barcodes.forEach((b) => { m[b.barcode] = b.sku; });
    return m;
  }, [barcodes]);
  const siteMap = useMemo(() => {
    const m = {};
    sites.forEach((s) => { m[s.site_id] = s; });
    return m;
  }, [sites]);

  const picklists = useMemo(() => {
    const groups = {};
    pickTasks.forEach((t) => {
      const key = t.picklist_id || 'UNASSIGNED';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return Object.entries(groups).map(([picklist_id, tasks]) => {
      const transfer = transfers.find((tr) => tr.transfer_id === tasks[0]?.batch);
      return {
        picklist_id,
        tasks,
        transfer,
        totalQty: tasks.reduce((a, t) => a + (t.qty || 0), 0),
        pickedQty: tasks.reduce((a, t) => a + (t.picked_qty || 0), 0),
        done: tasks.length > 0 && tasks.every((t) => t.status === 'COMPLETED' || (t.picked_qty || 0) >= (t.qty || 0)),
      };
    });
  }, [pickTasks, transfers]);

  useEffect(() => {
    if (!activePicklist && picklists.length > 0) setActivePicklist(picklists[0].picklist_id);
  }, [picklists, activePicklist]);

  const activeGroup = picklists.find((p) => p.picklist_id === activePicklist);
  const selectedTask = pickTasks.find((t) => String(t.id) === String(selectedTaskId));
  const remaining = selectedTask ? Math.max((selectedTask.qty || 0) - (selectedTask.picked_qty || 0), 0) : 0;

  // ---------- CREATE ----------
  const addLine = () => setLines((prev) => [...prev, { sku: '', qty: 10, bin: '' }]);
  const updateLine = (idx, field, value) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const createReplenishment = async () => {
    const validLines = lines.filter((l) => l.sku && Number(l.qty) > 0);
    if (!sourceSite || !destSite) return showNotice('error', 'Select source warehouse and destination dark store.');
    if (validLines.length === 0) return showNotice('error', 'Add at least one SKU line with quantity.');
    setLoading(true);
    try {
      const totalQty = validLines.reduce((a, l) => a + Number(l.qty), 0);
      const transfer = await postApi('/ds-ops/transfer-orders/', {
        source_site: sourceSite,
        dest_site: destSite,
        status: 'ALLOCATED',
        total_qty: totalQty,
      });
      const picklist_id = newId();
      for (let i = 0; i < validLines.length; i++) {
        const l = validLines[i];
        await postApi('/ds-ops/pick-tasks/', {
          picklist_id,
          batch: transfer.transfer_id,
          sku: l.sku,
          bin: l.bin || '',
          qty: Number(l.qty),
          picked_qty: 0,
          pick_seq: i + 1,
          status: 'NOT_STARTED',
        });
      }
      await patchApi(`/ds-ops/transfer-orders/${transfer.transfer_id}/`, { status: 'PICKING' });
      showNotice('success', `Picklist created: ${picklist_id.slice(0, 8)} with ${validLines.length} lines (${totalQty} units).`);
      setLines([{ sku: '', qty: 10, bin: '' }]);
      setActivePicklist(picklist_id);
      await loadAll();
    } catch (e) {
      showNotice('error', `Create failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ---------- EXECUTE ----------
  const confirmBin = () => {
    if (!selectedTask) return;
    if (manualBin || !selectedTask.bin || binScan.trim() === selectedTask.bin.trim()) {
      setBinConfirmed(true);
      showNotice('success', `Bin ${selectedTask.bin || '(manual)'} confirmed. Now scan products.`);
    } else {
      showNotice('error', `Wrong bin. Task expects ${selectedTask.bin}, scanned ${binScan}.`);
    }
  };

  const registerPick = async () => {
    if (!selectedTask) return;
    if (!binConfirmed) return showNotice('error', 'Confirm the bin first (step 1).');
    let resolvedSku = selectedTask.sku;
    if (!manualQtyMode) {
      if (!prodScan) return showNotice('error', 'Scan the product barcode first.');
      const found = barcodeToSku[prodScan.trim()];
      if (!found) return showNotice('error', `Unknown barcode ${prodScan}. Tick "manual qty" if this product has no barcode.`);
      if (String(found) !== String(selectedTask.sku)) {
        const expected = skuMap[selectedTask.sku];
        return showNotice('error', `Barcode belongs to ${skuMap[found]?.name || found}, but this task needs ${expected?.name || selectedTask.sku}.`);
      }
      resolvedSku = found;
    }
    const qtyToAdd = Math.min(Number(pickQty) || 0, remaining);
    if (qtyToAdd <= 0) return showNotice('error', 'Nothing left to pick on this task.');
    try {
      await postApi(`/ds-ops/pick-tasks/${selectedTask.id}/complete/`, {
        picked_qty: qtyToAdd,
      });
      showNotice('success', `Registered ${qtyToAdd} x ${skuMap[resolvedSku]?.name || resolvedSku}.`);
      setProdScan('');
      setPickQty(1);
      await loadAll();
      if (activeGroup) {
        const fresh = activeGroup.tasks.filter((t) => t.id !== selectedTask.id);
        const next = fresh.find((t) => (t.picked_qty || 0) < (t.qty || 0) && t.status !== 'COMPLETED');
        if (next) {
          setSelectedTaskId(next.id);
          setBinScan('');
          setBinConfirmed(false);
        } else {
          setSelectedTaskId(null);
          setBinScan('');
          setBinConfirmed(false);
        }
      }
    } catch (e) {
      showNotice('error', `Pick failed: ${e.message}`);
    }
  };

  const finishPicklist = async () => {
    if (!activeGroup) return;
    const remainingTasks = activeGroup.tasks.filter((t) => (t.picked_qty || 0) < (t.qty || 0));
    if (remainingTasks.length > 0) {
      const desc = remainingTasks
        .map((t) => `${skuMap[t.sku]?.name || t.sku}: ${(t.qty || 0) - (t.picked_qty || 0)} left @ ${t.bin || 'no bin'}`)
        .join('; ');
      return showNotice('error', `Not done — remaining: ${desc}`);
    }
    showNotice('success', 'Picklist complete. Build the TOTE below to pack & dispatch.');
  };

  // ---------- PACK & DISPATCH ----------
  const packAndDispatch = async () => {
    if (!activeGroup || !activeGroup.done) return showNotice('error', 'Finish all picks before packing.');
    const transfer = activeGroup.transfer;
    if (!transfer) return showNotice('error', 'No transfer order linked to this picklist.');
    setLoading(true);
    try {
      const lpnBarcode = `TOTE-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const lpn = await postApi('/inventory/lpns/', {
        lpn_id: lpnBarcode,
        barcode: lpnBarcode,
        lpn_type: 'TOTE',
        current_site: transfer.source_site,
        source_site: transfer.source_site,
        dest_site: transfer.dest_site,
        status: 'PACKED',
        created_by: 'WMS-UI',
      });
      const packlist_id = newId();
      for (const t of activeGroup.tasks) {
        let lots = await fetchApi(`/catalog/lots/?sku=${t.sku}&site=${transfer.source_site}`);
        let lotId = Array.isArray(lots) && lots.length > 0 ? lots[0].lot_id : null;
        if (!lotId) {
          const lot = await postApi('/catalog/lots/', {
            sku: t.sku,
            site: transfer.source_site,
            batch_number: `B-${new Date().getFullYear()}-WH`,
            bucket: 'Good',
            status: 'AVAILABLE',
          });
          lotId = lot.lot_id;
        }
        await postApi('/inventory/lpn-contents/', { lpn: lpn.lpn_id, sku: t.sku, lot: lotId, qty: t.qty });
        await postApi('/ds-ops/pack-tasks/', {
          packlist_id,
          lpn: lpn.barcode,
          sku: t.sku,
          qty: t.qty,
          packed_qty: t.qty,
          status: 'COMPLETED',
        });
      }
      await patchApi(`/ds-ops/transfer-orders/${transfer.transfer_id}/`, { status: 'IN_TRANSIT' });
      setPackedLpn({ ...lpn, destName: siteMap[transfer.dest_site]?.name || transfer.dest_site, totalUnits: activeGroup.totalQty, lines: activeGroup.tasks.length });
      showNotice('success', `TOTE ${lpn.barcode} packed (${activeGroup.totalQty} units) and dispatched.`);
      await loadAll();
    } catch (e) {
      showNotice('error', `Pack failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const facilityLabel = facility?.code || facility?.name || 'Warehouse';

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Dark-Store Replenishment — Pick, Pack &amp; Dispatch</h1>
          <p style={{ color: '#64748b', margin: '4px 0 0' }}>
            Logged in at {facilityLabel} · every step reads/writes the backend APIs below
          </p>
        </div>
        <button className="btn-secondary" onClick={loadAll} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh from API'}
        </button>
      </header>

      {notice && (
        <div style={{
          background: notice.type === 'success' ? '#d1e7dd' : '#f8d7da',
          border: `1px solid ${notice.type === 'success' ? '#198754' : '#dc3545'}`,
          color: notice.type === 'success' ? '#155724' : '#721c1e',
          padding: '10px 14px', margin: '14px 0', borderRadius: 6,
        }}>
          {notice.message}
        </div>
      )}

      {/* STEP 1 — CREATE */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Step 1 · Create replenishment picklist <span style={{ fontWeight: 400, fontSize: 12, color: '#64748b' }}>POST /ds-ops/transfer-orders/ + POST /ds-ops/pick-tasks/</span></h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label>Source warehouse
            <select value={sourceSite} onChange={(e) => setSourceSite(e.target.value)} style={{ display: 'block', padding: 8, minWidth: 240 }}>
              <option value="">— select —</option>
              {(warehouses.length ? warehouses : facilitiesList.warehouses || []).map((s) => (
                <option key={s.site_id || s.code} value={s.site_id || s.code}>{s.name || s.code}</option>
              ))}
            </select>
          </label>
          <label>Destination dark store
            <select value={destSite} onChange={(e) => setDestSite(e.target.value)} style={{ display: 'block', padding: 8, minWidth: 240 }}>
              <option value="">— select —</option>
              {(darkStores.length ? darkStores : facilitiesList.dark_stores || []).map((s) => (
                <option key={s.site_id || s.code} value={s.site_id || s.code}>{s.name || s.code}</option>
              ))}
            </select>
          </label>
        </div>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label>SKU
              <select value={l.sku} onChange={(e) => updateLine(i, 'sku', e.target.value)} style={{ display: 'block', padding: 8, minWidth: 260 }}>
                <option value="">— select product —</option>
                {skus.map((s) => (
                  <option key={s.sku_id} value={s.sku_id}>{s.name} ({s.sku_code})</option>
                ))}
              </select>
            </label>
            <label>Qty
              <input type="number" min="1" value={l.qty} onChange={(e) => updateLine(i, 'qty', e.target.value)} style={{ display: 'block', padding: 8, width: 90 }} />
            </label>
            <label>Bin (scan or type)
              <input value={l.bin} onChange={(e) => updateLine(i, 'bin', e.target.value)} placeholder="e.g. A-01-02-04" style={{ display: 'block', padding: 8, width: 180 }} list="bin-options" />
              <datalist id="bin-options">
                {locations.filter((loc) => !sourceSite || String(loc.site) === String(sourceSite)).slice(0, 50).map((loc) => (
                  <option key={loc.location_id} value={loc.barcode} />
                ))}
              </datalist>
            </label>
            <button className="btn-secondary" onClick={() => removeLine(i)} disabled={lines.length === 1}>Remove</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={addLine}>+ Add line</button>
          <button className="btn-primary" onClick={createReplenishment} disabled={loading}>Create picklist</button>
        </div>
      </div>

      {/* STEP 2 — EXECUTE */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Step 2 · Execute pick <span style={{ fontWeight: 400, fontSize: 12, color: '#64748b' }}>GET /ds-ops/pick-tasks/ · PATCH /ds-ops/pick-tasks/:id/</span></h3>
        <label>Picklist
          <select value={activePicklist} onChange={(e) => { setActivePicklist(e.target.value); setSelectedTaskId(null); setBinScan(''); setBinConfirmed(false); }} style={{ display: 'block', padding: 8, minWidth: 320, marginBottom: 12 }}>
            <option value="">— select —</option>
            {picklists.map((p) => (
              <option key={p.picklist_id} value={p.picklist_id}>
                {p.picklist_id.slice(0, 8)} · {p.pickedQty}/{p.totalQty} picked {p.done ? '· DONE' : ''}
              </option>
            ))}
          </select>
        </label>
        {activeGroup && (
          <DataTable
            title={`Picklist ${activeGroup.picklist_id.slice(0, 8)} — scan bin, then each product`}
            subtitle={`Transfer ${activeGroup.transfer ? `${siteMap[activeGroup.transfer.source_site]?.code || ''} → ${siteMap[activeGroup.transfer.dest_site]?.code || ''} (${activeGroup.transfer.status})` : 'no linked transfer'}`}
            columns={[
              { header: 'SKU', render: (r) => <strong>{skuMap[r.sku]?.name || String(r.sku).slice(0, 8)}</strong> },
              { header: 'Code', render: (r) => <span className="code-cell">{skuMap[r.sku]?.sku_code || '—'}</span> },
              { header: 'Bin', render: (r) => <span className="location-pill">{r.bin || '—'}</span> },
              { header: 'Zone', render: (r) => r.zone || '—' },
              { header: 'Qty', align: 'right', render: (r) => r.qty },
              { header: 'Picked', align: 'right', render: (r) => <strong style={{ color: '#047857' }}>{r.picked_qty || 0}</strong> },
              { header: 'Status', render: (r) => <span className="badge badge-info">{r.status}</span> },
              {
                header: 'Action', render: (r) => (
                  <button className="btn-primary" style={{ fontSize: 11, padding: '3px 8px', height: 26 }} onClick={() => { setSelectedTaskId(r.id); setBinScan(''); setBinConfirmed(false); setProdScan(''); }}>
                    {String(selectedTaskId) === String(r.id) ? 'Selected ✓' : 'Pick this'}
                  </button>
                ),
              },
            ]}
            data={activeGroup.tasks}
          />
        )}

        {selectedTask && (
          <div style={{ border: '2px solid var(--accent-purple)', borderRadius: 8, padding: 16, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Picking: {skuMap[selectedTask.sku]?.name || selectedTask.sku} — {remaining} left @ {selectedTask.bin || 'no bin assigned'}</h3>
            <div style={{ marginBottom: 12 }}>
              <label>1 · Scan bin barcode
                <input value={binScan} onChange={(e) => setBinScan(e.target.value)} placeholder="Scan bin…" style={{ display: 'block', padding: 8, width: '100%', maxWidth: 360 }} />
              </label>
              <label style={{ display: 'block', marginTop: 6, fontSize: 13 }}>
                <input type="checkbox" checked={manualBin} onChange={(e) => setManualBin(e.target.checked)} /> Bin has no readable barcode — confirm manually
              </label>
              <button className="btn-secondary" onClick={confirmBin} style={{ marginTop: 6 }} disabled={binConfirmed}>
                {binConfirmed ? 'Bin confirmed ✓' : 'Confirm bin'}
              </button>
            </div>
            <div>
              <label>2 · Scan product barcode
                <input value={prodScan} onChange={(e) => setProdScan(e.target.value)} placeholder="Scan product…" disabled={!binConfirmed} style={{ display: 'block', padding: 8, width: '100%', maxWidth: 360 }} />
              </label>
              <label style={{ display: 'block', marginTop: 6, fontSize: 13 }}>
                <input type="checkbox" checked={manualQtyMode} onChange={(e) => setManualQtyMode(e.target.checked)} /> Product has no barcode — enter quantity manually
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6 }}>
                <label>Qty
                  <input type="number" min="1" max={remaining} value={pickQty} onChange={(e) => setPickQty(e.target.value)} style={{ display: 'block', padding: 8, width: 90 }} />
                </label>
                <button className="btn-primary" onClick={registerPick} disabled={!binConfirmed}>Register pick &amp; proceed</button>
              </div>
            </div>
          </div>
        )}

        {activeGroup && (
          <div style={{ marginTop: 12 }}>
            <button className="btn-primary" onClick={finishPicklist}>Drop — finish picklist</button>
          </div>
        )}
      </div>

      {/* STEP 3 — PACK & DISPATCH */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Step 3 · Pack TOTE &amp; dispatch <span style={{ fontWeight: 400, fontSize: 12, color: '#64748b' }}>POST /inventory/lpns/ + /lpn-contents/ + /ds-ops/pack-tasks/ · PATCH transfer → IN_TRANSIT</span></h3>
        {!activeGroup?.done ? (
          <p style={{ color: '#64748b' }}>Complete all picks in Step 2 first — the TOTE is built from the finished picklist.</p>
        ) : (
          <div>
            <ul>
              {activeGroup.tasks.map((t) => (
                <li key={t.id}>{skuMap[t.sku]?.name || t.sku} — {t.qty} units</li>
              ))}
            </ul>
            <p>Destination: <strong>{activeGroup.transfer ? (siteMap[activeGroup.transfer.dest_site]?.name || activeGroup.transfer.dest_site) : '—'}</strong></p>
            <button className="btn-primary" onClick={packAndDispatch} disabled={loading}>Pack TOTE &amp; dispatch</button>
          </div>
        )}
        {packedLpn && (
          <div style={{ marginTop: 16, border: '1px dashed #94a3b8', borderRadius: 8, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>TOTE {packedLpn.barcode} → {packedLpn.destName}</h3>
            <BarcodeGenerator value={packedLpn.barcode} />
            <div style={{ marginTop: 8 }}>
              <button className="btn-secondary" onClick={() => openBarcodePrintWindow({ barcode: packedLpn.barcode, destination_name: packedLpn.destName, total_units: packedLpn.totalUnits, items: activeGroup?.tasks || [] })}>
                Print TOTE label
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
