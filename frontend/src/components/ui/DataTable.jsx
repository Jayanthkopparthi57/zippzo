import React, { useState, useMemo } from 'react';
import {
  Search, Download, Plus, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Filter, Copy, Check, SlidersHorizontal, Eye, X
} from 'lucide-react';
import DetailDrawer from './DetailDrawer';

export default function DataTable({
  title,
  subtitle,
  columns = [],
  data = [],
  onAdd,
  addLabel = 'Add New',
  searchPlaceholder = 'Search by SKU, Barcode, Location, Order...',
  customHeaderAction,
  onRowUpdate,
  selectable = false,
  onSelectionChange,
  // React drops unknown props on custom components unless they are declared
  // here, so tests targeting a table have to go through this passthrough.
  'data-testid': dataTestId,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [density, setDensity] = useState('standard'); // 'compact' | 'standard' | 'comfortable'
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [copiedText, setCopiedText] = useState('');
  const [selectedRowDetail, setSelectedRowDetail] = useState(null);

  // Copy helper
  const handleCopy = (text, e) => {
    e?.stopPropagation();
    navigator.clipboard?.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(''), 2000);
  };

  // Sorting
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

  // Filter & Sort Pipeline
  const filteredAndSortedData = useMemo(() => {
    let result = [...data];

    // Global search across all properties
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(row => {
        return Object.values(row).some(val => {
          if (val === null || val === undefined) return false;
          if (typeof val === 'object') {
            return Object.values(val).some(nested => String(nested).toLowerCase().includes(q));
          }
          return String(val).toLowerCase().includes(q);
        });
      });
    }

    // Sorting
    if (sortKey) {
      result.sort((a, b) => {
        let valA = a[sortKey];
        let valB = b[sortKey];

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

  // Pagination
  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filteredAndSortedData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    if (pageSize === 'all') return filteredAndSortedData;
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedData.slice(start, start + pageSize);
  }, [filteredAndSortedData, currentPage, pageSize]);

  // Row selection
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const allIds = new Set(filteredAndSortedData.map((_, i) => i));
      setSelectedRows(allIds);
      onSelectionChange?.(filteredAndSortedData);
    } else {
      setSelectedRows(new Set());
      onSelectionChange?.([]);
    }
  };

  const handleSelectRow = (idx, row, e) => {
    e.stopPropagation();
    const next = new Set(selectedRows);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedRows(next);
    onSelectionChange?.(filteredAndSortedData.filter((_, i) => next.has(i)));
  };

  // CSV Export with UTF-8 BOM and deep property resolution
  const exportToCSV = () => {
    if (!filteredAndSortedData || filteredAndSortedData.length === 0) {
      alert('No records available to export.');
      return;
    }

    // Filter out Action and Selection columns
    const exportCols = columns.filter(c => {
      const h = (c.header || '').trim().toLowerCase();
      return h !== 'action' && h !== 'actions' && h !== '' && h !== 'select';
    });

    if (exportCols.length === 0) {
      alert('No exportable columns found.');
      return;
    }

    const headers = exportCols.map(c => `"${String(c.header || '').replace(/"/g, '""')}"`).join(',');

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
          // Fallback: match row properties by header name
          const cleanHeader = (col.header || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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

        // Clean up any remaining formatting
        val = String(val).replace(/<[^>]*>?/gm, '').trim();
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',')
    );

    // UTF-8 Byte Order Mark (\uFEFF) for Excel compatibility
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

  // Cell padding based on density
  const getCellPadding = () => {
    if (density === 'compact') return '6px 10px';
    if (density === 'comfortable') return '14px 16px';
    return '9px 12px'; // standard
  };

  return (
    <div className="card industrial-table-card" data-testid={dataTestId} style={{ padding: 0, overflow: 'hidden' }}>
      {/* Toast for copied text */}
      {copiedText && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: '#0f172a', color: '#fff', padding: '8px 14px', borderRadius: 6,
          fontSize: 12, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #334155'
        }}>
          <Check size={14} style={{ color: '#10b981' }} />
          Copied: <span style={{ fontFamily: 'var(--font-mono)' }}>{copiedText}</span>
        </div>
      )}

      {/* Industrial Toolbar */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#ffffff',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10
      }}>
        {/* Title & Stats */}
        <div>
          {title && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.2px', margin: 0 }}>
                {title}
              </h3>
              <span className="badge" style={{
                background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1',
                borderRadius: 4, fontWeight: 700, fontSize: 11, padding: '2px 6px'
              }}>
                {filteredAndSortedData.length} Records
              </span>
              {selectedRows.size > 0 && (
                <span className="badge badge-purple" style={{ fontSize: 11 }}>
                  {selectedRows.size} Selected
                </span>
              )}
            </div>
          )}
          {subtitle && <p style={{ fontSize: 12, color: '#64748b', marginTop: 2, margin: 0 }}>{subtitle}</p>}
        </div>

        {/* Actions & Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Search Box */}
          <div className="search-box" style={{
            width: 240, height: 32, padding: '4px 8px', background: '#f8fafc',
            border: '1px solid #cbd5e1', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6
          }}>
            <Search size={13} style={{ color: '#64748b' }} />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              style={{ fontSize: 12, border: 'none', background: 'transparent', outline: 'none', width: '100%' }}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Export CSV */}
          <button
            className="btn-secondary"
            onClick={exportToCSV}
            title="Export full table to CSV"
            style={{ height: 32, padding: '0 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={13} /> Export CSV
          </button>

          {customHeaderAction}

          {/* Add New Action */}
          {onAdd && (
            <button
              className="btn-primary"
              onClick={onAdd}
              style={{ height: 32, padding: '0 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={14} /> {addLabel}
            </button>
          )}
        </div>
      </div>

      {/* High Density Table Container */}
      <div className="table-container" style={{ maxHeight: 'calc(100vh - 310px)', overflowY: 'auto' }}>
        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f172a' }}>
            <tr style={{ background: '#0f172a', borderBottom: '2px solid #334155' }}>
              {selectable && (
                <th style={{ width: 36, padding: '8px 10px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedRows.size > 0 && selectedRows.size === filteredAndSortedData.length}
                    onChange={handleSelectAll}
                    style={{ cursor: 'pointer' }}
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
                    style={{
                      padding: '8px 12px',
                      color: '#94a3b8',
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      textAlign: col.align || 'left',
                      cursor: isSortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      whiteSpace: 'nowrap'
                    }}
                    onClick={() => isSortable && handleHeaderClick(col)}
                  >
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start'
                    }}>
                      <span>{col.header}</span>
                      {isSortable && (
                        isSorted ? (
                          sortDirection === 'asc' ? <ArrowUp size={12} style={{ color: '#38bdf8' }} /> : <ArrowDown size={12} style={{ color: '#38bdf8' }} />
                        ) : (
                          <ArrowUpDown size={11} style={{ color: '#475569', opacity: 0.6 }} />
                        )
                      )}
                    </div>
                  </th>
                );
              })}
              <th style={{ width: 44, textAlign: 'center', padding: '8px 10px', color: '#64748b' }}>
                <Eye size={12} />
              </th>
            </tr>
          </thead>

          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 2 : 1)}
                  style={{ textAlign: 'center', padding: '48px 16px', color: '#64748b' }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>No matching records found</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Try clearing search keywords or adjusting your filters.</div>
                </td>
              </tr>
            ) : (
              paginatedData.map((row, rowIdx) => {
                const isSelected = selectedRows.has((currentPage - 1) * pageSize + rowIdx);

                return (
                  <tr
                    key={rowIdx}
                    onClick={() => setSelectedRowDetail(row)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid #e2e8f0',
                      background: isSelected ? '#f5f3ff' : rowIdx % 2 === 1 ? '#fafafa' : '#ffffff',
                      transition: 'background-color 0.1s ease'
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = rowIdx % 2 === 1 ? '#fafafa' : '#ffffff'; }}
                  >
                    {selectable && (
                      <td style={{ textAlign: 'center', padding: getCellPadding() }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => handleSelectRow((currentPage - 1) * pageSize + rowIdx, row, e)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                    )}

                    {columns.map((col, colIdx) => (
                      <td
                        key={colIdx}
                        style={{
                          padding: getCellPadding(),
                          textAlign: col.align || 'left',
                          whiteSpace: col.nowrap !== false ? 'nowrap' : 'normal',
                          verticalAlign: 'middle'
                        }}
                      >
                        {col.render ? col.render(row, rowIdx) : (
                          col.isCode ? (
                            <span
                              className="code-cell"
                              onClick={e => handleCopy(String(row[col.key]), e)}
                              title="Click to copy"
                            >
                              {row[col.key] ?? '—'}
                            </span>
                          ) : (
                            row[col.key] ?? '—'
                          )
                        )}
                      </td>
                    ))}

                    <td
                      style={{ textAlign: 'center', padding: getCellPadding(), color: '#94a3b8' }}
                      title="Inspect record detail"
                    >
                      <button
                        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 2 }}
                        onClick={(e) => { e.stopPropagation(); setSelectedRowDetail(row); }}
                      >
                        ⋮
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Industrial Pagination Strip */}
      <div style={{
        padding: '8px 16px', background: '#f8fafc', borderTop: '1px solid #e2e8f0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#475569'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>
            Showing <strong>{filteredAndSortedData.length > 0 ? (currentPage - 1) * (pageSize === 'all' ? filteredAndSortedData.length : pageSize) + 1 : 0}</strong>–
            <strong>{pageSize === 'all' ? filteredAndSortedData.length : Math.min(currentPage * pageSize, filteredAndSortedData.length)}</strong> of <strong>{filteredAndSortedData.length}</strong> entries
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>Rows per page:</span>
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(e.target.value === 'all' ? 'all' : parseInt(e.target.value));
                setCurrentPage(1);
              }}
              style={{
                fontSize: 11, padding: '2px 6px', borderRadius: 4,
                border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a'
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>

        {/* Page Buttons */}
        {pageSize !== 'all' && totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="btn-secondary"
              style={{ padding: '3px 6px', fontSize: 11, height: 26 }}
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(1)}
              title="First Page"
            >
              <ChevronsLeft size={13} />
            </button>

            <button
              className="btn-secondary"
              style={{ padding: '3px 8px', fontSize: 11, height: 26 }}
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              title="Previous Page"
            >
              <ChevronLeft size={13} /> Prev
            </button>

            <span style={{ padding: '0 8px', fontWeight: 600, fontSize: 11 }}>
              Page {currentPage} of {totalPages}
            </span>

            <button
              className="btn-secondary"
              style={{ padding: '3px 8px', fontSize: 11, height: 26 }}
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              title="Next Page"
            >
              Next <ChevronRight size={13} />
            </button>

            <button
              className="btn-secondary"
              style={{ padding: '3px 6px', fontSize: 11, height: 26 }}
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
              title="Last Page"
            >
              <ChevronsRight size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Row Detail Drawer */}
      {selectedRowDetail && (
        <DetailDrawer
          isOpen={true}
          data={selectedRowDetail}
          title={title}
          onClose={() => setSelectedRowDetail(null)}
        />
      )}
    </div>
  );
}
