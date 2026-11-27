import React, { useMemo, useState } from 'react';
import {
  PackageCheck, AlertTriangle, RefreshCw, Search, Smartphone, Package,
} from 'lucide-react';
import StoreGate from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import {
  useDarkStore, useAsyncData, loadOrderQueue, packOrder,
} from './useDarkStore';
import { postApi } from '../../api/client';

/**
 * Dark-store packing worklist.
 *
 * Staging an order at a slot and creating its rider job is physical stock
 * work, so `/ds-ops/pack-order` requires a field-surface session
 * (`IsFieldSurface`). A web session can watch the picked queue and see which
 * staging slots are free.
 *
 * Outbound orders move in loose bags, never in totes or LPNs. Totes are an
 * inbound warehouse concept only; nothing about the customer delivery flow
 * knows about them.
 */

function PackStation({ siteId }) {
  const toast = useToast();
  const { data: orders, error, loading, reload } = useAsyncData(
    () => loadOrderQueue(siteId, ['PICKED', 'RACK_DROPPED']),
    [siteId],
    { pollMs: 30000 }
  );

  const [filterQuery, setFilterQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [stagingBin, setStagingBin] = useState('');
  const [packResult, setPackResult] = useState(null);
  const [dropBin, setDropBin] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const queue = useMemo(() => orders || [], [orders]);

  const openPackForm = (order) => {
    setSelectedOrder(order);
    setStagingBin('');
    setPackResult(null);
    setDropBin('');
    setFeedback(null);
  };

  const handlePackOrder = async () => {
    if (!selectedOrder) return;
    if (!stagingBin.trim()) {
      setFeedback({ type: 'error', message: 'Enter the staging slot before packing.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await packOrder(selectedOrder.order_id, {
        stagingBin: stagingBin.trim(),
      });
      setPackResult(result?.delivery_task || null);
      setDropBin(result?.staging_bin || stagingBin.trim());
      setFeedback({
        type: 'success',
        message: `Packed at ${stagingBin.trim()}. Now drop the bag in the collection bin so the rider can collect it.`,
      });
      toast.success(`${selectedOrder.order_no} packed`);
      await reload({ quiet: true });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Staging failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleBinDrop = async () => {
    if (!packResult || !dropBin.trim()) {
      setFeedback({ type: 'error', message: 'Enter the collection bin code.' });
      return;
    }
    setBusy(true);
    try {
      await postApi('/ds-ops/bin-drop', {
        task_id: packResult.task_id,
        bin_code: dropBin.trim(),
      });
      toast.success(`Bag dropped in ${dropBin.trim()}`);
      setSelectedOrder(null);
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Could not record the bin drop.' });
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    if (!filterQuery) return queue;
    const q = filterQuery.toLowerCase();
    return queue.filter((o) =>
      String(o.order_no || '').toLowerCase().includes(q) ||
      String(o.customer_name || '').toLowerCase().includes(q)
    );
  }, [queue, filterQuery]);

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>PACKING &amp; STAGING</span>
            <span className="screen-count-tag">{queue.length} picked</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Picked orders waiting at a staging slot for rider collection. Packing
            runs against the same server operation as the Operations mobile app.
          </div>
        </div>

        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => reload()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      <div
        className="scan-feedback"
        style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
      >
        <Smartphone size={14} />
        <span>
          Staging packs the store's bag for the rider and creates the job.
          Enter the slot and confirm.
        </span>
      </div>

      {error && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="table-filter-row">
        <div style={{ position: 'relative', flex: 1, maxWidth: 340 }}>
          <Search
            size={13}
            style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            className="table-filter-input"
            style={{ paddingLeft: 28 }}
            placeholder="Filter order number or customer..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
        </div>
        <span className="table-record-count">
          Showing {filtered.length} of {queue.length} picked orders
        </span>
      </div>

      <div className="wms-table-wrap">
        <table className="wms-table">
          <thead>
            <tr>
              <th>ORDER NUMBER</th>
              <th>CUSTOMER</th>
              <th>ITEMS</th>
              <th>ORDER VALUE</th>
              <th>STATUS</th>
              <th style={{ textAlign: 'right' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? (
              filtered.map((o) => (
                <tr key={o.order_id}>
                  <td>
                    <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                      {o.order_no}
                    </strong>
                  </td>
                  <td>{o.customer_name || '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>
                    {o.total_items ?? '—'} SKUs
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>
                    ₹{parseFloat(o.grand_total || 0).toFixed(2)}
                  </td>
                  <td>
                    <StatusBadge status={o.status || 'PICKED'} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn-ui primary"
                      style={{ padding: '3px 10px', fontSize: 11 }}
                      disabled={busy}
                      onClick={() => openPackForm(o)}
                    >
                      <Package size={12} />
                      <span>Pack & Stage</span>
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                  <PackageCheck size={18} style={{ marginBottom: 4 }} />
                  <div>No orders waiting at the packing table.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedOrder && (
        <div className="modal-backdrop" onClick={() => !busy && setSelectedOrder(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <div className="modal-title">Pack & Stage: {selectedOrder.order_no}</div>
              <button type="button" className="btn-ui neutral" onClick={() => setSelectedOrder(null)} disabled={busy}>
                Close
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {feedback && (
                <div className={`scan-feedback ${feedback.type === 'error' ? 'scan-feedback--error' : 'scan-feedback--success'}`}>
                  <AlertTriangle size={14} />
                  <span>{feedback.message}</span>
                </div>
              )}
              {packResult ? (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                    Step 2 — collection bin code (the rider scans this)
                  </label>
                  <input
                    type="text"
                    className="table-filter-input"
                    value={dropBin}
                    onChange={(e) => setDropBin(e.target.value)}
                    placeholder="e.g. BIN-07"
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Put the packed bag in this bin, then confirm. The rider job only opens for collection after this step.
                  </div>
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Staging slot</label>
                  <input
                    type="text"
                    className="table-filter-input"
                    value={stagingBin}
                    onChange={(e) => setStagingBin(e.target.value)}
                    placeholder="e.g. STAGE-01"
                  />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-ui neutral" onClick={() => setSelectedOrder(null)} disabled={busy}>
                Cancel
              </button>
              {packResult ? (
                <button type="button" className="btn-ui primary" onClick={handleBinDrop} disabled={busy}>
                  <PackageCheck size={13} />
                  <span>{busy ? 'Dropping…' : 'Drop to bin'}</span>
                </button>
              ) : (
                <button type="button" className="btn-ui primary" onClick={handlePackOrder} disabled={busy}>
                  <PackageCheck size={13} />
                  <span>{busy ? 'Packing…' : 'Pack bag'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrderPackingView() {
  const { siteId } = useDarkStore();
  return (
    <StoreGate>
      <PackStation siteId={siteId} />
    </StoreGate>
  );
}
