import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { RefreshCw, Download, Search } from 'lucide-react';

export default function CrossDockView() {
  const [moves, setMoves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');
  const [sites, setSites] = useState([]);
  const [skus, setSkus] = useState([]);
  const [form, setForm] = useState({ code: '', source_site: '', destination_site: '', sku: '', qty: 1, expected_at: '', notes: '' });
  const [error, setError] = useState('');

  const resultsFrom = (data) => Array.isArray(data) ? data : data.results || [];

  const loadData = async () => {
    setLoading(true);
    try {
      const [movesData, sitesData, skuData] = await Promise.all([
        apiClient.get('/transport/cross-dock/', { page_size: 200 }),
        apiClient.get('/network/sites/', { page_size: 500 }),
        apiClient.get('/catalog/skus/', { page_size: 500 }),
      ]);
      setMoves(resultsFrom(movesData));
      setSites(resultsFrom(sitesData));
      setSkus(resultsFrom(skuData).filter((sku) => sku.status === 'ACTIVE'));
      setForm((current) => ({
        ...current,
        source_site: current.source_site || resultsFrom(sitesData).find((site) => site.site_type === 'MH')?.site_id || resultsFrom(sitesData)[0]?.site_id || '',
        destination_site: current.destination_site || resultsFrom(sitesData).find((site) => site.site_type === 'DS' || site.site_type === site.site_type)?.site_id || '',
      }));
    } catch (err) {
      console.error('Failed loading cross-dock moves:', err);
      setMoves([]);
    } finally {
      setLoading(false);
    }
  };

  const createMove = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await apiClient.post('/transport/cross-dock/', {
        code: form.code || `XD-${Date.now()}`,
        source_site: form.source_site,
        destination_site: form.destination_site,
        sku: form.sku || null,
        qty: Number(form.qty),
        expected_at: form.expected_at ? new Date(form.expected_at).toISOString() : null,
        notes: form.notes,
      });
      await loadData();
    } catch (err) {
      setError(err.message || 'Could not create the cross-dock move.');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDownloadCsv = () => {
    if (moves.length === 0) return;
    const headers = ['Move Code', 'Source Site', 'Destination Site', 'SKU', 'LPN', 'Qty', 'Status', 'Expected At', 'Completed At', 'Created At'];
    const rows = moves.map(m => [
      m.code,
      m.source_site_code || '—',
      m.destination_site_code || '—',
      m.sku_code || '—',
      m.lpn_code || '—',
      m.qty || 0,
      m.status,
      m.expected_at || '—',
      m.completed_at || '—',
      m.created_at,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Zippzo_Cross_Dock_Moves_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const columns = [
    {
      label: 'Move Code',
      key: 'code',
      render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'Source Site',
      key: 'source_site_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'Destination Site',
      key: 'destination_site_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)', fontWeight: 600 }}>{val || '—'}</span>,
    },
    {
      label: 'SKU',
      key: 'sku_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'LPN',
      key: 'lpn_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'Qty',
      key: 'qty',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Expected At',
      key: 'expected_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
    {
      label: 'Created At',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
  ];

  const filteredMoves = moves.filter(m => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (m.code && m.code.toLowerCase().includes(q)) ||
      (m.source_site_code && m.source_site_code.toLowerCase().includes(q)) ||
      (m.destination_site_code && m.destination_site_code.toLowerCase().includes(q)) ||
      (m.sku_code && m.sku_code.toLowerCase().includes(q)) ||
      (m.lpn_code && m.lpn_code.toLowerCase().includes(q)) ||
      (m.status && m.status.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      <div className="subtabs-rail" style={{ marginBottom: 12 }}>
        <div className="subtabs-list">
          <button className="subtab-btn active">
            Cross Dock ({moves.length})
          </button>
        </div>

        <div className="screen-actions" style={{ paddingBottom: 6 }}>
          <button className="btn-ui neutral" onClick={loadData}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          <button className="btn-ui neutral" onClick={handleDownloadCsv}>
            <Download size={12} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div className="screen-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="screen-title">
            <span>CROSS DOCK MOVES</span>
            <span className="screen-count-tag">{filteredMoves.length} Records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Stock moving between sites without putaway.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search code, site, SKU, or LPN..."
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

      {error && <div className="form-error-banner" style={{ marginBottom: 12 }}>{error}</div>}
      <form onSubmit={createMove} className="wf-panel" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <label>Move code
            <input className="form-input" value={form.code} onChange={(e) => setForm((current) => ({ ...current, code: e.target.value }))} placeholder="XD-001" />
          </label>
          <label>Source site
            <select className="form-input" value={form.source_site} onChange={(e) => setForm((current) => ({ ...current, source_site: e.target.value }))} required>
              <option value="">Select source…</option>
              {sites.map((site) => <option key={site.site_id} value={site.site_id}>{site.code} — {site.name}</option>)}
            </select>
          </label>
          <label>Destination site
            <select className="form-input" value={form.destination_site} onChange={(e) => setForm((current) => ({ ...current, destination_site: e.target.value }))} required>
              <option value="">Select destination…</option>
              {sites.map((site) => <option key={site.site_id} value={site.site_id}>{site.code} — {site.name}</option>)}
            </select>
          </label>
          <label>Product
            <select className="form-input" value={form.sku} onChange={(e) => setForm((current) => ({ ...current, sku: e.target.value }))}>
              <option value="">No specific SKU…</option>
              {skus.map((sku) => <option key={sku.sku_id} value={sku.sku_id}>{sku.sku_code} — {sku.name}</option>)}
            </select>
          </label>
          <label>Qty
            <input className="form-input" type="number" min="1" value={form.qty} onChange={(e) => setForm((current) => ({ ...current, qty: e.target.value }))} />
          </label>
          <label>Expected at
            <input className="form-input" type="datetime-local" value={form.expected_at} onChange={(e) => setForm((current) => ({ ...current, expected_at: e.target.value }))} />
          </label>
        </div>
        <button className="btn-ui primary" type="submit" style={{ marginTop: 10 }}>Create cross-dock move</button>
      </form>

      <DataTable
        columns={columns}
        data={filteredMoves}
        idField="move_id"
        emptyMessage="No cross-dock moves found."
      />
    </div>
  );
}
