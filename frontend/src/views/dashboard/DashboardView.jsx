import React, { useCallback, useEffect, useState } from 'react';
import { fetchApiPage, describeError } from '../../api/client';
import {
  RefreshCw,
  ArrowDownToLine,
  ArrowRightLeft,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { useTabs } from '../../context/TabContext';

const PAGE_SIZE = 1000;

async function loadPage(path) {
  try {
    const page = await fetchApiPage(`${path}?page_size=${PAGE_SIZE}`);
    return { page, error: '' };
  } catch (err) {
    return { page: { count: 0, results: [] }, error: describeError(err) };
  }
}

const upper = (value) => String(value || '').toUpperCase();
const n = (value) => (value === null || value === undefined ? '—' : value);
const list = (result) => result.page.results || [];

export default function DashboardView() {
  const { openTab } = useTabs();
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState([]);
  const [inboundAsns, setInboundAsns] = useState([]);
  const [activeTripsList, setActiveTripsList] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);

    const [positionsR, transfersR, asnsR, batchesR, grnsR, putawaysR, qcR, tripsR] =
      await Promise.all([
        loadPage('/inventory/positions'),
        loadPage('/ds-ops/transfer-orders/'),
        loadPage('/supply/asns/'),
        loadPage('/fulfilment/batches/'),
        loadPage('/supply/grns/'),
        loadPage('/supply/putaway-tasks/'),
        loadPage('/supply/qc-inspections/'),
        loadPage('/transport/trips/'),
      ]);

    setFailures(
      [
        ['stock positions', positionsR.error],
        ['transfer orders', transfersR.error],
        ['inbound ASNs', asnsR.error],
        ['fulfilment batches', batchesR.error],
        ['goods receipts', grnsR.error],
        ['putaway tasks', putawaysR.error],
        ['QC inspections', qcR.error],
        ['linehaul trips', tripsR.error],
      ]
        .filter(([, error]) => error)
        .map(([name, error]) => `${name} — ${error}`)
    );

    const positions = list(positionsR);
    const transfers = list(transfersR);
    const asns = list(asnsR);
    const grns = list(grnsR);
    const putaways = list(putawaysR);
    const qcs = list(qcR);
    const trips = list(tripsR);

    const countAsn = (...statuses) =>
      asns.filter((row) => statuses.includes(upper(row.status))).length;
    const countTransfer = (...statuses) =>
      transfers.filter((row) => statuses.includes(upper(row.status))).length;
    const countTrip = (...statuses) =>
      trips.filter((row) => statuses.includes(upper(row.status))).length;

    const positionsOk = !positionsR.error;
    const asnsOk = !asnsR.error;
    const transfersOk = !transfersR.error;
    const putawaysOk = !putawaysR.error;
    const tripsOk = !tripsR.error;
    const exceptionsOk = !grnsR.error && !qcR.error;

    const totalValue = positions.reduce(
      (sum, row) => sum + Number(row.mrp || 0) * Number(row.qty || 0),
      0
    );

    setTelemetry({
      totalAsns: asnsOk ? asnsR.page.count : null,
      pendingAsns: asnsOk ? countAsn('ARRIVED', 'GRN_IN_PROGRESS') : null,
      totalTransfers: transfersOk ? transfersR.page.count : null,
      openTransfers: transfersOk
        ? transfers.filter((row) => !['RECEIVED', 'CLOSED', 'CANCELLED'].includes(upper(row.status))).length
        : null,
      inventoryValue: positionsOk ? (totalValue / 100000).toFixed(1) : null,
      positionsCount: positionsOk ? positionsR.page.count : null,
      waveBatches: batchesR.error ? null : batchesR.page.count,
      totalTrips: tripsOk ? tripsR.page.count : null,
      activeTrips: tripsOk ? countTrip('PLANNED', 'IN_TRANSIT', 'DELAYED') : null,
      discrepancies: exceptionsOk
        ? grns.filter((row) => row.has_discrepancy).length +
          qcs.filter((row) => Number(row.fail_count) > 0).length
        : null,
      inboundStages: {
        expected: asnsOk ? countAsn('DRAFT', 'CONFIRMED') : null,
        arrived: asnsOk ? countAsn('ARRIVED') : null,
        inwarding: asnsOk ? countAsn('GRN_IN_PROGRESS') : null,
        putaway: putawaysOk
          ? putaways.filter((row) => upper(row.status) !== 'CONFIRMED').length
          : null,
        closed: asnsOk ? countAsn('CLOSED') : null,
      },
      outboundStages: {
        draft: transfersOk ? countTransfer('DRAFT') : null,
        approved: transfersOk ? countTransfer('APPROVED') : null,
        allocated: transfersOk ? countTransfer('ALLOCATED') : null,
        picking: transfersOk ? countTransfer('PICKING', 'PICKED') : null,
        packed: transfersOk ? countTransfer('SORTED', 'PACKING', 'PACKED') : null,
        transit: transfersOk ? countTransfer('LOADED', 'IN_TRANSIT') : null,
      },
    });

    setInboundAsns(asns.slice(0, 5));
    setActiveTripsList(trips.slice(0, 5));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const t = telemetry || {
    totalAsns: null,
    pendingAsns: null,
    totalTransfers: null,
    openTransfers: null,
    inventoryValue: null,
    positionsCount: null,
    waveBatches: null,
    totalTrips: null,
    activeTrips: null,
    discrepancies: null,
    inboundStages: { expected: null, arrived: null, inwarding: null, putaway: null, closed: null },
    outboundStages: { draft: null, approved: null, allocated: null, picking: null, packed: null, transit: null },
  };

  return (
    <div style={{ paddingBottom: 24 }} data-testid="dashboard-root">
      <div className="screen-header">
        <div>
          <div className="screen-title">Operations Control Tower</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Live telemetry across inbound receiving, stock positions, transfer-order
            flow and linehaul dispatch.
          </div>
        </div>
        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={loadData} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Syncing…' : 'Sync Telemetry'}</span>
          </button>
        </div>
      </div>

      {failures.length > 0 && (
        <div className="scan-feedback scan-feedback--error" data-testid="dashboard-errors" style={{ marginBottom: 14 }}>
          <AlertTriangle size={14} />
          <span>Some telemetry could not be read. Affected tiles show “—” rather than a false zero. {failures.join(' · ')}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-amber)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Inbound Inwarding</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{n(t.totalAsns)} ASNs</div>
          <div style={{ fontSize: 11, color: 'var(--c-amber)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>● {n(t.pendingAsns)} arrived / inwarding</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-teal)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Transfer Orders</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{n(t.totalTransfers)}</div>
          <div style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)', marginTop: 4 }}>↑ {n(t.openTransfers)} open in the pipeline</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-ink)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Inventory Valuation</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{t.inventoryValue === null ? '—' : `₹${t.inventoryValue}L`}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>{n(t.positionsCount)} stock positions</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-amber)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Fulfilment Batches</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{n(t.waveBatches)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>Wave pick batches</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-rust)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Exceptions</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--c-rust)', marginTop: 4 }}>{n(t.discrepancies)}</div>
          <div style={{ fontSize: 11, color: 'var(--c-rust)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>GRN variances &amp; QC failures</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ArrowDownToLine size={14} style={{ color: 'var(--c-amber)' }} />
              <span>Inbound Receiving Pipeline</span>
            </div>
            <button className="btn-ui neutral" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openTab('inbound-asns', 'Inbound ASNs', 'PackageCheck')}><span>Manage Inbound</span><ExternalLink size={10} style={{ marginLeft: 4 }} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {[
              { code: '01', count: t.inboundStages.expected, label: 'Expected' },
              { code: '02', count: t.inboundStages.arrived, label: 'Arrived' },
              { code: '03', count: t.inboundStages.inwarding, label: 'Inwarding' },
              { code: '04', count: t.inboundStages.putaway, label: 'Putaway' },
              { code: '05', count: t.inboundStages.closed, label: 'Closed' },
            ].map((st) => (
              <div key={st.code} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, textAlign: 'center', borderRadius: 'var(--radius-xs)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-muted)' }}>STEP {st.code}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '2px 0' }}>{n(st.count)}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ArrowRightLeft size={14} style={{ color: 'var(--c-teal)' }} />
              <span>Transfer Order Flow Pipeline</span>
            </div>
            <button className="btn-ui neutral" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openTab('sto', 'Transfer Orders (STO)', 'ArrowRightLeft')}><span>View STOs</span><ExternalLink size={10} style={{ marginLeft: 4 }} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {[
              { code: '01', count: t.outboundStages.draft, label: 'Draft' },
              { code: '02', count: t.outboundStages.approved, label: 'Approved' },
              { code: '03', count: t.outboundStages.allocated, label: 'Allocated' },
              { code: '04', count: t.outboundStages.picking, label: 'Picking' },
              { code: '05', count: t.outboundStages.packed, label: 'Packed' },
              { code: '06', count: t.outboundStages.transit, label: 'In Transit' },
            ].map((st) => (
              <div key={st.code} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, textAlign: 'center', borderRadius: 'var(--radius-xs)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-muted)' }}>STAGE {st.code}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '2px 0' }}>{n(st.count)}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>Active Inbound Dock Activity</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latest consignments and the vehicle expected at the dock</div>
            </div>
            <button className="btn-ui neutral" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => openTab('inbound-asns', 'Inbound ASNs', 'PackageCheck')}>All ASNs ({n(t.totalAsns)})</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                <th style={{ padding: '6px 8px' }}>ASN NUMBER</th>
                <th style={{ padding: '6px 8px' }}>SOURCE</th>
                <th style={{ padding: '6px 8px' }}>VEHICLE</th>
                <th style={{ padding: '6px 8px' }}>STATUS</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>ACTION</th>
              </tr></thead>
              <tbody>
                {inboundAsns.length > 0 ? inboundAsns.map((asn) => (
                  <tr key={asn.asn_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--c-teal)' }}>{asn.asn_no}</td>
                    <td style={{ padding: '8px 8px' }}>{asn.source_vendor_name || asn.source_site_code || asn.po_ref || '—'}</td>
                    <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{asn.expected_vehicle || '—'}</td>
                    <td style={{ padding: '8px 8px' }}><span className="status-badge amber" style={{ fontSize: 10 }}>{asn.status}</span></td>
                    <td style={{ padding: '8px 8px', textAlign: 'right' }}><button className="btn-ui neutral" style={{ padding: '2px 6px', fontSize: 10.5 }} onClick={() => openTab('inbound-asns', 'Inbound ASNs', 'PackageCheck')}>Open</button></td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>{failures.some((f) => f.startsWith('inbound ASNs')) ? 'Inbound ASNs could not be read.' : 'No inbound ASNs returned.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>Active Linehaul Dispatch Queue</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Planned and in-transit vehicle movements</div>
            </div>
            <button className="btn-ui neutral" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => openTab('active-trips', 'Active Trips', 'Truck')}>All Trips ({n(t.totalTrips)})</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                <th style={{ padding: '6px 8px' }}>TRIP</th>
                <th style={{ padding: '6px 8px' }}>DESTINATION</th>
                <th style={{ padding: '6px 8px' }}>VEHICLE</th>
                <th style={{ padding: '6px 8px' }}>STATUS</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>DEPARTURE</th>
              </tr></thead>
              <tbody>
                {activeTripsList.length > 0 ? activeTripsList.map((trip) => (
                  <tr key={trip.trip_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{trip.code || '—'}</td>
                    <td style={{ padding: '8px 8px', color: 'var(--c-teal)', fontWeight: 500 }}>{trip.destination_site_code || '—'}</td>
                    <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{trip.vehicle_registration || 'Unassigned'}</td>
                    <td style={{ padding: '8px 8px' }}><span className="status-badge teal" style={{ fontSize: 10 }}>{trip.status}</span></td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{trip.planned_departure_at ? new Date(trip.planned_departure_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>{failures.some((f) => f.startsWith('linehaul trips')) ? 'Linehaul trips could not be read.' : 'No linehaul trips returned.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
