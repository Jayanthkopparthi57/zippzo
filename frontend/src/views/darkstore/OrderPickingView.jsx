import React, { useMemo, useState } from 'react';
import {
  ClipboardList, Check, X, AlertTriangle, RefreshCw, Smartphone, MapPin,
} from 'lucide-react';
import StoreGate from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import {
  useDarkStore, useAsyncData, loadOrderQueue, loadPickLines, allocateOrder,
  completePick, pickLine, resolveStoreBin, rackDrop, ORDER_QUEUE_STATUSES,
} from './useDarkStore';

/**
 * Dark-store picking worklist and scan execution.
 *
 * Allocating and reading the worklist work from any signed-in operator
 * session. Taking units off a shelf is guarded server-side by
 * `IsFieldSurface`: floor accounts execute it from the mobile Operations app,
 * while console roles (SUPER_ADMIN / OPS_MANAGER) may execute it here. The
 * UI calls the same `/ds-ops/pick-line` endpoint either way, so a web scan and
 * a phone scan cannot drift apart.
 */

const COMPLETABLE = new Set([
  'CONFIRMED', 'PICKING', 'INTERRUPTED', 'PARTIALLY_FULFILLED',
]);

function Picker({ siteId, storeCode }) {
  const { data: queue, error, loading, reload } = useAsyncData(
    () => loadOrderQueue(siteId, ORDER_QUEUE_STATUSES),
    [siteId],
    { pollMs: 20000 }
  );

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pickMeta, setPickMeta] = useState(null);
  const [pickLines, setPickLines] = useState([]);
  const [pickDrafts, setPickDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [rackLocation, setRackLocation] = useState('RACK-01');
  const [filterQuery, setFilterQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const orders = useMemo(() => queue || [], [queue]);

  const openOrder = async (order) => {
    setSelectedOrder(order);
    setFeedback(null);
    setBusy(true);
    try {
      if (order.status === 'CONFIRMED') {
        try {
          await allocateOrder(order.order_id);
        } catch (err) {
          // Allocation can legitimately fail on a short order; the worklist
          // below still renders and names the short lines, so this is not
          // treated as a fatal error.
          setFeedback({
            type: 'error',
            message: err.message || 'This order could not be fully allocated.',
          });
        }
      }
      const payload = await loadPickLines(order.order_id);
      setPickLines(payload.lines || []);
      setPickMeta(payload);
      setPickDrafts(Object.fromEntries((payload.lines || []).map(line => [
        line.line_id,
        {
          binScan: '',
          productBarcode: '',
          qty: line.outstanding ?? Math.max(0, (line.qty || 0) - (line.picked_qty || 0)),
        },
      ])));
    } catch (err) {
      setPickLines([]);
      setPickMeta(null);
      setFeedback({
        type: 'error',
        message: err.message || 'Could not load pick allocation lines.',
      });
    } finally {
      setBusy(false);
    }
  };

  const closeOrder = () => {
    setSelectedOrder(null);
    setPickLines([]);
    setPickMeta(null);
    setPickDrafts({});
  };

  const executePick = async (line) => {
    if (!selectedOrder) return;
    const draft = pickDrafts[line.line_id] || {};
    const qty = parseInt(draft.qty, 10) || 0;
    if (!draft.binScan?.trim()) {
      setFeedback({ type: 'error', message: 'Scan the shelf bin for this line first.' });
      return;
    }
    if (!draft.productBarcode?.trim()) {
      setFeedback({ type: 'error', message: `Scan the product barcode or SKU code for ${line.sku_code}.` });
      return;
    }
    if (qty <= 0) {
      setFeedback({ type: 'error', message: 'Enter a quantity greater than zero.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const scanId = draft.scanId || crypto.randomUUID();
    setPickDrafts(prev => ({
      ...prev,
      [line.line_id]: { ...prev[line.line_id], scanId },
    }));
    try {
      const binMatches = await resolveStoreBin(storeCode, draft.binScan.trim());
      if (binMatches.length !== 1) {
        setFeedback({
          type: 'error',
          message: binMatches.length
            ? `The scanned bin matched ${binMatches.length} locations. Scan a unique shelf label.`
            : `No shelf bin at ${storeCode} matches "${draft.binScan.trim()}".`,
        });
        return;
      }
      const result = await pickLine({
        orderId: selectedOrder.order_id,
        lineId: line.line_id,
        binLocationId: binMatches[0].location_id,
        productBarcode: draft.productBarcode.trim(),
        qty,
        scanId,
      });
      setFeedback({
        type: 'success',
        message: result?.already_applied
          ? `Already applied: ${result.picked_qty} picked, ${result.outstanding} outstanding.`
          : `Picked ${qty} unit(s) of ${line.sku_code}. Outstanding: ${result?.outstanding ?? '—'}.`,
      });
      const payload = await loadPickLines(selectedOrder.order_id);
      setPickLines(payload.lines || []);
      setPickMeta(payload);
      setPickDrafts(Object.fromEntries((payload.lines || []).map(next => [
        next.line_id,
        {
          binScan: '',
          productBarcode: '',
          qty: next.outstanding ?? Math.max(0, (next.qty || 0) - (next.picked_qty || 0)),
        },
      ])));
      reload();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Pick failed.' });
    } finally {
      setBusy(false);
    }
  };

  const completeOrderPick = async () => {
    if (!selectedOrder) return;
    setBusy(true);
    setFeedback(null);
    try {
      await completePick(selectedOrder.order_id);
      // The chart keeps the order on the floor after the last scan: the next
      // step is carrying it to the rack, not closing the screen.
      setSelectedOrder((prev) => (prev ? { ...prev, status: 'PICKED' } : prev));
      setFeedback({
        type: 'success',
        message: `${selectedOrder.order_no} is picked. Carry the tote to the rack and confirm the drop.`,
      });
      reload();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Could not complete pick.' });
    } finally {
      setBusy(false);
    }
  };

  const confirmRackDrop = async () => {
    if (!selectedOrder) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await rackDrop(selectedOrder.order_id, rackLocation);
      setFeedback({
        type: 'success',
        message: result?.already_dropped
          ? `${selectedOrder.order_no} was already dropped at ${result.rack_location}.`
          : `${selectedOrder.order_no} dropped at ${result.rack_location}. Packing can take it now.`,
      });
      setSelectedOrder(null);
      setPickLines([]);
      setPickMeta(null);
      setPickDrafts({});
      reload();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Could not confirm rack drop.' });
    } finally {
      setBusy(false);
    }
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
      if (!filterQuery) return true;
      const q = filterQuery.toLowerCase();
      return (
        String(o.order_no || '').toLowerCase().includes(q) ||
        String(o.customer_name || '').toLowerCase().includes(q)
      );
    });
  }, [orders, statusFilter, filterQuery]);

  const outstandingTotal = pickMeta?.outstanding_total
    ?? pickLines.reduce((sum, line) => sum + (line.outstanding || 0), 0);

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>DARK STORE ORDER PICKING</span>
            <span className="screen-count-tag">{orders.length} orders</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Allocation worklist for this store. Picks are executed in the Zippzo Operations mobile app.
          </div>
        </div>

        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => reload()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync Orders</span>
          </button>
        </div>
      </div>

      {!selectedOrder && (
        <div
          className="scan-feedback"
          style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
        >
          <Smartphone size={14} />
          <span>
            Scan the allocated shelf bin for each line. Floor accounts execute
            from the Operations mobile app; console supervisors may scan here.
          </span>
        </div>
      )}

      {error && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {feedback && (
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
          <button
            type="button"
            className="btn-ui neutral"
            style={{ padding: '2px 6px', fontSize: 11 }}
            onClick={() => setFeedback(null)}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {selectedOrder ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
            <div>
              <strong style={{ fontSize: 15, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                PICK WORKLIST: {selectedOrder.order_no}
              </strong>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Status: {selectedOrder.status}
                {' · '}
                Lines: {pickLines.length}
                {' · '}
                Outstanding units: {outstandingTotal}
                {pickMeta?.pickable === false && pickMeta?.blocked_reason
                  ? ` · Blocked: ${pickMeta.blocked_reason}`
                  : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['PICKED', 'RACK_DROPPED'].includes(selectedOrder.status) ? null : (
                <button
                  type="button"
                  className="btn-ui primary"
                  onClick={completeOrderPick}
                  disabled={busy}
                >
                  Complete Pick
                </button>
              )}
              <button
                type="button"
                className="btn-ui neutral"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const payload = await loadPickLines(selectedOrder.order_id);
                    setPickLines(payload.lines || []);
                    setPickMeta(payload);
                  } catch (err) {
                    setFeedback({
                      type: 'error',
                      message: err.message || 'Could not refresh the worklist.',
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                <RefreshCw size={12} className={busy ? 'spin' : ''} />
                <span>Refresh Worklist</span>
              </button>
              <button
                type="button"
                className="btn-ui neutral"
                onClick={closeOrder}
              >
                Back to Order Queue
              </button>
            </div>
          </div>

          {['PICKED', 'RACK_DROPPED'].includes(selectedOrder.status) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              padding: 14, marginBottom: 16, borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface-2, rgba(0,0,0,0.02))',
              border: '1px solid var(--border-color)',
            }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong style={{ fontSize: 13 }}>Rack Drop</strong>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Carry the picked units to the packing rack, then record the rack
                  label. The pack station seals the tote and raises the rider job.
                </div>
              </div>
              <input
                type="text"
                className="table-filter-input"
                style={{ width: 150 }}
                aria-label="Rack location"
                placeholder="Rack label"
                value={rackLocation}
                onChange={(e) => setRackLocation(e.target.value)}
              />
              <button
                type="button"
                className="btn-ui primary"
                disabled={busy || !rackLocation.trim()}
                onClick={confirmRackDrop}
              >
                <Check size={12} /> <span>Confirm Rack Drop</span>
              </button>
            </div>
          )}

          <table className="wms-table">
            <thead>
              <tr>
                <th>SHELF LOCATION</th>
                <th>ITEM NAME / SKU</th>
                <th>ORDERED QTY</th>
                <th>PICKED QTY</th>
                <th>OUTSTANDING</th>
                <th>STATUS</th>
                <th>SCAN BIN / PRODUCT / QTY</th>
                <th style={{ textAlign: 'right' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {pickLines.length > 0 ? (
                pickLines.map((line) => {
                  const outstanding = line.outstanding
                    ?? Math.max(0, (line.qty || 0) - (line.picked_qty || 0));
                  return (
                    <tr key={line.line_id}>
                      <td>
                        {line.bin ? (
                          <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                            {line.bin}
                          </strong>
                        ) : (
                          <span style={{ color: 'var(--danger)', fontSize: 11 }}>
                            <MapPin size={11} /> No shelf holds this lot
                          </span>
                        )}
                        {line.allocated === false && line.bin && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            not allocated to this order
                          </div>
                        )}
                      </td>
                      <td>
                        <strong>{line.product_name || line.sku_code}</strong>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {line.sku_code}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{line.qty ?? '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{line.picked_qty ?? 0}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{outstanding}</td>
                      <td>
                        <StatusBadge status={outstanding === 0 ? 'PICKED' : (line.status || 'PENDING')} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="text"
                            className="table-filter-input"
                            style={{ width: 130 }}
                            aria-label={`Scan shelf bin for ${line.sku_code}`}
                            placeholder="Scan bin"
                            value={pickDrafts[line.line_id]?.binScan || ''}
                            onChange={(e) => setPickDrafts(prev => ({
                              ...prev, [line.line_id]: { ...(prev[line.line_id] || {}), binScan: e.target.value },
                            }))}
                          />
                          <input
                            type="text"
                            className="table-filter-input"
                            style={{ width: 140 }}
                            aria-label={`Scan product barcode for ${line.sku_code}`}
                            placeholder="Scan product"
                            value={pickDrafts[line.line_id]?.productBarcode || ''}
                            onChange={(e) => setPickDrafts(prev => ({
                              ...prev, [line.line_id]: { ...(prev[line.line_id] || {}), productBarcode: e.target.value },
                            }))}
                          />
                          <input
                            type="number"
                            className="table-filter-input"
                            style={{ width: 64 }}
                            min="1"
                            max={outstanding || 1}
                            value={pickDrafts[line.line_id]?.qty ?? outstanding}
                            onChange={(e) => setPickDrafts(prev => ({
                              ...prev,
                              [line.line_id]: { ...(prev[line.line_id] || {}), qty: e.target.value },
                            }))}
                          />
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {outstanding === 0 ? (
                          <span style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)' }}>Done</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-ui primary"
                            style={{ padding: '3px 10px', fontSize: 11 }}
                            disabled={busy}
                            onClick={() => executePick(line)}
                          >
                            Pick
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No pick allocation lines loaded for this order.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Smartphone size={12} />
            <span>Scan the shelf bin and matching product barcode (or SKU code) before recording a pick.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="status-tabs">
            {['ALL', ...ORDER_QUEUE_STATUSES].map((st) => (
              <button
                key={st}
                className={`status-tab ${statusFilter === st ? 'active' : ''}`}
                onClick={() => setStatusFilter(st)}
              >
                {st === 'ALL'
                  ? `All Orders (${orders.length})`
                  : `${st} (${orders.filter(o => o.status === st).length})`}
              </button>
            ))}
          </div>

          <div className="table-filter-row">
            <input
              type="text"
              className="table-filter-input"
              placeholder="Filter order number or customer..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
            <span className="table-record-count">Showing {filteredOrders.length} of {orders.length} orders</span>
          </div>

          <div className="wms-table-wrap">
            <table className="wms-table">
              <thead>
                <tr>
                  <th>ORDER NUMBER</th>
                  <th>ITEMS</th>
                  <th>TOTAL VALUE</th>
                  <th>PLACED TIME</th>
                  <th>STATUS</th>
                  <th style={{ textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((o) => (
                    <tr key={o.order_id}>
                      <td>
                        <div>
                          <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                            {o.order_no}
                          </strong>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{o.customer_name || 'Customer'}</div>
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{o.total_items ?? '—'} SKUs</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>₹{parseFloat(o.total_amount || 0).toFixed(2)}</td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          {o.placed_at ? new Date(o.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={o.status} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn-ui primary"
                          style={{ padding: '3px 10px', fontSize: 11 }}
                          onClick={() => openOrder(o)}
                          disabled={busy}
                        >
                          <ClipboardList size={12} />
                          <span>Open Pick List</span>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                      No customer orders pending pick.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function OrderPickingView() {
  const { siteId } = useDarkStore();
  return (
    <StoreGate>
      <Picker siteId={siteId} />
    </StoreGate>
  );
}
