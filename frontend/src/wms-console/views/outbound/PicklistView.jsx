import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { UserCheck, Activity, Calendar, X, Search, RefreshCw, Download } from 'lucide-react';

export default function PicklistView({ initialTab = 'picklists' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [picklists, setPicklists] = useState([]);
  const [batches, setBatches] = useState([]);
  const [sortlists, setSortlists] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');

  // Modals & Drawers
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [selectedDetailRow, setSelectedDetailRow] = useState(null);
  const [detailLines, setDetailLines] = useState([]);
  const [loadingDetailLines, setLoadingDetailLines] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const resultsFrom = (data) => Array.isArray(data) ? data : data.results || [];

  const loadData = async () => {
    setLoading(true);
    setSelectedIds([]);
    try {
      if (activeTab === 'batches') {
        const data = await apiClient.get('/fulfilment/batches/', { page_size: 200 });
        setBatches(resultsFrom(data));
      } else if (activeTab === 'sorting-list') {
        const data = await apiClient.get('/ds-ops/sorting-waves/', { page_size: 200 });
        setSortlists(resultsFrom(data));
      } else {
        const data = await apiClient.get('/ds-ops/pick-tasks/picklists/');
        setPicklists(resultsFrom(data));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await apiClient.get('/iam/users/', { page_size: 500 });
      const nextUsers = resultsFrom(data);
      setUsers(nextUsers);
      if (nextUsers.length > 0) {
        setSelectedUserId(prev => prev || nextUsers.find(u => u.status === 'ACTIVE')?.user_id || nextUsers[0].user_id);
      }
    } catch (err) {
      console.error('Failed loading users:', err);
    }
  };

  useEffect(() => {
    loadData();
    loadUsers();
  }, [activeTab]);

  const handleAssignPicker = async () => {
    if (!selectedUserId || selectedIds.length === 0) return;
    setAssigning(true);
    setAssignError('');
    try {
      // The web summary is aggregated by picklist; the assignment API works on
      // the underlying pick-task lines. Address every open line in each list.
      for (const picklistId of selectedIds) {
        const linesData = await apiClient.get('/ds-ops/pick-tasks/', {
          picklist_id: picklistId,
          page_size: 1000,
        });
        const openLines = resultsFrom(linesData).filter(line =>
          !['COMPLETED', 'CANCELLED'].includes(line.status));
        for (const line of openLines) {
          await apiClient.post(`/ds-ops/pick-tasks/${line.id}/assign/`, {
            user: selectedUserId,
          });
        }
      }
      setShowAssignModal(false);
      setSelectedIds([]);
      await loadData();
    } catch (err) {
      console.error('Failed assigning picker:', err);
      setAssignError(err.message || 'Error updating picklist assignment.');
    } finally {
      setAssigning(false);
    }
  };

  const handleViewLines = async (row) => {
    setSelectedDetailRow(row);
    setDetailLines([]);
    setLoadingDetailLines(true);
    try {
      const [linesData, skuData] = await Promise.all([
        apiClient.get('/ds-ops/pick-tasks/', { picklist_id: row.picklist_id, page_size: 1000 }),
        apiClient.get('/catalog/skus/', { page_size: 1000 }),
      ]);
      const skuLabels = new Map(resultsFrom(skuData).map(sku => [
        sku.sku_id,
        `${sku.sku_code || sku.sku_id} — ${sku.name || ''}`.trim(),
      ]));
      setDetailLines(resultsFrom(linesData).map(line => ({
        ...line,
        sku_label: skuLabels.get(line.sku) || line.sku || 'SKU item',
      })));
    } catch (err) {
      console.error('Failed loading picklist lines:', err);
    } finally {
      setLoadingDetailLines(false);
    }
  };

  const handleDownloadCsv = () => {
    if (activeTab === 'batches') {
      if (batches.length === 0) return;
      const headers = ['Batch No', 'Status', 'Order Type', 'Processing', 'Destinations', 'Ordered Qty', 'Picked Qty', 'Created At'];
      const rows = batches.map(b => [
        b.batch_no,
        b.status,
        b.order_type || '—',
        b.processing_type || '—',
        b.destinations || '—',
        b.ordered_qty || 0,
        b.picked_qty || 0,
        b.created_at,
      ]);
      downloadCsv(headers, rows, 'Wave_Batches');
    } else if (activeTab === 'sorting-list') {
      if (sortlists.length === 0) return;
      const headers = ['Wave ID', 'Batch', 'Type', 'Status', 'Assigned Qty', 'Sorted Qty', 'Pending Qty', 'Cluster Zone', 'Created At'];
      const rows = sortlists.map(s => [
        s.wave_id,
        s.batch || '—',
        s.type || 'CLUSTER',
        s.status,
        s.assigned_qty || 0,
        s.sorted_qty || 0,
        Math.max(0, (s.assigned_qty || 0) - (s.sorted_qty || 0)),
        s.cluster_zone || '—',
        s.created_at || '—',
      ]);
      downloadCsv(headers, rows, 'Sorting_Lists');
    } else {
      if (picklists.length === 0) return;
      const headers = ['Picklist ID', 'Batch', 'Site', 'Status', 'Assigned Qty', 'Picked Qty', 'Pending Qty', 'Pickers', 'Zones'];
      const rows = picklists.map(p => [
        p.picklist_id,
        p.batch || '—',
        p.site_code || '—',
        p.status,
        p.assigned_qty || 0,
        p.picked_qty || 0,
        p.pending_qty ?? Math.max(0, (p.assigned_qty || 0) - (p.picked_qty || 0)),
        (p.pickers || []).join('; ') || 'UNASSIGNED',
        (p.zones || []).join('; ') || '—',
      ]);
      downloadCsv(headers, rows, 'Picklists');
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

  const picklistColumns = [
    {
      label: 'Picklist ID',
      key: 'picklist_id',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Batch: {row.batch || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Assigned Qty',
      key: 'assigned_qty',
      render: (val, row) => (
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ?? 0}</span>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.sku_count ?? 0} SKUs</div>
        </div>
      ),
    },
    {
      label: 'Picked / Pending',
      key: 'picked_qty',
      render: (val, row) => (
        <div>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0} / {row.pending_qty ?? 0}</span>
          <div style={{ fontSize: 10, color: 'var(--c-rust)' }}>{row.short_qty || 0} Short</div>
        </div>
      ),
    },
    {
      label: 'Picker',
      key: 'pickers',
      render: (val) => (
        (val || []).length > 0
          ? (
            <span style={{ color: 'var(--c-teal)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {val.join(', ')}
            </span>
          )
          : <span style={{ color: 'var(--text-muted)' }}>— Unassigned —</span>
      ),
    },
    {
      label: 'Zone',
      key: 'zones',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{(val || []).join(', ') || '—'}</span>,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => (
        <button
          className="btn-ui neutral"
          style={{ padding: '2px 8px', fontSize: 10.5 }}
          onClick={(e) => {
            e.stopPropagation();
            handleViewLines(row);
          }}
        >
          View Lines
        </button>
      ),
    },
  ];

  const batchColumns = [
    {
      label: 'Batch No',
      key: 'batch_no',
      render: (val) => <strong style={{ color: 'var(--c-amber)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Type',
      key: 'type',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || 'MANUAL'}</span>,
    },
    {
      label: 'Processing',
      key: 'processing_type',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || 'LPN_BASED'}</span>,
    },
    {
      label: 'Destinations',
      key: 'destinations',
      render: (val) => <span style={{ fontSize: 11, color: 'var(--c-teal)' }}>{val || 'All Stores'}</span>,
    },
    {
      label: 'Ordered Units',
      key: 'ordered_qty',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong>,
    },
    {
      label: 'Picked Units',
      key: 'picked_qty',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</span>,
    },
    {
      label: 'Created Time',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
  ];

  const sortlistColumns = [
    {
      label: 'Wave ID',
      key: 'wave_id',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Batch: {row.batch || '—'}</div>
        </div>
      ),
    },
    {
      label: 'Type',
      key: 'type',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || 'CLUSTER'}</span>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Assigned Qty',
      key: 'assigned_qty',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong>,
    },
    {
      label: 'Sorted / Pending',
      key: 'sorted_qty',
      render: (val, row) => (
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', color: '#48a968', fontWeight: 600 }}>{val ?? 0}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}> / {Math.max(0, (row.assigned_qty || 0) - (val || 0))} pending</span>
        </div>
      ),
    },
    {
      label: 'Cluster Zone',
      key: 'cluster_zone',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'Created At',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
  ];

  const filteredPicklists = picklists.filter(p => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (p.picklist_id && p.picklist_id.toLowerCase().includes(q)) ||
      (p.site_code && p.site_code.toLowerCase().includes(q)) ||
      (p.status && p.status.toLowerCase().includes(q)) ||
      (p.pickers || []).some(name => name.toLowerCase().includes(q)) ||
      (p.zones || []).some(zone => zone.toLowerCase().includes(q))
    );
  });

  const filteredBatches = batches.filter(b => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (b.batch_no && b.batch_no.toLowerCase().includes(q)) ||
      (b.status && b.status.toLowerCase().includes(q)) ||
      (b.destinations && b.destinations.toLowerCase().includes(q))
    );
  });

  const filteredSortlists = sortlists.filter(s => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (s.wave_id && s.wave_id.toLowerCase().includes(q)) ||
      (s.batch && s.batch.toLowerCase().includes(q)) ||
      (s.cluster_zone && s.cluster_zone.toLowerCase().includes(q)) ||
      (s.status && s.status.toLowerCase().includes(q))
    );
  });

  const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div>
      {/* Subtabs Rail */}
      <div className="subtabs-rail" style={{ marginBottom: 12 }}>
        <div className="subtabs-list">
          <button
            className={`subtab-btn ${activeTab === 'batches' ? 'active' : ''}`}
            onClick={() => setActiveTab('batches')}
          >
            Wave Batches ({batches.length})
          </button>
          <button
            className={`subtab-btn ${activeTab === 'picklists' ? 'active' : ''}`}
            onClick={() => setActiveTab('picklists')}
          >
            Picklists ({picklists.length})
          </button>
          <button
            className={`subtab-btn ${activeTab === 'sorting-list' ? 'active' : ''}`}
            onClick={() => setActiveTab('sorting-list')}
          >
            Sorting Lists ({sortlists.length})
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
          {activeTab === 'picklists' && (
            <>
              <button className="btn-ui neutral" onClick={() => setShowActivityModal(true)}>
                <Activity size={12} />
                <span>Picker Activity</span>
              </button>
              <button
                className="btn-ui primary"
                disabled={selectedIds.length === 0}
                onClick={() => setShowAssignModal(true)}
              >
                <UserCheck size={13} />
                <span>Assign Picker ({selectedIds.length})</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Top Controls: Header & Search */}
      <div className="screen-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="screen-title">
            <span>
              {activeTab === 'batches'
                ? 'OUTBOUND WAVE BATCHES'
                : activeTab === 'sorting-list'
                ? 'OUTBOUND SORTING & CONSOLIDATION'
                : 'PICKING OPERATIONS & DISPATCH STAGING'}
            </span>
            <span className="screen-count-tag">
              {activeTab === 'batches'
                ? filteredBatches.length
                : activeTab === 'sorting-list'
                ? filteredSortlists.length
                : filteredPicklists.length} Records
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {activeTab === 'batches'
              ? 'Group and optimize order releases across storage zones and cutoff schedules.'
              : activeTab === 'sorting-list'
              ? 'Put-to-light sorting, piece-level store split, and tote packing.'
              : 'Allocate picklists to warehouse operators, track piece-pick rates, and monitor wave staging.'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', padding: '4px 10px', borderRadius: 'var(--radius-xs)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            <Calendar size={12} style={{ color: 'var(--c-amber)' }} />
            <span>{todayStr}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
            <input
              type="text"
              placeholder="Filter list..."
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
      </div>

      {/* Main Table */}
      {activeTab === 'batches' ? (
        <DataTable
          columns={batchColumns}
          data={filteredBatches}
          idField="batch_id"
          emptyMessage="No wave batches available."
        />
      ) : activeTab === 'sorting-list' ? (
        <DataTable
          columns={sortlistColumns}
          data={filteredSortlists}
          idField="wave_id"
          emptyMessage="No sorting lists available."
        />
      ) : (
        <DataTable
          columns={picklistColumns}
          data={filteredPicklists}
          idField="picklist_id"
          selectable={true}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          emptyMessage="No picklists available."
        />
      )}

      {/* Slide-out Picklist Lines Drawer */}
      {selectedDetailRow && (
        <div className="drawer-backdrop" onClick={() => setSelectedDetailRow(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
            <div className="drawer-header">
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                  PICKLIST SPECIFICATION
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>
                  {selectedDetailRow.picklist_id}
                </div>
              </div>
              <button className="btn-ui neutral" onClick={() => setSelectedDetailRow(null)}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, fontSize: 12 }}>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>STATUS</div>
                <div style={{ fontWeight: 600 }}>{selectedDetailRow.status}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>BATCH</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{selectedDetailRow.batch || '—'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>SITE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{selectedDetailRow.site_code || '—'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>STORAGE ZONE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{(selectedDetailRow.zones || []).join(', ') || '—'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>ASSIGNED PICKER</div>
                <div style={{ fontWeight: 600, color: 'var(--c-teal)' }}>
                  {(selectedDetailRow.pickers || []).join(', ') || 'Unassigned'}
                </div>
              </div>
            </div>

            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, marginBottom: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
              Picking Line Allocations ({detailLines.length})
            </div>

            {loadingDetailLines ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                Loading picklist lines...
              </div>
            ) : detailLines.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detailLines.map(l => (
                  <div key={l.id} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{l.sku_label}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      <span>Bin: {l.bin || '—'}</span>
                      <span>Requested: {l.qty || 0}</span>
                      <span>Picked: {l.picked_qty || 0}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                      Status: {l.status} • Zone: {l.zone || '—'} • Picker: {l.assigned_to_name || 'Unassigned'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No picklist lines currently registered for this picklist.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assign Picker Modal */}
      {showAssignModal && (
        <div className="modal-backdrop" onClick={() => setShowAssignModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div className="modal-title">Assign Operator to {selectedIds.length} Picklist(s)</div>
              <button className="btn-ui neutral" onClick={() => setShowAssignModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Select an active warehouse picker to allocate the selected wave picklists:
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Warehouse Operator / Picker</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)' }}
                >
                  {users.map(u => (
                    <option key={u.user_id} value={u.user_id}>
                      {(u.full_name || u.email) + ' (' + u.email + ')' + ' — ' + (u.role || 'OPERATOR')}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)', fontSize: 11, color: 'var(--text-muted)' }}>
                The assignment uses the pick-task detail endpoint and starts any not-started lines, making them available to the selected operator.
              </div>

              {assignError && (
                <div className="form-error-banner">{assignError}</div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-ui neutral" onClick={() => setShowAssignModal(false)}>
                Cancel
              </button>
              <button className="btn-ui primary" onClick={handleAssignPicker} disabled={assigning}>
                {assigning ? 'Assigning...' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Picker Activity Modal */}
      {showActivityModal && (
        <div className="modal-backdrop" onClick={() => setShowActivityModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <div className="modal-title">Live Picker Activity & Throughput</div>
              <button className="btn-ui neutral" onClick={() => setShowActivityModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                    <th style={{ padding: '6px 8px' }}>OPERATOR</th>
                    <th style={{ padding: '6px 8px' }}>ROLE</th>
                    <th style={{ padding: '6px 8px' }}>ACTIVE LISTS</th>
                    <th style={{ padding: '6px 8px' }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const displayName = u.full_name || u.email;
                    const activeCount = picklists.filter(p => (p.pickers || []).includes(displayName)).length;
                    const isActive = u.status === 'ACTIVE';
                    return (
                      <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '8px 8px', fontWeight: 600 }}>
                          {displayName} ({u.email})
                        </td>
                        <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          {u.role || 'OPERATOR'}
                        </td>
                        <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)' }}>
                          {activeCount} active
                        </td>
                        <td style={{ padding: '8px 8px' }}>
                          <span className={`status-badge ${isActive ? 'teal' : 'rust'}`} style={{ fontSize: 10 }}>
                            {isActive ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="modal-footer">
              <button className="btn-ui neutral" onClick={() => setShowActivityModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
