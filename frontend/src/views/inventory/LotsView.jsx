import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { RefreshCw, Download, Search, CheckCircle2 } from 'lucide-react';

export default function LotsView({ initialTab = 'inventory-lots' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [lots, setLots] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [droplists, setDroplists] = useState([]);
  const [cycleCounts, setCycleCounts] = useState([]);
  const [replenishments, setReplenishments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'transactions') {
        const res = await apiClient.get('/inventory/transactions/');
        setTransactions(res.results || []);
      } else if (activeTab === 'droplists') {
        const res = await apiClient.get('/inventory/droplists/');
        setDroplists(res.results || []);
      } else if (activeTab === 'cycle-counts') {
        const res = await apiClient.get('/optional/cycle-counts/');
        setCycleCounts(res.results || []);
      } else if (activeTab === 'replenishment') {
        const res = await apiClient.get('/optional/replenishments/');
        setReplenishments(res.results || []);
      } else {
        const res = await apiClient.get('/inventory/lots/');
        setLots(res.results || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const handleCompleteReplenishment = async (task) => {
    try {
      await apiClient.patch(`/optional/replenishments/${task.rep_id}/`, {
        status: 'COMPLETED',
      });
      await loadData();
    } catch (err) {
      console.error('Failed completing replenishment:', err);
    }
  };

  const handleDownloadCsv = () => {
    if (activeTab === 'transactions') {
      if (transactions.length === 0) return;
      const headers = ['Tx ID', 'SKU', 'Flow', 'Ref Type', 'Quantity', 'From Bin', 'To Bin', 'Created At'];
      const rows = transactions.map(t => [
        t.tx_id,
        t.sku_name || t.sku_code || '—',
        t.flow || '—',
        t.ref_type || '—',
        t.qty || 0,
        t.from_bin || '—',
        t.to_bin || '—',
        t.created_at,
      ]);
      downloadCsv(headers, rows, 'Inventory_Transactions');
    } else if (activeTab === 'droplists') {
      if (droplists.length === 0) return;
      const headers = ['Droplist Code', 'Totes', 'Dropped Count', 'Status', 'Created At'];
      const rows = droplists.map(d => [d.code, d.totes || 0, d.dropped_count || 0, d.status, d.created_at]);
      downloadCsv(headers, rows, 'Droplists');
    } else if (activeTab === 'cycle-counts') {
      if (cycleCounts.length === 0) return;
      const headers = ['Count ID', 'Site', 'Type', 'Scope', 'Status', 'Total Lines', 'Created At'];
      const rows = cycleCounts.map(c => [c.count_id?.slice(0, 8), c.site_code || 'HYD080M', c.type, c.scope || '—', c.status, c.lines?.length || 0, c.created_at]);
      downloadCsv(headers, rows, 'Cycle_Counts');
    } else if (activeTab === 'replenishment') {
      if (replenishments.length === 0) return;
      const headers = ['Rep ID', 'SKU', 'From Bin', 'To Bin', 'Qty', 'Trigger', 'Status', 'Created At'];
      const rows = replenishments.map(r => [
        r.rep_id?.slice(0, 8),
        r.sku_name || '—',
        r.from_bin_code || '—',
        r.to_bin_code || '—',
        r.qty || 0,
        r.trigger || '—',
        r.status,
        r.created_at,
      ]);
      downloadCsv(headers, rows, 'Replenishment_Tasks');
    } else {
      if (lots.length === 0) return;
      const headers = ['Lot Code', 'SKU Code', 'Product Name', 'Bin', 'Qty', 'MRP', 'Bucket', 'Status', 'Expiry Date'];
      const rows = lots.map(l => [
        l.lot_code,
        l.sku_code,
        l.sku_name,
        l.bin_code,
        l.qty,
        l.mrp,
        l.bucket,
        l.status,
        l.expiry_date || '—',
      ]);
      downloadCsv(headers, rows, 'Inventory_Lots');
    }
  };

  const downloadCsv = (headers, rows, prefix) => {
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Zippzo_${prefix}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const lotColumns = [
    { label: 'Lot Code', key: 'lot_code', isCode: true },
    { label: 'SKU Code', key: 'sku_code', isCode: true },
    { label: 'Product Name', key: 'sku_name' },
    { label: 'Bin Coordinate', key: 'bin_code', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--c-amber)', padding: '2px 6px' }}>{val || '—'}</span> },
    { label: 'Quantity', key: 'qty', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong> },
    { label: 'MRP', key: 'mrp', render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>₹{parseFloat(val || 0).toFixed(2)}</span> },
    { label: 'Bucket', key: 'bucket', badge: true },
    { label: 'Status', key: 'status', badge: true },
    { label: 'Expiry Date', key: 'expiry_date', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
  ];

  const txColumns = [
    { label: 'Tx ID', key: 'tx_id', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontSize: 11 }}>{val || '—'}</strong> },
    { label: 'SKU', key: 'sku_name', render: (val, row) => <div><strong>{val || row.sku_code || '—'}</strong><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.sku_code}</div></div> },
    { label: 'Flow', key: 'flow', badge: true },
    { label: 'Ref Type', key: 'ref_type', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Units', key: 'qty', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong> },
    { label: 'From Location', key: 'from_bin', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'To Location', key: 'to_bin', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)', fontWeight: 600 }}>{val || '—'}</span> },
    { label: 'Logged At', key: 'created_at', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span> },
  ];

  const droplistColumns = [
    { label: 'Droplist Code', key: 'code', render: (val) => <strong style={{ color: 'var(--c-amber)', fontFamily: 'var(--font-mono)' }}>{val}</strong> },
    { label: 'Totes', key: 'totes', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong> },
    { label: 'Dropped', key: 'dropped_count', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: '#48a968' }}>{val ?? 0}</span> },
    { label: 'Status', key: 'status', badge: true },
    { label: 'Generated Time', key: 'created_at', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span> },
  ];

  const cycleCountColumns = [
    { label: 'Count ID', key: 'count_id', render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? val.slice(0, 8) + '…' : '—'}</strong> },
    { label: 'Site', key: 'site_code', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || 'HYD080M'}</span> },
    { label: 'Type', key: 'type', badge: true },
    { label: 'Scope / Bins', key: 'scope', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{val || '—'}</span> },
    { label: 'Status', key: 'status', badge: true },
    { label: 'Lines', key: 'lines', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val?.length || 0}</strong> },
    { label: 'Created At', key: 'created_at', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span> },
  ];

  const replenishmentColumns = [
    { label: 'Rep ID', key: 'rep_id', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontSize: 11 }}>{val ? val.slice(0, 8) + '…' : '—'}</strong> },
    { label: 'Product Name', key: 'sku_name', render: (val) => <strong>{val || '—'}</strong> },
    { label: 'From Bin', key: 'from_bin_code', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'To Forward Bin', key: 'to_bin_code', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontWeight: 600 }}>{val || '—'}</span> },
    { label: 'Units', key: 'qty', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong> },
    { label: 'Trigger', key: 'trigger', badge: true },
    { label: 'Status', key: 'status', badge: true },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => row.status !== 'COMPLETED' ? (
        <button
          className="btn-ui neutral"
          style={{ padding: '2px 8px', fontSize: 10.5 }}
          onClick={(e) => {
            e.stopPropagation();
            handleCompleteReplenishment(row);
          }}
        >
          <CheckCircle2 size={11} style={{ color: '#48a968' }} />
          <span>Complete</span>
        </button>
      ) : (
        <span style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)' }}>Replenished</span>
      ),
    },
  ];

  const filteredLots = lots.filter(l => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (l.lot_code && l.lot_code.toLowerCase().includes(q)) ||
      (l.sku_name && l.sku_name.toLowerCase().includes(q)) ||
      (l.bin_code && l.bin_code.toLowerCase().includes(q))
    );
  });

  const filteredTxs = transactions.filter(t => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (t.sku_name && t.sku_name.toLowerCase().includes(q)) ||
      (t.flow && t.flow.toLowerCase().includes(q)) ||
      (t.ref_type && t.ref_type.toLowerCase().includes(q)) ||
      (t.from_bin && t.from_bin.toLowerCase().includes(q)) ||
      (t.to_bin && t.to_bin.toLowerCase().includes(q))
    );
  });

  const filteredDroplists = droplists.filter(d => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (d.code && d.code.toLowerCase().includes(q)) ||
      (d.status && d.status.toLowerCase().includes(q))
    );
  });

  const filteredCycleCounts = cycleCounts.filter(c => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (c.count_id && c.count_id.toLowerCase().includes(q)) ||
      (c.site_code && c.site_code.toLowerCase().includes(q)) ||
      (c.scope && c.scope.toLowerCase().includes(q)) ||
      (c.status && c.status.toLowerCase().includes(q))
    );
  });

  const filteredReplenishments = replenishments.filter(r => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (r.sku_name && r.sku_name.toLowerCase().includes(q)) ||
      (r.from_bin_code && r.from_bin_code.toLowerCase().includes(q)) ||
      (r.to_bin_code && r.to_bin_code.toLowerCase().includes(q))
    );
  });

  const currentCount =
    activeTab === 'transactions' ? filteredTxs.length :
    activeTab === 'droplists' ? filteredDroplists.length :
    activeTab === 'cycle-counts' ? filteredCycleCounts.length :
    activeTab === 'replenishment' ? filteredReplenishments.length :
    filteredLots.length;

  return (
    <div>
      {/* Subtabs Rail */}
      <div className="subtabs-rail" style={{ marginBottom: 12 }}>
        <div className="subtabs-list">
          <button
            className={`subtab-btn ${activeTab === 'inventory-lots' ? 'active' : ''}`}
            onClick={() => setActiveTab('inventory-lots')}
          >
            Inventory Lots ({lots.length})
          </button>
          <button
            className={`subtab-btn ${activeTab === 'transactions' ? 'active' : ''}`}
            onClick={() => setActiveTab('transactions')}
          >
            Transaction Log ({transactions.length})
          </button>
          <button
            className={`subtab-btn ${activeTab === 'droplists' ? 'active' : ''}`}
            onClick={() => setActiveTab('droplists')}
          >
            Droplists ({droplists.length})
          </button>
          <button
            className={`subtab-btn ${activeTab === 'cycle-counts' ? 'active' : ''}`}
            onClick={() => setActiveTab('cycle-counts')}
          >
            Cycle Counts ({cycleCounts.length})
          </button>
          <button
            className={`subtab-btn ${activeTab === 'replenishment' ? 'active' : ''}`}
            onClick={() => setActiveTab('replenishment')}
          >
            Replenishment ({replenishments.length})
          </button>
        </div>

        <div className="screen-actions" style={{ paddingBottom: 6 }}>
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
          <button className="btn-ui neutral" onClick={handleDownloadCsv}>
            <Download size={12} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Screen Header */}
      <div className="screen-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="screen-title">
            <span>
              {activeTab === 'transactions' ? 'INVENTORY AUDIT & TRANSACTION LOG' :
               activeTab === 'droplists' ? 'INTERNAL STOCK MOVEMENT & DROPLISTS' :
               activeTab === 'cycle-counts' ? 'PHYSICAL CYCLE COUNTS & RECONCILIATION' :
               activeTab === 'replenishment' ? 'FORWARD PICK REPLENISHMENT TASKS' :
               'INVENTORY LOTS & PHYSICAL LOCATIONS'}
            </span>
            <span className="screen-count-tag">{currentCount} Records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {activeTab === 'transactions' ? 'Immutable ledger of all stock putaway, pick, sort, and transfer events.' :
             activeTab === 'droplists' ? 'Inter-bin pallet and bin replenishment droplists.' :
             activeTab === 'cycle-counts' ? 'Regular stock verification audits to ensure physical bin accuracy.' :
             activeTab === 'replenishment' ? 'Reserve-to-pickface replenishment to avoid outbound pick stockouts.' :
             'Real-time bin balances, lot serials, and expiry control.'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search records..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{
              padding: '5px 28px 5px 10px',
              fontSize: 12,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)'
            }}
          />
          <Search size={12} style={{ position: 'absolute', right: 8, color: 'var(--text-muted)' }} />
        </div>
      </div>

      {/* Main Table */}
      {activeTab === 'transactions' ? (
        <DataTable
          columns={txColumns}
          data={filteredTxs}
          idField="tx_id"
          emptyMessage="No transaction logs recorded."
        />
      ) : activeTab === 'droplists' ? (
        <DataTable
          columns={droplistColumns}
          data={filteredDroplists}
          idField="droplist_id"
          emptyMessage="No droplists registered."
        />
      ) : activeTab === 'cycle-counts' ? (
        <DataTable
          columns={cycleCountColumns}
          data={filteredCycleCounts}
          idField="count_id"
          emptyMessage="No cycle counts in progress."
        />
      ) : activeTab === 'replenishment' ? (
        <DataTable
          columns={replenishmentColumns}
          data={filteredReplenishments}
          idField="rep_id"
          emptyMessage="No replenishment tasks pending."
        />
      ) : (
        <DataTable
          columns={lotColumns}
          data={filteredLots}
          idField="lot_id"
          emptyMessage="No inventory lots found."
        />
      )}
    </div>
  );
}
