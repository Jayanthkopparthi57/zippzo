import React, { useState, useMemo, useEffect } from 'react';
import {
  Search, Download, Plus, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Filter, Copy, Check, Eye, X
} from 'lucide-react';
import DetailDrawer from './DetailDrawer';
import StatusBadge from './StatusBadge';
import { PageHead } from './WmsUI';

/**
 * The reference WMS table: record-count header, "Filter table rows…" strip,
 * dense zebra table with a checkbox column and per-column filter glyphs, and a
 * numbered pager.
 *
 * Every prop the older call sites rely on is preserved (title, subtitle,
 * breadcrumbs, count, onAdd, customHeaderAction, selectable, selectedIds,
 * onSelectionChange, onRowClick, idField, data-testid). Column definitions may
 * use either `header` or `label`; `badge` renders a status pill and `isCode` /
 * `link` renders the purple id link.
 */
export default function DataTable({
  title,
  subtitle,
  breadcrumbs,
  count,
  columns = [],
  data = [],
  onAdd,
  addLabel = 'Add New',
  searchPlaceholder = 'Filter table rows...',
  customHeaderAction,
  onRowUpdate,
  selectable = true,
  hideCheckboxes = false,
  selectedIds,
  onSelectionChange,
  onRowClick,
  idField,
  defaultPageSize = 25,
  // React drops unknown props on custom components unless they are declared
  // here, so tests targeting a table have to go through this passthrough.
  'data-testid': dataTestId,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [copiedText, setCopiedText] = useState('');
  const [selectedRowDetail, setSelectedRowDetail] = useState(null);

  const rowId = (row, idx) => (idField && row?.[idField] != null ? row[idField] : idx);

  const emitSelection = (next) => {
    setSelectedRows(next);
    onSelectionChange?.(data.filter((row, i) => next.has(rowId(row, i))));
  };

  // Keep an externally controlled selection in sync (InboundView / StoView
  // pass their own selectedIds set).
  useEffect(() => {
    if (!selectedIds) return;
    const next = new Set();
    data.forEach((row, i) => {
      const id = rowId(row, i);
      if (selectedIds instanceof Set ? selectedIds.has(id) : Array.isArray(selectedIds) && selectedIds.includes(id)) {
        next.add(id);
      }
    });
    setSelectedRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, data]);

  const handleCopy = (text, e) => {
    e?.stopPropagation();
    navigator.clipboard?.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(''), 2000);
  };

  const handleHeaderClick = (col) => {
    if (!col.key && !col.sortKey) return;
    const key = col.sortKey || col.key;
    if (sortKey === key) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else {
        setSortKey(null);
        setSortDirection('asc');
      }
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const filteredAndSortedData = useMemo(() => {
    let result = [...data];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(row => Object.values(row).some(val => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') {
          return Object.values(val).some(nested => String(nested).toLowerCase().includes(q));
        }
        return String(val).toLowerCase().includes(q);
      }));
    }

    if (sortKey) {
      result.sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        }
        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        return sortDirection === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
      });
    }

    return result;
  }, [data, searchTerm, sortKey, sortDirection]);

  const effectivePageSize = pageSize === 'all' ? filteredAndSortedData.length || 1 : pageSize;
  const totalPages = Math.ceil(filteredAndSortedData.length / effectivePageSize) || 1;
  const safePage = Math.min(currentPage, totalPages);

  const paginatedData = useMemo(() => {
    if (pageSize === 'all') return filteredAndSortedData;
    const start = (safePage - 1) * effectivePageSize;
    return filteredAndSortedData.slice(start, start + effectivePageSize);
  }, [filteredAndSortedData, safePage, effectivePageSize, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, data, pageSize]);

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const all = new Set(filteredAndSortedData.map((row, i) => rowId(row, i)));
      emitSelection(all);
    } else {
      emitSelection(new Set());
    }
  };

  const handleSelectRow = (row, idx, e) => {
    e.stopPropagation();
    const id = rowId(row, idx);
    const next = new Set(selectedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emitSelection(next);
  };

  const exportToCSV = () => {
    if (!filteredAndSortedData || filteredAndSortedData.length === 0) {
      alert('No records available to export.');
      return;
    }
    const exportCols = columns.filter(c => {
      const h = String(c.header || c.label || '').trim().toLowerCase();
      return h !== 'action' && h !== 'actions' && h !== '' && h !== 'select';
    });
    if (exportCols.length === 0) {
      alert('No exportable columns found.');
      return;
    }
    const headers = exportCols.map(c => `"${String(c.header || c.label || '').replace(/"/g, '""')}"`).join(',');
    const rows = filteredAndSortedData.map(row =>
      exportCols.map(col => {
        let val = '';
        if (col.key && row[col.key] !== undefined && row[col.key] !== null) {
          if (typeof row[col.key] === 'object') {
            val = row[col.key]?.name || row[col.key]?.code || row[col.key]?.sku_code || JSON.stringify(row[col.key]);
          } else {
            val = String(row[col.key]);
          }
        } else {
          const cleanHeader = String(col.header || col.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          for (const [k, v] of Object.entries(row)) {
            const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanKey === cleanHeader || cleanKey.includes(cleanHeader) || cleanHeader.includes(cleanKey)) {
              if (v !== undefined && v !== null) {
                val = typeof v === 'object' ? (v.name || v.code || '') : String(v);
                break;
              }
            }
          }
        }
        val = String(val).replace(/<[^>]*>?/gm, '').trim();
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',')
    );
    const csvContent = '\uFEFF' + [headers, ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `${(title || 'wms_export').toLowerCase().replace(/[^a-z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const colHeader = (col) => col.header ?? col.label ?? '';

  const renderCell = (col, row, rowIdx) => {
    if (col.render) return col.render(row, rowIdx);
    const raw = col.key ? row[col.key] : undefined;
    if (col.badge) return <StatusBadge status={raw} />;
    if (col.link || col.isCode) {
      return (
        <span
          className="link-cell"
          onClick={e => handleCopy(String(raw ?? ''), e)}
          title="Click to copy"
        >
          {raw ?? '—'}
        </span>
      );
    }
    return raw ?? '—';
  };

  const showHead = !!(title || subtitle || onAdd || customHeaderAction || breadcrumbs);
  const shownFrom = filteredAndSortedData.length === 0 ? 0 : (safePage - 1) * effectivePageSize + 1;
  const shownTo = pageSize === 'all'
    ? filteredAndSortedData.length
    : Math.min(safePage * effectivePageSize, filteredAndSortedData.length);

  const pageNumbers = () => {
    const nums = [];
    const max = 5;
    let start = Math.max(1, safePage - 2);
    const end = Math.min(totalPages, start + max - 1);
    start = Math.max(1, end - max + 1);
    for (let i = start; i <= end; i += 1) nums.push(i);
    return nums;
  };

  return (
    <>
    {showHead && (
      <PageHead
        title={title || (breadcrumbs?.length ? breadcrumbs[breadcrumbs.length - 1] : '')}
        count={count != null ? count : filteredAndSortedData.length}
        subtitle={subtitle || (breadcrumbs?.length ? breadcrumbs.join(' / ') : undefined)}
        actions={(
          <>
            {selectedRows.size > 0 && (
              <span className="screen-count-tag">{selectedRows.size} selected</span>
            )}
            <button className="btn-ui" onClick={exportToCSV} title="Export full table to CSV">
              <Download size={12} /> Export CSV
            </button>
            {customHeaderAction}
            {onAdd && (
              <button className="btn-ui primary" onClick={onAdd}>
                <Plus size={12} /> {addLabel}
              </button>
            )}
          </>
        )}
      />
    )}

    <div className="wms-table-card" data-testid={dataTestId}>
      {copiedText && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: '#0b1220', color: '#fff', padding: '8px 14px', borderRadius: 5,
          fontSize: 11.5, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #334155'
        }}>
          <Check size={14} style={{ color: '#34d399' }} />
          Copied: <span style={{ fontFamily: 'var(--font-mono)' }}>{copiedText}</span>
        </div>
      )}

      {/* Reference filter strip */}
      <div className="wms-filterbar">
        <div className="wms-filterbar__left">
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            aria-label="Filter table rows"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}
              title="Clear filter"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div className="wms-shown">
          Showing <b>{filteredAndSortedData.length}</b> of <b>{data.length}</b> records
        </div>
      </div>

      <div className="table-container" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
        <table className="data-table">
          <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <tr>
              {!hideCheckboxes && (
                <th style={{ width: 34, textAlign: 'center' }} className="th-checkbox">
                  <input
                    type="checkbox"
                    className="row-checkbox"
                    checked={selectedRows.size > 0 && selectedRows.size === filteredAndSortedData.length}
                    onChange={handleSelectAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}

              {columns.map((col, idx) => {
                const isSortable = !!(col.key || col.sortKey);
                const currentKey = col.sortKey || col.key;
                const isSorted = sortKey === currentKey;
                return (
                  <th
                    key={idx}
                    style={{ textAlign: col.align || 'left', cursor: isSortable ? 'pointer' : 'default', userSelect: 'none' }}
                    onClick={() => isSortable && handleHeaderClick(col)}
                  >
                    <span className="th-inner" style={{ justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start', width: '100%' }}>
                      <span>{colHeader(col)}</span>
                      <Filter size={10} className="th-filter" />
                      {isSortable && (
                        isSorted
                          ? (sortDirection === 'asc' ? <ArrowUp size={11} style={{ color: '#0f4c5c' }} /> : <ArrowDown size={11} style={{ color: '#0f4c5c' }} />)
                          : <ArrowUpDown size={10} style={{ color: '#cbd5e1' }} />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (hideCheckboxes ? 0 : 1)} className="table-empty">
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>No matching records found</div>
                  <div style={{ fontSize: 11, marginTop: 3 }}>Try clearing the filter or adjusting your selection.</div>
                </td>
              </tr>
            ) : (
              paginatedData.map((row, rowIdx) => {
                const absoluteIdx = (safePage - 1) * effectivePageSize + rowIdx;
                const id = rowId(row, absoluteIdx);
                const isSelected = selectedRows.has(id);
                return (
                  <tr
                    key={id ?? rowIdx}
                    onClick={() => {
                      onRowClick?.(row);
                      if (!onRowClick && row && typeof row === 'object' && !Array.isArray(row)) {
                        setSelectedRowDetail(row);
                      }
                    }}
                    style={{ cursor: 'pointer', background: isSelected ? '#f1f5f9' : undefined }}
                  >
                    {!hideCheckboxes && (
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="row-checkbox"
                          checked={isSelected}
                          onChange={e => handleSelectRow(row, absoluteIdx, e)}
                          aria-label={`Select row ${absoluteIdx + 1}`}
                        />
                      </td>
                    )}

                    {columns.map((col, colIdx) => (
                      <td
                        key={colIdx}
                        style={{
                          textAlign: col.align || 'left',
                          whiteSpace: col.nowrap === false ? 'normal' : 'nowrap',
                        }}
                      >
                        {renderCell(col, row, rowIdx)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="wms-pager">
        <div className="wms-pager__size">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10)); setCurrentPage(1); }}
            aria-label="Rows per page"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="wms-pager__pages">
          <button className="wms-page-btn" disabled={safePage <= 1} onClick={() => setCurrentPage(1)} title="First page">
            <ChevronsLeft size={12} />
          </button>
          <button className="wms-page-btn" disabled={safePage <= 1} onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} title="Previous page">
            <ChevronLeft size={12} />
          </button>
          {pageNumbers().map(n => (
            <button
              key={n}
              className={`wms-page-btn ${n === safePage ? 'active' : ''}`}
              onClick={() => setCurrentPage(n)}
            >
              {n}
            </button>
          ))}
          <button className="wms-page-btn" disabled={safePage >= totalPages} onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} title="Next page">
            <ChevronRight size={12} />
          </button>
          <button className="wms-page-btn" disabled={safePage >= totalPages} onClick={() => setCurrentPage(totalPages)} title="Last page">
            <ChevronsRight size={12} />
          </button>
        </div>

        <div className="wms-shown">
          {shownFrom}–{shownTo} of {filteredAndSortedData.length}
        </div>
      </div>

      {selectedRowDetail && (
        <DetailDrawer
          isOpen={true}
          data={selectedRowDetail}
          title={title}
          onClose={() => setSelectedRowDetail(null)}
        />
      )}
    </div>
    </>
  );
}
