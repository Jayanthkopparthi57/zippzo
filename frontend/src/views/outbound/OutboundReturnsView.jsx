import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, describeError } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { RefreshCw, AlertTriangle } from 'lucide-react';

export default function OutboundReturnsView() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiClient.get('/reverse/returns/?page_size=500');
      setReturns(Array.isArray(data) ? data : []);
    } catch (err) {
      setLoadError(describeError(err));
      setReturns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const columns = [
    { label: 'Return ID', key: 'return_id', render: (val) => (<strong style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)' }}>{val ? String(val).slice(0, 8) : '—'}</strong>) },
    { label: 'Order', key: 'order', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? String(val).slice(0, 8) : '—'}</span>) },
    { label: 'Reason', key: 'reason', render: (val) => <span style={{ fontSize: 12 }}>{val || '—'}</span> },
    { label: 'Fault', key: 'fault', render: (val) => (<span className="status-badge amber" style={{ fontSize: 10 }}>{val || 'NONE'}</span>) },
    { label: 'Status', key: 'status', badge: true },
    { label: 'QC disposition', key: 'qc_disposition', render: (val) => <span style={{ fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Refund', key: 'refund_amount', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val != null ? `₹${Number(val).toFixed(2)}` : '—'}</span>) },
    { label: 'Created', key: 'created_at', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>) },
  ];

  return (
    <div data-testid="outbound-returns-root">
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>OUTBOUND RETURNS</span>
            <span className="screen-count-tag">{returns.length} records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Customer return orders and their QC / refund pipeline.</div>
        </div>
        <div className="screen-actions">
          <button type="button" className="btn-ui neutral" onClick={loadData} disabled={loading} data-testid="outbound-returns-refresh">
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Syncing…' : 'Sync'}</span>
          </button>
        </div>
      </div>
      {loadError && (<div className="scan-feedback scan-feedback--error" data-testid="outbound-returns-error" style={{ marginBottom: 12 }}><AlertTriangle size={14} /><span>{loadError}</span></div>)}
      <DataTable title="Customer returns" columns={columns} data={returns} idField="return_id" selectable={false} hideCheckboxes data-testid="outbound-returns-table" />
    </div>
  );
}
