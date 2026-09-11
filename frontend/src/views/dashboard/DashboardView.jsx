import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import {
  RefreshCw,
  Activity,
  ArrowDownToLine,
  ArrowRightLeft,
  Truck,
  Warehouse,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink
} from 'lucide-react';
import { useTabs } from '../../context/TabContext';

export default function DashboardView({ onOpenDiagnostics }) {
  const { openTab } = useTabs();
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inboundAsns, setInboundAsns] = useState([]);
  const [activeTripsList, setActiveTripsList] = useState([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [orders, trips, lots, asns, batches, discrepancies, grns, putaways] = await Promise.all([
        apiClient.get('/outbound/orders/'),
        apiClient.get('/transport/trips/'),
        apiClient.get('/inventory/lots/'),
        apiClient.get('/inbound/asns/'),
        apiClient.get('/outbound/batches/'),
        apiClient.get('/inbound/discrepancies/'),
        apiClient.get('/inbound/grns/'),
        apiClient.get('/inbound/putaway-tasks/'),
      ]);

      const totalVal = (lots.results || []).reduce((sum, l) => sum + parseFloat(l.mrp || 0) * (l.qty || 0), 0);
      const activeTripsCount = (trips.results || []).filter(t => ['IN_TRANSIT', 'LOADING', 'DOCKED_IN', 'CHECKED_IN'].includes(t.status)).length;
      const openOrdersCount = (orders.results || []).filter(o => ['CREATED', 'ALLOCATED', 'PICKING', 'SORTED'].includes(o.status)).length;
      const pendingAsnsCount = (asns.results || []).filter(a => ['ARRIVED', 'CHECKED_IN', 'QC_PENDING'].includes(a.status)).length;
      const pendingPutawayCount = (putaways.results || []).filter(p => p.status === 'PENDING').length;

      // Inbound stages counts
      const asnExpected = (asns.results || []).filter(a => a.status === 'DRAFT' || a.status === 'CONFIRMED').length;
      const asnArrived = (asns.results || []).filter(a => a.status === 'ARRIVED' || a.status === 'CHECKED_IN').length;
      const asnUnloading = (asns.results || []).filter(a => a.status === 'UNLOADED' || a.status === 'QC_PENDING').length;
      const asnPutaway = (asns.results || []).filter(a => a.status === 'PUTAWAY_PENDING').length;
      const asnClosed = (asns.results || []).filter(a => a.status === 'CLOSED').length;

      // Outbound stages counts
      const orderCreated = (orders.results || []).filter(o => o.status === 'CREATED').length;
      const orderAllocated = (orders.results || []).filter(o => o.status === 'ALLOCATED').length;
      const orderPicking = (orders.results || []).filter(o => o.status === 'PICKING').length;
      const orderSorted = (orders.results || []).filter(o => o.status === 'SORTED').length;
      const orderPacked = (orders.results || []).filter(o => o.status === 'PACKED').length;
      const orderShipped = (orders.results || []).filter(o => o.status === 'SHIPPED').length;

      setTelemetry({
        totalOrders: orders.count ?? orders.results?.length ?? 0,
        openOrders: openOrdersCount,
        activeTrips: activeTripsCount,
        totalTrips: trips.count ?? trips.results?.length ?? 0,
        inventoryValue: (totalVal / 100000).toFixed(1),
        lotsCount: lots.count ?? lots.results?.length ?? 0,
        totalAsns: asns.count ?? asns.results?.length ?? 0,
        pendingAsns: pendingAsnsCount,
        pendingPutaways: pendingPutawayCount,
        waveBatches: batches.count ?? batches.results?.length ?? 0,
        discrepancies: discrepancies.count ?? discrepancies.results?.length ?? 0,
        inboundStages: {
          expected: asnExpected,
          arrived: asnArrived,
          unloading: asnUnloading,
          putaway: asnPutaway,
          closed: asnClosed,
        },
        outboundStages: {
          created: orderCreated,
          allocated: orderAllocated,
          picking: orderPicking,
          sorted: orderSorted,
          packed: orderPacked,
          shipped: orderShipped,
        }
      });

      setInboundAsns((asns.results || []).slice(0, 5));
      setActiveTripsList((trips.results || []).slice(0, 5));
    } catch (err) {
      console.error('Error fetching dashboard telemetry:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const t = telemetry || {
    totalOrders: 0,
    openOrders: 0,
    activeTrips: 0,
    totalTrips: 0,
    inventoryValue: '0.0',
    lotsCount: 0,
    totalAsns: 0,
    pendingAsns: 0,
    pendingPutaways: 0,
    waveBatches: 0,
    discrepancies: 0,
    inboundStages: { expected: 0, arrived: 0, unloading: 0, putaway: 0, closed: 0 },
    outboundStages: { created: 0, allocated: 0, picking: 0, sorted: 0, packed: 0, shipped: 0 },
  };

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Screen Header */}
      <div className="screen-header">
        <div>
          <div className="screen-title">OPERATIONAL CONTROL OVERVIEW</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Real-time warehouse telemetry across Inbound receiving, inventory storage, wave picking, and fleet dispatch.
          </div>
        </div>

        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync Telemetry</span>
          </button>
          <button className="btn-ui neutral" onClick={onOpenDiagnostics}>
            <Activity size={12} style={{ color: 'var(--c-teal)' }} />
            <span>System Diagnostics</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        {/* Inbound KPI */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-amber)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Inbound Inwarding</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{t.totalAsns} ASNs</div>
          <div style={{ fontSize: 11, color: 'var(--c-amber)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            • {t.pendingAsns} ASNs pending dock / putaway
          </div>
        </div>

        {/* Outbound Orders KPI */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-teal)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Outbound STOs</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{t.totalOrders}</div>
          <div style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            ↑ {t.openOrders} in fulfillment pipeline
          </div>
        </div>

        {/* Fleet In-Transit KPI */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-teal)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Fleet In-Transit</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{t.activeTrips}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            of {t.totalTrips} scheduled store routes
          </div>
        </div>

        {/* Inventory Valuation KPI */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-ink)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Inventory Valuation</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>₹{t.inventoryValue}L</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            {t.lotsCount} active storage lots
          </div>
        </div>

        {/* Wave Batches KPI */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-amber)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Wave Batches</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{t.waveBatches}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            Wave pick optimization
          </div>
        </div>

        {/* Exceptions & Discrepancies KPI */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-rust)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Logged Discrepancies</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--c-rust)', marginTop: 4 }}>{t.discrepancies}</div>
          <div style={{ fontSize: 11, color: 'var(--c-rust)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            OSD & putaway variances
          </div>
        </div>
      </div>

      {/* DUAL PIPELINE DISPLAY: Inbound Receiving + Outbound Order Fulfillment */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Inbound Receiving Pipeline */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ArrowDownToLine size={14} style={{ color: 'var(--c-amber)' }} />
              <span>Inbound Receiving Pipeline</span>
            </div>
            <button
              className="btn-ui neutral"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => openTab({ id: 'inbound-asns', title: 'Inbound ASNs', view: 'InboundView' })}
            >
              <span>Manage Inbound</span>
              <ExternalLink size={10} style={{ marginLeft: 4 }} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {[
              { code: '01', count: t.inboundStages.expected, label: 'Expected' },
              { code: '02', count: t.inboundStages.arrived, label: 'Gate / Arrived' },
              { code: '03', count: t.inboundStages.unloading, label: 'Dock Inward' },
              { code: '04', count: t.inboundStages.putaway, label: 'Putaway' },
              { code: '05', count: t.inboundStages.closed, label: 'Closed' },
            ].map(st => (
              <div key={st.code} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, textAlign: 'center', borderRadius: 'var(--radius-xs)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-muted)' }}>STEP {st.code}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '2px 0' }}>{st.count}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Outbound Order Flow Pipeline */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ArrowRightLeft size={14} style={{ color: 'var(--c-teal)' }} />
              <span>Outbound Order Flow Pipeline</span>
            </div>
            <button
              className="btn-ui neutral"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => openTab({ id: 'sto', title: 'STO', view: 'StoView' })}
            >
              <span>View STOs</span>
              <ExternalLink size={10} style={{ marginLeft: 4 }} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {[
              { code: '01', count: t.outboundStages.created, label: 'Created' },
              { code: '02', count: t.outboundStages.allocated, label: 'Allocated' },
              { code: '03', count: t.outboundStages.picking, label: 'Picking' },
              { code: '04', count: t.outboundStages.sorted, label: 'Sorted' },
              { code: '05', count: t.outboundStages.packed, label: 'Packed' },
              { code: '06', count: t.outboundStages.shipped, label: 'Shipped' },
            ].map(st => (
              <div key={st.code} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, textAlign: 'center', borderRadius: 'var(--radius-xs)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-muted)' }}>STAGE {st.code}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '2px 0' }}>{st.count}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* LIVE OPERATIONAL MONITOR TABLES (Inbound Dock Activity & Outbound Dispatch) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Live Inbound Dock Activity Table */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>
                Active Inbound Dock Activity
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latest arriving vehicles, vendor deliveries, and receiving status</div>
            </div>

            <button
              className="btn-ui neutral"
              style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => openTab({ id: 'inbound-asns', title: 'Inbound ASNs', view: 'InboundView' })}
            >
              All ASNs ({t.totalAsns})
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                  <th style={{ padding: '6px 8px' }}>ASN NUMBER</th>
                  <th style={{ padding: '6px 8px' }}>VENDOR</th>
                  <th style={{ padding: '6px 8px' }}>VEHICLE</th>
                  <th style={{ padding: '6px 8px' }}>STATUS</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {inboundAsns.length > 0 ? (
                  inboundAsns.map(asn => (
                    <tr key={asn.asn_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--c-teal)' }}>
                        {asn.asn_no}
                      </td>
                      <td style={{ padding: '8px 8px' }}>
                        {asn.source_vendor_name || asn.source_site_code || '—'}
                      </td>
                      <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {asn.expected_vehicle || '—'}
                      </td>
                      <td style={{ padding: '8px 8px' }}>
                        <span className="status-badge amber" style={{ fontSize: 10 }}>{asn.status}</span>
                      </td>
                      <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                        <button
                          className="btn-ui neutral"
                          style={{ padding: '2px 6px', fontSize: 10.5 }}
                          onClick={() => openTab({ id: 'inbound-asns', title: 'Inbound ASNs', view: 'InboundView' })}
                        >
                          Inward
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                      No active inbound dock records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Outbound Fleet Dispatch Table */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>
                Active Linehaul Dispatch Queue
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Store delivery routes, loading progress, and departure cutoffs</div>
            </div>

            <button
              className="btn-ui neutral"
              style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => openTab({ id: 'active-trips', title: 'Active Trips', view: 'ActiveTripsView' })}
            >
              All Trips ({t.totalTrips})
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                  <th style={{ padding: '6px 8px' }}>TRIP ID</th>
                  <th style={{ padding: '6px 8px' }}>DESTINATION</th>
                  <th style={{ padding: '6px 8px' }}>VEHICLE</th>
                  <th style={{ padding: '6px 8px' }}>STATUS</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>SCHEDULED</th>
                </tr>
              </thead>
              <tbody>
                {activeTripsList.length > 0 ? (
                  activeTripsList.map(trip => (
                    <tr key={trip.trip_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {trip.trip_no}
                      </td>
                      <td style={{ padding: '8px 8px', color: 'var(--c-teal)', fontWeight: 500 }}>
                        {trip.dest_site || trip.site_code || '—'}
                      </td>
                      <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {trip.vehicle_no || 'UNASSIGNED'}
                      </td>
                      <td style={{ padding: '8px 8px' }}>
                        <span className="status-badge teal" style={{ fontSize: 10 }}>{trip.status}</span>
                      </td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                        {trip.scheduled_departure ? new Date(trip.scheduled_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                      No active dispatch trips found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
