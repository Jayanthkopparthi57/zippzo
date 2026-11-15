import React, { useState, useMemo } from 'react';
import { MoreVertical, Filter, ArrowUpDown } from 'lucide-react';

export default function DataTable({
  columns,
  data = [],
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  idField = 'id',
  onRowClick,
  onActionClick,
}) {
  const [filterText, setFilterText] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  // Handle select all
  const allSelected = data.length > 0 && selectedIds.length === data.length;

  const handleSelectAll = (e) => {
    if (!onSelectionChange) return;
    if (e.target.checked) {
      onSelectionChange(data.map(r => r[idField]));
    } else {
      onSelectionChange([]);
    }
  };

  const handleSelectRow = (id, e) => {
    e.stopPropagation();
    if (!onSelectionChange) return;
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter(i => i !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  // Filter & Sort
  const processedData = useMemo(() => {
    let list = [...data];
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      list = list.filter(row => JSON.stringify(Object.values(row)).toLowerCase().includes(q));
    }
    if (sortConfig.key) {
      list.sort((a, b) => {
        let va = a[sortConfig.key];
        let vb = b[sortConfig.key];
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') {
          return sortConfig.direction === 'asc' ? va - vb : vb - va;
        }
        return sortConfig.direction === 'asc'
          ? String(va).localeCompare(String(vb))
          : String(vb).localeCompare(String(va));
      });
    }
    return list;
  }, [data, filterText, sortConfig]);

  const toggleSort = (key) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  return (
    <div className="datagrid-card">
      {/* Grid Toolbar */}
      <div className="datagrid-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="text"
            placeholder="Filter table rows..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11.5,
              padding: '4px 8px',
              width: 220,
              outline: 'none',
            }}
          />
          {selectable && selectedIds.length > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-amber)', fontWeight: 600 }}>
              {selectedIds.length} row(s) selected
            </span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          Showing {processedData.length} of {data.length} records
        </div>
      </div>

      {/* Grid Table */}
      <div className="datagrid-table-wrap">
        <table className="datagrid-table">
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 34, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    className="grid-checkbox"
                    checked={allSelected}
                    onChange={handleSelectAll}
                  />
                </th>
              )}
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  onClick={() => toggleSort(col.key)}
                  style={{ cursor: 'pointer' }}
                  title="Click to sort"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span>{col.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--text-muted)' }}>
                      <Filter size={10} />
                      <ArrowUpDown size={10} />
                    </div>
                  </div>
                </th>
              ))}
              {onActionClick && <th style={{ width: 32 }}></th>}
            </tr>
          </thead>
          <tbody>
            {processedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0) + (onActionClick ? 1 : 0)} style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  [ No matching records in current view ]
                </td>
              </tr>
            ) : (
              processedData.map((row, rIdx) => {
                const isSelected = selectedIds.includes(row[idField]);
                return (
                  <tr
                    key={rIdx}
                    onClick={() => onRowClick && onRowClick(row)}
                    style={{
                      cursor: onRowClick ? 'pointer' : 'default',
                      background: isSelected ? 'rgba(40, 90, 115, 0.18)' : undefined
                    }}
                  >
                    {selectable && (
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="grid-checkbox"
                          checked={isSelected}
                          onChange={(e) => handleSelectRow(row[idField], e)}
                        />
                      </td>
                    )}
                    {columns.map((col, cIdx) => {
                      let val = col.key.split('.').reduce((o, k) => o?.[k], row);
                      let content = val ?? '—';

                      if (col.badge) {
                        content = <StatusBadge status={val} />;
                      } else if (col.render) {
                        content = col.render(val, row);
                      } else if (col.isCode || col.key.includes('_id') || col.key.includes('_no') || col.key.includes('code')) {
                        content = <code>{val ?? '—'}</code>;
                      }

                      return <td key={cIdx}>{content}</td>;
                    })}
                    {onActionClick && (
                      <td style={{ textAlign: 'center' }} onClick={(e) => { e.stopPropagation(); onActionClick(row); }}>
                        <button className="btn-ui neutral" style={{ padding: '2px 4px', border: 'none', background: 'transparent' }}>
                          <MoreVertical size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  if (!status) return <span className="status-badge gray">—</span>;
  const s = String(status).toUpperCase();

  const teal = ['ACTIVE', 'COMPLETED', 'CLOSED', 'DONE', 'SHIPPED', 'RECEIVED', 'MATCHED', 'PUTAWAY', 'ASSIGNED'];
  const amber = ['IN_PROGRESS', 'PICKING', 'SORTING', 'IN_TRANSIT', 'LOADING', 'ALLOCATED', 'ARRIVED', 'NOT_STARTED', 'PENDING'];
  const rust = ['CANCELLED', 'BLOCKED', 'INACTIVE', 'SHORT', 'DAMAGE', 'DELAYED', 'EXCEPTION', 'VARIANCE'];

  let cls = 'gray';
  if (teal.some(k => s.includes(k))) cls = 'teal';
  else if (amber.some(k => s.includes(k))) cls = 'amber';
  else if (rust.some(k => s.includes(k))) cls = 'rust';

  return <span className={`status-badge ${cls}`}>{status}</span>;
}
