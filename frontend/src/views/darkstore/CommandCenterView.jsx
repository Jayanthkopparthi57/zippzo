import React from 'react';
import {
  LayoutDashboard, RefreshCw, PackageCheck, ShoppingBag, Bike, Boxes,
  AlertTriangle, Timer, TrendingUp, Users, Warehouse, ClipboardList, Route,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import {
  useDarkStore, useAsyncData, dsOverview, dsDepartmentStatus, dsOrderTracking,
  mmss, num,
} from './useDarkStore';

/**
 * Dark store command centre: the shift's headline numbers, plus the queues that
 * need somebody to walk somewhere.
 *
 * Reads `/ds-ops/overview`, which is already site-scoped server-side, and polls
 * it quietly so the SLA and dispatch counts track reality without the operator
 * holding a refresh button.
 */
function Tile({ label, value, sub, tone, icon: Icon, testId }) {
  return (
    <div className={`tally-tile${tone ? ` tally-tile--${tone}` : ''}`} data-testid={testId}>
      <div className="tally-tile__label">
        {Icon && <Icon size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />}
        {label}
      </div>
      <div className="tally-tile__value">{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Overview({ storeCode }) {
  const { data, error, loading, reload } = useAsyncData(
    () => dsOverview(storeCode),
    [storeCode],
    { pollMs: 30000 }
  );

  if (error && !data) {
    return (
      <div className="wf-panel">
        <div className="scan-feedback scan-feedback--error" data-testid="ds-overview-error">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button
            type="button"
            className="scan-btn scan-btn--ghost"
            style={{ marginLeft: 'auto', minHeight: 34 }}
            onClick={() => reload()}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="wf-panel">
        <div className="scan-feedback scan-feedback--hint" data-testid="ds-overview-loading">
          Reading the store dashboard…
        </div>
      </div>
    );
  }

  const inventory = data.shelf_inventory || {};
  // The server sends null (not 0) when nothing settled in the window, so "no
  // data" must render as a dash. Showing 0% here would read as a total SLA
  // failure during a quiet night.
  const sla = data.sla_compliance_pct;
  const avgPick = data.avg_pick_time_sec;

  return (
    <>
      {error && (
        <div className="wf-panel">
          <div className="scan-feedback scan-feedback--error" data-testid="ds-overview-stale">
            <AlertTriangle size={14} /> Last refresh failed: {error}
          </div>
        </div>
      )}

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-peek"> Command Centre</div>
            <div className="wf-panel__hint">
              Live shift picture for <StoreBadge />
            </div>
          </div>
          <div className="wf-panel__actions">
            {loading && <span className="scan-feedback scan-feedback--hint">Refreshing…</span>}
            <button
              className="btn-secondary"
              onClick={() => reload()}
              disabled={loading}
              data-testid="ds-overview-refresh"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <div className="tally-grid" data-testid="ds-overview-tiles">
          <Tile
            label="Fulfilment SLA (24h)"
            icon={TrendingUp}
            value={sla == null ? '—' : `${sla}%`}
            sub={sla == null ? 'Nothing settled in the last 24h' : 'Delivered / settled'}
            tone={sla == null ? undefined : sla >= 95 ? 'ok' : 'short'}
            testId="ds-tile-sla"
          />
          <Tile
            label="Active orders"
            icon={ShoppingBag}
            value={num(data.active_orders)}
            sub={`${num(data.total_orders)} total`}
            testId="ds-tile-active-orders"
          />
          <Tile
            label="Out for delivery"
            icon={Bike}
            value={num(data.out_for_delivery)}
            sub={`${num(data.online_riders_count)} riders online`}
            testId="ds-tile-out-for-delivery"
          />
          <Tile
            label="Avg pick time"
            icon={Timer}
            value={avgPick == null ? '—' : mmss(Math.round(avgPick))}
            sub={avgPick == null ? 'No picks timed yet' : `${avgPick}s per task`}
            testId="ds-tile-avg-pick"
          />
          <Tile
            label="Delivered (24h)"
            icon={PackageCheck}
            value={num(data.today_dispatched_orders)}
            sub={`₹${num(data.today_revenue).toLocaleString('en-IN')} collected`}
            testId="ds-tile-delivered"
          />
          <Tile
            label="Pickers on shift"
            icon={Users}
            value={num(data.active_pickers_count)}
            sub="Active at this site"
            testId="ds-tile-pickers"
          />
          <Tile
            label="Shelf stock"
            icon={Warehouse}
            value={num(inventory.total_units).toLocaleString('en-IN')}
            sub={`${num(inventory.total_skus)} distinct SKUs`}
            testId="ds-tile-shelf-units"
          />
          <Tile
            label="Inbound totes"
            icon={PackageCheck}
            value={num(data.incoming_lpns)}
            sub={num(data.pending_putaways) > 0 ? `${num(data.pending_putaways)} putaways open` : 'All shelved'}
            tone={num(data.pending_putaways) > 0 ? 'over' : 'ok'}
            testId="ds-tile-inbound"
          />
          <Tile
            label="Orders pending"
            icon={ShoppingBag}
            value={num(data.orders_pending)}
            sub="Confirmed, not yet picking"
            tone={num(data.orders_pending) > 0 ? 'short' : 'ok'}
            testId="ds-tile-orders-pending"
          />
          <Tile
            label="Picking now"
            icon={ClipboardList}
            value={num(data.orders_picking)}
            sub={`${num(data.orders_picked)} picked, ${num(data.orders_rack_dropped)} at rack`}
            testId="ds-tile-picking"
          />
          <Tile
            label="Ready for rider"
            icon={Boxes}
            value={num(data.orders_ready)}
            sub={`${num(data.out_for_delivery)} out for delivery`}
            testId="ds-tile-ready"
          />
          <Tile
            label="Pending pick queue"
            icon={Timer}
            value={num(data.pending_pick_queue)}
            sub={num(data.pending_pick_queue) > 0 ? 'Nobody assigned yet' : 'Every pick has an owner'}
            tone={num(data.pending_pick_queue) > 0 ? 'over' : 'ok'}
            testId="ds-tile-pending-queue"
          />
        </div>
      </div>

      <div className="wf-panel">
        <div className="wf-panel__header">
          <div>
            <div className="wf-peek"> What needs attention</div>
            <div className="wf-panel__hint">Open the matching screen from the sidebar to work the queue</div>
          </div>
        </div>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Queue</th>
                <th>Waiting</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody data-testid="ds-overview-queues">
              {[
                { label: 'Totes waiting to be received', value: data.incoming_lpns, screen: 'ds-lpn-receipt' },
                { label: 'Putaways not yet confirmed', value: data.pending_putaways, screen: 'ds-shelf-putaway' },
                { label: 'Orders waiting for a picker', value: data.pending_pick_queue, screen: 'ds-order-picking' },
                { label: 'Orders being picked', value: data.orders_picking, screen: 'ds-order-picking' },
                { label: 'Picked, waiting at the rack', value: data.orders_picked, screen: 'ds-order-picking' },
                { label: 'Rack dropped, waiting for a tote', value: data.orders_rack_dropped, screen: 'ds-packing' },
                { label: 'Packed totes waiting for a rider', value: data.orders_ready, screen: 'ds-rider-handoff' },
              ].map((row) => (
                <tr key={row.screen} data-testid={`ds-queue-${row.screen}`}>
                  <td>{row.label}</td>
                  <td className="mono-num">{num(row.value)}</td>
                  <td>
                    <StatusBadge
                      status={num(row.value) > 0 ? 'PENDING' : 'CLEAR'}
                      dataTestId={`ds-queue-badge-${row.screen}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <DepartmentStatus storeCode={storeCode} />
      <OrderTracking storeCode={storeCode} />
    </>
  );
}

function DepartmentStatus({ storeCode }) {
  const { data, error } = useAsyncData(
    () => dsDepartmentStatus(storeCode),
    [storeCode],
    { pollMs: 15000 },
  );

  return (
    <div className="wf-panel">
      <div className="wf-panel__header">
        <div>
          <div className="wf-peek"> Department status</div>
          <div className="wf-panel__hint">
            Work waiting in every part of the store. Open the sidebar screen to act.
          </div>
        </div>
      </div>
      {error ? (
        <div className="scan-feedback scan-feedback--error">
          <AlertTriangle size={14} /> {error}
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table" data-testid="ds-department-status">
            <thead>
              <tr>
                <th>Department</th>
                <th>Waiting</th>
                <th>What it means</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {(data?.departments || []).map((row) => (
                <tr key={row.key}>
                  <td><strong>{row.label}</strong></td>
                  <td className="mono-num">{num(row.pending)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {row.detail}
                    {row.unassigned ? ` · ${num(row.unassigned)} unassigned` : ''}
                  </td>
                  <td>
                    <StatusBadge status={num(row.pending) > 0 ? 'PENDING' : 'CLEAR'} />
                  </td>
                </tr>
              ))}
              {!data?.departments?.length && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                    Loading departments…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrderTracking({ storeCode }) {
  const { data, error } = useAsyncData(
    () => dsOrderTracking(storeCode),
    [storeCode],
    { pollMs: 15000 },
  );

  return (
    <div className="wf-panel">
      <div className="wf-panel__header">
        <div>
          <div className="wf-peek"> Order tracking</div>
          <div className="wf-panel__hint">
            Every live order and the next physical step, newest first.
          </div>
        </div>
      </div>
      {error ? (
        <div className="scan-feedback scan-feedback--error">
          <AlertTriangle size={14} /> {error}
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table" data-testid="ds-order-tracking">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Rack</th>
                <th>Rider</th>
                <th>Promise</th>
              </tr>
            </thead>
            <tbody>
              {(data?.orders || []).slice(0, 12).map((order) => (
                <tr key={order.order_id}>
                  <td>
                    <strong className="mono-num">{order.order_no}</strong>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      ₹{order.grand_total} · {order.payment_method}
                    </div>
                  </td>
                  <td>{order.customer_name || '—'}</td>
                  <td><StatusBadge status={order.status} /></td>
                  <td className="mono-num">{order.rack_location || '—'}</td>
                  <td className="mono-num">
                    {order.delivery?.rider_id ? order.delivery.status : 'unassigned'}
                  </td>
                  <td className="mono-num">
                    {order.promise_at
                      ? new Date(order.promise_at).toLocaleTimeString([], {
                        hour: '2-digit', minute: '2-digit',
                      })
                      : '—'}
                  </td>
                </tr>
              ))}
              {!data?.orders?.length && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                    No live orders.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CommandCenterView() {
  const { storeCode } = useDarkStore();

  return (
    <StoreGate>
      {storeCode && <Overview storeCode={storeCode} />}
    </StoreGate>
  );
}
