import React, { useMemo, useState } from 'react';
import { Banknote, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import StoreGate from './StoreGate';
import {
  useDarkStore, useAsyncData, deliveryTasks, num,
} from './useDarkStore';
import { postApi } from '../../api/client';

export default function CashRegisterView() {
  const { siteId } = useDarkStore();
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);
  const { data: taskRows, error, loading, reload } = useAsyncData(
    () => (siteId ? deliveryTasks(siteId) : Promise.resolve([])),
    [siteId],
    { pollMs: 20000 },
  );

  const rows = useMemo(
    () => (taskRows || [])
      .filter((t) => String(t.payment_method || '').toUpperCase().startsWith('COD'))
      .sort((a, b) => String(b.delivered_at || b.pickup_at || '').localeCompare(String(a.delivered_at || a.pickup_at || ''))),
    [taskRows],
  );

  const toggle = async (task) => {
    setBusy(task.task_id);
    setFeedback(null);
    try {
      await postApi(`/delivery/delivery-tasks/${task.task_id}/toggle-cash-collected/`, {});
      await reload({ quiet: true });
      setFeedback({
        type: 'ok',
        message: task.cash_collected_at
          ? `Cash unmarked for ${task.order_no || task.order}. Rider is still holding the cash.`
          : `Cash marked for ${task.order_no || task.order}. Held in the store vault.`,
      });
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'Could not mark the cash.';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setBusy('');
    }
  };

  return (
    <StoreGate>
      {siteId && (
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="screen-title"><span>COD ORDERS</span></div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {rows.length} cash-on-delivery {rows.length === 1 ? 'order' : 'orders'}
              </div>
            </div>
            <div className="wf-panel__actions">
              {loading && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</span>}
              <button className="btn-ui neutral" onClick={() => reload()} disabled={loading}>
                <RefreshCw size={12} className={loading ? 'spin' : ''} /> <span>Refresh</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 10 }}>
              <AlertTriangle size={14} /> {String(error)}
            </div>
          )}
          {feedback && feedback.type === 'error' && (
            <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 10 }}>
              <AlertTriangle size={14} /> {feedback.message}
            </div>
          )}
          {feedback && feedback.type === 'ok' && (
            <div className="scan-feedback scan-feedback--ok" style={{ marginBottom: 10 }}>
              <Check size={14} /> {feedback.message}
            </div>
          )}

          {rows.length === 0 ? (
            <div className="wf-empty">
              <Banknote size={36} className="wf-empty__icon" />
              <div className="wf-empty__title">No COD orders yet</div>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th><th>Customer</th><th>Rider</th><th>Total</th><th>Cash in DS?</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((task) => {
                    const collected = !!task.cash_collected_at;
                    return (
                      <tr key={task.task_id}>
                        <td className="mono-num"><strong>{task.order_no || task.order}</strong></td>
                        <td>{task.customer_name || '—'}</td>
                        <td>{task.rider_name || 'Unassigned'}</td>
                        <td className="mono-num"><strong>₹{num(task.grand_total).toFixed(2)}</strong></td>
                        <td>
                          <button
                            type="button"
                            className={collected ? 'btn-ui neutral' : 'btn-ui primary'}
                            disabled={busy === task.task_id}
                            onClick={() => toggle(task)}
                            style={{ minWidth: 130 }}
                          >
                            {busy === task.task_id
                              ? 'Saving…'
                              : collected ? 'Collected' : 'Mark collected'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </StoreGate>
  );
}
