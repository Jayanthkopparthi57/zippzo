/* The store's order book: what this store owes the customer right now.
 *
 * One row per order with its payment method, its delivery task, and the
 * rider carrying it - the three facts the counter actually acts on. COD
 * orders say so plainly, because the cash cycle (Cash Register) only makes
 * sense once you can see which orders put money on a rider.
 */
import React, { useState } from 'react';
import {
  ClipboardList, RefreshCw, AlertTriangle, Banknote,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import {
  useDarkStore, useAsyncData, asList, num, loadPickLines,
} from './useDarkStore';
import { fetchApi } from '../../api/client';
import DataTable from '../../ds-console/components/ui/DataTable';

const ORDERS = '/orders/orders/';
const TASKS = '/delivery/delivery-tasks/';
const RIDERS = '/delivery/rider-profiles/';

// Live order states only: delivered/cancelled work belongs to history, which
// the shopper app already carries.
const LIVE_STATES = [
  'PLACED', 'CONFIRMED', 'PRICE_FINALIZED', 'ALLOCATED', 'PICKING', 'PACKED',
  'STAGED', 'RIDER_ASSIGNED', 'OUT_FOR_DELIVERY', 'ARRIVED', 'PICKED_UP',
];

function tone(status) {
  if (status === 'OUT_FOR_DELIVERY' || status === 'RIDER_ASSIGNED') return 'badge-info';
  if (status === 'PACKED' || status === 'STAGED') return 'badge-purple';
  if (status === 'PICKING' || status === 'ALLOCATED') return 'badge-warning';
  return 'badge-default';
}

export default function OrdersView() {
  const { siteId, storeCode } = useDarkStore();
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailLines, setDetailLines] = useState([]);
  const [detailPickTasks, setDetailPickTasks] = useState([]);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const { data: orders, error: orderError, loading, reload } = useAsyncData(
    () => (siteId
      ? fetchApi(
        `${ORDERS}?site=${encodeURIComponent(siteId)}&page_size=1000`,
      ).then((r) => asList(r, ORDERS))
      : Promise.resolve([])),
    [siteId],
    { pollMs: 20000 },
  );

  const { data: tasks } = useAsyncData(
    () => (siteId
      ? fetchApi(`${TASKS}?site=${encodeURIComponent(siteId)}&page_size=1000`)
        .then((r) => asList(r, TASKS))
      : Promise.resolve([])),
    [siteId],
    { pollMs: 20000 },
  );

  const { data: riders } = useAsyncData(
    () => fetchApi(`${RIDERS}?page_size=200`).then((r) => asList(r, RIDERS)),
    [],
    { pollMs: 0 },
  );

  const riderName = {};
  (riders || []).forEach((r) => { riderName[String(r.rider_id)] = r.name; });

  const taskByOrder = {};
  (tasks || []).forEach((t) => { taskByOrder[String(t.order)] = t; });

  const live = (orders || []).filter((o) => LIVE_STATES.includes(o.status));
  const rows = (orders || []).map((order) => {
    const task = taskByOrder[String(order.order_id)];
    return {
      ...order,
      grand_total_value: num(order.grand_total),
      payment_label: order.payment_method === 'COD'
        ? `COD ₹${num(order.grand_total)}`
        : (order.payment_method || '—'),
      rider_name: task?.rider
        ? `Rider: ${riderName[String(task.rider)] || String(task.rider).slice(0, 8)}`
        : 'No rider yet',
      delivery_address: task?.delivery_address || '',
      task_status: task?.status || '—',
    };
  });
  const openOrderLines = async (order) => {
    setDetailOrder(order);
    setDetailLines([]);
    setDetailPickTasks([]);
    setDetailError('');
    setDetailLoading(true);
    try {
      const [payload, tasksResponse] = await Promise.all([
        loadPickLines(order.order_id),
        fetchApi(`/ds-ops/pick-tasks/?order=${encodeURIComponent(order.order_id)}&page_size=1000`)
          .then((response) => asList(response, '/ds-ops/pick-tasks')),
      ]);
      setDetailLines(payload.lines || []);
      setDetailPickTasks(tasksResponse);
    } catch (err) {
      setDetailError(err.message || 'Could not load order product, price, location and picker details.');
    } finally {
      setDetailLoading(false);
    }
  };
  const pickerNames = [...new Set(detailPickTasks
    .map((task) => task.completed_by_name || task.started_by_name || task.assigned_to_name)
    .filter(Boolean))];
  const columns = [
    { label: 'Order', key: 'order_no', isCode: true },
    { label: 'Customer', key: 'customer_name', render: (value) => value || '—' },
    { label: 'Items', key: 'total_items', render: (value) => value ?? 0 },
    {
      label: 'Status',
      key: 'status',
      render: (status, order) => (
        <span className={`badge ${tone(status)}`} data-testid={`ov-status-${order.order_no}`}>
          {status}
        </span>
      ),
    },
    {
      label: 'Payment',
      key: 'payment_label',
      render: (value, order) => order.payment_method === 'COD'
        ? <span className="badge badge-warning"><Banknote size={11} /> {value}</span>
        : value,
    },
    {
      label: 'Total',
      key: 'grand_total_value',
      render: (value) => <span className="mono-num">₹{value}</span>,
    },
    {
      label: 'Placed',
      key: 'placed_at',
      render: (value) => (
        <span className="mono-num">
          {value
            ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '—'}
        </span>
      ),
    },
    {
      label: 'Promise by',
      key: 'promise_at',
      render: (_, order) => (
        <span className="mono-num">
          {order.promise_at
            ? `${new Date(order.promise_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${(order.delivered_at && new Date(order.delivered_at) > new Date(order.promise_at)) ? ' (late)' : ''}`
            : '—'}
        </span>
      ),
    },
    {
      label: 'Rider',
      key: 'rider_name',
      render: (value, order) => <span data-testid={`ov-rider-${order.order_no}`}>{value}</span>,
    },
    {
      label: 'Task',
      key: 'task_status',
      render: (value) => value === '—' ? value : <strong>{value}</strong>,
    },
    {
      label: 'Products',
      key: 'order_id',
      render: (_, order) => (
        <button type="button" className="btn-ui neutral" onClick={() => openOrderLines(order)}>
          View items
        </button>
      ),
    },
  ];

  return (
    <StoreGate>
      {siteId && (
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek">
 Orders
              </div>
              <div className="wf-panel__hint">
                Live work at <StoreBadge /> — {live.length} open,{' '}
                {(orders || []).length} listed
              </div>
            </div>
            <div className="wf-panel__actions">
              {loading && <span className="scan-feedback scan-feedback--hint">Loading…</span>}
              <button className="btn-secondary" onClick={() => reload()} disabled={loading}
                      data-testid="ov-refresh">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {orderError && (
            <div className="scan-feedback scan-feedback--error" data-testid="ov-error">
              <AlertTriangle size={14} /> {String(orderError)}
            </div>
          )}

          {(orders || []).length === 0 ? (
            <div className="wf-empty" data-testid="ov-empty">
              <ClipboardList size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">No orders at this store</div>
              <div className="wf-empty__text">
                The moment a shopper checks out against {storeCode}, the order
                lands here with its pick, pack and rider trail.
              </div>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              idField="order_id"
              bodyTestId="ov-table"
              getRowProps={(order) => ({ 'data-testid': `ov-order-${order.order_no}` })}
              emptyMessage="[ No orders match the current filter ]"
            />
          )}
        </div>
      )}
      {detailOrder && (
        <div className="modal-backdrop" onClick={() => !detailLoading && setDetailOrder(null)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="modal-header">
              <div className="modal-title">Order products · {detailOrder.order_no}</div>
              <button type="button" className="btn-ui neutral" onClick={() => setDetailOrder(null)} disabled={detailLoading}>Close</button>
            </div>
            <div className="modal-body">
              {detailLoading && <div className="scan-feedback scan-feedback--hint">Loading order lines…</div>}
              {detailError && <div className="scan-feedback scan-feedback--error"><AlertTriangle size={14} /> {detailError}</div>}
              {!detailLoading && !detailError && (
                <div>
                  <div className="wf-panel__hint" style={{ marginBottom: 12 }}>
                    <strong>{detailOrder.customer_name || 'Customer'}</strong>
                    {' · '}{detailOrder.status}
                    {' · '}Payment: {detailOrder.payment_method || '—'}
                    {' · '}Total: ₹{num(detailOrder.grand_total).toFixed(2)}
                    <br />
                    Delivering to: {detailOrder.delivery_address || '—'}
                    <br />
                    Picked by: {pickerNames.join(', ') || 'Not assigned yet'}
                    {' · '}Delivering rider: {detailOrder.rider_name || 'Not assigned yet'}
                  </div>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Product</th><th>Ordered</th><th>Picked</th><th>Packed</th>
                          <th>Shipped</th><th>Unit price</th><th>Line total</th>
                          <th>Picker</th><th>Bin locations</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLines.map((line) => {
                          const lineTasks = detailPickTasks.filter((task) =>
                            String(task.sku) === String(line.sku)
                            && (!task.lot || String(task.lot) === String(line.lot)));
                          const linePickers = [...new Set(lineTasks
                            .map((task) => task.completed_by_name || task.started_by_name || task.assigned_to_name)
                            .filter(Boolean))];
                          const binDetails = (line.bins || [])
                            .map((bin) => `${bin.label || 'Bin'} (${bin.available_qty ?? 0})`);
                          if (line.bin && !binDetails.length) binDetails.push(line.bin);
                          return (
                            <tr key={line.line_id}>
                              <td>
                                {line.product_name}
                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                  {line.sku_code} · {line.lot || 'No lot'}
                                </div>
                              </td>
                              <td className="mono-num">{line.qty}</td>
                              <td className="mono-num">{line.picked_qty}</td>
                              <td className="mono-num">{line.packed_qty}</td>
                              <td className="mono-num">{line.shipped_qty}</td>
                              <td className="mono-num">₹{num(line.unit_price).toFixed(2)}</td>
                              <td className="mono-num">₹{num(line.line_total).toFixed(2)}</td>
                              <td>{linePickers.join(', ') || 'Unassigned'}</td>
                              <td className="mono-num">{binDetails.join(', ') || line.bin || 'Not on a shelf'}</td>
                            </tr>
                          );
                        })}
                        {detailLines.length === 0 && <tr><td colSpan={9}>No product lines found for this order.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </StoreGate>
  );
}
