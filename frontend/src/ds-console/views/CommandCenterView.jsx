import React from 'react';
import {
  RefreshCw,
  Activity,
  ArrowDownToLine,
  ArrowRightLeft,
  ExternalLink,
} from 'lucide-react';
import { useTabs } from '../../ds-console/context/TabContext';
import { useDarkStore, useAsyncData, dsOverview, num, mmss } from '../../views/darkstore/useDarkStore';

export default function CommandCenterView({ onOpenDiagnostics }) {
  const { openTab } = useTabs();
  const { storeCode } = useDarkStore();
  const { data, error, loading, reload } = useAsyncData(
    () => (storeCode ? dsOverview(storeCode) : Promise.resolve(null)),
    [storeCode],
    { pollMs: 30000 }
  );

  if (!storeCode) {
    return (
      <div className="screen-header">
        <div>
          <div className="screen-title">DARK STORE COMMAND CENTER</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Select a dark store from the header to view operations.
          </div>
        </div>
      </div>
    );
  }

  const inventory = data?.shelf_inventory || {};
  const sla = data?.sla_compliance_pct;
  const avgPick = data?.avg_pick_time_sec;

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="screen-header">
        <div>
          <div className="screen-title">DARK STORE COMMAND CENTER</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Real-time dark store telemetry across inbound receiving, shelf inventory, order fulfillment, and rider dispatch.
          </div>
        </div>
        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => reload()}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync Telemetry</span>
          </button>
          <button className="btn-ui neutral" onClick={onOpenDiagnostics}>
            <Activity size={12} style={{ color: 'var(--c-teal)' }} />
            <span>System Diagnostics</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="form-error-banner" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Loading dark store telemetry...
        </div>
      )}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-amber)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Fulfilment SLA (24h)</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{sla == null ? '—' : `${sla}%`}</div>
              <div style={{ fontSize: 11, color: 'var(--c-amber)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {sla == null ? 'Nothing settled in the last 24h' : 'Delivered / settled'}
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-teal)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Orders</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{num(data.active_orders)}</div>
              <div style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                ↑ {num(data.total_orders)} total
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-teal)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Out for Delivery</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{num(data.out_for_delivery)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {num(data.online_riders_count)} riders online
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-ink)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Shelf Stock</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{num(inventory.total_units).toLocaleString('en-IN')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {num(inventory.total_skus)} distinct SKUs
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-amber)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Inbound Totes</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{num(data.incoming_lpns)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {num(data.pending_putaways) > 0 ? `${num(data.pending_putaways)} putaways open` : 'All shelved'}
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderTop: '3px solid var(--c-rust)', padding: 14, borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Avg Pick Time</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{avgPick == null ? '—' : mmss(Math.round(avgPick))}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {avgPick == null ? 'No picks timed yet' : `${avgPick}s per task`}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ArrowDownToLine size={14} style={{ color: 'var(--c-amber)' }} />
                  <span>Inbound Receiving Pipeline</span>
                </div>
                <button className="btn-ui neutral" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openTab({ id: 'ds-lpn-receipt', title: 'LPN Receipt', view: 'LpnReceiptView' })}>
                  <span>Manage Inbound</span>
                  <ExternalLink size={10} style={{ marginLeft: 4 }} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {[
                  { code: '01', count: num(data.incoming_lpns), label: 'Incoming' },
                  { code: '02', count: num(data.pending_putaways), label: 'Putaway' },
                  { code: '03', count: num(inventory.total_skus), label: 'SKUs' },
                  { code: '04', count: num(inventory.total_units), label: 'Units' },
                ].map(st => (
                  <div key={st.code} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, textAlign: 'center', borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-muted)' }}>STEP {st.code}</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '2px 0' }}>{st.count}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{st.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ArrowRightLeft size={14} style={{ color: 'var(--c-teal)' }} />
                  <span>Outbound Order Flow</span>
                </div>
                <button className="btn-ui neutral" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openTab({ id: 'ds-orders', title: 'Customer Orders', view: 'OrdersView' })}>
                  <span>View Orders</span>
                  <ExternalLink size={10} style={{ marginLeft: 4 }} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {[
                  { code: '01', count: num(data.active_orders), label: 'Active' },
                  { code: '02', count: num(data.out_for_delivery), label: 'Dispatched' },
                  { code: '03', count: num(data.today_dispatched_orders), label: 'Delivered' },
                  { code: '04', count: num(data.online_riders_count), label: 'Riders' },
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
        </>
      )}
    </div>
  );
}
