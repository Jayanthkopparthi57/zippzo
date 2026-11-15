import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Plus, Trash2, RefreshCw, PackageCheck, Truck, ClipboardList,
  ArrowRightLeft, AlertTriangle, CheckCircle2, Boxes, Factory,
} from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import StatusBadge from '../components/ui/StatusBadge';
import { PageHead, SubTabs } from '../components/ui/WmsUI';
import { useToast } from '../components/ui/Toast';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../api/client';

/**
 * Stock Transfer Orders (STO) — the outbound ledger.
 *
 * The reference screen is a table, not a creation form: one row per transfer
 * with its lifecycle totals, and the form behind a "New STO" action. Every
 * number below is read from the API (`/ds-ops/transfer-orders/`, which
 * annotates the lifecycle totals in SQL) — nothing is estimated in the browser.
 *
 *   Ordered      total_qty raised with the transfer
 *   Allocated    units on its pick lines (allocation happens at creation)
 *   Picked       sum of picked_qty over the pick lines
 *   Short        sum of short_qty over the pick lines
 *   Shipped      packed LPN contents once the transfer is IN_TRANSIT/RECEIVED
 *   Received     the same contents once the destination has received it
 *
 * "Section" is the category of the first SKU on the pick list; the transfer
 * record itself has no section column, so it is blank when no pick line exists.
 */

const STATUS_LABEL = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  ALLOCATED: 'Allocated',
  PICKING: 'Picking',
  PICKED: 'Picked',
  SORTED: 'Sorted',
  PACKING: 'Packing',
  PACKED: 'Packed',
  LOADED: 'Loaded',
  IN_TRANSIT: 'In Transit',
  RECEIVED: 'Received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

const STATUS_ORDER = Object.keys(STATUS_LABEL);

const stoLabel = (row) =>
  `STO-${String(row?.transfer_id ?? '').slice(0, 8).toUpperCase()}`;

const siteLabel = (code, name) => {
  if (!code && !name) return '—';
  if (!name) return code;
  return (
    <>
      <span style={{ fontWeight: 700, color: '#0f172a' }}>{code}</span>
      <span style={{ color: '#64748b' }}> · {name}</span>
    </>
  );
};

const dt = (v) => (v ? new Date(v).toLocaleString() : '—');

/** Big value with the SKU sub-count underneath, as the reference shows it. */
function QtyCell({ value, skus }) {
  return (
    <div style={{ lineHeight: 1.15 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{Number(value) || 0}</div>
      <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 600 }}>
        {Number(skus) || 0} SKUs
      </div>
    </div>
  );
}

const emptyLine = () => ({ sku: '', qty: 1, bin: '' });

export default function TransferOrderView() {
  const toast = useToast();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('sto');
  const [statusFilter, setStatusFilter] = useState('ALL');

  /* ── detail drawer ─────────────────────────────────────────────────── */
  const [detail, setDetail] = useState(null);
  const [lines, setLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesError, setLinesError] = useState('');
  const [skuMap, setSkuMap] = useState({});
  const [skusLoaded, setSkusLoaded] = useState(false);

  /* ── creation modal ────────────────────────────────────────────────── */
  const [createOpen, setCreateOpen] = useState(false);
  const [refsLoading, setRefsLoading] = useState(false);
  const [refsLoaded, setRefsLoaded] = useState(false);
  const [sites, setSites] = useState([]);
  const [skus, setSkus] = useState([]);
  const [locations, setLocations] = useState([]);
  const [sourceSite, setSourceSite] = useState('');
  const [destSite, setDestSite] = useState('');
  const [orderLines, setOrderLines] = useState([emptyLine()]);
  const [creating, setCreating] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await fetchApi('/ds-ops/transfer-orders/?page_size=200');
      const rows = unwrapList(payload);
      if (!Array.isArray(rows)) {
        throw new Error('Transfer orders returned an unrecognised payload shape.');
      }
      setOrders(rows);
    } catch (e) {
      setError(describeError(e));
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const loadRefs = useCallback(async () => {
    if (refsLoaded || refsLoading) return;
    setRefsLoading(true);
    try {
      const [sitesRes, skusRes, locRes] = await Promise.all([
        fetchApi('/network/sites/?page_size=200'),
        fetchApi('/catalog/skus/?page_size=500'),
        fetchApi('/network/locations/?page_size=500'),
      ]);
      const siteList = unwrapList(sitesRes) || [];
      const skuList = unwrapList(skusRes) || [];
      setSites(siteList);
      setSkus(skuList);
      setLocations(unwrapList(locRes) || []);
      setSkuMap((prev) => {
        const next = { ...prev };
        skuList.forEach((s) => { next[String(s.sku_id)] = s; });
        return next;
      });
      setSkusLoaded(true);
      setRefsLoaded(true);
      const mh = siteList.find((s) => s.site_type === 'MH');
      const ds = siteList.find((s) => s.site_type === 'DS');
      if (mh && !sourceSite) setSourceSite(mh.site_id);
      if (ds && !destSite) setDestSite(ds.site_id);
    } catch (e) {
      toast.error('Could not load transfer references', describeError(e));
    } finally {
      setRefsLoading(false);
    }
  }, [destSite, refsLoaded, refsLoading, sourceSite, toast]);

  const openCreate = () => {
    setCreateOpen(true);
    loadRefs();
  };

  /* ── the detail drawer reads the transfer's own pick lines ─────────── */
  const openDetail = useCallback(async (row) => {
    setDetail(row);
    setLines([]);
    setLinesError('');
    setLinesLoading(true);

    // Resolve SKU codes without blocking the line read; rows fall back to the
    // raw sku id if the catalog is slow or unavailable.
    if (!skusLoaded) {
      fetchApi('/catalog/skus/?page_size=500')
        .then((payload) => {
          const list = unwrapList(payload) || [];
          setSkuMap((prev) => {
            const next = { ...prev };
            list.forEach((s) => { next[String(s.sku_id)] = s; });
            return next;
          });
          setSkusLoaded(true);
        })
        .catch(() => {});
    }

    try {
      const payload = await fetchApi(
        `/ds-ops/pick-tasks/?batch=${encodeURIComponent(String(row.transfer_id))}&page_size=200`
      );
      const rows = unwrapList(payload);
      if (!Array.isArray(rows)) {
        throw new Error('Pick lines returned an unrecognised payload shape.');
      }
      rows.sort((a, b) => (Number(a.pick_seq) || 0) - (Number(b.pick_seq) || 0));
      setLines(rows);
    } catch (e) {
      setLinesError(describeError(e));
    } finally {
      setLinesLoading(false);
    }
  }, [skusLoaded]);

  const closeDetail = () => {
    setDetail(null);
    setLines([]);
    setLinesError('');
  };

  /* ── create ────────────────────────────────────────────────────────── */
  const addLine = () => setOrderLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx) => setOrderLines((prev) => (
    prev.length <= 1 ? [emptyLine()] : prev.filter((_, i) => i !== idx)
  ));
  const updateLine = (idx, field, value) => setOrderLines((prev) => (
    prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
  ));

  const resetForm = () => {
    setOrderLines([emptyLine()]);
  };

  const submitTransferOrder = async (e) => {
    e.preventDefault();
    if (!sourceSite || !destSite) {
      toast.error('Missing site', 'Select both a source warehouse and a destination dark store.');
      return;
    }
    if (sourceSite === destSite) {
      toast.error('Invalid transfer', 'Source and destination must be different sites.');
      return;
    }
    const validLines = orderLines.filter((l) => l.sku && Number(l.qty) > 0);
    if (validLines.length === 0) {
      toast.error('No lines', 'Add at least one SKU line with a quantity.');
      return;
    }

    setCreating(true);
    try {
      const totalQty = validLines.reduce((a, l) => a + Number(l.qty), 0);
      const transfer = await postApi('/ds-ops/transfer-orders/', {
        source_site: sourceSite,
        dest_site: destSite,
        status: 'ALLOCATED',
        total_qty: totalQty,
      });
      // PickTask.picklist_id is a required UUIDField — "PL-1712..." is a 400.
      const picklistId = crypto.randomUUID();
      for (let i = 0; i < validLines.length; i += 1) {
        const l = validLines[i];
        await postApi('/ds-ops/pick-tasks/', {
          picklist_id: picklistId,
          batch: transfer.transfer_id,
          sku: l.sku,
          bin: l.bin || '',
          qty: Number(l.qty),
          picked_qty: 0,
          pick_seq: i + 1,
          status: 'NOT_STARTED',
        });
      }
      await patchApi(`/ds-ops/transfer-orders/${transfer.transfer_id}/`, { status: 'PICKING' });
      toast.success(
        'Transfer order created',
        `${stoLabel(transfer)} · ${validLines.length} line${validLines.length === 1 ? '' : 's'} · ${totalQty} units.`
      );
      resetForm();
      setCreateOpen(false);
      await loadOrders();
    } catch (err) {
      toast.error('Could not create transfer order', describeError(err));
    } finally {
      setCreating(false);
    }
  };

  /* ── derived view data ─────────────────────────────────────────────── */
  const statusCounts = useMemo(() => {
    const counts = {};
    orders.forEach((o) => {
      counts[o.status] = (counts[o.status] || 0) + 1;
    });
    return counts;
  }, [orders]);

  const visibleOrders = useMemo(() => (
    statusFilter === 'ALL' ? orders : orders.filter((o) => o.status === statusFilter)
  ), [orders, statusFilter]);

  const metrics = useMemo(() => {
    const sum = (key) => orders.reduce((a, o) => a + (Number(o[key]) || 0), 0);
    return {
      total: orders.length,
      picking: (statusCounts.PICKING || 0) + (statusCounts.PICKED || 0)
        + (statusCounts.SORTED || 0) + (statusCounts.PACKING || 0),
      transit: (statusCounts.IN_TRANSIT || 0) + (statusCounts.LOADED || 0),
      received: statusCounts.RECEIVED || 0,
      shippedUnits: sum('shipped_units'),
      receivedUnits: sum('received_units'),
      shortUnits: sum('short_units'),
    };
  }, [orders, statusCounts]);

  const warehouses = sites.filter((s) => s.site_type === 'MH');
  const darkStores = sites.filter((s) => s.site_type === 'DS');
  const storageBins = locations.filter((l) => l.location_type === 'BIN');

  const columns = [
    {
      header: 'STO ID',
      key: 'transfer_id',
      render: (row) => (
        <span className="link-cell" style={{ fontWeight: 700 }}>{stoLabel(row)}</span>
      ),
    },
    {
      header: 'Status',
      key: 'status',
      render: (row) => (
        <StatusBadge status={row.status} dataTestId={`sto-status-${row.transfer_id}`}>
          {STATUS_LABEL[row.status] || row.status}
        </StatusBadge>
      ),
    },
    {
      header: 'Section',
      key: 'section',
      render: (row) => row.section || <span style={{ color: '#94a3b8' }}>—</span>,
    },
    {
      header: 'Source',
      key: 'source_site_code',
      nowrap: false,
      render: (row) => siteLabel(row.source_site_code, row.source_site_name),
    },
    {
      header: 'Destination',
      key: 'dest_site_code',
      nowrap: false,
      render: (row) => siteLabel(row.dest_site_code, row.dest_site_name),
    },
    {
      header: 'Ordered Qty',
      key: 'ordered_units',
      align: 'right',
      render: (row) => <QtyCell value={row.ordered_units} skus={row.sku_count} />,
    },
    {
      header: 'Allocated Qty',
      key: 'pick_lines',
      align: 'right',
      render: (row) => <QtyCell value={row.ordered_units} skus={row.sku_count} />,
    },
    {
      header: 'Picked Qty',
      key: 'picked_units',
      align: 'right',
      render: (row) => <QtyCell value={row.picked_units} skus={row.sku_count} />,
    },
    {
      header: 'Short Picked Qty',
      key: 'short_units',
      align: 'right',
      render: (row) => <QtyCell value={row.short_units} skus={row.short_units ? row.sku_count : 0} />,
    },
    {
      header: 'Shipped Qty',
      key: 'shipped_units',
      align: 'right',
      render: (row) => <QtyCell value={row.shipped_units} skus={row.shipped_skus} />,
    },
    {
      header: 'Received Qty',
      key: 'received_units',
      align: 'right',
      render: (row) => <QtyCell value={row.received_units} skus={row.received_skus} />,
    },
    {
      header: '',
      key: 'view',
      align: 'right',
      render: (row) => (
        <button
          type="button"
          className="btn-secondary"
          style={{ padding: '3px 8px', fontSize: 11 }}
          onClick={(e) => { e.stopPropagation(); openDetail(row); }}
          title="Open transfer"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div data-testid="sto-root">
      <PageHead
        title="Stock Transfer Orders"
        count={orders.length}
        countLabel="STOs"
        subtitle="Replenishment transfers between a mother hub and its dark stores. Lifecycle totals are read from the transfer ledger."
        actions={(
          <>
            <button className="btn-ui" onClick={loadOrders} disabled={loading} data-testid="sto-refresh">
              <RefreshCw size={12} /> Refresh
            </button>
            <button className="btn-ui primary" onClick={openCreate} data-testid="sto-new">
              <Plus size={12} /> New STO
            </button>
          </>
        )}
      />

      <SubTabs
        tabs={[
          { id: 'sto', label: 'STO', count: orders.length },
          { id: 'metrics', label: 'Metrics' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error && (
        <div className="form-group">
          <div className="scan-feedback scan-feedback--error" data-testid="sto-load-error">
            <AlertTriangle size={14} /> <span>Could not read transfer orders — {error}</span>
          </div>
        </div>
      )}

      {tab === 'metrics' ? (
        <div className="metrics-grid" data-testid="sto-metrics">
          <div className="stat-card">
            <div>
              <div className="stat-value">{metrics.total}</div>
              <div className="stat-label">Total STOs</div>
            </div>
            <div className="stat-icon" style={{ background: '#eef2ff', color: '#4338ca' }}>
              <ArrowRightLeft size={18} />
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="stat-value">{metrics.picking}</div>
              <div className="stat-label">In picking / packing</div>
            </div>
            <div className="stat-icon" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
              <ClipboardList size={18} />
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="stat-value">{metrics.transit}</div>
              <div className="stat-label">On the road</div>
            </div>
            <div className="stat-icon" style={{ background: '#fffbeb', color: '#b45309' }}>
              <Truck size={18} />
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="stat-value">{metrics.received}</div>
              <div className="stat-label">Received at store</div>
            </div>
            <div className="stat-icon" style={{ background: '#ecfdf5', color: '#047857' }}>
              <PackageCheck size={18} />
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="stat-value">{metrics.shippedUnits}</div>
              <div className="stat-label">Units shipped</div>
            </div>
            <div className="stat-icon" style={{ background: '#f5f3ff', color: '#6d28d9' }}>
              <Boxes size={18} />
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="stat-value">{metrics.receivedUnits}</div>
              <div className="stat-label">Units received</div>
            </div>
            <div className="stat-icon" style={{ background: '#ecfdf5', color: '#059669' }}>
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div className="stat-card">
            <div>
              <div className="stat-value">{metrics.shortUnits}</div>
              <div className="stat-label">Short-picked units</div>
            </div>
            <div className="stat-icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Status
            </label>
            <select
              className="form-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: 200, height: 30, fontSize: 12 }}
              data-testid="sto-status-filter"
            >
              <option value="ALL">All statuses ({orders.length})</option>
              {STATUS_ORDER.filter((s) => statusCounts[s]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]} ({statusCounts[s]})</option>
              ))}
            </select>
            <span style={{ fontSize: 11.5, color: '#94a3b8' }}>
              {loading ? 'Loading…' : `${visibleOrders.length} of ${orders.length} shown`}
            </span>
          </div>

          <DataTable
            data={visibleOrders}
            columns={columns}
            idField="transfer_id"
            onRowClick={openDetail}
            selectable={false}
            hideCheckboxes
            searchPlaceholder="Filter transfer orders…"
            defaultPageSize={25}
            data-testid="sto-table"
          />
        </>
      )}

      {/* ── New STO modal ─────────────────────────────────────────────── */}
      {createOpen && (
        <div className="drawer-overlay" onClick={() => !creating && setCreateOpen(false)}>
          <div
            className="drawer-panel"
            style={{ width: 820, maxWidth: '96vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header" style={{ background: '#0f172a', color: '#fff', padding: '16px 20px' }}>
              <div style={{ flex: 1 }}>
                <div className="drawer-title" style={{ fontSize: 15, fontWeight: 800 }}>
                  Create Dark Store Transfer Order
                </div>
                <div className="drawer-subtitle" style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                  Raise a replenishment transfer and its pick list. Physical picking and scanning happen in the Zippzo Operations app.
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                style={{ background: '#1e293b', borderColor: '#334155', color: '#fff' }}
                onClick={() => !creating && setCreateOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <form className="drawer-body" onSubmit={submitTransferOrder} style={{ padding: '16px 20px', background: '#f8fafc', overflowY: 'auto' }}>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <label style={{ flex: 1, minWidth: 220 }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>
                      Source warehouse *
                    </span>
                    <select
                      className="form-input"
                      value={sourceSite}
                      onChange={(e) => setSourceSite(e.target.value)}
                      required
                      data-testid="sto-source-site"
                    >
                      <option value="">— Select source warehouse —</option>
                      {warehouses.map((s) => (
                        <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ flex: 1, minWidth: 220 }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>
                      Destination dark store *
                    </span>
                    <select
                      className="form-input"
                      value={destSite}
                      onChange={(e) => setDestSite(e.target.value)}
                      required
                      data-testid="sto-dest-site"
                    >
                      <option value="">— Select dark store —</option>
                      {darkStores.map((s) => (
                        <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {refsLoading && (
                  <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 10 }}>Loading sites and catalog…</div>
                )}
              </div>

              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#0f172a' }}>
                    Order lines ({orderLines.length})
                  </div>
                  <button type="button" className="btn-secondary" onClick={addLine} style={{ fontSize: 12 }}>
                    <Plus size={14} /> Add SKU
                  </button>
                </div>

                {orderLines.map((line, idx) => (
                  <div
                    key={idx}
                    style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'flex-end', padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}
                  >
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>
                        SKU *
                      </label>
                      <select
                        className="form-input"
                        value={line.sku}
                        onChange={(e) => updateLine(idx, 'sku', e.target.value)}
                        required
                        data-testid={`sto-line-sku-${idx}`}
                      >
                        <option value="">— Select product —</option>
                        {skus.map((s) => (
                          <option key={s.sku_id} value={s.sku_id}>{s.name} ({s.sku_code})</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ width: 84 }}>
                      <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>
                        Qty *
                      </label>
                      <input
                        type="number"
                        min="1"
                        className="form-input"
                        value={line.qty}
                        onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                        required
                        data-testid={`sto-line-qty-${idx}`}
                      />
                    </div>
                    <div style={{ width: 170 }}>
                      <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>
                        Preferred source bin
                      </label>
                      <input
                        className="form-input"
                        value={line.bin}
                        onChange={(e) => updateLine(idx, 'bin', e.target.value)}
                        placeholder="A-01-02-04"
                        list="sto-bin-options"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => removeLine(idx)}
                      title="Remove line"
                      style={{ padding: '5px 8px' }}
                    >
                      <Trash2 size={14} color="#dc2626" />
                    </button>
                  </div>
                ))}

                <datalist id="sto-bin-options">
                  {storageBins.map((b) => <option key={b.location_id} value={b.location_id} />)}
                </datalist>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                  <button type="button" className="btn-secondary" onClick={resetForm} disabled={creating}>
                    Clear
                  </button>
                  <button type="submit" className="btn-primary" disabled={creating} data-testid="sto-submit">
                    {creating ? 'Creating…' : 'Create Transfer Order'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Detail drawer ─────────────────────────────────────────────── */}
      {detail && (
        <div className="drawer-overlay" onClick={closeDetail}>
          <div
            className="drawer-panel"
            style={{ width: 720, maxWidth: '96vw' }}
            onClick={(e) => e.stopPropagation()}
            data-testid="sto-detail"
          >
            <div className="drawer-header" style={{ background: '#0f172a', color: '#fff', padding: '16px 20px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="drawer-title" style={{ fontSize: 15, fontWeight: 800 }}>
                  {stoLabel(detail)}
                </div>
                <div className="drawer-subtitle" style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                  {detail.source_site_code} → {detail.dest_site_code}
                  {' · '}
                  raised {dt(detail.created_at)}
                </div>
              </div>
              <button type="button" className="icon-btn" style={{ background: '#1e293b', borderColor: '#334155', color: '#fff' }} onClick={closeDetail} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="drawer-body" style={{ padding: '16px 20px', background: '#f8fafc', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Status</div>
                  <div style={{ marginTop: 6 }}>
                    <StatusBadge status={detail.status}>{STATUS_LABEL[detail.status] || detail.status}</StatusBadge>
                  </div>
                </div>
                {[
                  ['Ordered', detail.ordered_units, detail.sku_count],
                  ['Picked', detail.picked_units, detail.sku_count],
                  ['Short', detail.short_units, detail.short_units ? detail.sku_count : 0],
                  ['Shipped', detail.shipped_units, detail.shipped_skus],
                  ['Received', detail.received_units, detail.received_skus],
                ].map(([label, value, skus]) => (
                  <div key={label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>{Number(value) || 0}</div>
                    <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 600 }}>{Number(skus) || 0} SKUs</div>
                  </div>
                ))}
              </div>

              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Source</div>
                    <div style={{ marginTop: 3 }}>{detail.source_site_code} · {detail.source_site_name || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Destination</div>
                    <div style={{ marginTop: 3 }}>{detail.dest_site_code} · {detail.dest_site_name || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Raised by</div>
                    <div style={{ marginTop: 3 }}>{detail.created_by_name || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Dispatched by</div>
                    <div style={{ marginTop: 3 }}>{detail.dispatched_by_name || '—'}</div>
                  </div>
                </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#0f172a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Factory size={15} color="#7c3aed" /> Pick lines ({lines.length})
                </div>

                {linesError && (
                  <div className="scan-feedback scan-feedback--error" data-testid="sto-lines-error">
                    <AlertTriangle size={14} /> <span>{linesError}</span>
                  </div>
                )}

                {linesLoading && (
                  <div style={{ fontSize: 12, color: '#64748b', padding: '10px 0' }}>Loading pick lines…</div>
                )}

                {!linesLoading && !linesError && lines.length === 0 && (
                  <div style={{ fontSize: 12, color: '#64748b', padding: '10px 0' }}>
                    This transfer has no pick lines yet.
                  </div>
                )}

                {!linesLoading && lines.length > 0 && (
                  <div className="table-container" style={{ maxHeight: 320, overflowY: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>SKU</th>
                          <th>Bin</th>
                          <th style={{ textAlign: 'right' }}>Qty</th>
                          <th style={{ textAlign: 'right' }}>Picked</th>
                          <th style={{ textAlign: 'right' }}>Short</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line, idx) => {
                          const sku = skuMap[String(line.sku)];
                          return (
                            <tr key={String(line.id ?? idx)}>
                              <td className="mono-num">{line.pick_seq ?? idx + 1}</td>
                              <td>
                                <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 12 }}>
                                  {sku?.sku_code || String(line.sku ?? '—')}
                                </div>
                                <div style={{ fontSize: 11, color: '#64748b' }}>
                                  {sku?.name || 'not in catalog'}
                                </div>
                              </td>
                              <td className="mono-num">{line.bin || '—'}</td>
                              <td className="mono-num" style={{ textAlign: 'right' }}>{Number(line.qty) || 0}</td>
                              <td className="mono-num" style={{ textAlign: 'right' }}>{Number(line.picked_qty) || 0}</td>
                              <td className="mono-num" style={{ textAlign: 'right' }}>{Number(line.short_qty) || 0}</td>
                              <td><StatusBadge status={line.status} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: '12px 20px', background: '#fff', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={closeDetail}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
