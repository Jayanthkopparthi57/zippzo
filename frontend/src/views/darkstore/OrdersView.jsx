/* The store's order book: what this store owes the customer right now.
 *
 * One row per order with its payment method, its delivery task, and the
 * rider carrying it - the three facts the counter actually acts on. COD
 * orders say so plainly, because the cash cycle (Cash Register) only makes
 * sense once you can see which orders put money on a rider.
 */
import React from 'react';
import {
  ClipboardList, RefreshCw, AlertTriangle, Banknote,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import {
  useDarkStore, useAsyncData, asList, num,
} from './useDarkStore';
import { fetchApi } from '../../api/client';

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

  const { data: orders, error: orderError, loading, reload } = useAsyncData(
    () => (siteId
      ? fetchApi(
        `${ORDERS}?site=${encodeURIComponent(siteId)}&page_size=100`,
      ).then((r) => asList(r, ORDERS))
      : Promise.resolve([])),
    [siteId],
    { pollMs: 20000 },
  );

  const { data: tasks } = useAsyncData(
    () => (siteId
      ? fetchApi(`${TASKS}?site=${encodeURIComponent(siteId)}&page_size=100`)
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

  return (
    <StoreGate>
      {siteId && (
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-panel__title">
                <ClipboardList size={17} /> Orders
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
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Total</th>
                    <th>Placed</th>
                    <th>Rider</th>
                    <th>Task</th>
                  </tr>
                </thead>
                <tbody data-testid="ov-table">
                  {(orders || []).map((o) => {
                    const task = taskByOrder[String(o.order_id)];
                    const cod = o.payment_method === 'COD';
                    return (
                      <tr key={o.order_id} data-testid={`ov-order-${o.order_no}`}>
                        <td>
                          <div className="entity-card__title">
                            <span className="code-cell">{o.order_no}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${tone(o.status)}`}
                                data-testid={`ov-status-${o.order_no}`}>
                            {o.status}
                          </span>
                        </td>
                        <td>
                          {cod ? (
                            <span className="badge badge-warning">
                              <Banknote size={11} /> COD ₹{num(o.grand_total)}
                            </span>
                          ) : (o.payment_method || '—')}
                        </td>
                        <td className="mono-num">₹{num(o.grand_total)}</td>
                        <td className="mono-num">
                          {o.placed_at
                            ? new Date(o.placed_at).toLocaleTimeString(
                              [], { hour: '2-digit', minute: '2-digit' },
                            )
                            : '—'}
                        </td>
                        <td data-testid={`ov-rider-${o.order_no}`}>
                          {task?.rider
                            ? `Rider: ${riderName[String(task.rider)] || String(task.rider).slice(0, 8)}`
                            : 'No rider yet'}
                        </td>
                        <td>{task?.status ? <strong>{task.status}</strong> : '—'}</td>
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
