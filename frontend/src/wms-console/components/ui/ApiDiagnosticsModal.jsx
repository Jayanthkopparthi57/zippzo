import React, { useState, useEffect } from 'react';
import { apiClient, API_BASE } from '../../api/client';
import { X, Play, RefreshCw } from 'lucide-react';

// Every path here must answer on the running server. The previous list was a
// catalogue of the retired API surface, so the matrix reported a wall of
// failures that said nothing about the product's health.
const ALL_APIS = [
  { module: 'Platform', name: 'Users', path: '/iam/users/' },
  { module: 'Platform', name: 'Sites', path: '/network/sites/' },
  { module: 'Master Data', name: 'SKU Categories', path: '/catalog/categories/' },
  { module: 'Master Data', name: 'SKUs', path: '/catalog/skus/' },
  { module: 'Master Data', name: 'Vendors', path: '/supply/vendors/' },
  { module: 'Master Data', name: 'Zones', path: '/network/zones/' },
  { module: 'Master Data', name: 'Bins / Locations', path: '/network/locations/' },
  { module: 'Master Data', name: 'Dock Doors', path: '/network/dock-doors/' },
  { module: 'Master Data', name: 'Vehicle Types', path: '/network/vehicle-types/' },
  { module: 'Master Data', name: 'Transporters', path: '/master/carriers/' },
  { module: 'Inventory', name: 'LPNs (Totes)', path: '/inventory/lpns/' },
  { module: 'Inventory', name: 'Inventory Lots', path: '/catalog/lots/' },
  { module: 'Inventory', name: 'Stock Movements', path: '/inventory/movements/' },
  { module: 'Inventory', name: 'Stock Balances', path: '/inventory/balances/' },
  { module: 'Inbound', name: 'ASNs', path: '/supply/asns/' },
  { module: 'Inbound', name: 'ASN Lines', path: '/supply/asn-lines/' },
  { module: 'Inbound', name: 'GRNs', path: '/supply/grns/' },
  { module: 'Inbound', name: 'GRN Lines', path: '/supply/grn-lines/' },
  { module: 'Inbound', name: 'Putaway Tasks', path: '/supply/putaway-tasks/' },
  { module: 'Outbound', name: 'Dispatch Plans', path: '/transport/dispatch-plans/' },
  { module: 'Outbound', name: 'Wave Batches', path: '/fulfilment/batches/' },
  { module: 'Outbound', name: 'Orders', path: '/orders/orders/' },
  { module: 'Outbound', name: 'Order Lines', path: '/orders/order-lines/' },
  { module: 'Outbound', name: 'Allocations', path: '/fulfilment/allocations/' },
  { module: 'Outbound', name: 'Picklists', path: '/ds-ops/pick-tasks/picklists/' },
  { module: 'Outbound', name: 'Sorting Waves', path: '/ds-ops/sorting-waves/' },
  { module: 'Outbound', name: 'Transfer Orders', path: '/ds-ops/transfer-orders/' },
  { module: 'Transport', name: 'Shipments', path: '/transport/shipments/' },
  { module: 'Transport', name: 'Trips', path: '/transport/trips/' },
  { module: 'Transport', name: 'Vehicle Check-ins', path: '/master/vehicle-checkins/' },
  { module: 'Optional', name: 'Cycle Counts', path: '/counting/cycle-counts/' },
  { module: 'Optional', name: 'Cycle Count Lines', path: '/counting/cycle-count-lines/' },
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
            <span>SYSTEM API DIAGNOSTICS MATRIX ({ALL_APIS.length} ENDPOINTS)</span>
          </div>
          <button className="btn-ui neutral" onClick={onClose} style={{ padding: '3px 6px' }}>
            <X size={13} />
          </button>
        </div>

        <div className="modal-content">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                Target REST Base: <code style={{ color: 'var(--c-teal)' }}>{API_BASE}</code>
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
              <span>{isRunning ? 'TESTING...' : `RERUN ALL ${ALL_APIS.length}`}</span>
            </button>
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: 4, background: 'var(--bg-input)', borderRadius: 2, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--c-teal)', transition: 'width 0.1s ease' }} />
          </div>

          {/* Grid of probed endpoints */}
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
