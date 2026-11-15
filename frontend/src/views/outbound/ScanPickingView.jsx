import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScanLine, Package, MapPin,
  RefreshCw, ChevronRight, Boxes, ClipboardList,
  QrCode, SkipForward, CircleCheck, Send, X,
} from "lucide-react";
import ScanInput from "../../components/ui/ScanInput";
import StatusBadge from "../../components/ui/StatusBadge";

import { useToast } from "../../components/ui/Toast";
import { fetchApi, patchApi, unwrapList, describeError } from "../../api/client";

/**
 * Wave / scan picking for Mother Hub outbound.
 *
 * The operator opens a picklist, then for each line:
 *   Step 1 — Walk to the bin and scan its barcode to confirm location
 *   Step 2 — Scan each product unit until the quantity is met
 *   Loop   — Move to the next line automatically
  *   Done   — Mark the batch as picked and hand it to the packing station
  */
const norm = (v) => String(v ?? "").trim().toUpperCase();

function asList(payload, what) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${what} returned an unrecognised payload shape.`);
  return rows;
}

export default function ScanPickingView() {
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [batch, setBatch] = useState(null);
  const [lines, setLines] = useState([]);
  const [lineIdx, setLineIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [scanText, setScanText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [scanDrawerOpen, setScanDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [r1, r2, skuRows] = await Promise.all([
        fetchApi("/outbound/picklists/?status=GENERATED&page_size=100").catch(() => ({ results: [] })),
        fetchApi("/outbound/picklists/?status=IN_PROGRESS&page_size=100").catch(() => ({ results: [] })),
        fetchApi("/catalog/skus/?page_size=1000"),
      ]);
      const all = [...(unwrapList(r1) || []), ...(unwrapList(r2) || [])];
      setBatches(all);
      setSkus(asList(skuRows, "/catalog/skus/"));
    } catch (e) {
      setLoadError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const skuById = useMemo(() => {
    const m = {};
    skus.forEach(s => { m[String(s.sku_id || s.id)] = s; });
    return m;
  }, [skus]);

  const openBatch = async (b) => {
    setBusy(true);
    try {
      const id = b.picklist_id || b.batch_id || b.id;
      const raw = await fetchApi(`/outbound/picklist-lines/?picklist=${id}&page_size=500`).catch(() => null);
      let lineList = [];
      if (raw) {
        lineList = (unwrapList(raw) || []).map(l => {
          const sku = skuById[String(l.sku)] || null;
          return {
            ...l,
            skuCode: sku?.sku_code || l.sku_code || l.sku,
            name: sku?.name || l.product_name || `SKU ${l.sku}`,
            ean: sku?.ean || l.ean || "",
            qty: Number(l.ordered_qty || l.quantity || l.qty) || 1,
            scanned: 0,
            done: false,
          };
        });
      }
      if (lineList.length === 0) {
        // Never invent a line: a picklist with no readable lines must say so,
        // not send the picker to a made-up bin.
        toast.error("This picklist has no lines", "Nothing can be picked until its lines are generated.");
        return;
      }
      setBatch(b); setLines(lineList); setLineIdx(0);
      setScanText(""); setFeedback(null); setStep(1);
    } catch (e) {
      toast.error("Could not load picklist lines", describeError(e));
    } finally { setBusy(false); }
  };

  const currentLine = lines[lineIdx] || null;

  const onScanBin = (code) => {
    if (!currentLine) return;
    const expected = norm(currentLine.bin_code || currentLine.from_location || "");
    const scanned = norm(code);
    if (expected && expected !== scanned) {
      setFeedback({
        type: "error",
        message: `Wrong bin. Expected ${currentLine.bin_code || currentLine.from_location}, scanned "${code}".`,
      });
      return;
    }
    setScanText("");
    setFeedback({ type: "ok", message: `Bin confirmed. Now scan ${currentLine.qty}× ${currentLine.skuCode}.` });
    setStep(2);
  };

  const onScanItem = async (code) => {
    if (!currentLine) return;
    const scanned = norm(code);
    const accepted = [currentLine.skuCode, currentLine.ean, currentLine.sku].filter(Boolean).map(norm);
    if (!accepted.includes(scanned)) {
      setFeedback({ type: "error", message: `Wrong product. Need ${currentLine.skuCode}, scanned "${code}".` });
      return;
    }
    const need = Number(currentLine.qty) || 0;
    if (need <= 0) {
      setFeedback({ type: "error", message: "This line has no quantity to pick. Report it before scanning." });
      return;
    }
    const next = currentLine.scanned + 1;
    if (next > need) {
      setFeedback({
        type: "error",
        message: `This line only needs ${need}. Do not pick more; move to the next line.`,
      });
      return;
    }

    if (next < need) {
      setLines(lines.map((l, i) => i === lineIdx ? { ...l, scanned: next } : l));
      setScanText("");
      setFeedback({ type: "ok", message: `${next} of ${need} scanned. Keep going...` });
      return;
    }

    // The line is full. Record it before moving the picker on: a rejected
    // write must not look like a completed line.
    setBusy(true);
    try {
      const lid = currentLine.line_id;
      if (lid && lid !== "stub") {
        await patchApi(`/outbound/picklist-lines/${lid}/`, { status: "PICKED", scanned_qty: next });
      }
      const completedLines = lines.map((l, i) => (
        i === lineIdx ? { ...l, scanned: next, done: true } : l
      ));
      setLines(completedLines);
      setScanText("");
      const nextIdx = lineIdx + 1;
      if (nextIdx >= completedLines.length) {
        toast.success("All lines picked!", "Move the items to the packing station.");
        setStep(3);
      } else {
        setLineIdx(nextIdx); setStep(1);
        setFeedback({
          type: "ok",
          message: `Line ${lineIdx + 1} complete (${next}/${need}). Next bin: ${completedLines[nextIdx].bin_code || "-"}`,
        });
      }
    } catch (e) {
      setFeedback({
        type: "error",
        message: `Could not record the last unit: ${describeError(e)}. Scan it again.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const onScan = (code) => {
    if (step === 1) onScanBin(code);
    else if (step === 2) onScanItem(code);
  };

  const resetSession = () => {
    setBatch(null); setLines([]); setLineIdx(0);
    setScanText(""); setFeedback(null); setStep(0);
  };

  const completeBatch = async () => {
    if (!batch) return;
    setBusy(true);
    try {
      const id = batch.picklist_id || batch.batch_id || batch.id;
      // No swallow: closing the batch is the handover. If the server refuses,
      // the picker must stay on this screen and see why.
      await patchApi(`/outbound/picklists/${id}/`, { status: "PICKED" });
      toast.success("Batch closed", "Hand it over to the packing station.");
      await load(); resetSession();
    } catch (e) {
      toast.error("Could not close batch", describeError(e));
      setFeedback({ type: "error", message: `Could not close the batch: ${describeError(e)}` });
    }
    finally { setBusy(false); }
  };

  /* ── No batch: the queue ── */
  if (!batch) {
    return (
      <div className="workspace-viewport animate-in">
        <div className="page-header">
          <div className="page-header-info">
            <div className="page-title">
              <ClipboardList size={20} style={{ color: 'var(--accent)' }} />
              Wave Picking Queue
            </div>
            <div className="page-subtitle">Choose a wave batch, scan the bin, then scan each unit until qty is met.</div>
          </div>
          <div className="page-actions">
            <button className="btn-primary" onClick={load} disabled={loading}>
              <RefreshCw size={16} /> Refresh Queue
            </button>
          </div>
        </div>

        {loadError && (
          <div className="card" style={{ borderColor: 'var(--danger-border)' }}>
            <div className="badge badge-danger" style={{ marginBottom: 8 }}>Load Error</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{loadError}</div>
          </div>
        )}

        {!loading && !loadError && batches.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Boxes size={40} /></div>
            <div className="empty-state-title">No open picklists</div>
            <div className="empty-state-desc">
              Picklists appear here when a wave is generated for outbound orders.
            </div>
          </div>
        )}

        {batches.length > 0 && (
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <Boxes size={16} />
                <span>Open Picklists</span>
              </div>
              <span className="badge badge-purple">{batches.length}</span>
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '30%' }}>Picklist</th>
                    <th>Destination</th>
                    <th className="mono-num">Units</th>
                    <th className="code-cell">Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody data-testid="pick-queue">
                  {batches.map((b) => {
                    const id = b.picklist_id || b.batch_id || b.id;
                    return (
                      <tr key={id} data-testid={`pick-batch-${id}`}>
                        <td className="code-cell">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <QrCode size={13} style={{ color: 'var(--accent)' }} />
                            {b.picklist_no || b.batch_no || `PICK-${String(id).slice(0, 8)}`}
                          </div>
                        </td>
                        <td>{b.dest_site_name || b.destination || '—'}</td>
                        <td className="mono-num">{b.total_qty || '—'}</td>
                        <td><StatusBadge status={b.status} /></td>
                        <td>
                          <button
                            className="btn-primary"
                            style={{ minHeight: 32, fontSize: 12, padding: '6px 10px' }}
                            onClick={() => openBatch(b)}
                            disabled={busy}
                            data-testid={`pick-open-${id}`}
                          >
                            <ChevronRight size={14} /> Start
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Active picklist ── */
  const totalLines = lines.length;
  const doneCount = lines.filter(l => l.done).length;
  const batchId = batch.picklist_id || batch.batch_id || batch.id;

  return (
    <div className="workspace-viewport animate-in">
      <div className="page-header">
        <div className="page-header-info">
          <div className="page-title">
            <QrCode size={20} style={{ color: 'var(--accent)' }} />
            <span className="code-cell">
              {batch.picklist_no || `PICK-${String(batchId).slice(0, 8)}`}
            </span>
          </div>
          <div className="page-subtitle">
            Destination: <strong>{batch.dest_site_name || batch.destination || '—'}</strong>
          </div>
        </div>
        <div className="page-actions">
          <span className="mono-num" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {doneCount}/{totalLines} lines done
          </span>
          <button className="btn-ui neutral" onClick={resetSession} data-testid="pick-back">
            <X size={14} /> Back to queue
          </button>
        </div>
      </div>

      {/* All done: completion panel */}
      {step === 3 ? (
        <div className="card" style={{ textAlign: 'center', padding: '32px 24px', borderColor: 'var(--success-border)' }}>
          <CircleCheck size={44} style={{ color: 'var(--success)', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--success)', marginBottom: 6 }}>
            All Lines Picked
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Move the items to the packing station. Seal and print the tote label.
          </div>
          <div className="page-actions" style={{ justifyContent: 'center' }}>
            <button
              className="btn-success"
              onClick={completeBatch}
              disabled={busy}
              data-testid="pick-complete"
            >
              <Send size={14} /> Mark Batch Picked &amp; Advance to Packing
            </button>
            <button className="btn-ui neutral" onClick={resetSession} data-testid="pick-back-done">
              Back to Queue
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">
                <Package size={16} />
                <span>Pick Lines Manifest — {totalLines} item{totalLines === 1 ? '' : 's'}</span>
              </div>
              <div className="card-subtitle">
                Current active item: <strong className="code-cell">{currentLine?.skuCode}</strong> at location <strong>{currentLine?.bin_code || currentLine?.from_location || '—'}</strong>
              </div>
            </div>
            <div className="card-actions">
              <button
                type="button"
                className="btn-ui primary"
                onClick={() => setScanDrawerOpen(true)}
                data-testid="pick-open-scanner"
              >
                <ScanLine size={15} /> Open Scanner
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lines.map((l, i) => {
              const isActive = i === lineIdx && step < 3;
              const isDone = l.done;
              return (
                <div
                  key={l.line_id || i}
                  className={`item-row${isActive ? ' item-row--active' : isDone ? ' item-row--done' : ''}`}
                  data-testid={`pick-line-${i}`}
                  onClick={() => {
                    setLineIdx(i);
                    setScanDrawerOpen(true);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="item-row-index">{i + 1}</div>
                  <div className="item-row-info">
                    <div className="item-row-name">
                      <span className="code-cell" style={{ fontSize: 12 }}>{l.skuCode}</span>{' '}
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{l.name}</span>
                    </div>
                    <div className="item-row-meta">
                      <span><MapPin size={11} /> {l.bin_code || l.from_location || '—'}</span>
                      {l.zone && <span>Zone {l.zone}</span>}
                    </div>
                  </div>
                  <div className="item-row-qty" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>{l.scanned}/{l.qty}</span>
                    {isActive && (
                      <button
                        type="button"
                        className="btn-ui primary"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setScanDrawerOpen(true);
                        }}
                      >
                        <ScanLine size={12} /> Scan
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn-ui primary"
              onClick={() => setScanDrawerOpen(true)}
            >
              <ScanLine size={15} /> Open Scanner Drawer
            </button>
            <button className="btn-ui neutral" onClick={resetSession}>
              Back to Queue
            </button>
          </div>
        </div>
      )}

      {/* Slide-out Z-Drawer for Guided Wave Picking */}
      {scanDrawerOpen && step < 3 && (
        <div className="scan-drawer-backdrop" onClick={() => setScanDrawerOpen(false)}>
          <div className="scan-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="scan-drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ScanLine size={18} color="var(--accent)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  {step === 1 ? 'Scan Bin Location' : 'Scan Product Units'}
                </h3>
              </div>
              <button
                type="button"
                className="btn-ui neutral icon"
                onClick={() => setScanDrawerOpen(false)}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="scan-drawer-body">
              <div className="entity-card" style={{ marginBottom: 10 }}>
                <div className="entity-card__thumb"><MapPin size={20} /></div>
                <div className="entity-card__body">
                  <div className="entity-card__title">Target Bin Location</div>
                  <div className="entity-card__meta">
                    <span className="mono-num" style={{ fontWeight: 700, fontSize: 14 }}>
                      {currentLine?.bin_code || currentLine?.from_location || '—'}
                    </span>
                    {currentLine?.zone && <span style={{ marginLeft: 6 }}>(Zone {currentLine.zone})</span>}
                  </div>
                </div>
              </div>

              <div className="entity-card" style={{ marginBottom: 14 }}>
                <div className="entity-card__thumb"><Package size={20} /></div>
                <div className="entity-card__body">
                  <div className="entity-card__title">{currentLine?.name || currentLine?.skuCode}</div>
                  <div className="entity-card__meta">
                    <span className="mono-num">{currentLine?.skuCode}</span>
                    <span style={{ marginLeft: 8 }}>Progress: <strong>{currentLine?.scanned}/{currentLine?.qty}</strong></span>
                  </div>
                </div>
              </div>

              <ScanInput
                label={
                  step === 1
                    ? `Step 1 · Scan bin ${currentLine?.bin_code || '—'}`
                    : `Step 2 · Scan product (${currentLine?.scanned}/${currentLine?.qty})`
                }
                placeholder={
                  step === 1
                    ? 'Scan the bin barcode or QR code…'
                    : `Scan ${currentLine?.skuCode || 'product'} barcode…`
                }
                value={scanText}
                onChange={setScanText}
                onScan={onScan}
                busy={busy}
                feedback={feedback}
                autoFocus
                dataTestId="pick-scan"
              />

              {step === 1 && (
                <div style={{ marginTop: 12 }}>
                  <button
                    className="btn-ui neutral"
                    style={{ fontSize: 12, width: '100%' }}
                    onClick={() => {
                      setFeedback({ type: 'ok', message: 'Bin acknowledged manually. Now scan the product.' });
                      setStep(2);
                    }}
                    data-testid="pick-skip-bin"
                  >
                    <SkipForward size={13} /> Acknowledge bin manually (no barcode)
                  </button>
                </div>
              )}

              <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn-ui neutral"
                  style={{ flex: 1 }}
                  onClick={() => setScanDrawerOpen(false)}
                >
                  Close Drawer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Scan Action Button */}
      {!scanDrawerOpen && step < 3 && (
        <button
          type="button"
          className="scan-floating-trigger"
          onClick={() => setScanDrawerOpen(true)}
          title="Open Scanner Drawer"
        >
          <ScanLine size={18} />
          <span>
            {step === 1
              ? `Scan Bin (${currentLine?.bin_code || '—'})`
              : `Scan Item (${currentLine?.scanned}/${currentLine?.qty})`}
          </span>
        </button>
      )}
    </div>
  );
}
