import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { UserCheck, Activity, Calendar, X, CheckCircle2, User, Search, RefreshCw, Download } from 'lucide-react';

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
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const loadData = async () => {
    setLoading(true);
    setSelectedIds([]);
    try {
      if (activeTab === 'batches') {
        const data = await apiClient.get('/outbound/batches/');
        setBatches(data.results || []);
      } else if (activeTab === 'sorting-list') {
        const data = await apiClient.get('/outbound/sortlists/');
        setSortlists(data.results || []);
      } else {
        const data = await apiClient.get('/outbound/picklists/');
        setPicklists(data.results || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await apiClient.get('/platform/users/');
      setUsers(data.results || []);
      if (data.results?.length > 0) {
        setSelectedUserId(data.results[0].user_id);
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
    try {
      await Promise.all(
        selectedIds.map(id =>
          apiClient.patch(`/outbound/picklists/${id}/`, {
            assigned_to: selectedUserId,
            status: 'IN_PROGRESS',
          })
        )
      );
      setShowAssignModal(false);
      setSelectedIds([]);
      await loadData();
    } catch (err) {
      console.error('Failed assigning picker:', err);
      alert('Error updating picklist assignment.');
    } finally {
      setAssigning(false);
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
      const headers = ['Sortlist Code', 'Batch', 'Type', 'Status', 'Assigned Qty', 'Sorted Qty', 'Short Qty', 'Sorter', 'Started At'];
      const rows = sortlists.map(s => [
        s.code,
        s.batch_no || '—',
        s.type || 'CLUSTER',
        s.status,
        s.assigned_qty || 0,
        s.sorted_qty || 0,
        s.short_qty || 0,
        s.sorter || '—',
        s.started_at || '—',
      ]);
      downloadCsv(headers, rows, 'Sorting_Lists');
    } else {
      if (picklists.length === 0) return;
      const headers = ['Picklist Code', 'Batch', 'Status', 'Assigned Qty', 'Picked Qty', 'Picker', 'Zone'];
      const rows = picklists.map(p => [
        p.code,
        p.batch_no || '—',
        p.status,
        p.assigned_qty || 0,
        p.picked_qty || 0,
        p.assigned_to_name || 'UNASSIGNED',
        p.zone_name || '—',
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
      key: 'code',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Batch: {row.batch_no || '—'}</div>
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
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ?? (row.lines?.reduce((s, l) => s + (l.qty || 0), 0) ?? 0)}</span>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.assigned_skus ?? (row.lines?.length || 0)} SKUs</div>
        </div>
      ),
    },
    {
      label: 'Picked / Pending',
      key: 'picked_qty',
      render: (val, row) => (
        <div>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0} / {row.assigned_qty ?? 0}</span>
          <div style={{ fontSize: 10, color: 'var(--c-rust)' }}>{row.short_qty || 0} Short</div>
        </div>
      ),
    },
    {
      label: 'Picker',
      key: 'assigned_to_name',
      render: (val, row) => {
        const pickerName = val || users.find(u => u.user_id === row.assigned_to)?.name;
        return pickerName ? (
          <span style={{ color: 'var(--c-teal)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
            {pickerName}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>— Unassigned —</span>
        );
      },
    },
    {
      label: 'Zone',
      key: 'zone_name',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
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
            setSelectedDetailRow(row);
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
      label: 'Sortlist Code',
      key: 'code',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Batch: {row.batch_no || '—'}</div>
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
      render: (val, row) => (
        <div>
          <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.assigned_skus ?? 0} SKUs</div>
        </div>
      ),
    },
    {
      label: 'Sorted / Pending',
      key: 'sorted_qty',
      render: (val, row) => (
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', color: '#48a968', fontWeight: 600 }}>{val ?? 0}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}> / {row.pending_qty ?? 0} pending</span>
        </div>
      ),
    },
    {
      label: 'Short Qty',
      key: 'short_qty',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: val ? 'var(--c-rust)' : 'var(--text-muted)' }}>{val ?? 0}</span>,
    },
    {
      label: 'Sorter',
      key: 'sorter',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'Started At',
      key: 'started_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
  ];

  const filteredPicklists = picklists.filter(p => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (p.code && p.code.toLowerCase().includes(q)) ||
      (p.assigned_to_name && p.assigned_to_name.toLowerCase().includes(q)) ||
      (p.status && p.status.toLowerCase().includes(q)) ||
      (p.zone_name && p.zone_name.toLowerCase().includes(q))
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
      (s.code && s.code.toLowerCase().includes(q)) ||
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
          idField="sortlist_id"
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
                  {selectedDetailRow.code}
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
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{selectedDetailRow.batch_no || '—'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>STORAGE ZONE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{selectedDetailRow.zone_name || '—'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>ASSIGNED PICKER</div>
                <div style={{ fontWeight: 600, color: 'var(--c-teal)' }}>
                  {selectedDetailRow.assigned_to_name || 'Unassigned'}
                </div>
              </div>
            </div>

            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, marginBottom: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
              Picking Line Allocations ({selectedDetailRow.lines?.length || 0})
            </div>

            {selectedDetailRow.lines && selectedDetailRow.lines.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedDetailRow.lines.map((l, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{l.sku_name || l.sku_code || 'SKU Item'}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      <span>Bin: {l.bin_code || '—'}</span>
                      <span>Requested: {l.qty || 0}</span>
                      <span>Picked: {l.picked_qty || 0}</span>
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
                      {u.name} ({u.emp_code}) — {u.role || 'PICKER'}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)', fontSize: 11, color: 'var(--text-muted)' }}>
                Status will automatically transition to <strong>IN_PROGRESS</strong> and dispatch notifications to the handheld terminal.
              </div>
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
                    const activeCount = picklists.filter(p => p.assigned_to === u.user_id).length;
                    return (
                      <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '8px 8px', fontWeight: 600 }}>
                          {u.name} ({u.emp_code})
                        </td>
                        <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          {u.role || 'OPERATOR'}
                        </td>
                        <td style={{ padding: '8px 8px', fontFamily: 'var(--font-mono)' }}>
                          {activeCount} active
                        </td>
                        <td style={{ padding: '8px 8px' }}>
                          <span className={`status-badge ${u.is_active ? 'teal' : 'rust'}`} style={{ fontSize: 10 }}>
                            {u.is_active ? 'ACTIVE' : 'OFFLINE'}
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
