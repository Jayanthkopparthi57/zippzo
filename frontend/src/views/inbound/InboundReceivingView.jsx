import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageCheck, Package, RefreshCw, AlertTriangle, Boxes, ScanLine, Truck, Send, XCircle, Building2, Store, Plus, X, FilePlus2 } from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
// WorkflowStepper / ProgressRing chrome removed: scan inputs + tables carry the flow.
import StatusBadge from '../../components/ui/StatusBadge';
import { PageHead, SubTabs, FilterBar } from '../../components/ui/WmsUI';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { useTabs } from '../../context/TabContext';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';

/**
 * Scan-first goods receipt: "Register batches by scanning".
 *
 * The loop is physical, not clerical — a pallet arrives, its batch/LPN is
 * scanned, then every unit is scanned while received-vs-expected tallies live.
 * Nothing is invented client-side: the expected side comes from AsnLine, the
 * received side is persisted to GrnLine.received_qty on every single scan, and
 * "Complete Receiving" is the real GrnViewSet.complete action that closes the
 * GRN, closes the ASN and hands the batch to QC. Only QC-accepted units later
 * become putaway tasks.
 */
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
  const { openTab } = useTabs();
  const [queueFilter, setQueueFilter] = useState('');
  const [queueSelection, setQueueSelection] = useState(new Set());

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
  // Manual batch entry is an exception path. It stays collapsed until the
  // operator says the label cannot be scanned, and it cannot be submitted
  // without a reason: the GRN then carries who typed it and why.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualBatch, setManualBatch] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  /* ── ASN creation wizard ── */
  const [showCreate, setShowCreate] = useState(false);
  const [sites, setSites] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [newAsn, setNewAsn] = useState({
    type: 'VENDOR_PO', dest_site: '', source_vendor: '', po_ref: '',
  });
  const [newLines, setNewLines] = useState([]);
  const [lineDraft, setLineDraft] = useState({ code: '', qty: '' });

  const openCreate = async () => {
    setCreateError('');
    setShowCreate(true);
    if (sites.length === 0) {
      try {
        const [siteRows, vendorRows] = await Promise.all([
          fetchApi('/network/sites/?page_size=200'),
          fetchApi('/supply/vendors/?page_size=200'),
        ]);
        setSites(asList(siteRows, '/network/sites/'));
        setVendors(asList(vendorRows, '/supply/vendors/'));
      } catch (e) {
        setCreateError(describeError(e));
      }
    }
  };

  const addLineToNewAsn = () => {
    const sku = skuForCode(lineDraft.code);
    const qty = Number(lineDraft.qty);
    if (!sku) { setCreateError(`No product matches "${lineDraft.code}".`); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setCreateError('Quantity must be a positive number.'); return; }
    setCreateError('');
    setNewLines((prev) => {
      const existing = prev.find((l) => l.sku === String(sku.sku_id));
      if (existing) {
        return prev.map((l) => (l.sku === String(sku.sku_id) ? { ...l, ordered_qty: l.ordered_qty + qty } : l));
      }
      return [...prev, { sku: String(sku.sku_id), ean: sku.ean || '', name: sku.name, sku_code: sku.sku_code, ordered_qty: qty }];
    });
    setLineDraft({ code: '', qty: '' });
  };

  const submitNewAsn = async () => {
    if (!newAsn.dest_site) { setCreateError('Destination site is required.'); return; }
    if (newAsn.type === 'VENDOR_PO' && !newAsn.source_vendor) { setCreateError('Vendor is required for a vendor PO consignment.'); return; }
    if (newLines.length === 0) { setCreateError('Add at least one product line.'); return; }
    setCreating(true);
    setCreateError('');
    try {
      // asn_no / created_by / line_no are assigned server-side.
      const created = await postApi('/supply/asns/', {
        type: newAsn.type,
        dest_site: newAsn.dest_site,
        ...(newAsn.type === 'VENDOR_PO' ? { source_vendor: newAsn.source_vendor } : {}),
        ...(newAsn.po_ref.trim() ? { po_ref: newAsn.po_ref.trim() } : {}),
        // Land directly in the receivable queue: a consignment raised from
        // the dock screen is confirmed stock the moment the worker books it.
        status: 'CONFIRMED',
      });
      await Promise.all(
        newLines.map((l) => postApi('/supply/asn-lines/', {
          asn: created.asn_id, sku: l.sku, ean: l.ean, ordered_qty: l.ordered_qty,
        }))
      );
      setShowCreate(false);
      setNewAsn({ type: 'VENDOR_PO', dest_site: '', source_vendor: '', po_ref: '' });
      setNewLines([]);
      toast.success('Consignment created', `${created.asn_no} · ${newLines.length} line${newLines.length === 1 ? '' : 's'} · ready to receive.`);
      await load();
    } catch (e) {
      setCreateError(describeError(e));
    } finally {
      setCreating(false);
    }
  };

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
    setManualOpen(false);
    setManualBatch('');
    setManualReason('');
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
  const onScanBatch = async (code, manual = null) => {
    if (!asn) {
      setFeedback({ type: 'error', message: 'Select a consignment first.' });
      return;
    }
    const batchValue = String(code).trim().slice(0, 100);
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
          batch_code: batchValue,
        });
      } else {
        if (String(receipt.status).toUpperCase() !== 'COMPLETED') {
          receipt = await patchApi(`/supply/grns/${receipt.grn_id}/`, { status: 'IN_PROGRESS' });
        }
        if (!receipt.batch_code) {
          receipt = await patchApi(`/supply/grns/${receipt.grn_id}/`, { batch_code: batchValue });
        }
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
      if (manual?.reason) {
        // The label could not be scanned. The typed reference is only allowed
        // because the receipt now records who typed it and why.
        const stamped = await postApi(`/supply/grns/${receipt.grn_id}/manual_batch/`, {
          batch_code: batchValue,
          reason: manual.reason,
        });
        setGrn((prev) => ({ ...prev, ...stamped }));
        setManualOpen(false);
        setManualBatch('');
        setManualReason('');
        setFeedback({
          type: 'ok',
          message: `Manual batch ${batchValue} recorded as an exception. ${missing.length} line(s) opened on ${receipt.grn_no}.`,
        });
      } else {
        setFeedback({
          type: 'ok',
          message: `Batch ${String(code).trim()} loaded. ${missing.length} line(s) opened on ${receipt.grn_no}.`,
        });
      }
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 2b: typed batch reference — labelled exception only ── */
  const submitManualBatch = async () => {
    const code = manualBatch.trim();
    const reason = manualReason.trim();
    if (!code) {
      setFeedback({ type: 'error', message: 'Type the batch / LPN reference before recording it.' });
      return;
    }
    if (!reason) {
      setFeedback({ type: 'error', message: 'A reason is required when a label cannot be scanned.' });
      return;
    }
    setManualBusy(true);
    try {
      await onScanBatch(code, { reason });
    } finally {
      setManualBusy(false);
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
        // Receiving records what arrived; it does not decide what is sellable.
        // accepted_qty stays 0 until QC has scanned the units, so no putaway
        // task and no stock can be minted from an uninspected receipt.
        await patchApi(`/supply/grn-lines/${line.grnId}/`, { accepted_qty: 0, lot: lotId });
      }

      const result = await postApi(`/supply/grns/${grn.grn_id}/complete/`, {
        received_by: user?.user_id || undefined,
      });

      toast.success(
        'Receiving complete',
        `${result.grn_no || grn.grn_no} closed and sent to QC. Accepted units become putaway tasks.`
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
  const queueRows = useMemo(() => {
    const q = queueFilter.trim().toLowerCase();
    if (!q) return asns;
    return asns.filter((a) => [
      a.asn_no, a.po_ref, a.type, a.status,
      a.source_vendor_name, a.source_site_code, a.expected_vehicle,
    ].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [asns, queueFilter]);

  const openReceipt = (asnRow) => {
    setAsn(asnRow);
    setScanText('');
    setFeedback(null);
    setStep(1);
  };

  if (!asn) {
    return (
      <div>
        <PageHead
          title="Inbound Warehouse Operations"
          count={asns.length}
          subtitle="Manage Advance Shipping Notices (ASNs), dock gate entry, GRN inwarding, putaway, and discrepancies."
          actions={(
            <>
              <button className="btn-ui" onClick={load} disabled={loading} data-testid="rcv-refresh">
                <RefreshCw size={13} /> Sync
              </button>
              <button className="btn-ui primary" onClick={openCreate} data-testid="rcv-create-asn">
                <FilePlus2 size={13} /> Create Inbound ASN
              </button>
            </>
          )}
        />

        <SubTabs
          search={queueFilter}
          onSearch={setQueueFilter}
          active="asns"
          onChange={(id) => { if (id !== 'asns') openTab(id, id === 'qc-testing' ? 'QC Testing' : id === 'putaway-tasks' ? 'Putaway Tasks' : 'Inbound Ledger'); }}
          tabs={[
            { id: 'asns', label: 'ASNs (Advance Shipping)', count: asns.length },
            { id: 'qc-testing', label: 'QC Testing' },
            { id: 'putaway-tasks', label: 'Putaway Tasks' },
            { id: 'inbound-ledger', label: 'Inbound Ledger' },
          ]}
        />

        <div className="wf-panel" style={{ padding: 0 }}>
          <div className="wms-table-card__head">
            <div>
              <div className="wms-table-card__title">
                <span>Register Batches by Scanning</span>
                <span className="screen-count-tag">{asns.length} records</span>
              </div>
              <div className="wms-table-card__sub">
                {loading
                  ? 'Loading open consignments…'
                  : `${asns.length} consignment${asns.length === 1 ? '' : 's'} waiting to be received`}
              </div>
            </div>
          </div>

          <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--wms-line)' }}>
            <ScanInput
              label="Scan the consignment / ASN"
              placeholder="Scan the ASN number, PO reference or LPN label"
              value={scanText}
              onChange={setScanText}
              onScan={onScanConsignment}
              busy={busy}
              feedback={feedback}
              dataTestId="rcv-asn-scan"
            />
          </div>

          {loadError && (
            <div className="scan-feedback scan-feedback--error" data-testid="rcv-load-error" style={{ margin: 12 }}>
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
            <>
              <FilterBar
                value={queueFilter}
                onChange={setQueueFilter}
                shown={queueRows.length}
                total={asns.length}
              />
              <div className="table-container" style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 34, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          className="row-checkbox"
                          checked={queueRows.length > 0 && queueSelection.size === queueRows.length}
                          onChange={(e) => setQueueSelection(e.target.checked ? new Set(queueRows.map((a) => a.asn_id)) : new Set())}
                          aria-label="Select all consignments"
                        />
                      </th>
                      <th>ASN Number</th>
                      <th>Type</th>
                      <th>Vendor / Source</th>
                      <th>Door / Vehicle</th>
                      <th>SKUs &amp; Qty</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody data-testid="rcv-queue">
                    {queueRows.map((a) => (
                      <tr
                        key={a.asn_id}
                        data-testid={`rcv-queue-${a.asn_id}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => openReceipt(a)}
                      >
                        <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="row-checkbox"
                            checked={queueSelection.has(a.asn_id)}
                            onChange={() => setQueueSelection((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.asn_id)) next.delete(a.asn_id);
                              else next.add(a.asn_id);
                              return next;
                            })}
                            aria-label={`Select ${a.asn_no}`}
                          />
                        </td>
                        <td>
                          <span className="link-cell" data-testid={`rcv-queue-${a.asn_id}-name`}>{a.asn_no}</span>
                          <span className="cell-sub">PO: {a.po_ref || '—'}</span>
                        </td>
                        <td>{a.type || '—'}</td>
                        <td>{a.source_vendor_name || a.source_site_code || '—'}</td>
                        <td>
                          {a.expected_vehicle || '—'}
                          <span className="cell-sub">Door: {a.dock_code || 'DOCK-01'}</span>
                        </td>
                        <td>
                          <span className="mono-num" data-testid={`rcv-queue-${a.asn_id}-qty`}>{Number(a.total_qty) || 0}</span> Qty
                          <span className="cell-sub">{a.line_count ?? a.lines_count ?? 1} SKUs</span>
                        </td>
                        <td><StatusBadge status={a.status} /></td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="row-action-btn"
                              onClick={(e) => { e.stopPropagation(); openReceipt(a); }}
                            >
                              Lines
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="wms-pager">
                <div className="wms-shown">Showing <b>{queueRows.length}</b> of <b>{asns.length}</b> records</div>
                <div className="wms-pager__pages">
                  <button className="wms-page-btn" disabled>Prev</button>
                  <button className="wms-page-btn active">1</button>
                  <button className="wms-page-btn" disabled>Next</button>
                </div>
              </div>
            </>
          )}
        </div>

        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, width: '94vw' }}>
              <div className="modal-header">
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }} data-testid="asn-create-title">
                    New Consignment
                  </h2>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    ASN number and line numbers are assigned automatically
                  </div>
                </div>
                <button className="modal-close" data-testid="asn-create-close" onClick={() => setShowCreate(false)}>
                  <X size={18} />
                </button>
              </div>

              {createError && (
                <div className="scan-feedback scan-feedback--error" data-testid="asn-create-error">
                  <AlertTriangle size={14} /> {createError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Consignment type</label>
                  <select className="form-input" data-testid="asn-create-type"
                    value={newAsn.type}
                    onChange={(e) => setNewAsn((p) => ({ ...p, type: e.target.value }))}>
                    <option value="VENDOR_PO">Vendor PO — inbound from supplier</option>
                    <option value="MH_TRANSFER">MH Transfer — from Mother Hub</option>
                    <option value="STORE_RETURN">Store Return — returns from a store</option>
                    <option value="RTV_IN">RTV In — return to vendor</option>
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Destination site</label>
                  <select className="form-input" data-testid="asn-create-dest"
                    value={newAsn.dest_site}
                    onChange={(e) => setNewAsn((p) => ({ ...p, dest_site: e.target.value }))}>
                    <option value="">Select destination…</option>
                    {sites.map((s) => (
                      <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                {newAsn.type === 'VENDOR_PO' && (
                  <div>
                    <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Vendor</label>
                    <select className="form-input" data-testid="asn-create-vendor"
                      value={newAsn.source_vendor}
                      onChange={(e) => setNewAsn((p) => ({ ...p, source_vendor: e.target.value }))}>
                      <option value="">Select vendor…</option>
                      {vendors.map((v) => (
                        <option key={v.vendor_id} value={v.vendor_id}>{v.code} — {v.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>
                    PO reference <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span>
                  </label>
                  <input className="form-input" placeholder="PO-2026-0001"
                    data-testid="asn-create-po"
                    value={newAsn.po_ref}
                    onChange={(e) => setNewAsn((p) => ({ ...p, po_ref: e.target.value }))} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid #e4e4e7', paddingTop: 12 }}>
                <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Product lines</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 8, marginBottom: 8 }}>
                  <input className="form-input" placeholder="Scan or type SKU code / EAN"
                    data-testid="asn-line-code"
                    value={lineDraft.code}
                    onChange={(e) => setLineDraft((p) => ({ ...p, code: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLineToNewAsn(); } }} />
                  <input className="form-input" type="number" min="1" placeholder="Qty"
                    data-testid="asn-line-qty"
                    value={lineDraft.qty}
                    onChange={(e) => setLineDraft((p) => ({ ...p, qty: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLineToNewAsn(); } }} />
                  <button type="button" className="btn-secondary" data-testid="asn-line-add"
                    onClick={addLineToNewAsn} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Plus size={14} /> Add
                  </button>
                </div>

                {newLines.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94a3b8', padding: '8px 0' }} data-testid="asn-lines-empty">
                    No lines yet — scan a product and enter the expected quantity.
                  </div>
                ) : (
                  <div className="table-container" style={{ maxHeight: 180, overflowY: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr><th>Product</th><th>SKU</th><th>Qty</th><th></th></tr>
                      </thead>
                      <tbody data-testid="asn-lines">
                        {newLines.map((l, i) => (
                          <tr key={l.sku}>
                            <td>{l.name}</td>
                            <td className="code-cell">{l.sku_code}</td>
                            <td className="mono-num">× {l.ordered_qty}</td>
                            <td>
                              <button className="modal-close" title="Remove line"
                                onClick={() => setNewLines((prev) => prev.filter((_, idx) => idx !== i))}>
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="button" className="btn-primary" data-testid="asn-create-submit"
                  disabled={creating} onClick={submitNewAsn}>
                  {creating ? 'Creating…' : `Create Consignment (${newLines.length} line${newLines.length === 1 ? '' : 's'})`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Receiving a consignment ── */
  return (
    <div>
      <div className="wf-split">
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek"> Scan</div>
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
              label="Scan the vendor batch / LPN"
              placeholder="Scan the pallet or LPN label to open the receipt"
              value={scanText}
              onChange={setScanText}
              onScan={onScanBatch}
              busy={busy}
              feedback={feedback}
              dataTestId="rcv-batch-scan"
            />
          )}

          {step === 1 && !manualOpen && (
            <div className="form-group">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setManualOpen(true)}
                data-testid="rcv-manual-toggle"
              >
                <AlertTriangle size={14} /> Label unreadable? Type the batch (exception)
              </button>
            </div>
          )}

          {step === 1 && manualOpen && (
            <div className="form-group" data-testid="rcv-manual-panel">
              <div className="scan-feedback scan-feedback--hint">
                <AlertTriangle size={14} />
                <span>
                  Manual entry is the exception, not the default. It is recorded against
                  this receipt with your name and the reason you give.
                </span>
              </div>
              <label className="form-label" htmlFor="rcv-manual-batch">Batch / LPN reference</label>
              <input
                id="rcv-manual-batch"
                className="form-input mono-num"
                value={manualBatch}
                onChange={(e) => setManualBatch(e.target.value)}
                placeholder="Type the reference printed on the label"
                data-testid="rcv-manual-batch"
              />
              <label className="form-label" htmlFor="rcv-manual-reason" style={{ marginTop: 10 }}>
                Why can it not be scanned?
              </label>
              <input
                id="rcv-manual-reason"
                className="form-input"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder="e.g. pallet label water damaged"
                data-testid="rcv-manual-reason"
              />
              <div className="wf-panel__actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="scan-btn scan-btn--neutral"
                  onClick={submitManualBatch}
                  disabled={busy || manualBusy || !manualBatch.trim() || !manualReason.trim()}
                  data-testid="rcv-manual-submit"
                >
                  <FilePlus2 size={15} /> Record exception
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setManualOpen(false); setManualBatch(''); setManualReason(''); }}
                  data-testid="rcv-manual-cancel"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {grn?.manual_entry_by && (
            <div className="scan-feedback scan-feedback--error" data-testid="rcv-manual-exception">
              <AlertTriangle size={14} />
              <span>
                Manual batch exception: <strong>{grn.batch_code}</strong> — {grn.manual_entry_reason}
              </span>
            </div>
          )}

          {step >= 2 && (
            <ScanInput
              key="rcv-unit"
              label={`Scan each unit (${receivedTotal} of ${expectedTotal})`}
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
              <div className="wf-peek"> Receipt</div>
              <div className="wf-panel__hint">
                {asn.po_ref ? `PO ${asn.po_ref} · ` : ''}
                {asn.expected_vehicle || 'no vehicle on the ASN'}
              </div>
            </div>
            {lines.length > 0 && (
              <span className="mono-num" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {receivedTotal} / {expectedTotal}
              </span>
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
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Batch</th>
                    <th>Received</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody data-testid="rcv-lines">
                  {lines.map((l) => (
                    <tr key={l.key} data-testid={`rcv-line-${l.key}`}>
                      <td data-testid={`rcv-line-${l.key}-name`}>{l.name}</td>
                      <td className="code-cell">
                        {l.skuCode}
                        {l.ean ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>EAN {l.ean}</div> : null}
                      </td>
                      <td className="code-cell">{batchCode}</td>
                      <td className="mono-num" data-testid={`rcv-line-${l.key}-qty`}>
                        {l.received}
                        {l.expected > 0 && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> / {l.expected}</span>
                        )}
                      </td>
                      <td>{l.asnLine?.line_status ? <StatusBadge status={l.asnLine.line_status} /> : null}</td>
                      <td>
                        <button
                          type="button"
                          className="scan-btn"
                          style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                          data-testid={`rcv-line-${l.key}-scan`}
                          onClick={() => document.getElementById('rcv-unit-scan-text')?.focus()}
                        >
                          Scan
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
