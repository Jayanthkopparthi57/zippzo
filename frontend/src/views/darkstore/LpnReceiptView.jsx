import React, { useCallback, useMemo, useState } from 'react';
import { Check, X, AlertTriangle, RefreshCw } from 'lucide-react';
import StoreGate from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useDarkStore, useAsyncData, dsIncomingLpns, receiveLpn } from './useDarkStore';

function norm(v) {
  return String(v || '').trim().toUpperCase();
}

function Receipt({ storeCode, storeName }) {
  const toast = useToast();
  const { data: queue, error: error, loading, reload } = useAsyncData(
    () => dsIncomingLpns(storeCode),
    [storeCode],
    { pollMs: 30000 }
  );

  const [selectedTote, setSelectedTote] = useState(null);
  const [seal, setSeal] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const rows = useMemo(() => queue || [], [queue]);

  const onConfirmReceipt = useCallback(
    async (toteToReceive) => {
      const target = toteToReceive || selectedTote;
      if (!target) return;
      setBusy(true);
      setFeedback(null);
      try {
        const res = await receiveLpn(
          target.barcode || target.lpn_id || target.id,
          storeCode,
          seal.trim() || target.seal_number || ''
        );
        toast.success(`Tote ${target.barcode || target.id} received into custody`);
        setFeedback({
          type: 'success',
          message: `Received ${target.barcode || target.id}. ${(res?.stock_moved || []).length} item lines added to store stock.`,
        });
        setSelectedTote(null);
        setSeal('');
        reload();
      } catch (err) {
        setFeedback({
          type: 'error',
          message: err.message || 'Failed to accept tote. Please check status.',
        });
      } finally {
        setBusy(false);
      }
    },
    [selectedTote, storeCode, seal, toast, reload]
  );

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter !== 'ALL' && norm(r.status) !== statusFilter) return false;
      if (!filterQuery) return true;
      const q = filterQuery.toLowerCase();
      return (
        String(r.barcode || '').toLowerCase().includes(q) ||
        String(r.lpn_id || r.id || '').toLowerCase().includes(q) ||
        String(r.source_name || r.source || '').toLowerCase().includes(q)
      );
    });
  }, [rows, statusFilter, filterQuery]);

  const pendingCount = rows.filter(r => norm(r.status) === 'IN_TRANSIT' || norm(r.status) === 'DISPATCHED' || norm(r.status) === 'SHIPPED').length;
  const receivedCount = rows.filter(r => norm(r.status) === 'RECEIVED').length;

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Header */}
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>INBOUND TOTE RECEIPTS (LPN)</span>
            <span className="screen-count-tag">{filteredRows.length} records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Receive mother hub replenishment totes directly into store custody without scanning.
          </div>
        </div>

        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => reload()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync Receipts</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="kpi-card teal">
          <div className="kpi-label">Incoming Totes</div>
          <div className="kpi-value">{rows.length}</div>
          <div className="kpi-sub">From mother warehouse</div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-label">Awaiting Receipt</div>
          <div className="kpi-value">{pendingCount}</div>
          <div className="kpi-sub">Ready to acknowledge</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Received in Store</div>
          <div className="kpi-value">{receivedCount}</div>
          <div className="kpi-sub">Ready for shelf putaway</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Active Store</div>
          <div className="kpi-value" style={{ fontSize: 18, color: 'var(--accent)' }}>{storeCode}</div>
          <div className="kpi-sub">{storeName || 'Dark Store RJY'}</div>
        </div>
      </div>

      {feedback && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: feedback.type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
            color: feedback.type === 'error' ? 'var(--danger)' : 'var(--success)',
            border: `1px solid ${feedback.type === 'error' ? 'var(--danger-border)' : 'var(--success-border)'}`,
          }}
        >
          {feedback.type === 'error' ? <AlertTriangle size={15} /> : <Check size={15} />}
          <span style={{ flex: 1 }}>{feedback.message}</span>
          <button
            type="button"
            className="btn-ui neutral"
            style={{ padding: '2px 6px', fontSize: 11 }}
            onClick={() => setFeedback(null)}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="status-tabs">
        {['ALL', 'IN_TRANSIT', 'DISPATCHED', 'SHIPPED', 'RECEIVED'].map(st => (
          <button
            key={st}
            className={`status-tab ${statusFilter === st ? 'active' : ''}`}
            onClick={() => setStatusFilter(st)}
          >
            {st === 'ALL' ? `All Totes (${rows.length})` : `${st.replace(/_/g, ' ')} (${rows.filter(r => norm(r.status) === st).length})`}
          </button>
        ))}
      </div>

      {/* Filter Row */}
      <div className="table-filter-row">
        <input
          type="text"
          className="table-filter-input"
          placeholder="Filter tote barcode or source..."
          value={filterQuery}
          onChange={e => setFilterQuery(e.target.value)}
        />
        <span className="table-record-count">Showing {filteredRows.length} of {rows.length} totes</span>
      </div>

      {/* Totes Table */}
      <div className="wms-table-wrap">
        <table className="wms-table">
          <thead>
            <tr>
              <th>TOTE BARCODE / LPN</th>
              <th>SOURCE HUB</th>
              <th>SEAL NUMBER</th>
              <th>UNITS / ITEMS</th>
              <th>DISPATCH TIME</th>
              <th>STATUS</th>
              <th style={{ textAlign: 'right' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length > 0 ? (
              filteredRows.map(row => {
                const isReceived = norm(row.status) === 'RECEIVED';
                return (
                  <tr key={row.lpn_id || row.id || row.barcode}>
                    <td>
                      <div>
                        <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                          {row.barcode || row.lpn_id || row.id}
                        </strong>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          LPN: {String(row.lpn_id || row.id || '').slice(0, 12)}
                        </div>
                      </div>
                    </td>
                    <td>{row.source_name || row.source || 'Central Hub HYD080M'}</td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {row.seal_code || row.seal || '—'}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {row.item_count ?? row.qty ?? '—'} units
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {row.dispatched_at ? new Date(row.dispatched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={row.status || 'IN_TRANSIT'} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!isReceived ? (
                        <button
                          type="button"
                          className="btn-ui primary"
                          style={{ padding: '3px 10px', fontSize: 11 }}
                          disabled={busy}
                          onClick={() => {
                            setSelectedTote(row);
                            onConfirmReceipt(row);
                          }}
                        >
                          <Check size={12} />
                          <span>Receive Tote</span>
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
                          âœ“ In Custody
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                  No replenishment totes found in this queue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LpnReceiptView() {
  const { storeCode, storeName, operatorName } = useDarkStore();
  return (
    <StoreGate>
      <Receipt storeCode={storeCode} storeName={storeName} operatorName={operatorName} />
    </StoreGate>
  );
}

