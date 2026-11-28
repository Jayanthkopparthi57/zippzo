import { useEffect } from 'react';

// Rows that still need action stay above settled rows until data changes again.
const NEEDS_ACTION = /\b(pending|processing|assigned|offered|queued|waiting|new|open|not started|to verify)\b/i;

/**
 * One compact search input in every column header of every DS table.
 * Typing filters that column by substring; filters combine across columns.
 */
export default function TableColumnFilters({ screenKey }) {
  useEffect(() => {
    const root = document.body;
    if (!root) return undefined;

    let observer;
    let timer = 0;
    const queries = new WeakMap();

    const stateFor = (table) => {
      let map = queries.get(table);
      if (!map) {
        map = new Map();
        queries.set(table, map);
      }
      return map;
    };

    const pause = (fn) => {
      observer?.disconnect();
      try { fn(); } finally { observer?.observe(root, { childList: true, subtree: true }); }
    };

    const cellText = (row, col) => {
      const cell = row.cells?.[col];
      return (cell?.innerText || cell?.textContent || '').trim().toLowerCase();
    };

    const apply = (table) => {
      const body = table.tBodies[0];
      if (!body) return;
      const map = stateFor(table);
      const rows = Array.from(body.rows);
      const keep = [];
      rows.forEach((row) => {
        let matches = true;
        for (const [col, query] of map.entries()) {
          if (query && !cellText(row, col).includes(query.toLowerCase())) {
            matches = false;
            break;
          }
        }
        if (matches) keep.push(row);
        else row.style.display = 'none';
      });
      const pending = keep.filter((row) => NEEDS_ACTION.test((row.innerText || '').toLowerCase()));
      const settled = keep.filter((row) => !NEEDS_ACTION.test((row.innerText || '').toLowerCase()));
      pending.concat(settled).forEach((row) => {
        row.style.display = '';
        body.appendChild(row);
      });
    };

    const decorate = () => {
      root.querySelectorAll('table').forEach((table) => {
        const header = table.tHead?.rows[0];
        if (!header) return;
        const map = stateFor(table);
        Array.from(header.cells).forEach((th, col) => {
          if (th.querySelector(':scope > .col-filter-input')) return;
          const input = document.createElement('input');
          input.type = 'search';
          input.className = 'col-filter-input';
          input.placeholder = 'Filter';
          input.setAttribute('aria-label', `Filter ${th.innerText.trim() || 'column'} column`);
          input.value = map.get(col) || '';
          input.addEventListener('input', (event) => {
            map.set(col, event.target.value);
            pause(() => apply(table));
          });
          th.appendChild(input);
        });
        apply(table);
      });
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => pause(decorate), 0);
    };

    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    schedule();

    return () => {
      observer.disconnect();
      clearTimeout(timer);
      root.querySelectorAll('.col-filter-input').forEach((input) => input.remove());
    };
  }, [screenKey]);

  return null;
}
