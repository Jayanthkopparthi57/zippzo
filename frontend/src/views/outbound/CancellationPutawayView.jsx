import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { RefreshCw } from 'lucide-react';

export default function CancellationPutawayView() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await apiClient
        .get('/outbound/orders/?type=CANCELLED')
        .catch(() => ({ results: [] }));
      setTasks(data.results || []);
    } catch (err) {
      console.error(err);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const filtered = tasks.filter((t) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (t.order_no && t.order_no.toLowerCase().includes(q)) ||
      (t.status && t.status.toLowerCase().includes(q))
    );
  });

  const columns = [
    {
      label: 'Order No',
      key: 'order_no',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>{val || '—'}</span>
      ),
    },
    {
      label: 'Destination',
      key: 'dest_site',
      render: (val) => <span>{val || '—'}</span>,
    },
    {
      label: 'Qty',
      key: 'total_qty',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{val ?? 0}</span>
      ),
    },
    { label: 'Status', key: 'status', badge: true },
    {
      label: 'Created',
      key: 'created_at',
      render: (val) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {val ? new Date(val).toLocaleDateString() : '—'}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>CANCELLATION PUTAWAY</span>
            <span className="screen-count-tag">{filtered.length} records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Putaway tasks generated from cancelled outbound orders.
          </div>
        </div>
        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      <div className="table-filter-row">
        <input
          type="text"
          className="table-filter-input"
          placeholder="Filter table rows..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
        <span className="table-record-count">
          Showing {filtered.length} of {tasks.length} records
        </span>
      </div>

      <DataTable columns={columns} data={filtered} idField="order_id" />
    </div>
  );
}
