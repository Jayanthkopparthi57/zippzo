import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import {
  RefreshCw,
  Activity,
  ArrowDownToLine,
  ArrowRightLeft,
  ExternalLink
} from 'lucide-react';
import { useTabs } from '../../context/TabContext';

export default function DashboardView({ onOpenDiagnostics }) {
  const { openTab } = useTabs();
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inboundAsns, setInboundAsns] = useState([]);
  const [activeTripsList, setActiveTripsList] = useState([]);
  const [degraded, setDegraded] = useState([]);

  const loadData = async () => {
    setLoading(true);
    // One dashboard card must not blank the whole board. Each source is
    // fetched independently and a failing one is reported as degraded
    // telemetry instead of rejecting the Promise.all and leaving every tile
    // on zero.
    const failed = [];
    const get = async (path, params = {}) => {
      try {
        return await apiClient.get(path, params);
      } catch (err) {
        failed.push(path);
        console.error(`Telemetry source unavailable: ${path}`, err);
        return { results: [], count: 0 };
      }
    };

    try {
      const [orders, trips, lots, asns, batches, grns, putaways, skus, balances] = await Promise.all([
        get('/orders/orders/', { page_size: 200 }),
        get('/transport/trips/', { page_size: 200 }),
        get('/catalog/lots/', { page_size: 200 }),
        get('/supply/asns/', { page_size: 200 }),
        get('/fulfilment/batches/', { page_size: 200 }),
        get('/supply/grns/', { page_size: 200 }),
        get('/supply/putaway-tasks/', { page_size: 200 }),
        get('/catalog/skus/', { page_size: 1000 }),
        get('/inventory/balances/', { page_size: 1000 }),
      ]);

      // Valuation needs quantity (balances) and price (SKU master); lots carry
      // no stock quantity, so the old mrp × lot formula was always zero.
      const mrpBySku = new Map((skus.results || []).map(s => [s.sku_id, parseFloat(s.mrp || 0)]));
      const inventoryValue = (balances.results || []).reduce(
        (sum, b) => sum + (mrpBySku.get(b.sku) || 0) * (b.qty || 0), 0,
      );

      const count = (payload) => payload.count ?? payload.results?.length ?? 0;
      const byStatus = (payload, statuses) =>
        (payload.results || []).filter(r => statuses.includes(r.status)).length;

      const activeTripsCount = byStatus(trips, ['PLANNED', 'IN_TRANSIT']);
      const pendingPutaways = byStatus(putaways, ['GENERATED', 'ACCEPTED', 'IN_PROGRESS']);
      const discrepancies = (grns.results || []).filter(g => g.has_discrepancy).length;

      setTelemetry({
        totalOrders: count(orders),
        openOrders: byStatus(orders, [
          'PLACED', 'PAYMENT_PENDING', 'CONFIRMED', 'PICKING', 'PICKED',
          'PARTIALLY_FULFILLED', 'PACKED', 'STAGED',
        ]),
        activeTrips: activeTripsCount,
        totalTrips: count(trips),
        inventoryValue: (inventoryValue / 100000).toFixed(1),
        lotsCount: count(lots),
        totalAsns: count(asns),
        pendingAsns: byStatus(asns, ['DRAFT', 'CONFIRMED', 'ARRIVED', 'GRN_IN_PROGRESS']),
        pendingPutaways,
        waveBatches: count(batches),
        discrepancies,
        inboundStages: {
          expected: byStatus(asns, ['DRAFT', 'CONFIRMED']),
          arrived: byStatus(asns, ['ARRIVED']),
          unloading: byStatus(asns, ['GRN_IN_PROGRESS']),
          putaway: pendingPutaways,
          closed: byStatus(asns, ['CLOSED']),
        },
        outboundStages: {
          created: byStatus(orders, ['PLACED', 'PAYMENT_PENDING']),
          allocated: byStatus(orders, ['CONFIRMED']),
          picking: byStatus(orders, ['PICKING']),
          sorted: byStatus(orders, ['PICKED', 'PARTIALLY_FULFILLED']),
          packed: byStatus(orders, ['PACKED', 'STAGED']),
          shipped: byStatus(orders, ['RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']),
        },
      });

      setInboundAsns((asns.results || []).slice(0, 5));
      setActiveTripsList((trips.results || []).slice(0, 5));
      setDegraded(failed);
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

      {degraded.length > 0 && (
        <div className="form-error-banner" style={{ marginBottom: 16 }}>
          {degraded.length} telemetry source(s) unavailable: {degraded.join(', ')}. Tiles below show live values from the sources that answered.
        </div>
      )}

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
                        {trip.code}
                      </td>
                      <td style={{ padding: '8px 8px', color: 'var(--c-teal)', fontWeight: 500 }}>
                        {trip.destination_site_code || '—'}
                      </td>
                      <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {trip.vehicle_registration || 'UNASSIGNED'}
                      </td>
                      <td style={{ padding: '8px 8px' }}>
                        <span className="status-badge teal" style={{ fontSize: 10 }}>{trip.status}</span>
                      </td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                        {trip.planned_departure_at ? new Date(trip.planned_departure_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
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
