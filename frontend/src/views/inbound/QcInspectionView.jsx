import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, Package, RefreshCw, AlertTriangle, ScanLine, CheckCircle2,
  XCircle, ClipboardCheck, FlaskConical,
} from 'lucide-react';
import ScanInput from '../../components/ui/ScanInput';
import WorkflowStepper from '../../components/ui/WorkflowStepper';
import ProgressRing from '../../components/ui/ProgressRing';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';

/**
 * Scan & verify quality.
 *
 * A batch is scanned, then its units one at a time. The inspector sets PASS or
 * FAIL before scanning, so the scan is the data entry — the count is persisted
 * to the QcInspection row after every unit, never only in local state, and the
 * final PASSED/PARTIAL/FAILED verdict is written through the real
 * `verify` action so a reload shows the same result.
 */
const STEPS = [
  { key: 'batch', title: 'Scan Batch', description: 'Scan the consignment, GRN or a product to start' },
  { key: 'units', title: 'Scan Units', description: 'Set pass or fail, then scan each unit' },
  { key: 'record', title: 'Record Result', description: 'Write the verdict and release the line' },
];

const norm = (v) => String(v ?? '').trim().toUpperCase();

/**
 * unwrapList() returns null for a payload it does not recognise; collapsing that
 * to [] is what makes a broken endpoint look like an empty queue.
 */
function asList(payload, what) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${what} returned an unrecognised payload shape.`);
  return rows;
}

const VERDICT = (pass, fail) => {
  if (pass === 0 && fail === 0) return null;
  if (fail === 0) return 'PASSED';
  if (pass === 0) return 'FAILED';
  return 'PARTIAL';
};

export default function QcInspectionView() {
  const toast = useToast();
  const { user } = useAuth();

  const [skus, setSkus] = useState([]);
  const [lines, setLines] = useState([]);
  const [inspections, setInspections] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [batch, setBatch] = useState(null);
  const [line, setLine] = useState(null);
  const [qcId, setQcId] = useState(null);
  const [pass, setPass] = useState(0);
  const [fail, setFail] = useState(0);
  const [mode, setMode] = useState('pass');
  const [step, setStep] = useState(0);
  const [scanText, setScanText] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [rejects, setRejects] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [skuRows, lineRows, qcRows] = await Promise.all([
        // GrnLine.sku is a Sku UUID; the scannable codes live in the catalog.
        fetchApi('/catalog/skus/?page_size=1000'),
        // Server-side filter: only lines that actually have stock on the dock.
        // An unfiltered page is ordered -created_at and would be a lie about
        // the QC queue.
        fetchApi('/supply/grn-lines/?received_qty__gte=1&page_size=500'),
        // Only inspections that belong to a received line. Fetching every
        // inspection in the system would hand back the whole QC history and
        // then match on the first row that looked right.
        fetchApi('/supply/qc-inspections/?grn_line__received_qty__gte=1&page_size=500'),
      ]);
      setSkus(asList(skuRows, '/catalog/skus/'));
      setLines(asList(lineRows, '/supply/grn-lines/?received_qty__gte=1'));
      setInspections(asList(qcRows, '/supply/qc-inspections/?grn_line__received_qty__gte=1'));
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

  const qcByLine = useMemo(() => {
    const map = {};
    inspections.forEach((q) => { map[String(q.grn_line)] = q; });
    return map;
  }, [inspections]);

  /** GrnLine + its consignment + catalog SKU, with any inspection joined in. */
  const rows = useMemo(
    () =>
      lines.map((gl) => {
        const sku = skuById[String(gl.sku)] || null;
        const qc = qcByLine[String(gl.line_id)] || null;
        return {
          gl,
          qc,
          skuCode: sku?.sku_code || gl.sku,
          name: sku?.name || `SKU ${gl.sku}`,
          ean: sku?.ean || '',
          received: Number(gl.received_qty) || 0,
          accepted: Number(gl.accepted_qty) || 0,
        };
      }),
    [lines, skuById, qcByLine]
  );

  const pending = rows.filter((r) => !r.qc || !['PASSED', 'FAILED'].includes(String(r.qc.status).toUpperCase()));
  const inspectedCount = rows.length - pending.length;

  const resetBatch = () => {
    setBatch(null);
    setLine(null);
    setQcId(null);
    setPass(0);
    setFail(0);
    setMode('pass');
    setScanText('');
    setFeedback(null);
    setRejects([]);
    setStep(0);
  };

  /* ── Step 1: resolve a batch from a scan ── */
  const onScanBatch = async (code) => {
    setBusy(true);
    setFeedback(null);
    try {
      // An ASN no / PO ref resolves to every received line on that receipt.
      const asnHits = asList(
        await fetchApi(`/supply/asns/?search=${encodeURIComponent(code)}&page_size=50`),
        '/supply/asns/?search='
      );
      const want = norm(code);
      const asnHit =
        asnHits.find((a) => norm(a.asn_no) === want || norm(a.po_ref) === want || String(a.asn_id) === code) ||
        (asnHits.length === 1 ? asnHits[0] : null);

      if (asnHit) {
        // `?grn=` and `?asn_line=` are real filterset fields; without them this
        // returned every GRN line in the database.
        const grns = asList(
          await fetchApi(`/supply/grns/?asn=${encodeURIComponent(asnHit.asn_id)}&page_size=50`),
          '/supply/grns/?asn='
        );
        if (!grns.length) {
          setFeedback({ type: 'error', message: `${asnHit.asn_no} has no goods receipt to inspect.` });
          return;
        }
        const grnLines = asList(
          await fetchApi(
            `/supply/grn-lines/?grn=${encodeURIComponent(grns[0].grn_id)}&received_qty__gte=1&page_size=200`
          ),
          '/supply/grn-lines/?grn='
        );
        if (!grnLines.length) {
          setFeedback({ type: 'error', message: `${asnHit.asn_no} has no received units to inspect yet.` });
          return;
        }
        setBatch({
          kind: 'asn',
          label: asnHit.asn_no,
          sub: grns[0].grn_no,
          lineIds: grnLines.map((g) => String(g.line_id)),
        });
        setScanText('');
        setStep(1);
        setFeedback({ type: 'ok', message: `${asnHit.asn_no} loaded. Pick a line, then scan units.` });
        return;
      }

      // A GRN number is indexed on GrnViewSet.search_fields.
      const grnHits = asList(
        await fetchApi(`/supply/grns/?search=${encodeURIComponent(code)}&page_size=50`),
        '/supply/grns/?search='
      );
      const grnHit =
        grnHits.find((g) => norm(g.grn_no) === want || String(g.grn_id) === code) ||
        (grnHits.length === 1 ? grnHits[0] : null);
      if (grnHit) {
        const grnLines = asList(
          await fetchApi(
            `/supply/grn-lines/?grn=${encodeURIComponent(grnHit.grn_id)}&received_qty__gte=1&page_size=200`
          ),
          '/supply/grn-lines/?grn='
        );
        if (!grnLines.length) {
          setFeedback({ type: 'error', message: `${grnHit.grn_no} has no received units to inspect yet.` });
          return;
        }
        // One detail fetch for the label. Pulling the whole ASN table on every
        // load just to decorate this one line is the unfiltered-list trap.
        let asnNo = '';
        if (grnHit.asn) {
          try {
            const detail = await fetchApi(`/supply/asns/${encodeURIComponent(grnHit.asn)}/`);
            asnNo = detail?.asn_no || '';
          } catch {
            asnNo = '';
          }
        }
        setBatch({
          kind: 'grn',
          label: grnHit.grn_no,
          sub: asnNo,
          lineIds: grnLines.map((g) => String(g.line_id)),
        });
        setScanText('');
        setStep(1);
        setFeedback({ type: 'ok', message: `${grnHit.grn_no} loaded. Pick a line, then scan units.` });
        return;
      }

      // Otherwise treat it as a product code: filtered server-side, not by
      // downloading the whole ledger and guessing.
      const productHits = asList(
        await fetchApi(`/catalog/skus/?search=${encodeURIComponent(code)}&page_size=20`),
        '/catalog/skus/?search='
      );
      const skuHit =
        productHits.find((s) => norm(s.sku_code) === want || norm(s.ean) === want) ||
        (productHits.length === 1 ? productHits[0] : null);
      if (!skuHit) {
        setFeedback({
          type: 'error',
          message: productHits.length
            ? `"${code}" matches ${productHits.length} products. Scan the exact SKU code or EAN.`
            : `"${code}" is not a consignment, GRN or product.`,
        });
        return;
      }
      const skuLines = asList(
        await fetchApi(
          `/supply/grn-lines/?sku=${encodeURIComponent(skuHit.sku_id)}&received_qty__gte=1&page_size=200`
        ),
        '/supply/grn-lines/?sku='
      );
      if (!skuLines.length) {
        setFeedback({ type: 'error', message: `${skuHit.sku_code} has no received units waiting for QC.` });
        return;
      }
      setBatch({
        kind: 'sku',
        label: `${skuHit.sku_code} · ${skuHit.name}`,
        sub: `${skuLines.length} received line(s)`,
        lineIds: skuLines.map((g) => String(g.line_id)),
      });
      setScanText('');
      setStep(1);
      setFeedback({ type: 'ok', message: `${skuHit.sku_code} loaded. Pick a line, then scan units.` });
    } catch (e) {
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Line selection: any unit in the batch may be inspected ── */
  const batchRows = useMemo(
    () => (batch ? rows.filter((r) => batch.lineIds.includes(String(r.gl.line_id))) : []),
    [batch, rows]
  );

  const openLine = (r) => {
    setLine(r);
    setQcId(r.qc ? r.qc.qc_id : null);
    setPass(r.qc ? Number(r.qc.pass_count) || 0 : 0);
    setFail(r.qc ? Number(r.qc.fail_count) || 0 : 0);
    setScanText('');
    setFeedback(null);
    setRejects([]);
    setStep(2);
  };

  /**
   * Create the QcInspection lazily so opening a line never invents a result.
   * `knownId` must be an id that provably belongs to `r` — the component-wide
   * `qcId` cannot be trusted here, because a unit scan may switch lines and a
   * stale id would file the count against the wrong GRN line.
   */
  const ensureInspection = async (r, nextPass, nextFail, knownId) => {
    if (knownId) return knownId;
    const created = await postApi('/supply/qc-inspections/', {
      grn_line: r.gl.line_id,
      sample_size: nextPass + nextFail,
      pass_count: nextPass,
      fail_count: nextFail,
      status: 'IN_PROGRESS',
      remarks: 'Opened by scan',
    });
    setQcId(created.qc_id);
    return created.qc_id;
  };

  /* ── Step 2: one unit = one pass or fail, persisted immediately ── */
  const onScanUnit = async (code) => {
    if (!line) {
      setFeedback({ type: 'error', message: 'Pick a line to inspect first.' });
      return;
    }
    const want = norm(code);
    const candidates = [line, ...batchRows.filter((r) => String(r.gl.line_id) !== String(line.gl.line_id))];
    const hit = candidates.find((r) =>
      [r.ean, r.skuCode, r.gl.sku].some((v) => norm(v) && norm(v) === want)
    );

    if (!hit) {
      setFeedback({
        type: 'error',
        message: `Rejected: "${code}" is not on ${batch?.label || 'this batch'}.`,
      });
      setRejects((prev) => [
        { code: String(code).trim(), at: new Date().toLocaleTimeString() },
        ...prev,
      ].slice(0, 25));
      return;
    }

    const sameLine = String(hit.gl.line_id) === String(line.gl.line_id);
    const basePass = sameLine ? pass : (hit.qc ? Number(hit.qc.pass_count) || 0 : 0);
    const baseFail = sameLine ? fail : (hit.qc ? Number(hit.qc.fail_count) || 0 : 0);
    // Reuse an inspection only when it is known to belong to `hit`.
    const knownId = hit.qc ? hit.qc.qc_id : sameLine ? qcId : null;
    const nextPass = mode === 'pass' ? basePass + 1 : basePass;
    const nextFail = mode === 'fail' ? baseFail + 1 : baseFail;

    if (!sameLine) {
      setLine(hit);
      setPass(basePass);
      setFail(baseFail);
      setQcId(knownId);
    }

    setBusy(true);
    setFeedback(null);
    try {
      const id = await ensureInspection(hit, nextPass, nextFail, knownId);
      const saved = await patchApi(`/supply/qc-inspections/${id}/`, {
        sample_size: nextPass + nextFail,
        pass_count: nextPass,
        fail_count: nextFail,
      });
      setPass(Number(saved.pass_count) || 0);
      setFail(Number(saved.fail_count) || 0);
      setScanText('');
      setFeedback({
        type: 'ok',
        message: `${hit.skuCode} logged ${mode === 'pass' ? 'PASS' : 'FAIL'} — ${nextPass} pass / ${nextFail} fail.`,
      });
    } catch (e) {
      // Counts must not move unless the write landed.
      setFeedback({ type: 'error', message: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Step 3: write the verdict through the real verify action ── */
  const recordResult = async () => {
    if (!line) return;
    const verdict = VERDICT(pass, fail);
    if (!verdict) {
      setFeedback({ type: 'error', message: 'Scan at least one unit before recording a result.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const id = await ensureInspection(line, pass, fail, qcId);
      const saved = await postApi(`/supply/qc-inspections/${id}/verify/`, {
        sample_size: pass + fail,
        pass_count: pass,
        fail_count: fail,
        status: verdict,
        remarks: `${verdict}: ${pass} pass / ${fail} fail of ${pass + fail} scanned`,
        tested_by: user?.user_id || undefined,
      });
      toast.success('QC recorded', `${line.skuCode} → ${saved.status || verdict} (${saved.pass_count}/${saved.fail_count}).`);
      setStep(1);
      setLine(null);
      setQcId(null);
      setPass(0);
      setFail(0);
      setScanText('');
      await load();
    } catch (e) {
      const msg = describeError(e);
      setFeedback({ type: 'error', message: msg });
      toast.error('Could not record QC', msg);
    } finally {
      setBusy(false);
    }
  };

  const totalScanned = pass + fail;
  const sampled = line ? (line.received || 0) : 0;

  /* ── No batch: the scan-first landing ── */
  if (!batch) {
    return (
      <div>
        <WorkflowStepper steps={STEPS} current={0} dataTestId="qc-stepper" />

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><CheckCircle2 size={17} /> Scan &amp; Verify Quality</div>
              <div className="wf-panel__hint">
                {loading
                  ? 'Loading received batches…'
                  : `${pending.length} line${pending.length === 1 ? '' : 's'} awaiting QC · ${inspectedCount} already decided`}
              </div>
            </div>
            <div className="wf-panel__actions">
              <button className="btn-secondary" onClick={load} disabled={loading} data-testid="qc-refresh">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          <ScanInput
            label="Step 1 · Scan the batch"
            placeholder="Scan a consignment number, GRN number, SKU code or EAN"
            value={scanText}
            onChange={setScanText}
            onScan={onScanBatch}
            busy={busy}
            feedback={feedback}
            dataTestId="qc-batch-scan"
          />

          {loadError && (
            <div className="scan-feedback scan-feedback--error" data-testid="qc-load-error">
              <ClipboardCheck size={14} /> {loadError}
            </div>
          )}

          {!loading && !loadError && rows.length === 0 && (
            <div className="wf-empty" data-testid="qc-empty">
              <Package size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">Nothing received to inspect</div>
              <div className="wf-empty__text">
                QC lines appear once goods have been received on a GRN. Finish a receipt in Receiving first.
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Inspected</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody data-testid="qc-queue">
                  {rows.map((r) => (
                    <tr
                      key={r.gl.line_id}
                      data-testid={`qc-queue-${r.gl.line_id}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setBatch({
                          kind: 'asn',
                          label: r.skuCode,
                          sub: '1 received line',
                          lineIds: [String(r.gl.line_id)],
                        });
                        setScanText('');
                        setStep(1);
                      }}
                    >
                      <td data-testid={`qc-queue-${r.gl.line_id}-name`}>{r.name}</td>
                      <td className="code-cell">
                        {r.skuCode}
                        {r.ean ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>EAN {r.ean}</div> : null}
                      </td>
                      <td className="mono-num" data-testid={`qc-queue-${r.gl.line_id}-qty`}>
                        {r.qc ? (Number(r.qc.pass_count) || 0) + (Number(r.qc.fail_count) || 0) : 0}
                        {r.received > 0 && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> / {r.received}</span>
                        )}
                      </td>
                      <td>{r.qc ? <StatusBadge status={r.qc.status} /> : <StatusBadge status="PENDING" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Batch open ── */
  return (
    <div>
      <WorkflowStepper steps={STEPS} current={step} dataTestId="qc-stepper" />

      <div className="wf-split">
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><ScanLine size={17} /> Scan</div>
              <div className="wf-panel__hint">
                {batch.label}
                {batch.sub ? ` · ${batch.sub}` : ''}
                {line ? ` · ${line.skuCode}` : ''}
              </div>
            </div>
          </div>

          {!line && (
            <div className="wf-empty" data-testid="qc-pick-line">
              <ShieldCheck size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">Choose the line to inspect</div>
              <div className="wf-empty__text">Pick a received line below to start scanning units.</div>
            </div>
          )}

          {/* No ScanInput is mounted while a line is being chosen, and ScanInput
              is what renders `feedback` — so the "batch loaded" confirmation was
              dropped the moment the scan advanced to this step. */}
          {!line && feedback?.message && (
            <div
              className={`scan-feedback scan-feedback--${feedback.type}`}
              data-testid="qc-batch-feedback"
              style={{ marginTop: 10 }}
            >
              {feedback.type === 'ok' && <CheckCircle2 size={14} />}
              {feedback.type === 'error' && <XCircle size={14} />}
              <span>{feedback.message}</span>
            </div>
          )}

          {line && (
            <>
              <div className="wf-panel__actions">
                <button
                  className="scan-btn scan-btn--success"
                  onClick={() => setMode('pass')}
                  disabled={busy}
                  data-testid="qc-mode-pass"
                >
                  <CheckCircle2 size={15} /> Pass
                </button>
                <button
                  className="scan-btn scan-btn--danger"
                  onClick={() => setMode('fail')}
                  disabled={busy}
                  data-testid="qc-mode-fail"
                >
                  <XCircle size={15} /> Fail
                </button>
              </div>

              <ScanInput
                key={`qc-unit-${line.gl.line_id}`}
                label={`Step 2 · Scan units as ${mode.toUpperCase()}`}
                placeholder="Scan a product unit"
                value={scanText}
                onChange={setScanText}
                onScan={onScanUnit}
                busy={busy}
                feedback={feedback}
                dataTestId="qc-unit-scan"
              />

              {rejects.length > 0 && (
                <div className="scan-feedback scan-feedback--error" data-testid="qc-rejects">
                  <XCircle size={14} />
                  <span>
                    Rejected {rejects.length} scan{rejects.length === 1 ? '' : 's'} not on this batch:{' '}
                    <span className="mono-num">{rejects.map((r) => r.code).join(', ')}</span>
                  </span>
                </div>
              )}

              <div className="wf-panel__actions">
                <button
                  className="scan-btn scan-btn--success"
                  onClick={recordResult}
                  disabled={busy || totalScanned === 0}
                  data-testid="qc-record"
                >
                  <ClipboardCheck size={16} /> Record Result
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => { setLine(null); setQcId(null); setPass(0); setFail(0); setFeedback(null); setStep(1); }}
                  disabled={busy}
                  data-testid="qc-choose-other"
                >
                  Other line
                </button>
                <button className="btn-secondary" onClick={resetBatch} disabled={busy} data-testid="qc-abort">
                  Back
                </button>
              </div>

              {totalScanned === 0 && (
                <div className="scan-feedback scan-feedback--hint" data-testid="qc-need-scan">
                  <AlertTriangle size={14} />
                  <span>Scan at least one unit before recording a result.</span>
                </div>
              )}
            </>
          )}

          {!line && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Inspected</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody data-testid="qc-batch-lines">
                  {batchRows.map((r) => (
                    <tr
                      key={r.gl.line_id}
                      data-testid={`qc-batch-line-${r.gl.line_id}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => openLine(r)}
                    >
                      <td data-testid={`qc-batch-line-${r.gl.line_id}-name`}>{r.name}</td>
                      <td className="code-cell">
                        {r.skuCode}
                        {r.ean ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>EAN {r.ean}</div> : null}
                      </td>
                      <td className="mono-num" data-testid={`qc-batch-line-${r.gl.line_id}-qty`}>
                        {r.qc ? (Number(r.qc.pass_count) || 0) + (Number(r.qc.fail_count) || 0) : 0}
                        {r.received > 0 && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> / {r.received}</span>
                        )}
                      </td>
                      <td>{r.qc ? <StatusBadge status={r.qc.status} /> : <StatusBadge status="PENDING" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title"><CheckCircle2  size={17} /> Inspection</div>
              <div className="wf-panel__hint">{line ? line.name : 'No line selected'}</div>
            </div>
            {line && (
              <ProgressRing
                value={totalScanned}
                total={sampled || totalScanned || 1}
                label={`${totalScanned} tested`}
                sublabel={`${sampled} received`}
                dataTestId="qc-progress"
              />
            )}
          </div>

          {line ? (
            <>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr><th>Metric</th><th>Count</th></tr>
                  </thead>
                  <tbody data-testid="qc-tally">
                    <tr>
                      <td>Pass</td>
                      <td className="mono-num" data-testid="qc-pass">{pass}</td>
                    </tr>
                    <tr>
                      <td>Fail</td>
                      <td className="mono-num" data-testid="qc-fail">{fail}</td>
                    </tr>
                    <tr>
                      <td>Sampled</td>
                      <td className="mono-num" data-testid="qc-sampled">{totalScanned}</td>
                    </tr>
                    <tr>
                      <td>Received</td>
                      <td className="mono-num" data-testid="qc-received">{sampled}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="entity-card">
                <div className="entity-card__thumb"><Package size={20} /></div>
                <div className="entity-card__body">
                  <div className="entity-card__title">{line.name}</div>
                  <div className="entity-card__meta">
                    <span>SKU <strong>{line.skuCode}</strong></span>
                    {line.ean && <span>EAN <strong>{line.ean}</strong></span>}
                    <span>Line <strong className="mono-num">{line.gl.line_id}</strong></span>
                  </div>
                </div>
                <div className="entity-card__actions">
                   <StatusBadge status={VERDICT(pass, fail) || 'IN_PROGRESS'} />
                </div>
              </div>

              {qcId && (
                <div className="scan-feedback scan-feedback--hint" data-testid="qc-persisted">
                  <CheckCircle2 size={14} />
                  <span>
                    Saved live to inspection <span className="mono-num">{String(qcId).slice(0, 8)}</span>. Reload the page and this count survives.
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="wf-empty" data-testid="qc-no-line">
              <FlaskConical size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">No line under inspection</div>
              <div className="wf-empty__text">
                Set the verdict first, then scan units. Each scan is written straight to the QcInspection record.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
