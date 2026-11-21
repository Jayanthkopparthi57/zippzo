import React, { useMemo, useState } from 'react';
import {
  Bike, Check, AlertTriangle, RefreshCw, KeyRound, X,
} from 'lucide-react';
import StoreGate from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import {
  useDarkStore, useAsyncData, deliveryTasks, ACTIVE_HANDOFF_STATUSES, riderPickup, deliveryPod,
} from './useDarkStore';

/**
 * Rider handoff and dispatch counter.
 *
 * Unlike picking and packing, this screen really does execute on the web: the
 * three endpoints behind it require only an authenticated operator, and the
 * server fences each task to the caller's own store. The contract is:
 *
 *   - assign: riders are stamped onto tasks automatically at checkout; this
 *     screen never assigns manually. The UNASSIGNED queue clears when the
 *     assignment engine retries (a rider coming online drains the queue).
 *   - pickup: the rider takes the staged bag; the server ships what was packed
 *     and starts custody. No tote is scanned - outbound orders are loose bags.
 *   - POD: the customer's pickup code and, for COD, the cash taken.
 *
 * Outbound orders are loose bags; nothing about this screen knows about
 * totes or LPNs. A missing value renders as a dash.
 */

const PICKUP_STATUSES = new Set([
  'UNASSIGNED', 'OFFERED', 'ACCEPTED', 'AT_DS', 'STAGED',
]);
const POD_STATUSES = new Set([
  'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'POD_PENDING',
]);

const STATUS_TABS = [
  'UNASSIGNED', 'OFFERED', 'ACCEPTED', 'AT_DS', 'STAGED', 'PICKED_UP',
  'EN_ROUTE', 'ARRIVED', 'POD_PENDING',
];

function Handoff({ siteId }) {
  const toast = useToast();
  const [historyMode, setHistoryMode] = useState(false);

  const { data: tasks, error, loading, reload } = useAsyncData(
    () => deliveryTasks(siteId, historyMode ? ['DELIVERED'] : ACTIVE_HANDOFF_STATUSES),
    [siteId, historyMode],
    { pollMs: 20000 }
  );

  const [selectedTask, setSelectedTask] = useState(null);
  const [modalMode, setModalMode] = useState(null); // 'pickup' | 'pod'
  const [otpCode, setOtpCode] = useState('');
  const [cashCollected, setCashCollected] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const taskList = useMemo(() => tasks || [], [tasks]);

  const closeModal = (force = false) => {
    // A successful submit calls this while `busy` is still true in this
    // closure; `force` lets it reset. User-initiated closes pass nothing.
    if (busy && force !== true) return;
    setSelectedTask(null);
    setModalMode(null);
    setOtpCode('');
    setCashCollected('');
  };

  const openModal = (task, mode) => {
    setSelectedTask(task);
    setModalMode(mode);
    setOtpCode('');
    setCashCollected('');
    setFeedback(null);
    setOtpCode('');
    setCashCollected('');
    setFeedback(null);
  };

  const handlePickup = async () => {
    if (!selectedTask) return;
    setBusy(true);
    setFeedback(null);
    try {
      await riderPickup(selectedTask.task_id);
      toast.success(`${selectedTask.order_no || 'Order'} handed to the rider.`);
      closeModal(true);
      reload();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Handoff failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handlePod = async () => {
    if (!selectedTask) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deliveryPod(selectedTask.task_id, {
        otp: otpCode.trim() || undefined,
        codAmount: cashCollected === '' ? undefined : parseFloat(cashCollected),
      });
      toast.success(`${selectedTask.order_no || 'Order'} delivered.`);
      closeModal(true);
      reload();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Delivery verification failed.' });
    } finally {
      setBusy(false);
    }
  };

  const filteredTasks = useMemo(() => {
    return taskList.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (!filterQuery) return true;
      const q = filterQuery.toLowerCase();
      return (
        String(t.order_no || t.order || '').toLowerCase().includes(q) ||
        String(t.rider_name || '').toLowerCase().includes(q) ||
        String(t.staging_bin || '').toLowerCase().includes(q)
      );
    });
  }, [taskList, statusFilter, filterQuery]);
  const visibleStatusTabs = historyMode
    ? []
    : STATUS_TABS.filter((status) => taskList.some((task) => task.status === status));

  const submit = { pickup: handlePickup, pod: handlePod }[modalMode];

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>{historyMode ? 'DELIVERED RIDER TASK HISTORY' : 'ACTIVE RIDER HANDOFFS'}</span>
            <span className="screen-count-tag">
              {taskList.length} {historyMode ? 'delivered' : 'active'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {historyMode
              ? 'Delivered orders are shown separately from active rider handoffs.'
              : 'Active work only. Riders are assigned automatically; hand off the staged bag and close cash-on-delivery jobs.'}
          </div>
        </div>

        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => reload()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync Fleet</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {feedback && !modalMode && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: feedback.type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
            color: feedback.type === 'error' ? 'var(--danger)' : 'var(--success)',
            border: `1px solid ${feedback.type === 'error' ? 'var(--danger-border)' : 'var(--success-border)'}`,
          }}
        >
          {feedback.type === 'error' ? <AlertTriangle size={15} /> : <Check size={15} />}
          <span style={{ flex: 1 }}>{feedback.message}</span>
          <button type="button" className="btn-ui neutral" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => setFeedback(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      <div className="status-tabs">
        <button
          className={`status-tab ${!historyMode && statusFilter === 'ALL' ? 'active' : ''}`}
          onClick={() => {
            setHistoryMode(false);
            setStatusFilter('ALL');
          }}
        >
          Active tasks{historyMode ? '' : ` (${taskList.length})`}
        </button>
        {visibleStatusTabs.map((st) => (
          <button
            key={st}
            className={`status-tab ${!historyMode && statusFilter === st ? 'active' : ''}`}
            onClick={() => {
              setHistoryMode(false);
              setStatusFilter(st);
            }}
          >
            {st} ({taskList.filter((t) => t.status === st).length})
          </button>
        ))}
        <button
          className={`status-tab ${historyMode ? 'active' : ''}`}
          onClick={() => {
            setHistoryMode(true);
            setStatusFilter('ALL');
          }}
        >
          Delivered history
        </button>
      </div>

      <div className="table-filter-row">
        <input
          type="text"
          className="table-filter-input"
          placeholder="Filter order, rider or staging slot..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
        <span className="table-record-count">
          Showing {filteredTasks.length} of {taskList.length} {historyMode ? 'delivered orders' : 'active delivery tasks'}
        </span>
      </div>

      <div className="wms-table-wrap">
        <table className="wms-table">
          <thead>
            <tr>
              <th>ORDER REF</th>
              <th>STAGING SLOT</th>
              <th>ASSIGNED RIDER</th>
              <th>WEIGHT</th>
              <th>STATUS</th>
              <th style={{ textAlign: 'right' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.length > 0 ? (
              filteredTasks.map((t) => {
                const canPickup = PICKUP_STATUSES.has(t.status);
                const canPod = POD_STATUSES.has(t.status);
                // No rider, no handover: the bag leaves the counter in someone's
                // hands. The server retries dispatch here, but showing the
                // action first invites a click that can only be refused.
                const hasRider = Boolean(String(t.rider_name || '').trim());
                return (
                  <tr key={t.task_id}>
                    <td>
                      <div>
                        <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                          {t.order_no || t.order || 'â€”'}
                        </strong>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          TASK: {String(t.task_id).slice(0, 10)}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        {t.staging_bin || 'â€”'}
                      </span>
                    </td>
                    <td>{t.rider_name || <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {t.order_weight_kg ? `${parseFloat(t.order_weight_kg).toFixed(2)} kg` : 'â€”'}
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {canPickup && hasRider && (
                          <button
                            type="button"
                            className="btn-ui primary"
                            style={{ padding: '3px 10px', fontSize: 11 }}
                            onClick={() => openModal(t, 'pickup')}
                          >
                            <Bike size={12} />
                            <span>Rider Handoff</span>
                          </button>
                        )}
                        {canPickup && !hasRider && (
                          <span
                            style={{ fontSize: 11, color: 'var(--text-muted)' }}
                            title="Packing assigns a rider automatically; this job waits until one comes online at this store."
                          >
                            Waiting for rider
                          </span>
                        )}
                        {canPod && (
                          <button
                            type="button"
                            className="btn-ui neutral"
                            style={{ padding: '3px 10px', fontSize: 11 }}
                            onClick={() => openModal(t, 'pod')}
                          >
                            <Check size={12} style={{ color: 'var(--success)' }} />
                            <span>Confirm POD</span>
                          </button>
                        )}
                        {!canPickup && !canPod && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>â€”</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                  No active delivery tasks in this queue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedTask && modalMode && (
        <div className="modal-backdrop" onClick={() => closeModal()}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <div className="modal-title">
                {modalMode === 'pickup' && `Handoff Order: ${selectedTask.order_no || ''}`}
                {modalMode === 'pod' && `Delivery POD: ${selectedTask.order_no || ''}`}
              </div>
              <button className="btn-ui neutral" onClick={() => closeModal()} disabled={busy}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {feedback && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: 11.5,
                    background: feedback.type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
                    color: feedback.type === 'error' ? 'var(--danger)' : 'var(--success)',
                    border: `1px solid ${feedback.type === 'error' ? 'var(--danger-border)' : 'var(--success-border)'}`,
                  }}
                >
                  {feedback.message}
                </div>
              )}

              {modalMode === 'pickup' && (
                <div style={{ background: 'var(--bg-panel)', padding: 10, borderRadius: 'var(--radius-xs)', fontSize: 12 }}>
                  <div><strong>Order:</strong> {selectedTask.order_no || '—'}</div>
                  <div style={{ marginTop: 4 }}><strong>Rider:</strong> {selectedTask.rider_name || 'Unassigned'}</div>
                  <div style={{ marginTop: 4 }}><strong>Staging:</strong> {selectedTask.staging_bin || '—'}</div>
                  <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>Bags travel loose — confirm the rider takes the staged bag.</div>
                </div>
              )}

              {modalMode === 'pod' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      <KeyRound size={11} /> Customer pickup code
                    </label>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Code from the customer"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 14, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-xs)' }}
                    />
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
                      Leave blank only when this order has no pickup code.
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Cash collected (COD)
                    </label>
                    <input
                      type="number"
                      placeholder={selectedTask.payment_method === 'COD' ? 'Amount due' : 'Not a COD order'}
                      value={cashCollected}
                      onChange={(e) => setCashCollected(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 14, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-xs)' }}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-ui neutral" onClick={() => closeModal()} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn-ui primary" disabled={busy} onClick={submit}>
                {modalMode === 'pickup' && 'Confirm Handoff'}
                {modalMode === 'pod' && 'Complete Delivery'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RiderHandoffView() {
  const { siteId } = useDarkStore();
  return (
    <StoreGate>
      <Handoff siteId={siteId} />
    </StoreGate>
  );
}

