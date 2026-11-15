import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, describeError } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { useAuth } from '../../context/AuthContext';
import {
  RefreshCw,
  Plus,
  AlertTriangle,
  FileText,
  X,
  Trash2,
  ExternalLink,
} from 'lucide-react';

const PAGE_SIZE = 500;

const EMPTY_LINE = () => ({ sku: '', qty: 1 });

const fmtDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
};

const asArray = (value) => (Array.isArray(value) ? value : []);

export default function InboundView({ initialTab, initialSubtab = 'asns' }) {
  const { facility } = useAuth();
  const startingTab = initialTab || initialSubtab || 'asns';

  const [activeSubtab, setActiveSubtab] = useState(startingTab);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState([]);

  const [asns, setAsns] = useState([]);
  const [grns, setGrns] = useState([]);
  const [putaways, setPutaways] = useState([]);
  const [qcFailures, setQcFailures] = useState([]);

  const [detail, setDetail] = useState(null);
  const [detailLines, setDetailLines] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [vendors, setVendors] = useState([]);
  const [sites, setSites] = useState([]);
  const [skus, setSkus] = useState([]);
  const [dockDoors, setDockDoors] = useState([]);

  const [form, setForm] = useState({
    type: 'VENDOR_PO',
    source_vendor: '',
    source_site: '',
    dest_site: '',
    po_ref: '',
    door: '',
    expected_vehicle: '',
    lines: [EMPTY_LINE()],
  });

  useEffect(() => {
    setActiveSubtab(startingTab);
  }, [startingTab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [vendorRes, siteRes, skuRes, doorRes] = await Promise.allSettled([
        apiClient.get(`/supply/vendors/?page_size=${PAGE_SIZE}`),
        apiClient.get(`/network/sites/?page_size=${PAGE_SIZE}`),
        apiClient.get(`/catalog/skus/?page_size=${PAGE_SIZE}`),
        apiClient.get(`/network/dock-doors/?page_size=${PAGE_SIZE}`),
      ]);
      if (cancelled) return;

      setVendors(
        asArray(vendorRes.status === 'fulfilled' ? vendorRes.value : []).filter(
          (v) => String(v.status || '').toUpperCase() === 'ACTIVE'
        )
      );
      const siteList = asArray(siteRes.status === 'fulfilled' ? siteRes.value : []);
      setSites(siteList);
      setSkus(asArray(skuRes.status === 'fulfilled' ? skuRes.value : []));
      setDockDoors(asArray(doorRes.status === 'fulfilled' ? doorRes.value : []));

      const ownSite = siteList.find((s) => s.code === facility?.code);
      if (ownSite) {
        setForm((prev) =>
          prev.dest_site ? prev : { ...prev, dest_site: ownSite.site_id }
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [facility?.code]);

  const loadData = useCallback(async (subtab = activeSubtab) => {
    setLoading(true);
    setLoadError('');
    try {
      if (subtab === 'asns') {
        const data = asArray(await apiClient.get(`/supply/asns/?page_size=${PAGE_SIZE}`));
        setAsns(data);
        setRows(data);
      } else if (subtab === 'grns') {
        const data = asArray(await apiClient.get(`/supply/grns/?page_size=${PAGE_SIZE}`));
        setGrns(data);
        setRows(data);
      } else if (subtab === 'putaway') {
        const data = asArray(
          await apiClient.get(`/supply/putaway-tasks/?page_size=${PAGE_SIZE}`)
        );
        setPutaways(data);
        setRows(data);
      } else if (subtab === 'exceptions') {
        const [grnData, qcData] = await Promise.all([
          apiClient.get(`/supply/grns/?page_size=${PAGE_SIZE}`),
          apiClient.get(`/supply/qc-inspections/?page_size=${PAGE_SIZE}`),
        ]);
        const varianceRows = asArray(grnData).filter((g) => g.has_discrepancy);
        const qcRows = asArray(qcData).filter((q) => Number(q.fail_count || 0) > 0);
        setGrns(asArray(grnData));
        setQcFailures(qcRows);
        setRows(
          [
            ...varianceRows.map((g) => ({
              row_id: `grn-${g.grn_id}`,
              reference: g.grn_no,
              asn_no: g.asn_no || '—',
              kind: 'GRN variance',
              detail: `${g.mode} · ${g.status}`,
              status: 'OPEN',
              recorded_at: g.created_at,
              source: g,
            })),
            ...qcRows.map((q) => ({
              row_id: `qc-${q.qc_id}`,
              reference: q.grn_no || '—',
              asn_no: q.asn_no || '—',
              kind: 'QC failure',
              detail: `${q.sku_name || q.sku_code || 'SKU'} — ${q.fail_count}/${q.sample_size} failed`,
              status: q.status || 'FAILED',
              recorded_at: q.tested_at,
              source: q,
            })),
          ].sort(
            (a, b) =>
              new Date(b.recorded_at || 0).getTime() -
              new Date(a.recorded_at || 0).getTime()
          )
        );
      } else {
        setRows([]);
      }
    } catch (err) {
      setLoadError(describeError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeSubtab]);

  useEffect(() => {
    loadData(activeSubtab);
  }, [activeSubtab, loadData]);

  const typeNeedsVendor = form.type === 'VENDOR_PO' || form.type === 'RTV_IN';
  const typeNeedsSourceSite = form.type === 'MH_TRANSFER' || form.type === 'STORE_RETURN';

  const eligibleDoors = useMemo(
    () => dockDoors.filter((d) => !form.dest_site || d.site === form.dest_site),
    [dockDoors, form.dest_site]
  );

  const resetForm = () => {
    const ownSite = sites.find((s) => s.code === facility?.code);
    setForm({
      type: 'VENDOR_PO',
      source_vendor: '',
      source_site: '',
      dest_site: ownSite?.site_id || '',
      po_ref: '',
      door: '',
      expected_vehicle: '',
      lines: [EMPTY_LINE()],
    });
    setCreateError('');
  };

  const openCreate = () => {
    resetForm();
    setShowCreate(true);
  };

  const setLine = (index, patch) => {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  };

  const addLine = () =>
    setForm((prev) => ({ ...prev, lines: [...prev.lines, EMPTY_LINE()] }));

  const removeLine = (index) =>
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.length === 1 ? prev.lines : prev.lines.filter((_, i) => i !== index),
    }));

  const handleCreateAsn = async (event) => {
    event.preventDefault();
    setCreateError('');

    if (!form.dest_site) {
      setCreateError('Choose the destination site.');
      return;
    }
    if (typeNeedsVendor && !form.source_vendor) {
      setCreateError('Choose the vendor this consignment is expected from.');
      return;
    }
    if (typeNeedsSourceSite && !form.source_site) {
      setCreateError('Choose the site this consignment is transferring from.');
      return;
    }

    const lines = form.lines
      .map((line) => ({ sku: line.sku, qty: parseInt(line.qty, 10) }))
      .filter((line) => line.sku && Number.isFinite(line.qty) && line.qty > 0);

    if (lines.length === 0) {
      setCreateError('Add at least one SKU line with a quantity greater than zero.');
      return;
    }

    setCreating(true);
    try {
      const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
      const asn = await apiClient.post('/supply/asns/', {
        type: form.type,
        source_vendor: typeNeedsVendor ? form.source_vendor : null,
        source_site: typeNeedsSourceSite ? form.source_site : null,
        dest_site: form.dest_site,
        po_ref: form.po_ref.trim(),
        door: form.door || null,
        expected_vehicle: form.expected_vehicle.trim(),
        total_skus: lines.length,
        total_qty: totalQty,
        status: 'DRAFT',
      });

      for (const line of lines) {
        const sku = skus.find((s) => s.sku_id === line.sku);
        await apiClient.post('/supply/asn-lines/', {
          asn: asn.asn_id,
          sku: line.sku,
          ean: sku?.ean || '',
          ordered_qty: line.qty,
          line_status: 'OPEN',
        });
      }

      setShowCreate(false);
      resetForm();
      setActiveSubtab('asns');
      await loadData('asns');
    } catch (err) {
      setCreateError(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  const openDetail = async (row) => {
    setDetail(row);
    setDetailLines([]);
    setDetailError('');
    setDetailLoading(true);
    try {
      const lines = asArray(
        await apiClient.get(`/supply/asn-lines/?asn=${row.asn_id}&page_size=${PAGE_SIZE}`)
      );
      setDetailLines(lines);
    } catch (err) {
      setDetailError(describeError(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const asnColumns = useMemo(
    () => [
      { label: 'ASN', key: 'asn_no', render: (val, row) => (<div><strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val || '—'}</strong><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>PO: {row.po_ref || '—'}</div></div>) },
      { label: 'Type', key: 'type', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>) },
      { label: 'Vendor / Source', key: 'source_vendor_name', render: (val, row) => (<span>{val || row.source_site_code || '—'}</span>) },
      { label: 'Destination', key: 'dest_site_code', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>) },
      { label: 'Vehicle', key: 'expected_vehicle', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>) },
      { label: 'SKUs / Qty', key: 'total_qty', render: (val, row) => (<div><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ?? 0} qty</span><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.total_skus ?? 0} SKUs</div></div>) },
      { label: 'Status', key: 'status', badge: true },
      { label: 'Lines', key: 'action', render: (_, row) => (<button type="button" className="btn-ui neutral" style={{ padding: '3px 8px', fontSize: 11 }} data-testid={`inbound-asn-lines-${row.asn_no}`} onClick={(e) => { e.stopPropagation(); openDetail(row); }}><FileText size={11} /><span>View lines</span></button>) },
    ],
    []
  );

  const grnColumns = useMemo(
    () => [
      { label: 'GRN', key: 'grn_no', render: (val) => (<strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val || '—'}</strong>) },
      { label: 'ASN', key: 'asn_no', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>) },
      { label: 'Site', key: 'dest_site_code', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>) },
      { label: 'Mode', key: 'mode', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>) },
      { label: 'Status', key: 'status', badge: true },
      { label: 'Variance', key: 'has_discrepancy', render: (val) => (<span style={{ color: val ? 'var(--c-rust)' : '#48a968', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ? 'VARIANCE' : 'CLEAN'}</span>) },
      { label: 'Received by', key: 'received_by_name', render: (val) => <span>{val || '—'}</span> },
      { label: 'Created', key: 'created_at', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{fmtDateTime(val)}</span>) },
    ],
    []
  );

  const putawayColumns = useMemo(
    () => [
      { label: 'Task', key: 'task_id', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? String(val).slice(0, 8) : '—'}</span>) },
      { label: 'GRN / ASN', key: 'grn_no', render: (val, row) => (<div><strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val || '—'}</strong><div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>ASN: {row.asn_no || '—'}</div></div>) },
      { label: 'SKU', key: 'sku_name', render: (val, row) => (<div><strong>{val || '—'}</strong><div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{row.sku_code || '—'} · Lot {row.lot_number || '—'}</div></div>) },
      { label: 'Qty', key: 'qty', render: (val, row) => (<div><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{row.placed_qty ?? 0}/{val ?? 0}</span><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>placed / task</div></div>) },
      { label: 'From → To', key: 'to_bin_code', render: (val, row) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.from_container || '—'} → {val || '—'}</span>) },
      { label: 'Assignee', key: 'assigned_to_name', render: (val) => <span>{val || 'Unassigned'}</span> },
      { label: 'Status', key: 'status', badge: true },
      { label: 'Created', key: 'created_at', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{fmtDateTime(val)}</span>) },
    ],
    []
  );

  const exceptionColumns = useMemo(
    () => [
      { label: 'Reference', key: 'reference', render: (val) => (<strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val || '—'}</strong>) },
      { label: 'ASN', key: 'asn_no', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>) },
      { label: 'Type', key: 'kind', render: (val) => <span className="status-badge rust">{val}</span> },
      { label: 'Detail', key: 'detail', render: (val) => <span style={{ fontSize: 12 }}>{val || '—'}</span> },
      { label: 'Status', key: 'status', render: (val) => (<span className="status-badge amber">{val || 'OPEN'}</span>) },
      { label: 'Recorded', key: 'recorded_at', render: (val) => (<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{fmtDateTime(val)}</span>) },
    ],
    []
  );

  const columnsFor = (subtab) => {
    switch (subtab) {
      case 'grns': return grnColumns;
      case 'putaway': return putawayColumns;
      case 'exceptions': return exceptionColumns;
      default: return asnColumns;
    }
  };

  const idFieldFor = (subtab) => {
    if (subtab === 'grns') return 'grn_id';
    if (subtab === 'putaway') return 'task_id';
    if (subtab === 'exceptions') return 'row_id';
    return 'asn_id';
  };

  const subtabs = [
    { id: 'asns', label: 'Consignments (ASN)' },
    { id: 'grns', label: 'Goods Receipts' },
    { id: 'putaway', label: 'Putaway Queue' },
    { id: 'exceptions', label: 'Receiving Exceptions' },
  ];

  const countFor = (subtab) => {
    if (subtab === 'asns') return asns.length;
    if (subtab === 'grns') return grns.length;
    if (subtab === 'putaway') return putaways.length;
    if (subtab === 'exceptions') return rows.length;
    return 0;
  };

  return (
    <div data-testid="inbound-root">
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>INBOUND OPERATIONS</span>
            <span className="screen-count-tag">{rows.length} records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Plan consignments and watch receiving, putaway and QC exceptions. Physical
            receiving and shelving run in the Zippzo Operations app.
          </div>
        </div>

        <div className="screen-actions">
          <button type="button" className="btn-ui neutral" onClick={() => loadData(activeSubtab)} disabled={loading} data-testid="inbound-sync">
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Syncing…' : 'Sync'}</span>
          </button>

          {activeSubtab === 'asns' && (
            <button type="button" className="btn-ui primary" onClick={openCreate} data-testid="inbound-create-asn">
              <Plus size={13} />
              <span>Create consignment</span>
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="scan-feedback scan-feedback--error" data-testid="inbound-error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} />
          <span>{loadError}</span>
        </div>
      )}

      <div className="subtabs-rail">
        <div className="subtabs-list">
          {subtabs.map((tab) => (
            <button key={tab.id} type="button" className={`subtab-btn ${activeSubtab === tab.id ? 'active' : ''}`} onClick={() => setActiveSubtab(tab.id)} data-testid={`inbound-tab-${tab.id}`}>
              {tab.label}
              <span style={{ marginLeft: 6, opacity: 0.7 }}>({countFor(tab.id)})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="scan-feedback scan-feedback--hint" style={{ marginBottom: 12 }} data-testid="inbound-surface-note">
        <ExternalLink size={14} />
        <span>Receiving, goods receipt and putaway confirmation are captured on the handheld operations app. This desk shows what the floor has recorded.</span>
      </div>

      <DataTable title={subtabs.find((tab) => tab.id === activeSubtab)?.label} columns={columnsFor(activeSubtab)} data={rows} idField={idFieldFor(activeSubtab)} selectable={false} hideCheckboxes onRowClick={activeSubtab === 'asns' ? openDetail : undefined} data-testid="inbound-table" />

      {detail && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, background: 'var(--bg-card)', borderLeft: '1px solid var(--border-mid)', boxShadow: 'var(--shadow-modal)', zIndex: 1000, display: 'flex', flexDirection: 'column' }} data-testid="inbound-detail">
          <div style={{ padding: 16, borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700 }}>ASN {detail.asn_no}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{detail.type} · {detail.dest_site_code || '—'}</div>
            </div>
            <button type="button" className="btn-ui neutral" onClick={() => setDetail(null)} style={{ padding: '4px 6px' }} data-testid="inbound-detail-close"><X size={14} /></button>
          </div>
          <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div><div style={labelStyle}>Status</div><div style={{ marginTop: 4 }}><span className="status-badge teal">{detail.status || '—'}</span></div></div>
              <div><div style={labelStyle}>Vehicle</div><div style={valueStyle}>{detail.expected_vehicle || '—'}</div></div>
              <div><div style={labelStyle}>Vendor / Source</div><div style={valueStyle}>{detail.source_vendor_name || detail.source_site_code || '—'}</div></div>
              <div><div style={labelStyle}>PO reference</div><div style={valueStyle}>{detail.po_ref || '—'}</div></div>
              <div><div style={labelStyle}>Created by</div><div style={valueStyle}>{detail.created_by_name || '—'}</div></div>
              <div><div style={labelStyle}>Created</div><div style={valueStyle}>{fmtDateTime(detail.created_at)}</div></div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, marginBottom: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>Line items ({detailLines.length})</div>
            {detailLoading ? (<div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading lines…</div>) : detailError ? (<div className="scan-feedback scan-feedback--error"><AlertTriangle size={13} /><span>{detailError}</span></div>) : detailLines.length === 0 ? (<div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }} data-testid="inbound-detail-empty">No line items recorded for this consignment.</div>) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detailLines.map((line) => (
                  <div key={line.line_id} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{line.sku_name || '—'}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      <span>{line.sku_code || '—'}</span>
                      <span>Ordered: {line.ordered_qty ?? 0}</span>
                      <span style={{ color: 'var(--c-teal)' }}>{line.line_status || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, width: 'min(640px, 94vw)' }} data-testid="inbound-create-modal">
            <div className="modal-header">
              <div className="modal-title">Create inbound consignment</div>
              <button type="button" className="btn-ui neutral" onClick={() => setShowCreate(false)}><X size={14} /></button>
            </div>
            <form onSubmit={handleCreateAsn}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {createError && (<div className="scan-feedback scan-feedback--error" data-testid="inbound-create-error"><AlertTriangle size={14} /><span>{createError}</span></div>)}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value, source_vendor: '', source_site: '' }))} style={inputStyle} data-testid="inbound-create-type">
                      <option value="VENDOR_PO">Vendor PO</option>
                      <option value="MH_TRANSFER">Main hub transfer</option>
                      <option value="STORE_RETURN">Store return</option>
                      <option value="RTV_IN">Return to vendor (in)</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Destination site</label>
                    <select value={form.dest_site} onChange={(e) => setForm((prev) => ({ ...prev, dest_site: e.target.value, door: '' }))} style={inputStyle} required data-testid="inbound-create-dest-site">
                      <option value="">Select site…</option>
                      {sites.map((site) => (<option key={site.site_id} value={site.site_id}>{site.name || site.code} · {site.code}</option>))}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {typeNeedsVendor ? (
                    <div>
                      <label style={labelStyle}>Vendor</label>
                      <select value={form.source_vendor} onChange={(e) => setForm((prev) => ({ ...prev, source_vendor: e.target.value }))} style={inputStyle} required data-testid="inbound-create-vendor">
                        <option value="">Select vendor…</option>
                        {vendors.map((vendor) => (<option key={vendor.vendor_id} value={vendor.vendor_id}>{vendor.name} · {vendor.code}</option>))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label style={labelStyle}>Source site</label>
                      <select value={form.source_site} onChange={(e) => setForm((prev) => ({ ...prev, source_site: e.target.value }))} style={inputStyle} required data-testid="inbound-create-source-site">
                        <option value="">Select site…</option>
                        {sites.filter((site) => site.site_id !== form.dest_site).map((site) => (<option key={site.site_id} value={site.site_id}>{site.name || site.code} · {site.code}</option>))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label style={labelStyle}>PO reference</label>
                    <input type="text" value={form.po_ref} onChange={(e) => setForm((prev) => ({ ...prev, po_ref: e.target.value }))} style={inputStyle} placeholder="Optional purchase-order reference" data-testid="inbound-create-po" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Dock door</label>
                    <select value={form.door} onChange={(e) => setForm((prev) => ({ ...prev, door: e.target.value }))} style={inputStyle} data-testid="inbound-create-door">
                      <option value="">Unassigned</option>
                      {eligibleDoors.map((door) => (<option key={door.door_id} value={door.door_id}>{door.code} · {door.capability || 'standard'}</option>))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Expected vehicle</label>
                    <input type="text" value={form.expected_vehicle} onChange={(e) => setForm((prev) => ({ ...prev, expected_vehicle: e.target.value }))} style={inputStyle} placeholder="Registration, if known" data-testid="inbound-create-vehicle" />
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginTop: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={labelStyle}>Expected line items</span>
                    <button type="button" className="btn-ui neutral" onClick={addLine} data-testid="inbound-create-add-line"><Plus size={12} /><span>Add line</span></button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {form.lines.map((line, index) => (
                      <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 34px', gap: 8 }}>
                        <select value={line.sku} onChange={(e) => setLine(index, { sku: e.target.value })} style={inputStyle} data-testid={`inbound-create-sku-${index}`}>
                          <option value="">Select SKU…</option>
                          {skus.map((sku) => (<option key={sku.sku_id} value={sku.sku_id}>{sku.name} · {sku.sku_code}</option>))}
                        </select>
                        <input type="number" min="1" step="1" value={line.qty} onChange={(e) => setLine(index, { qty: e.target.value })} style={inputStyle} data-testid={`inbound-create-qty-${index}`} />
                        <button type="button" className="btn-ui neutral" onClick={() => removeLine(index)} disabled={form.lines.length === 1} title="Remove line" aria-label={`Remove line ${index + 1}`}><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn-ui primary" disabled={creating} data-testid="inbound-create-submit">{creating ? 'Creating…' : 'Create consignment'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', display: 'block', marginBottom: 4 };
const valueStyle = { marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)' };
const inputStyle = { width: '100%', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'inherit' };
