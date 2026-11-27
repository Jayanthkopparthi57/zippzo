import React, { useMemo, useState } from 'react';
import { ClipboardCheck, AlertTriangle, RefreshCw, Check } from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useDarkStore, useAsyncData, asList } from './useDarkStore';
import { fetchApi, postApi } from '../../api/client';

const QC = '/supply/qc-inspections/';

export default function QcInspectionView() {
  const { siteId } = useDarkStore();
  const toast = useToast();

  const { data, error, loading, reload } = useAsyncData(
    () => (siteId
      ? fetchApi(
        `${QC}?status=PENDING&grn_line__received_qty__gte=1` +
        `&grn_line__grn__asn__dest_site=${encodeURIComponent(siteId)}&page_size=200`
      ).then((r) => asList(r, QC))
      : Promise.resolve([])),
    [siteId],
    { pollMs: 30000 },
  );

  const [selected, setSelected] = useState(null);
  const [passCount, setPassCount] = useState('');
  const [failCount, setFailCount] = useState('');
  const [scanBarcode, setScanBarcode] = useState('');
  const [scanVerdict, setScanVerdict] = useState('PASS');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const rows = useMemo(() => data || [], [data]);

  const openInspect = (row) => {
    setSelected(row);
    setPassCount('0');
    setFailCount('0');
    setScanBarcode('');
    setScanVerdict('PASS');
    setRemarks(row.remarks || '');
    setFeedback(null);
  };

  const close = () => {
    setSelected(null);
    setPassCount('');
    setFailCount('');
    setScanBarcode('');
    setScanVerdict('PASS');
    setRemarks('');
    setFeedback(null);
  };

  const recordUnitScan = (event) => {
    event.preventDefault();
    const barcode = scanBarcode.trim().toLowerCase();
    if (!selected || !barcode) return;
    const acceptedBarcodes = [selected.sku_ean, selected.sku_code]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase());
    if (!acceptedBarcodes.includes(barcode)) {
      setFeedback({ type: 'error', message: `${scanBarcode.trim()} does not match ${selected.sku_code}.` });
      setScanBarcode('');
      return;
    }
    const scanned = Number(passCount || 0) + Number(failCount || 0);
    if (scanned >= Number(selected.received_qty || 0)) {
      setFeedback({ type: 'error', message: 'All received units have already been scanned.' });
      setScanBarcode('');
      return;
    }
    if (scanVerdict === 'PASS') setPassCount(String(Number(passCount || 0) + 1));
    else setFailCount(String(Number(failCount || 0) + 1));
    setScanBarcode('');
    setFeedback(null);
  };

  const verify = async () => {
    if (!selected) return;
    setBusy(true);
    setFeedback(null);
    try {
      const pass = parseInt(passCount || '0', 10);
      const fail = parseInt(failCount || '0', 10);
      const res = await postApi(`${QC}${selected.qc_id}/verify/`, {
        pass_count: pass,
        fail_count: fail,
        status: fail > 0 ? (pass > 0 ? 'PARTIAL' : 'FAILED') : 'PASSED',
        require_full_inspection: true,
        remarks: remarks.trim(),
      });
      toast.success('QC recorded', `Pass: ${res?.pass_count ?? passCount}, Fail: ${res?.fail_count ?? failCount}.`);
      close();
      await reload({ quiet: true });
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'QC verification failed.';
      setFeedback({ type: 'error', message: msg });
      toast.error('QC failed', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StoreGate>
      {siteId && (
        <div style={{ paddingBottom: 24 }}>
          <div className="screen-header">
            <div>
              <div className="screen-title">
                <span>QUALITY CONTROL INSPECTION</span>
                <span className="screen-count-tag">{rows.length} records</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Inspect received goods for <StoreBadge /> and record pass/fail counts.
              </div>
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

          {feedback && !selected && (
            <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
              <AlertTriangle size={14} /> {feedback.message}
            </div>
          )}

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>GRN Number</th>
                  <th>ASN Ref</th>
                  <th>SKU</th>
                  <th>Received</th>
                  <th>Pass</th>
                  <th>Fail</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.qc_id}>
                    <td className="mono-num">{r.grn_no || '—'}</td>
                    <td className="mono-num">{r.asn_no || '—'}</td>
                    <td>
                      <div className="entity-card__title">{r.sku_name || '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{r.sku_code || ''}</div>
                    </td>
                    <td className="mono-num">{r.received_qty ?? 0}</td>
                    <td className="mono-num">{r.pass_count ?? 0}</td>
                    <td className="mono-num">{r.fail_count ?? 0}</td>
                    <td><StatusBadge status={r.status || 'PENDING'} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn-ui primary" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => openInspect(r)}>
                        <ClipboardCheck size={12} />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                      <ClipboardCheck size={18} style={{ marginBottom: 4 }} />
                      <div>No QC inspections pending.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="modal-backdrop" onClick={() => !busy && close()}>
              <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
                <div className="modal-header">
                  <div className="modal-title">QC Inspection: {selected.sku_code}</div>
                  <button type="button" className="btn-ui neutral" onClick={close} disabled={busy}>Close</button>
                </div>
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {feedback && (
                    <div className="scan-feedback scan-feedback--error">
                      <AlertTriangle size={14} /> {feedback.message}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Scan every received unit ({Number(passCount || 0) + Number(failCount || 0)} / {selected.received_qty || 0}).
                  </div>
                  <form onSubmit={recordUnitScan} style={{ display: 'flex', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Unit result</label>
                      <select className="table-filter-input" value={scanVerdict} onChange={(e) => setScanVerdict(e.target.value)}>
                        <option value="PASS">Pass</option>
                        <option value="FAIL">Fail</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Product barcode</label>
                      <input autoFocus className="table-filter-input" value={scanBarcode} onChange={(e) => setScanBarcode(e.target.value)} placeholder="Scan and press Enter" />
                    </div>
                    <button className="btn-ui neutral" type="submit" disabled={!scanBarcode.trim() || busy}>Scan</button>
                  </form>
                  <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                    <span>Pass: <strong>{passCount || 0}</strong></span>
                    <span>Fail: <strong>{failCount || 0}</strong></span>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Remarks</label>
                    <textarea className="table-filter-input" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} style={{ width: '100%' }} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn-ui neutral" onClick={close} disabled={busy}>Cancel</button>
                  <button
                    type="button"
                    className="btn-ui primary"
                    onClick={verify}
                    disabled={busy || Number(passCount || 0) + Number(failCount || 0) !== Number(selected.received_qty || 0)}
                  >
                    <Check size={13} />
                    <span>{busy ? 'Verifying...' : 'Verify QC'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </StoreGate>
  );
}

