import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

// Rows whose visible status text still needs action stay at the top of every
// table, even while the operator is searching or filtering.
const NEEDS_ACTION = /\b(pending|processing|assigned|offered|queued|waiting|queued|new|open|not started|to verify)\b/i;

/**
 * One filter bar for every table on the active dark-store screen.
 *
 * The DS console renders tables from many different views (data-table,
 * wms-table and datagrid-table), so instead of duplicating a search input in
 * twenty files this bar walks the rendered tables in the workspace viewport,
 * hides non-matching rows and lifts pending rows to the top. A MutationObserver
 * re-applies the filter whenever a view refreshes its data.
 */
export default function TableFilterBar({ screenKey }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const countRef = useRef(null);

  // A search on one screen should not silently hide rows on the next one.
  useEffect(() => {
    setQuery('');
    setStatus('all');
  }, [screenKey]);

  useEffect(() => {
    const root = document.querySelector('.workspace-viewport');
    if (!root) return undefined;

    let timer = 0;
    let observer;

    const apply = () => {
      const needle = query.trim().toLowerCase();
      let shown = 0;
      let total = 0;

      if (observer) observer.disconnect();
      root.querySelectorAll('table').forEach((table) => {
        const body = table.tBodies[0];
        if (!body) return;
        const rows = Array.from(body.rows);
        total += rows.length;
        const pending = [];
        const settled = [];
        rows.forEach((row) => {
          const text = (row.innerText || row.textContent || '').toLowerCase();
          const isPending = NEEDS_ACTION.test(text);
          const matchesText = !needle || text.includes(needle);
          const matchesStatus = status === 'all'
            || (status === 'pending' && isPending)
            || (status === 'settled' && !isPending);
          if (matchesText && matchesStatus) {
            row.style.display = '';
            (isPending ? pending : settled).push(row);
          } else {
            row.style.display = 'none';
          }
        });
        shown += pending.length + settled.length;
        // Append in the desired order; the observer is paused so this does
        // not trigger another pass.
        pending.concat(settled).forEach((row) => body.appendChild(row));
      });
      if (countRef.current) {
        countRef.current.textContent = total
          ? `Showing ${shown} of ${total} rows`
          : '';
      }
      if (observer) observer.observe(root, { childList: true, subtree: true });
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 0);
    };

    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    schedule();
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [query, status]);

  return (
    <div className="table-filter-bar">
      <Search size={14} aria-hidden="true" />
      <input
        type="search"
        aria-label="Search all tables on this screen"
        placeholder="Search any table on this screen…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        aria-label="Filter table rows by status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
      >
        <option value="all">All rows</option>
        <option value="pending">Needs action</option>
        <option value="settled">Settled</option>
      </select>
      {(query || status !== 'all') && (
        <button
          type="button"
          className="table-filter-bar__clear"
          onClick={() => { setQuery(''); setStatus('all'); }}
          title="Clear filters"
        >
          <X size={13} /> Clear
        </button>
      )}
      <span className="table-filter-bar__count" ref={countRef} />
    </div>
  );
}
