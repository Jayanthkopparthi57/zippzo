import React, { useMemo, useState } from 'react';
import { Undo2, AlertTriangle, RefreshCw, Check, X } from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useDarkStore, useAsyncData, asList } from './useDarkStore';
import { fetchApi, postApi } from '../../api/client';

const CANCEL_PUTAWAY = '/reverse/cancellation-putaways/';

export default function CancellationPutawayView() {
  const { siteId, storeCode } = useDarkStore();
  const toast = useToast();

  const { data, error, loading, reload } = useAsyncData(
    () => (siteId
      ? fetchApi(`${CANCEL_PUTAWAY}?page_size=200`).then((r) => asList(r, CANCEL_PUTAWAY))
      : Promise.resolve([])),
    [siteId],
    { pollMs: 30000 },
  );

  const [selected, setSelected] = useState(null);
  const [bin, setBin] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const rows = useMemo(() => data || [], [data]);

  const openComplete = (row) => {
    setSelected(row);
    setBin(row.destination_bin || '');
    setFeedback(null);
  };

  const close = () => {
    setSelected(null);
    setBin('');
    setFeedback(null);
  };

  const complete = async () => {
    if (!selected) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (bin.trim()) {
        await fetchApi && null;
      }
      const res = await postApi(`${CANCEL_PUTAWAY}${selected.putaway_id}/complete/`, {});
      toast.success('Putaway completed', `Stock returned to ${bin || 'site'}.`);
      close();
      await reload({ quiet: true });
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'Completion failed.';
      setFeedback({ type: 'error', message: msg });
      toast.error('Failed', msg);
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
                <span>CANCELLATION PUTAWAY</span>
                <span className="screen-count-tag">{rows.length} records</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Cancelled-order stock awaiting putaway at <StoreBadge />.
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
                  <th>Putaway Code</th>
                  <th>Order</th>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>Destination Bin</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.putaway_id}>
                    <td className="mono-num">{r.code || String(r.putaway_id).slice(0, 8)}</td>
                    <td className="mono-num">{r.order_no || '—'}</td>
                    <td>
                      <div className="entity-card__title">{r.sku_name || '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{r.sku_code || ''}</div>
                    </td>
                    <td className="mono-num">{r.qty ?? 0}</td>
                    <td className="mono-num">{r.destination_bin || '—'}</td>
                    <td><StatusBadge status={r.status || 'PENDING_QC'} /></td>
                    <td style={{ textAlign: 'right' }}>
                      {!['COMPLETED', 'REJECTED', 'CANCELLED'].includes(r.status) && (
                        <button type="button" className="btn-ui primary" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => openComplete(r)}>
                          <Undo2 size={12} />
                          <span>Complete</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                      <Undo2 size={18} style={{ marginBottom: 4 }} />
                      <div>No cancellation putaways pending.</div>
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
                  <div className="modal-title">Complete Putaway: {selected.code}</div>
                  <button type="button" className="btn-ui neutral" onClick={close} disabled={busy}>Close</button>
                </div>
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {feedback && (
                    <div className="scan-feedback scan-feedback--error">
                      <AlertTriangle size={14} /> {feedback.message}
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Destination Bin</label>
                    <input type="text" className="table-filter-input" value={bin} onChange={(e) => setBin(e.target.value)} placeholder="Scan destination bin" style={{ width: '100%' }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    SKU: {selected.sku_name || '—'} · Qty: {selected.qty ?? 0} · Reason: {selected.reason_code || '—'}
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn-ui neutral" onClick={close} disabled={busy}>Cancel</button>
                  <button type="button" className="btn-ui primary" onClick={complete} disabled={busy}>
                    <Check size={13} />
                    <span>{busy ? 'Completing...' : 'Complete Putaway'}</span>
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

