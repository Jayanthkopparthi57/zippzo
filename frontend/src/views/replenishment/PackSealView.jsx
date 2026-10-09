import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PackageCheck, Package, RefreshCw, AlertTriangle, Boxes, ScanLine,
  Printer, XCircle, Building2, CheckCircle2, Plus, ShieldCheck,
} from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
import WorkflowStepper from '../../components/ui/WorkflowStepper';
import ProgressRing from '../../components/ui/ProgressRing';
import ProductCard from '../../components/ui/ProductCard';
import StatusBadge from '../../components/ui/StatusBadge';
import ToteLabel from '../../components/ui/ToteLabel';
import { useToast } from '../../components/ui/Toast';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';

/**
 * Pack and seal: build a tote / LPN from a picked transfer, verify what is
 * physically inside it against the pick list, and print the label that travels
 * with it.
 *
 * Three real records are involved and none of them is invented here:
 *   LpnMaster    the tote itself (POST /inventory/lpns/) — a real LPN that the
 *                dark store can later receive and the transfer `dispatch`
 *                action can publish, because TransferOrderViewSet._lpns_for
 *                selects LPNs by transfer_id + status in (PACKED, CREATED).
 *   LpnContent   what is inside it (POST/PATCH /inventory/lpn-contents/) —
 *                written one unit at a time as each product is scanned.
 *   PickTask     what should be inside it — the COMPLETED picks of this
 *                transfer batch. PickTask.sku is a bare UUID with no code, so
 *                the scannable sku_code/ean is resolved from /catalog/skus/.
 *
 * The verification step compares per product, because that is what the label
 * and the receiving dark store actually care about: "is the right thing in the
 * tote", not "which of the four lots did the picker grab".
 */
const STEPS = [
  { key: 'order', title: 'Select Order', description: 'Choose a picked transfer ready to pack' },
  { key: 'tote', title: 'Create Tote', description: 'Mint the LPN that will carry the stock' },
  { key: 'scan', title: 'Scan Products', description: 'Scan each unit into the tote' },
  { key: 'verify', title: 'Verify & Seal', description: 'Check contents, then print the label' },
];

/**
 * Transfer states whose picks are already done, so the stock is physically at
 * the pack bench. Each is fetched with its own server-side filter: the default
 * ordering is -created_at, so an unfiltered first page in a database where the
 * pipeline already ran is nothing but RECEIVED/CLOSED history.
 */
const PACKABLE_STATUS = ['PICKED', 'SORTED', 'PACKING'];

/** LpnMaster.lpn_id is max_length=50, barcode max_length=100. */
const LPN_ID_MAX = 50;
const LPN_BARCODE_MAX = 100;

const norm = (v) => String(v ?? '').trim().toUpperCase();

/**
 * unwrapList() returns null for a payload shape it does not recognise. Collapsing
 * that to [] makes a broken endpoint indistinguishable from an empty queue, so
 * an unrecognisable shape is raised instead.
 */
function asList(payload, what) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${what} returned an unrecognised payload shape.`);
  return rows;
}

export default function PackSealView() {
  const toast = useToast();

  const [orders, setOrders] = useState([]);
  const [skus, setSkus] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [tote, setTote] = useState(null);
  const [contents, setContents] = useState([]);
  const [step, setStep] = useState(0);
  const [scanText, setScanText] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [rejects, setRejects] = useState([]);
  const [sealed, setSealed] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [statusLists, skuRows, siteRows] = await Promise.all([
        Promise.all(PACKABLE_STATUS.map((s) => fetchApi(`/ds-ops/transfer-orders/?status=${s}&page_size=100`))),
        // PickTask.sku is a Sku UUID with no code on the task row, so the codes
        // an operator actually scans have to be resolved from the catalog.
        fetchApi('/catalog/skus/?page_size=500'),
        fetchApi('/network/sites/?page_size=200'),
      ]);

      const seen = new Set();
      const open = [];
      statusLists.forEach((payload, i) => {
        asList(payload, `/ds-ops/transfer-orders/?status=${PACKABLE_STATUS[i]}`).forEach((t) => {
          if (seen.has(String(t.transfer_id))) return;
          seen.add(String(t.transfer_id));
          open.push(t);
        });
      });
      setOrders(open);
      setSkus(asList(skuRows, '/catalog/skus/'));
      setSites(asList(siteRows, '/network/sites/'));
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

  const siteById = useMemo(() => {
    const map = {};
    sites.forEach((s) => { map[String(s.site_id)] = s; });
    return map;
  }, [sites]);

  const skuFor = useCallback((id) => skuById[String(id)] || null, [skuById]);

  /** Every scannable alias for a SKU: the code, the EAN, and the raw UUID. */
  const aliasesFor = useCallback(
    (skuId) => {
      const s = skuFor(skuId);
      return [s?.sku_code, s?.ean, s?.sku_id, skuId]
        .filter(Boolean)
        .map(norm);
    },
    [skuFor]
  );

  const resetTote = () => {
    setOrder(null);
    setLines([]);
    setTote(null);
    setContents([]);
    setScanText('');
    setFeedback(null);
    setRejects([]);
    setSealed(null);
    setStep(0);
  };

  /* ── Step 1: open a transfer and load the pick lines to pack against ── */
  const openOrder = async (t) => {
    setBusy(true);
    setFeedback(null);
    try {
      // ?batch= is a real filterset field on PickTaskViewSet and holds the
      // transfer id. Without it this returns every pick task in the system and
      // the packer would "verify" the tote against another transfer's stock.
      const picks = asList(
        await fetchApi(
          `/ds-ops/pick-tasks/?batch=${encodeURIComponent(t.transfer_id)}&status=COMPLETED&page_size=200`
        ),
        '/ds-ops/pick-tasks/?batch='
      );

      if (picks.length === 0) {
        setFeedback({
          type: 'error',
          message: `Transfer ${String(t.transfer_id).slice(0, 8)} has no completed pick lines to pack.`,
        });
        return;
      }

      // One expected line per product; several pick tasks for the same product
      // on different lots still add up to one product count on the label.
      const bySku = new Map();
      picks.forEach((p) => {
        const key = String(p.sku);
        const prev = bySku.get(key) || { skuId: p.sku, expected: 0, lots: new Set() };
        prev.expected += Number(p.picked_qty) || Number(p.qty) || 0;
        if (p.lot) prev.lots.add(String(p.lot));
        bySku.set(key, prev);
      });

      setOrder(t);
      setLines([...bySku.values()]);
      setStep(1);
      setScanText('');
      setFeedback({ type: 'ok', message: `${bySku.size} product line(s) to pack. Create the tote.` });
      toast.info('Order opened', `Transfer ${String(t.transfer_id).slice(0, 8)}`);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 1b: resolve a scanned order reference ── */
  const onScanOrder = async (code) => {
    const want = norm(code);
    const local = orders.find(
      (t) => norm(t.transfer_id) === want || norm(String(t.transfer_id).slice(0, 8)) === want
    );
    if (local) {
      setScanText('');
      await openOrder(local);
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      // TransferOrder has no search_fields, so an unknown reference is resolved
      // by fetching the row directly and checking its real status.
      const detail = await fetchApi(
        `/ds-ops/transfer-orders/${encodeURIComponent(String(code).trim())}/`
      );
      if (!detail || typeof detail !== 'object' || !detail.transfer_id) {
        setFeedback({ type: 'error', message: `"${code}" is not a transfer order.` });
        return;
      }
      if (!PACKABLE_STATUS.includes(String(detail.status).toUpperCase())) {
        setFeedback({
          type: 'error',
          message: `Transfer ${String(detail.transfer_id).slice(0, 8)} is ${detail.status}; only ${PACKABLE_STATUS.join(' / ')} can be packed.`,
        });
        return;
      }
      setScanText('');
      await openOrder(detail);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 2: mint a real LPN for this transfer ── */
  const createTote = async () => {
    if (!order) return;
    setBusy(true);
    setFeedback(null);
    try {
      // LpnMaster.lpn_id is the primary key and there is no default, so it has
      // to be generated — and it must be unique or the POST is a 400.
      const base = `TOTE${String(Date.now()).slice(-9)}`;
      let lpnId = base.slice(0, LPN_ID_MAX);
      let barcode = `LPN-${base}`.slice(0, LPN_BARCODE_MAX);

      const clash = asList(
        await fetchApi(`/inventory/lpns/?search=${encodeURIComponent(lpnId)}&page_size=10`),
        '/inventory/lpns/?search='
      );
      if (clash.some((l) => String(l.lpn_id) === lpnId)) {
        const salt = Math.random().toString(36).slice(2, 6).toUpperCase();
        lpnId = `${base}${salt}`.slice(0, LPN_ID_MAX);
        barcode = `LPN-${lpnId}`.slice(0, LPN_BARCODE_MAX);
      }

      // `transfer` is what makes this tote publishable: dispatch() finds LPNs by
      // transfer_id, and the dark store finds them by barcode.
      const created = await postApi('/inventory/lpns/', {
        lpn_id: lpnId,
        barcode,
        lpn_type: 'TOTE',
        current_site: order.source_site,
        source_site: order.source_site,
        dest_site: order.dest_site,
        transfer: order.transfer_id,
        current_container: 'LPN',
        current_ref_id: String(order.transfer_id).slice(0, 50),
        status: 'CREATED',
        created_by: 'console',
      });

      setTote(created);
      setContents([]);
      setStep(2);
      setFeedback({ type: 'ok', message: `${created.lpn_id} created. Scan the products into it.` });
      toast.success('Tote created', `${created.lpn_id} → ${siteById[String(order.dest_site)]?.code || 'dark store'}`);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
      toast.error('Could not create tote', describeError(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Resolve a lot for a product being packed.
   *
   * LpnContent.lot is a required FK, but PickTask.lot is nullable, so a pick
   * line with no lot still has to land in the tote against a real lot. The lot
   * is looked up at the source site (a real filterset field), never invented.
   */
  const resolveLot = useCallback(
    async (skuId, pickedLot) => {
      if (pickedLot) return String(pickedLot);
      const found = asList(
        await fetchApi(
          `/catalog/lots/?sku=${encodeURIComponent(skuId)}` +
          `&site=${encodeURIComponent(order.source_site)}` +
          `&status=AVAILABLE&page_size=1`
        ),
        '/catalog/lots/'
      );
      return found[0] ? String(found[0].lot_id) : null;
    },
    [order]
  );

  /* ── Step 3: one scan = one unit, persisted immediately ── */
  const onScanProduct = async (code) => {
    if (!tote || lines.length === 0) return;

    const want = norm(code);
    const line = lines.find((l) => aliasesFor(l.skuId).includes(want));

    if (!line) {
      const known = skus.find((s) => [s.sku_code, s.ean, s.sku_id].some((v) => norm(v) === want));
      setFeedback({
        type: 'error',
        message: known
          ? `Rejected: ${known.sku_code} (${known.name}) is not on this order.`
          : `Rejected: "${code}" is not a product on this order.`,
      });
      setRejects((prev) => [
        { code: String(code).trim(), at: new Date().toLocaleTimeString() },
        ...prev,
      ].slice(0, 25));
      return;
    }

    const received = receivedFor(line.skuId);
    if (line.expected > 0 && received >= line.expected) {
      setFeedback({
        type: 'error',
        message: `${skuFor(line.skuId)?.sku_code || line.skuId} is already packed (${received}/${line.expected}).`,
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      // Prefer the lot the picker actually took; fall back to a real available
      // lot at the source site. Returning null is refused below rather than
      // written with a fake lot id.
      const lot = line.lots.size === 1 ? [...line.lots][0] : await resolveLot(line.skuId, null);
      if (!lot) {
        setFeedback({
          type: 'error',
          message: `No available lot for ${skuFor(line.skuId)?.sku_code || line.skuId} at the source site; cannot record it in the tote.`,
        });
        return;
      }

      // LpnContent is unique on (lpn, sku, lot), so a repeat POST is a 400.
      // The existing row is read and incremented instead.
      const existing = asList(
        await fetchApi(
          `/inventory/lpn-contents/?lpn=${encodeURIComponent(tote.lpn_id)}` +
          `&sku=${encodeURIComponent(line.skuId)}&lot=${encodeURIComponent(lot)}&page_size=10`
        ),
        '/inventory/lpn-contents/'
      );

      const next = received + 1;
      let saved;
      if (existing[0]) {
        saved = await patchApi(`/inventory/lpn-contents/${existing[0].id}/`, { qty: next });
      } else {
        saved = await postApi('/inventory/lpn-contents/', {
          lpn: tote.lpn_id,
          sku: line.skuId,
          lot,
          qty: next,
        });
      }

      const qty = Number(saved.qty) || next;
      setContents((prev) => {
        const rest = prev.filter(
          (c) => !(String(c.sku) === String(line.skuId) && String(c.lot) === String(saved.lot ?? lot))
        );
        return [...rest, { ...saved, qty, lot: saved.lot ?? lot }];
      });

      setScanText('');
      setFeedback({ type: 'ok', message: `${skuFor(line.skuId)?.sku_code || 'Product'} packed ${qty} of ${line.expected}.` });
    } catch (e) {
      // The tally must not advance unless the write landed.
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 4: seal the tote ── */
  const sealTote = async () => {
    if (!tote) return;
    setBusy(true);
    setFeedback(null);
    try {
      // PACKED is one of the two statuses TransferOrderViewSet._lpns_for
      // accepts, so this is what makes dispatch publish the tote.
      const saved = await patchApi(`/inventory/lpns/${encodeURIComponent(tote.lpn_id)}/`, {
        status: 'PACKED',
      });
      setTote(saved);
      setSealed(saved);
      setStep(3);
      toast.success('Tote sealed', `${saved.lpn_id} is ready for dispatch.`);
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
      toast.error('Could not seal tote', describeError(e));
    } finally {
      setBusy(false);
    }
  };

  /* ── derived tallies ── */
  const receivedFor = useCallback(
    (skuId) =>
      contents
        .filter((c) => String(c.sku) === String(skuId))
        .reduce((t, c) => t + (Number(c.qty) || 0), 0),
    [contents]
  );

  const expectedTotal = lines.reduce((t, l) => t + (l.expected || 0), 0);
  const packedTotal = lines.reduce((t, l) => t + receivedFor(l.skuId), 0);
  const shortLines = lines.filter((l) => receivedFor(l.skuId) < l.expected);
  const overLines = lines.filter((l) => receivedFor(l.skuId) > l.expected);
  const matches = lines.length > 0 && shortLines.length === 0 && overLines.length === 0;

  const labelLines = lines
    .map((l) => ({
      sku_code: skuFor(l.skuId)?.sku_code || String(l.skuId),
      name: skuFor(l.skuId)?.name || '',
      qty: receivedFor(l.skuId),
    }))
    .filter((l) => l.qty > 0);

  /**
   * Print the label on its own.
   *
   * There is no @media print rule in workflow.css, so calling window.print()
   * on the app window would print the whole console. A dedicated print document
   * carrying only the label is opened and printed instead.
   */
  const printLabel = () => {
    if (!tote) return;
    const dest = siteById[String(order?.dest_site)]?.code || '—';
    const win = window.open('', '_blank');
    if (!win) {
      setFeedback({ type: 'error', message: 'Pop-up blocked. Allow pop-ups to print the tote label.' });
      toast.error('Pop-up blocked', 'Allow pop-ups to print the tote label.');
      return;
    }
    const rows = labelLines
      .map(
        (l) =>
          `<tr><td class="mono">${escapeHtml(l.sku_code)}</td><td>${escapeHtml(l.name)}</td>` +
          `<td class="mono r">${l.qty}</td></tr>`
      )
      .join('');
    win.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${escapeHtml(tote.lpn_id)}</title>
      <style>
        body { font-family: ui-monospace, Menlo, monospace; padding: 16px; color: #000; }
        h1 { font-size: 22px; letter-spacing: .06em; margin: 0 0 2px; }
        .meta { font-size: 12px; font-weight: 700; display: flex; justify-content: space-between;
                border-bottom: 2px solid #000; padding: 6px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
        td, th { padding: 4px 6px; border-bottom: 1px dotted #999; text-align: left; }
        th { border-bottom: 1px solid #000; font-size: 10px; text-transform: uppercase; }
        td.r, th.r { text-align: right; }
        .mono { font-family: ui-monospace, Menlo, monospace; }
        .barcode { font-size: 26px; letter-spacing: .18em; text-align: center;
                   border: 2px solid #000; margin-top: 12px; padding: 10px; }
        @page { margin: 10mm; }
      </style></head><body>
        <h1>${escapeHtml(tote.lpn_id)}</h1>
        <div class="meta"><span>DEST: ${escapeHtml(dest)}</span><span>ORDER: ${escapeHtml(String(order?.transfer_id || '').slice(0, 8))}</span></div>
        <div class="meta"><span>FROM: ${escapeHtml(siteById[String(order?.source_site)]?.code || '—')}</span><span>UNITS: ${labelLines.reduce((s, l) => s + l.qty, 0)}</span></div>
        <table><thead><tr><th>SKU</th><th>Product</th><th class="r">Qty</th>
</tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="barcode">${escapeHtml(tote.barcode || tote.lpn_id)}</div>
      </body></html>`
    );
    win.document.close();
    win.focus();
    win.print();
  };

  const destSite = siteById[String(order?.dest_site)];
  const srcSite = siteById[String(order?.source_site)];

  /* ── No order: the pack queue ── */
  if (!order) {
    return (
      <div>
        <WorkflowStepper steps={STEPS} current={0} dataTestId="pack-stepper" />

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                <Package size={17} /> Pack Queue
              </div>
              <div className="wf-panel__hint">
                {loading ? 'Loading transfers…' : `${orders.length} transfer${orders.length === 1 ? '' : 's'} ready to pack`}
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={load} disabled={loading} data-testid="pack-refresh">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          <ScanInput
            label="Step 1 · Scan or enter the transfer"
            placeholder="Transfer id, or pick one from the queue"
            value={scanText}
            onChange={setScanText}
            onScan={onScanOrder}
            busy={busy}
            feedback={feedback}
            dataTestId="pack-order-scan"
          />

          {loadError && (
            <div className="form-group">
              <div className="scan-feedback scan-feedback--error" data-testid="pack-load-error">
                <AlertTriangle size={14} /> {loadError}
              </div>
            </div>
          )}

          {!loading && !loadError && orders.length === 0 && (
            <div className="wf-empty" data-testid="pack-empty">
              <Boxes size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">Nothing ready to pack</div>
              <div className="wf-empty__text">
                A transfer appears here once it is PICKED, SORTED or PACKING. RECEIVED and CLOSED
                history is excluded.
              </div>
            </div>
          )}

          {orders.length > 0 && (
            <div className="item-list" data-testid="pack-queue">
              {orders.map((t) => (
                <ProductCard
                  key={t.transfer_id}
                  dataTestId={`pack-queue-${t.transfer_id}`}
                  product={{
                    name: `Transfer ${String(t.transfer_id).slice(0, 8)}`,
                    // Resolved per row: the open order's own src/dest are null
                    // while the queue is showing, so using them here printed
                    // "? → ?" on every transfer.
                    sku_code: `${siteById[String(t.source_site)]?.code || String(t.source_site || '—')} → ${siteById[String(t.dest_site)]?.code || String(t.dest_site || '—')}`,
                  }}
                  picked={0}
                  expected={Number(t.total_qty) || 0}
                  state="pending"
                  action={<StatusBadge status={t.status} />}
                  onSelect={() => openOrder(t)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Order open: create the tote, scan, verify ── */
  return (
    <div>
      <WorkflowStepper steps={STEPS} current={step} dataTestId="pack-stepper" />

      <div className="wf-split">
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><ScanLine size={17} /> Scan</div>
              <div className="wf-panel__hint">
                Transfer {String(order.transfer_id).slice(0, 8)}
                {tote ? ` · ${tote.lpn_id}` : ''}
              </div>
            </div>
          </div>

          {step === 1 && (
            <div className="scan-field">
              <div className="scan-feedback scan-feedback--hint" data-testid="pack-await-tote">
                <AlertTriangle size={14} />
                <span>Create the tote before scanning products into it.</span>
              </div>
              <div className="wf-panel__actions">
                <button
                  className="scan-btn scan-btn--success"
                  onClick={createTote}
                  disabled={busy}
                  data-testid="pack-create-tote"
                >
                  <Plus size={16} /> Create TOTE / LPN
                </button>
              </div>
            </div>
          )}

          {step >= 2 && (
            <ScanInput
              key="pack-unit"
              label={`Step 2 · Scan each unit (${packedTotal} of ${expectedTotal})`}
              placeholder="Scan a product barcode — accepted or rejected"
              value={scanText}
              onChange={setScanText}
              onScan={onScanProduct}
              busy={busy}
              feedback={feedback}
              dataTestId="pack-unit-scan"
            />
          )}

          {rejects.length > 0 && (
            <div className="form-group">
              <div className="scan-feedback scan-feedback--error" data-testid="pack-rejects">
                <XCircle size={14} />
                <span>
                  Rejected {rejects.length} scan{rejects.length === 1 ? '' : 's'} — not on this order:{' '}
                  <span className="mono-num">{rejects.map((r) => r.code).join(', ')}</span>
                </span>
              </div>
            </div>
          )}

          {step >= 2 && !matches && (
            <div className="form-group">
              <div className="scan-feedback scan-feedback--hint" data-testid="pack-not-ready">
                <AlertTriangle size={14} />
                <span>
                  {shortLines.length
                    ? `Short: ${shortLines.map((l) => `${skuFor(l.skuId)?.sku_code || l.skuId} ${receivedFor(l.skuId)}/${l.expected}`).join(', ')}`
                    : 'Scan the remaining units.'}
                </span>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="form-group">
              <div className="scan-feedback scan-feedback--ok" data-testid="pack-sealed-msg">
                <AlertTriangle size={14} />
                <span>{tote?.lpn_id} sealed. Dispatch publishes it to the dark store.</span>
              </div>
            </div>
          )}

          <div className="form-group wf-panel__actions">
            {step === 2 && (
              <button
                className="scan-btn scan-btn--success"
                onClick={sealTote}
                disabled={busy || !matches}
                data-testid="pack-seal"
              >
                <Package size={16} /> Verify &amp; Seal
              </button>
            )}
            {sealed && (
              <button
                className="scan-btn scan-btn--neutral"
                onClick={printLabel}
                data-testid="pack-print"
              >
                <Printer size={16} /> Print Label
              </button>
            )}
            <button
              className="btn-secondary"
              onClick={resetTote}
              disabled={busy}
              data-testid="pack-back"
            >
              Back to queue
            </button>
          </div>
        </div>

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                <Boxes size={17} /> {tote ? tote.lpn_id : 'Expected contents'}
              </div>
              <div className="wf-panel__hint">
                {srcSite?.code || '?'} → {destSite?.code || '?'}
                {tote ? ` · ${tote.barcode}` : ''}
              </div>
            </div>
            {lines.length > 0 && (
            <ProgressRing
              value={packedTotal}
                total={expectedTotal}
                label={`${packedTotal} of ${expectedTotal}`}
                sublabel="units packed"
                dataTestId="pack-progress"
              />
            )}
          </div>

          <div className="tally-grid" data-testid="pack-tally">
            <div className="tally-tile">
              <div className="tally-tile__label">Expected</div>
              <div className="tally-tile__value" data-testid="pack-expected">{expectedTotal}</div>
            </div>
            <div className="tally-tile tally-tile--ok">
              <div className="tally-tile__label">Packed</div>
              <div className="tally-tile__value" data-testid="pack-packed">{packedTotal}</div>
            </div>
            <div className={`tally-tile${shortLines.length ? ' tally-tile--short' : ''}`}>
              <div className="tally-tile__label">Short</div>
              <div className="tally-tile__value" data-testid="pack-short">{shortLines.length}</div>
            </div>
            <div className={`tally-tile${overLines.length ? ' tally-tile--over' : ''}`}>
              <div className="tally-tile__label">Over</div>
              <div className="tally-tile__value" data-testid="pack-over">{overLines.length}</div>
            </div>
          </div>

          <div className="form-group">
            <div className="item-list" data-testid="pack-lines">
              {lines.map((l) => {
                const s = skuFor(l.skuId);
                const got = receivedFor(l.skuId);
                return (
                  <ProductCard
                    key={String(l.skuId)}
                    dataTestId={`pack-line-${l.skuId}`}
                    product={{ name: s?.name, sku_code: s?.sku_code || String(l.skuId), ean: s?.ean }}
                    picked={got}
                    expected={l.expected}
                    state={got === 0 ? 'pending' : got < l.expected ? 'active' : 'done'}
                    onScan={step === 2 ? () => document.getElementById('pack-unit-scan-text')?.focus() : undefined}
                  />
                );
              })}
            </div>
          </div>

          {/* Verification summary. Shown as soon as anything is in the tote. */}
          {contents.length > 0 && (
            <div className="form-group">
              <div
                className={`scan-feedback scan-feedback--${matches ? 'ok' : 'error'}`}
                data-testid="pack-verify"
              >
                {matches ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                <span data-testid="pack-verify-text">
                  {matches
                    ? `Verified: ${labelLines.length} product${labelLines.length === 1 ? '' : 's'}, ${packedTotal} unit${packedTotal === 1 ? '' : 's'} — matches the pick list.`
                    : `Does not match the pick list. ${shortLines.length} short, ${overLines.length} over.`}
                </span>
              </div>
            </div>
          )}

          {order.source_site && (
            <div className="form-group">
              <div className="entity-card">
                <div className="entity-card__thumb"><Package size={20} /></div>
                <div className="entity-card__body">
                  <div className="entity-card__title">Destination</div>
                  <div className="entity-card__meta">
                    <span className="mono-num" data-testid="pack-dest">
                      {destSite?.code || String(order.dest_site)}
                    </span>
                    {destSite?.name && <span>{destSite.name}</span>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {tote && (
        <ToteLabel
          dataTestId="pack-label"
          toteId={tote.lpn_id}
          destination={destSite?.code || ''}
          origin={srcSite?.code || ''}
          orderRef={String(order.transfer_id).slice(0, 8)}
          lines={labelLines}
          createdAt={sealed ? `sealed ${new Date().toLocaleString()}` : ''}
          onPrint={printLabel}
        />
      )}
    </div>
  );
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
