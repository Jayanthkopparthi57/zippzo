import React, { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Package, Truck, Boxes, Barcode, ArrowUpRight, Clock, AlertTriangle, RefreshCw, Target, TrendingUp, MapPin } from 'lucide-react';
import { fetchApi, describeError } from '../api/client';
import { useTabs } from '../context/TabContext';
import { useAuth } from '../context/AuthContext';

const asList = (res) => Array.isArray(res) ? res : res?.results ?? [];

// Never print a number we do not have. A missing metric reads as "—", which is
// distinguishable from a real zero.
function Metric({ value, suffix = '', digits = 0 }) {
  if (value === null || value === undefined || value === '') {
    return <span style={{ color: '#94a3b8' }}>—</span>;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) return <>{value}{suffix}</>;
  return <>{value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}{suffix}</>;
}

function StatCard({ label, value, icon, bg, color, sub }) {
  return (
    <div className="stat-card">
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value" style={{ color }}>{value}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{sub}</div>
      </div>
      <div className="stat-icon" style={{ background: bg, color }}>{icon}</div>
    </div>
  );
}

const ORDER_STATUS_BADGE = (s) => {
  if (['DELIVERED', 'CLOSED'].includes(s)) return 'badge-success';
  if (['CANCELLED', 'CANCELLED_PENDING_RETURN', 'EXPIRED', 'FAILED', 'REFUNDED', 'CLOSED_RTO'].includes(s)) return 'badge-danger';
  if (['OUT_FOR_DELIVERY', 'ARRIVED', 'RIDER_ASSIGNED', 'PICKED_UP'].includes(s)) return 'badge-warning';
  if (['PICKING', 'PICKED', 'PACKED', 'STAGED'].includes(s)) return 'badge-purple';
  return 'badge-default';
};

export default function DashboardView() {
  const { openTab } = useTabs();
  const { facility, facilitiesList } = useAuth();
  const [siteCode, setSiteCode] = useState('');
  const [overview, setOverview] = useState(null);
  const [orders, setOrders] = useState([]);
  const [putaways, setPutaways] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const ovUrl = siteCode ? `/ds-ops/overview?store_code=${encodeURIComponent(siteCode)}` : '/ds-ops/overview';
      const [ov, orderList, putawayList] = await Promise.all([
        fetchApi(ovUrl),
        fetchApi('/orders/orders/'),
        fetchApi('/supply/putaway-tasks/'),
      ]);
      setOverview(ov);
      setOrders(asList(orderList));
      setPutaways(asList(putawayList));
    } catch (err) {
      setError(describeError(err));
      setOverview(null); setOrders([]); setPutaways([]);
    } finally {
      setLoading(false);
    }
  }, [siteCode]);

  useEffect(() => { loadData(); }, [loadData]);

  const shelf = overview?.shelf_inventory || {};
  const recentOrders = orders.slice(0, 4);
  const openPutaways = putaways.filter(p => p.status !== 'CONFIRMED').slice(0, 3);
  const siteName = overview?.scope?.site_name || facility?.name || siteCode || 'All sites';

  return (
    <div>
      {error && (
        <div className="card" style={{
          borderLeft: '3px solid #b91c1c', background: '#fef2f2', padding: '12px 16px',
          marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12
        }}>
          <AlertTriangle size={16} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#7f1d1d', marginBottom: 2 }}>Could not load operations data</div>
            <div style={{ color: '#991b1b' }}>{error}</div>
          </div>
          <button className="btn-secondary" onClick={loadData} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={12} /> {loading ? 'Retrying' : 'Retry'}
          </button>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">
            <LayoutDashboard size={24} style={{ color: 'var(--accent-purple)' }} /> Operations Control Tower
          </h1>
          <p className="page-subtitle">
            {siteName}
            {overview?.scope?.site ? ` (${overview.scope.site})` : ''} — all figures are live aggregates from the ledger
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ height: 32, fontSize: 12, width: 200 }}
            value={siteCode}
            onChange={e => setSiteCode(e.target.value)}
          >
            <option value="">All sites</option>
            {facilitiesList.all_facilities.map(s => (
              <option key={s.site_id} value={s.code}>{s.code} — {s.name || s.site_type}</option>
            ))}
          </select>
          <button className="btn-secondary" onClick={loadData} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button className="btn-primary" onClick={() => openTab('positions', 'Stock Positions')}>
            <Boxes size={16} /> Stock Positions
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <StatCard
          label="Active Orders"
          value={<Metric value={overview?.active_orders} />}
          icon={<Package size={22} />}
          bg="#faf5ff" color="var(--accent-purple-dark)"
          sub={<><Metric value={overview?.total_orders} /> total orders</>}
        />
        <StatCard
          label="Out for Delivery"
          value={<Metric value={overview?.out_for_delivery} />}
          icon={<Truck size={22} />}
          bg="#fffbeb" color="#f59e0b"
          sub={<><Metric value={overview?.today_dispatched_orders} /> delivered in last 24h</>}
        />
        <StatCard
          label="Active LPN Totes"
          value={<Metric value={overview?.total_lpns} />}
          icon={<Barcode size={22} />}
          bg="#ecfeff" color="var(--accent-cyan)"
          sub={<><Metric value={overview?.incoming_lpns} /> inbound in transit</>}
        />
        <StatCard
          label="Shelf Units On Hand"
          value={<Metric value={shelf.total_units} />}
          icon={<Boxes size={22} />}
          bg="#f0fdf4" color="#10b981"
          sub={<><Metric value={shelf.total_skus} /> distinct SKUs stocked</>}
        />
      </div>

      <div className="metrics-grid" style={{ marginTop: 16 }}>
        <StatCard
          label="Fulfilment SLA (24h)"
          value={<Metric value={overview?.sla_compliance_pct} suffix="%" digits={2} />}
          icon={<Target size={22} />}
          bg="#f0f9ff" color="#0284c7"
          sub="Delivered / settled orders"
        />
        <StatCard
          label="Avg Pick Duration"
          value={<Metric value={overview?.avg_pick_time_sec} suffix="s" digits={1} />}
          icon={<Clock size={22} />}
          bg="#fdf4ff" color="#a21caf"
          sub="Completed pick tasks"
        />
        <StatCard
          label="Active Pickers"
          value={<Metric value={overview?.active_pickers_count} />}
          icon={<TrendingUp size={22} />}
          bg="#fefce8" color="#ca8a04"
          sub="Active site assignments"
        />
        <StatCard
          label="Online Riders"
          value={<Metric value={overview?.online_riders_count} />}
          icon={<Truck size={22} />}
          bg="#f0fdf4" color="#16a34a"
          sub={<><Metric value={overview?.pending_putaways} /> putaway tasks open</>}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginTop: 16 }}>
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}>
            <Package size={16} style={{ color: 'var(--accent-purple)' }} /> Recent Orders
          </h3>

          {recentOrders.length === 0 ? (
            <div style={{ fontSize: 12, color: '#94a3b8', padding: '18px 0', textAlign: 'center' }}>
              {error ? 'Order data unavailable.' : 'No orders recorded yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentOrders.map(o => (
                <div key={o.order_id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 12, background: '#f8fafc', borderRadius: 6, border: '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className={`badge ${ORDER_STATUS_BADGE(o.status)}`}>{o.status}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{o.order_no}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {o.payment_method} • {o.payment_status} • grand total {o.grand_total}
                      </div>
                    </div>
                  </div>
                  <button className="btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }}
                    onClick={() => openTab('orders', 'Order Queue')}>
                    Inspect <ArrowUpRight size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {openPutaways.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '18px 0 10px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}>
                <Clock size={15} style={{ color: '#f59e0b' }} /> Open Putaway Tasks
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {openPutaways.map(t => (
                  <div key={t.task_id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', background: '#fffbeb', borderRadius: 6, border: '1px solid #fde68a'
                  }}>
                    <div style={{ fontSize: 12 }}>
                      <strong>{t.to_container}</strong> • {t.qty} units
                      <span style={{ color: '#92400e' }}> — {t.status}</span>
                    </div>
                    <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 9px' }}
                      onClick={() => openTab('putaway-tasks', 'Shelf Putaway')}>
                      Put away
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Quick Actions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn-secondary" style={{ justifyContent: 'flex-start', padding: '10px 12px' }} onClick={() => openTab('asns', 'Incoming LPNs')}>
              <Package size={15} style={{ color: 'var(--accent-purple)' }} /> Inbound ASN & GRN
            </button>
            <button className="btn-secondary" style={{ justifyContent: 'flex-start', padding: '10px 12px' }} onClick={() => openTab('bins', 'Bins & Locations')}>
              <MapPin size={15} style={{ color: 'var(--accent-cyan)' }} /> Bin & Location Registry
            </button>
            <button className="btn-secondary" style={{ justifyContent: 'flex-start', padding: '10px 12px' }} onClick={() => openTab('pick-execute', 'Pick & Pack Execution')}>
              <Truck size={15} style={{ color: '#10b981' }} /> Pick & Pack Execution
            </button>
            <button className="btn-secondary" style={{ justifyContent: 'flex-start', padding: '10px 12px' }} onClick={() => openTab('transaction-log', 'Stock Movements')}>
              <TrendingUp size={15} style={{ color: '#f59e0b' }} /> Stock Movement Ledger
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
