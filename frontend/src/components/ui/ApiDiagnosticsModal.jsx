import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import { X, Play, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

const ALL_APIS = [
  { module: 'Platform', name: 'Users', path: '/platform/users/' },
  { module: 'Platform', name: 'Reason Codes', path: '/platform/reason-codes/' },
  { module: 'Master Data', name: 'Sites', path: '/master/sites/' },
  { module: 'Master Data', name: 'SKU Categories', path: '/master/sku-categories/' },
  { module: 'Master Data', name: 'SKUs', path: '/master/skus/' },
  { module: 'Master Data', name: 'Vendors', path: '/master/vendors/' },
  { module: 'Master Data', name: 'Zones', path: '/master/zones/' },
  { module: 'Master Data', name: 'Bins', path: '/master/bins/' },
  { module: 'Master Data', name: 'Cluster Zones', path: '/master/cluster-zones/' },
  { module: 'Master Data', name: 'Dock Doors', path: '/master/dock-doors/' },
  { module: 'Master Data', name: 'Vehicle Types', path: '/master/vehicle-types/' },
  { module: 'Master Data', name: 'Transporters', path: '/master/transporters/' },
  { module: 'Inventory', name: 'LPNs (Totes)', path: '/inventory/lpns/' },
  { module: 'Inventory', name: 'Inventory Lots', path: '/inventory/lots/' },
  { module: 'Inventory', name: 'Inventory Transactions', path: '/inventory/transactions/' },
  { module: 'Inventory', name: 'Droplists (Movement)', path: '/inventory/droplists/' },
  { module: 'Inbound', name: 'ASNs', path: '/inbound/asns/' },
  { module: 'Inbound', name: 'ASN Lines', path: '/inbound/asn-lines/' },
  { module: 'Inbound', name: 'GRNs', path: '/inbound/grns/' },
  { module: 'Inbound', name: 'GRN Lines', path: '/inbound/grn-lines/' },
  { module: 'Inbound', name: 'Putaway Tasks', path: '/inbound/putaway-tasks/' },
  { module: 'Inbound', name: 'Discrepancies', path: '/inbound/discrepancies/' },
  { module: 'Outbound', name: 'Dispatch Plans', path: '/outbound/dispatch-plans/' },
  { module: 'Outbound', name: 'Wave Batches', path: '/outbound/batches/' },
  { module: 'Outbound', name: 'Orders', path: '/outbound/orders/' },
  { module: 'Outbound', name: 'Order Lines', path: '/outbound/order-lines/' },
  { module: 'Outbound', name: 'Order Allocations', path: '/outbound/allocations/' },
  { module: 'Outbound', name: 'Picklists', path: '/outbound/picklists/' },
  { module: 'Outbound', name: 'Picklist Lines', path: '/outbound/picklist-lines/' },
  { module: 'Outbound', name: 'Sortlists', path: '/outbound/sortlists/' },
  { module: 'Outbound', name: 'Sortlist Lines', path: '/outbound/sortlist-lines/' },
  { module: 'Outbound', name: 'Manifests', path: '/outbound/manifests/' },
  { module: 'Outbound', name: 'Manifest Lines', path: '/outbound/manifest-lines/' },
  { module: 'Outbound', name: 'Cancellation Putaways', path: '/outbound/cancellation-putaways/' },
  { module: 'Transport', name: 'Trips', path: '/transport/trips/' },
  { module: 'Transport', name: 'Vehicle Check-ins', path: '/transport/vehicle-checkins/' },
  { module: 'Transport', name: 'Trip Return Legs', path: '/transport/trip-return-legs/' },
  { module: 'Cross Dock', name: 'XDock Batches', path: '/crossdock/batches/' },
  { module: 'Cross Dock', name: 'XDock Lines', path: '/crossdock/lines/' },
  { module: 'Optional', name: 'Cycle Counts', path: '/optional/cycle-counts/' },
  { module: 'Optional', name: 'Cycle Count Lines', path: '/optional/cycle-count-lines/' },
  { module: 'Optional', name: 'Replenishments', path: '/optional/replenishments/' },
];

export default function ApiDiagnosticsModal({ onClose }) {
  const [results, setResults] = useState({});
  const [isRunning, setIsRunning] = useState(false);
  const [testedCount, setTestedCount] = useState(0);

  const runAll = async () => {
    setIsRunning(true);
    setResults({});
    setTestedCount(0);

    for (let i = 0; i < ALL_APIS.length; i++) {
      const api = ALL_APIS[i];
      const t0 = performance.now();
      try {
        const data = await apiClient.get(api.path);
        const ms = Math.round(performance.now() - t0);
        const count = data.count ?? (Array.isArray(data) ? data.length : (data.results?.length ?? 1));
        setResults(prev => ({
          ...prev,
          [api.path]: { status: 'pass', code: 200, count, latency: ms }
        }));
      } catch (err) {
        setResults(prev => ({
          ...prev,
          [api.path]: { status: 'fail', code: 'ERR', error: err.message }
        }));
      }
      setTestedCount(i + 1);
    }

    setIsRunning(false);
  };

  useEffect(() => {
    runAll();
  }, []);

  const passCount = Object.values(results).filter(r => r.status === 'pass').length;
  const failCount = Object.values(results).filter(r => r.status === 'fail').length;
  const latencies = Object.values(results).filter(r => r.latency).map(r => r.latency);
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : '—';
  const progressPct = Math.round((testedCount / ALL_APIS.length) * 100);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ maxWidth: 960 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-heading" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--c-amber)' }}>⚡</span>
            <span>SYSTEM API DIAGNOSTICS MATRIX (42/42 ENDPOINTS)</span>
          </div>
          <button className="btn-ui neutral" onClick={onClose} style={{ padding: '3px 6px' }}>
            <X size={13} />
          </button>
        </div>

        <div className="modal-content">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                Target REST Base: <code style={{ color: 'var(--c-teal)' }}>http://127.0.0.1:8000/api</code>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                Tested {testedCount} of {ALL_APIS.length} • Pass: <strong style={{ color: '#48a968' }}>{passCount}</strong> • Fail: <strong style={{ color: 'var(--c-rust)' }}>{failCount}</strong> • Avg Latency: <strong>{avgLatency} ms</strong>
              </div>
            </div>

            <button
              onClick={runAll}
              disabled={isRunning}
              className="btn-ui primary"
            >
              {isRunning ? <RefreshCw size={12} className="spin" /> : <Play size={12} />}
              <span>{isRunning ? 'TESTING...' : 'RERUN ALL 42'}</span>
            </button>
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: 4, background: 'var(--bg-input)', borderRadius: 2, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--c-teal)', transition: 'width 0.1s ease' }} />
          </div>

          {/* Grid of 42 APIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8, maxHeight: '55vh', overflowY: 'auto', paddingRight: 4 }}>
            {ALL_APIS.map((api, idx) => {
              const res = results[api.path];
              const isPass = res?.status === 'pass';
              const isFail = res?.status === 'fail';

              return (
                <div
                  key={idx}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderLeft: isPass ? '3px solid var(--c-teal)' : isFail ? '3px solid var(--c-rust)' : '3px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11.5,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{api.module}</div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{api.name}</div>
                    <code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{api.path}</code>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    {isPass && (
                      <div>
                        <span className="status-badge teal">200 OK</span>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{res.count} items • {res.latency}ms</div>
                      </div>
                    )}
                    {isFail && (
                      <span className="status-badge rust">ERROR</span>
                    )}
                    {!res && (
                      <span className="status-badge gray">QUEUED</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
