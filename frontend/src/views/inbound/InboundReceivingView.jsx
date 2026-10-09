import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageCheck, Package, RefreshCw, AlertTriangle, Boxes, ScanLine, Truck, Send, XCircle, Building2, Store } from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
import WorkflowStepper from '../../components/ui/WorkflowStepper';
import ProgressRing from '../../components/ui/ProgressRing';
import ProductCard from '../../components/ui/ProductCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';

/**
 * Scan-first goods receipt: "Register batches by scanning".
 *
 * The loop is physical, not clerical — a pallet arrives, its batch/LPN is
 * scanned, then every unit is scanned while received-vs-expected tallies live.
 * Nothing is invented client-side: the expected side comes from AsnLine, the
 * received side is persisted to GrnLine.received_qty on every single scan, and
 * "Complete Receiving" is the real GrnViewSet.complete action that closes the
 * GRN, closes the ASN and mints the putaway tasks.
 */
const STEPS = [
  { key: 'asn', title: 'Open Consignment', description: 'Scan the consignment, or pick one from the queue' },
  { key: 'batch', title: 'Scan Batch', description: 'Scan the vendor batch / LPN on the pallet' },
  { key: 'units', title: 'Scan Products', description: 'Scan each unit — received vs expected tallies live' },
  { key: 'close', title: 'Complete', description: 'Close the GRN and release putaway' },
];

/**
 * Only these ASN states can still be received against. An unfiltered
 * /supply/asns/ page is ordered -created_at, so in a database where the
 * pipeline already ran it returns nothing but CLOSED history and the receipt
 * queue looks empty.
 */
const OPEN_ASN_STATUS = ['CONFIRMED', 'ARRIVED', 'GRN_IN_PROGRESS'];

/** InventoryLot.batch_number is max_length=30; a scanned LPN can be longer. */
const BATCH_MAX = 30;

const norm = (v) => String(v ?? '').trim().toUpperCase();

/**
 * unwrapList() returns null for a payload it does not recognise. Collapsing that
 * to [] is what made a broken endpoint indistinguishable from an empty queue, so
 * an unrecognisable shape is raised instead.
 */
function asList(payload, what) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${what} returned an unrecognised payload shape.`);
  return rows;
}

/** Expected (AsnLine) joined with received (GrnLine) and the catalog SKU. */
function joinLines(asnLines, grnLines, skuById) {
  const byAsnLine = new Map(grnLines.map((g) => [String(g.asn_line), g]));
  const covered = new Set();

  const rows = asnLines.map((al) => {
    const gl = byAsnLine.get(String(al.line_id)) || null;
    covered.add(String(al.line_id));
    const sku = skuById[String(al.sku)] || null;
    return {
      key: String(al.line_id),
      asnLine: al,
      grnLine: gl,
      grnId: gl ? gl.line_id : null,
      skuId: al.sku,
      name: sku?.name || `SKU ${al.sku}`,
      skuCode: sku?.sku_code || al.sku,
      ean: al.ean || sku?.ean || '',
      expected: Number(al.ordered_qty) || 0,
      received: Number(gl?.received_qty) || 0,
    };
  });

  // Never hide a receipt line that has no matching expected line.
  grnLines
    .filter((g) => g.asn_line && !covered.has(String(g.asn_line)))
    .forEach((g) => {
      const sku = skuById[String(g.sku)] || null;
      rows.push({
        key: `orphan-${g.line_id}`,
        asnLine: null,
        grnLine: g,
        grnId: g.line_id,
        skuId: g.sku,
        name: sku?.name || `SKU ${g.sku}`,
        skuCode: sku?.sku_code || g.sku,
        ean: sku?.ean || '',
        expected: Number(g.ordered_qty) || 0,
        received: Number(g.received_qty) || 0,
      });
    });

  return rows;
}

export default function InboundReceivingView() {
  const toast = useToast();
  const { user } = useAuth();

  const [asns, setAsns] = useState([]);
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [asn, setAsn] = useState(null);
  const [grn, setGrn] = useState(null);
  const [lines, setLines] = useState([]);
  const [batchCode, setBatchCode] = useState('');
  const [step, setStep] = useState(0);
  const [scanText, setScanText] = useState('');
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [rejects, setRejects] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      // One server-side filter per receivable status — never an unfiltered page.
      const [statusLists, skuRows] = await Promise.all([
        Promise.all(
          OPEN_ASN_STATUS.map((s) => fetchApi(`/supply/asns/?status=${s}&page_size=100`))
        ),
        // AsnLine.sku / GrnLine.sku are Sku UUIDs, so the codes a worker
        // actually scans have to be resolved from the catalog.
        fetchApi('/catalog/skus/?page_size=1000'),
      ]);

      const seen = new Set();
      const open = [];
      statusLists.forEach((payload, i) => {
        asList(payload, `/supply/asns/?status=${OPEN_ASN_STATUS[i]}`).forEach((a) => {
          const id = String(a.asn_id);
          if (seen.has(id)) return;
          seen.add(id);
          open.push(a);
        });
      });
      setAsns(open);
      setSkus(asList(skuRows, '/catalog/skus/'));
    } catch (e) {
      setLoadError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const skuById = useMemo(() => {
    const map = {};
    skus.forEach((s) => { map[String(s.sku_id)] = s; });
    return map;
  }, [skus]);

  const skuForCode = useCallback(
    (code) => {
      const want = norm(code);
      if (!want) return null;
      return skus.find((s) => [s.sku_code, s.ean, s.sku_id].some((v) => norm(v) === want)) || null;
    },
    [skus]
  );

  const resetReceipt = () => {
    setAsn(null);
    setGrn(null);
    setLines([]);
    setBatchCode('');
    setScanText('');
    setFeedback(null);
    setRejects([]);
    setStep(0);
  };

  /* ── Step 1: resolve a consignment from a scan ── */
  const onScanConsignment = async (code) => {
    setBusy(true);
    setFeedback(null);
    try {
      // AsnViewSet.search_fields covers asn_no and po_ref; a bare asn_id is
      // matched locally because ?search= does not index the primary key.
      const rows = asList(
        await fetchApi(`/supply/asns/?search=${encodeURIComponent(code)}&page_size=50`),
        '/supply/asns/?search='
      );
      const want = norm(code);
      const hit =
        rows.find((a) => norm(a.asn_no) === want || norm(a.po_ref) === want || String(a.asn_id) === code) ||
        (rows.length === 1 ? rows[0] : null);

      if (!hit) {
        setFeedback({
          type: 'error',
          message: rows.length
            ? `"${code}" matches ${rows.length} consignments (${rows.map((a) => a.asn_no).join(', ')}). Scan the exact ASN number.`
            : `No consignment matches "${code}".`,
        });
        return;
      }
      if (!OPEN_ASN_STATUS.includes(String(hit.status).toUpperCase())) {
        setFeedback({ type: 'error', message: `${hit.asn_no} is ${hit.status} and can no longer be received.` });
        return;
      }
      setAsn(hit);
      setScanText('');
      setFeedback({ type: 'ok', message: `${hit.asn_no} selected. Now scan the batch / LPN on the pallet.` });
      setStep(1);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 2: scan the batch, provision the receipt, load expected lines ── */
  const onScanBatch = async (code) => {
    if (!asn) {
      setFeedback({ type: 'error', message: 'Select a consignment first.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      // One GRN per consignment. `?asn=` is a real filterset field; without it
      // this returned every GRN in the system and the first one was adopted.
      const existing = asList(
        await fetchApi(`/supply/grns/?asn=${encodeURIComponent(asn.asn_id)}&page_size=50`),
        '/supply/grns/?asn='
      );

      let receipt = existing[0] || null;
      if (!receipt) {
        receipt = await postApi('/supply/grns/', {
          grn_no: `GRN-${asn.asn_no}`.slice(0, 50),
          asn: asn.asn_id,
          mode: 'LPN_SCAN',
          status: 'IN_PROGRESS',
        });
      } else if (String(receipt.status).toUpperCase() !== 'COMPLETED') {
        receipt = await patchApi(`/supply/grns/${receipt.grn_id}/`, { status: 'IN_PROGRESS' });
      }

      // Expected side: the ASN lines. Received side: the GRN lines, seeded from
      // the ASN so every expected line has somewhere to record a tally.
      const asnLines = asList(
        await fetchApi(`/supply/asn-lines/?asn=${encodeURIComponent(asn.asn_id)}&page_size=200`),
        '/supply/asn-lines/?asn='
      );
      if (asnLines.length === 0) {
        setFeedback({ type: 'error', message: `${asn.asn_no} has no expected lines to receive against.` });
        return;
      }

      let grnLines = asList(
        await fetchApi(`/supply/grn-lines/?grn=${encodeURIComponent(receipt.grn_id)}&page_size=200`),
        '/supply/grn-lines/?grn='
      );

      const missing = asnLines.filter(
        (al) => !grnLines.some((gl) => String(gl.asn_line) === String(al.line_id))
      );
      for (const al of missing) {
        const createdLine = await postApi('/supply/grn-lines/', {
          grn: receipt.grn_id,
          asn_line: al.line_id,
          sku: al.sku,
          ordered_qty: Number(al.ordered_qty) || 0,
          received_qty: 0,
          accepted_qty: 0,
          damaged_qty: 0,
          expired_qty: 0,
          excess_qty: 0,
          expiry_date: al.expected_expiry || null,
        });
        grnLines = [...grnLines, createdLine];
      }

      // The ASN is genuinely mid-receipt now, so the queue stops offering it.
      if (String(asn.status).toUpperCase() !== 'GRN_IN_PROGRESS') {
        const moved = await patchApi(`/supply/asns/${asn.asn_id}/`, { status: 'GRN_IN_PROGRESS' });
        setAsn((prev) => ({ ...prev, ...moved }));
      }

      setGrn(receipt);
      setLines(joinLines(asnLines, grnLines, skuById));
      setBatchCode(String(code).trim().slice(0, BATCH_MAX));
      setScanText('');
      setStep(2);
      setFeedback({
        type: 'ok',
        message: `Batch ${String(code).trim()} loaded. ${missing.length} line(s) opened on ${receipt.grn_no}.`,
      });
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 3: one product scan = one unit, persisted immediately ── */
  const onScanProduct = async (code) => {
    if (lines.length === 0) return;

    const want = norm(code);
    const line = lines.find((l) => [l.ean, l.skuCode, l.skuId].some((v) => norm(v) && norm(v) === want));

    if (!line) {
      // Never silently drop an unexpected scan: say so and keep a visible log.
      const known = skuForCode(code);
      setFeedback({
        type: 'error',
        message: known
          ? `Rejected: ${known.sku_code} (${known.name}) is not on ${asn?.asn_no || 'this consignment'}.`
          : `Rejected: "${code}" is not a product on ${asn?.asn_no || 'this consignment'}.`,
      });
      setRejects((prev) => [
        { code: String(code).trim(), at: new Date().toLocaleTimeString() },
        ...prev,
      ].slice(0, 25));
      return;
    }

    if (!line.grnId) {
      setFeedback({ type: 'error', message: `${line.skuCode} has no receipt line to record against.` });
      return;
    }

    const next = line.received + 1;
    if (line.expected > 0 && next > line.expected) {
      setFeedback({
        type: 'error',
        message: `${line.skuCode} is already complete (${line.received}/${line.expected}). Over-receipt needs a GRN correction, not another scan.`,
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const saved = await patchApi(`/supply/grn-lines/${line.grnId}/`, { received_qty: next });
      const received = Number(saved.received_qty) || next;
      setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, received, grnLine: saved } : l)));
      setScanText('');
      setFeedback({ type: 'ok', message: `${line.skuCode} received ${received} of ${line.expected}.` });
    } catch (e) {
      // The counter must not advance unless the write landed.
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 4: accept + lot, then close the GRN for real ── */
  const ensureLot = async (line) => {
    const existing = asList(
      await fetchApi(
        `/catalog/lots/?sku=${encodeURIComponent(line.skuId)}` +
        `&site=${encodeURIComponent(asn.dest_site)}` +
        `&batch_number=${encodeURIComponent(batchCode)}&page_size=10`
      ),
      '/catalog/lots/'
    );
    if (existing.length) return existing[0].lot_id;

    // GrnViewSet.complete only mints a putaway task for a line that has a lot,
    // so a receipt without one closes cleanly and leaves nothing to put away.
    //
    // InventoryLot.inbound_type is max_length=10 but Asn.TYPE_CHOICES includes
    // 'MH_TRANSFER' (11) and 'STORE_RETURN' (12). Posting those verbatim is
    // rejected with HTTP 400, which would make "Complete Receiving" fail for
    // every non-VENDOR_PO consignment even though the receipt itself is sound.
    const created = await postApi('/catalog/lots/', {
      sku: line.skuId,
      site: asn.dest_site,
      batch_number: batchCode,
      expiry_date: line.asnLine?.expected_expiry || null,
      box_size: 1,
      bucket: 'Good',
      status: 'AVAILABLE',
      inbound_type: String(asn.type || '').slice(0, 10),
      inbound_ref: asn.asn_no || '',
    });
    return created.lot_id;
  };

  const completeReceiving = async () => {
    if (!grn) return;
    setCompleting(true);
    setFeedback(null);
    try {
      for (const line of lines) {
        if (line.received <= 0) throw new Error(`${line.skuCode} has nothing received.`);
        const lotId = await ensureLot(line);
        await patchApi(`/supply/grn-lines/${line.grnId}/`, { accepted_qty: line.received, lot: lotId });
      }

      const result = await postApi(`/supply/grns/${grn.grn_id}/complete/`, {
        received_by: user?.user_id || undefined,
      });

      toast.success(
        'Receiving complete',
        `${result.grn_no || grn.grn_no} closed. ${result.putaway_task_count ?? 0} putaway task(s) released.`
      );
      resetReceipt();
      await load();
    } catch (e) {
      const msg = describeError(e);
      setFeedback({ type: 'error', message: msg });
      toast.error('Could not complete receiving', msg);
    } finally {
      setCompleting(false);
    }
  };

  const receivedTotal = lines.reduce((t, l) => t + l.received, 0);
  const expectedTotal = lines.reduce((t, l) => t + l.expected, 0);
  const shortLines = lines.filter((l) => l.received < l.expected);
  const overLines = lines.filter((l) => l.received > l.expected);
  const allComplete = lines.length > 0 && shortLines.length === 0 && overLines.length === 0;

  /* ── Not receiving yet: the queue + the consignment scan ── */
  if (!asn) {
    return (
      <div>
        <WorkflowStepper steps={STEPS} current={0} dataTestId="rcv-stepper" />

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                <Package size={17} /> Register Batches by Scanning
              </div>
              <div className="wf-panel__hint">
                {loading
                  ? 'Loading open consignments…'
                  : `${asns.length} consignment${asns.length === 1 ? '' : 's'} waiting to be received`}
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={load} disabled={loading} data-testid="rcv-refresh">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          <ScanInput
            label="Step 1 · Scan the consignment / ASN"
            placeholder="Scan the ASN number, PO reference or LPN label"
            value={scanText}
            onChange={setScanText}
            onScan={onScanConsignment}
            busy={busy}
            feedback={feedback}
            dataTestId="rcv-asn-scan"
          />

          {loadError && (
            <div className="scan-feedback scan-feedback--error" data-testid="rcv-load-error">
              <AlertTriangle size={14} /> {loadError}
            </div>
          )}

          {!loading && !loadError && asns.length === 0 && (
            <div className="wf-empty" data-testid="rcv-empty">
              <Package size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">No consignments waiting</div>
              <div className="wf-empty__text">
                A consignment appears here once it is CONFIRMED or has ARRIVED at the dock. Closed receipts are excluded.
              </div>
            </div>
          )}

          {asns.length > 0 && (
            <div className="item-list" data-testid="rcv-queue">
              {asns.map((a) => (
                <ProductCard
                  key={a.asn_id}
                  dataTestId={`rcv-queue-${a.asn_id}`}
                  product={{ name: `Consignment ${a.asn_no}`, sku_code: a.po_ref || a.asn_no }}
                  picked={0}
                  expected={Number(a.total_qty) || 0}
                  state="pending"
                  action={<StatusBadge status={a.status} />}
                  onSelect={() => {
                    setAsn(a);
                    setScanText('');
                    setFeedback(null);
                    setStep(1);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Receiving a consignment ── */
  return (
    <div>
      <WorkflowStepper steps={STEPS} current={step} dataTestId="rcv-stepper" />

      <div className="wf-split">
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><ScanLine size={17} /> Scan</div>
              <div className="wf-panel__hint">
                {asn.asn_no}
                {grn ? ` · ${grn.grn_no}` : ''}
                {batchCode ? ` · batch ${batchCode}` : ''}
              </div>
            </div>
          </div>

          {step === 1 && (
            <ScanInput
              key="rcv-batch"
              label="Step 2 · Scan the vendor batch / LPN"
              placeholder="Scan the pallet or LPN label to open the receipt"
              value={scanText}
              onChange={setScanText}
              onScan={onScanBatch}
              busy={busy}
              feedback={feedback}
              dataTestId="rcv-batch-scan"
            />
          )}

          {step >= 2 && (
            <ScanInput
              key="rcv-unit"
              label={`Step 3 · Scan each unit (${receivedTotal} of ${expectedTotal})`}
              placeholder="Scan a product barcode — accepted or rejected"
              value={scanText}
              onChange={setScanText}
              onScan={onScanProduct}
              busy={busy}
              feedback={feedback}
              dataTestId="rcv-unit-scan"
            />
          )}

          {rejects.length > 0 && (
            <div className="scan-feedback scan-feedback--error" data-testid="rcv-rejects">
              <Package size={14} />
              <span>
                Rejected {rejects.length} scan{rejects.length === 1 ? '' : 's'} — not on this consignment:{' '}
                <span className="mono-num">{rejects.map((r) => r.code).join(', ')}</span>
              </span>
            </div>
          )}

          <div className="wf-panel__actions">
            {step >= 2 && (
              <button
                className="scan-btn scan-btn--success"
                onClick={completeReceiving}
                disabled={completing || busy || !allComplete}
                data-testid="rcv-complete"
              >
                <Send size={16} /> Complete Receiving
              </button>
            )}
            <button
              className="btn-secondary"
              onClick={resetReceipt}
              disabled={busy || completing}
              data-testid="rcv-abort"
            >
              Back to queue
            </button>
          </div>

          {step >= 2 && !allComplete && (
            <div className="scan-feedback scan-feedback--hint" data-testid="rcv-not-ready">
              <AlertTriangle size={14} />
              <span>
                {shortLines.length
                  ? `Short: ${shortLines.map((l) => `${l.skuCode} ${l.received}/${l.expected}`).join(', ')}`
                  : 'Scan the remaining units.'}
              </span>
            </div>
          )}
        </div>

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><PackageCheck size={17} /> Receipt</div>
              <div className="wf-panel__hint">
                {asn.po_ref ? `PO ${asn.po_ref} · ` : ''}
                {asn.expected_vehicle || 'no vehicle on the ASN'}
              </div>
            </div>
            {lines.length > 0 && (
              <ProgressRing
                value={receivedTotal}
                total={expectedTotal}
                label={`${receivedTotal} of ${expectedTotal}`}
                sublabel="units received"
                dataTestId="rcv-progress"
              />
            )}
          </div>

          {lines.length > 0 && (
            <div className="tally-grid" data-testid="rcv-tally">
              <div className="tally-tile">
                <div className="tally-tile__label">Expected</div>
                <div className="tally-tile__value" data-testid="rcv-expected">{expectedTotal}</div>
              </div>
              <div className="tally-tile tally-tile--ok">
                <div className="tally-tile__label">Received</div>
                <div className="tally-tile__value" data-testid="rcv-received">{receivedTotal}</div>
              </div>
              <div className={`tally-tile${overLines.length ? ' tally-tile--over' : ''}`}>
                <div className="tally-tile__label">Over</div>
                <div className="tally-tile__value" data-testid="rcv-over">{overLines.length}</div>
              </div>
              <div className={`tally-tile${shortLines.length ? ' tally-tile--short' : ''}`}>
                <div className="tally-tile__label">Short</div>
                <div className="tally-tile__value" data-testid="rcv-short">{shortLines.length}</div>
              </div>
            </div>
          )}

          {step < 2 && (
            <div className="wf-empty" data-testid="rcv-await-batch">
              <Package size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">Waiting for the batch scan</div>
              <div className="wf-empty__text">
                Scan the batch / LPN label on the pallet. The expected lines on {asn.asn_no} open once it lands.
              </div>
            </div>
          )}

          {step >= 2 && (
            <div className="item-list" data-testid="rcv-lines">
              {lines.map((l) => (
                <ProductCard
                  key={l.key}
                  dataTestId={`rcv-line-${l.key}`}
                  product={{ name: l.name, sku_code: l.skuCode, ean: l.ean, batch_no: batchCode }}
                  picked={l.received}
                  expected={l.expected}
                  state={l.received === 0 ? 'pending' : l.received < l.expected ? 'active' : 'done'}
                  action={l.asnLine?.line_status ? <StatusBadge status={l.asnLine.line_status} /> : null}
                  onScan={() => document.getElementById('rcv-unit-scan-text')?.focus()}
                />
              ))}
            </div>
          )}

          {asn.dest_site && (
            <div className="entity-card">
              <div className="entity-card__thumb"><Store size={20} /></div>
              <div className="entity-card__body">
                <div className="entity-card__title">Destination site</div>
                <div className="entity-card__meta">
                  <span className="mono-num" data-testid="rcv-dest-site">{asn.dest_site}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
