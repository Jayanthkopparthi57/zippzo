import { useEffect } from 'react';

// Rows that still need action stay above settled rows.
const NEEDS_ACTION = /\b(pending|processing|assigned|offered|queued|waiting|new|open|not started|to verify)\b/i;

/**
 * Hidden-by-default search for every table column. Each header gets a small
 * filter control; clicking it reveals that column's search input.
 */
export default function TableColumnFilters({ screenKey }) {
  useEffect(() => {
    const root = document.body;
    if (!root) return undefined;

    let observer;
    let timer = 0;
    const columns = new WeakMap();

    const stateFor = (table) => {
      let map = columns.get(table);
      if (!map) {
        map = new Map();
        columns.set(table, map);
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
      const keep = [];
      Array.from(body.rows).forEach((row) => {
        let matches = true;
        for (const [col, state] of map.entries()) {
          if (state.query && !cellText(row, col).includes(state.query.toLowerCase())) {
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
          if (!map.has(col)) map.set(col, { query: '', open: false });
          const state = map.get(col);
          if (th.querySelector(':scope > .col-filter-toggle')) return;

          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'col-filter-toggle';
          toggle.title = `Filter ${th.innerText.trim() || 'column'}`;
          toggle.setAttribute('aria-label', toggle.title);
          toggle.setAttribute('aria-expanded', 'false');
          toggle.textContent = '▾';

          const wrap = document.createElement('span');
          wrap.className = 'col-filter-wrap';
          const input = document.createElement('input');
          input.type = 'search';
          input.className = 'col-filter-input';
          input.placeholder = 'Filter';
          input.hidden = !state.open;
          input.value = state.query;
          input.setAttribute('aria-label', `Search ${th.innerText.trim() || 'column'} values`);
          const clear = document.createElement('button');
          clear.type = 'button';
          clear.className = 'col-filter-clear';
          clear.textContent = '×';
          clear.title = 'Clear this column filter';
          clear.hidden = !state.open;
          wrap.append(input, clear);

          toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            pause(() => {
              if (state.open) {
                state.open = false;
                state.query = '';
                input.value = '';
                input.hidden = true;
                clear.hidden = true;
                toggle.setAttribute('aria-expanded', 'false');
                apply(table);
              } else {
                state.open = true;
                input.hidden = false;
                clear.hidden = false;
                toggle.setAttribute('aria-expanded', 'true');
                input.focus();
              }
            });
          });
          input.addEventListener('input', (event) => {
            state.query = event.target.value;
            pause(() => apply(table));
          });
          clear.addEventListener('click', (event) => {
            event.stopPropagation();
            state.query = '';
            input.value = '';
            pause(() => apply(table));
            input.focus();
          });

          th.append(toggle, wrap);
        });

        // Keep revealed inputs in sync if the table was re-rendered.
        map.forEach((state, col) => {
          const cell = header.cells[col];
          if (!cell) return;
          const input = cell.querySelector('.col-filter-input');
          const clear = cell.querySelector('.col-filter-clear');
          if (input) { input.hidden = !state.open; input.value = state.query; }
          if (clear) clear.hidden = !state.open;
          const toggle = cell.querySelector('.col-filter-toggle');
          if (toggle) toggle.setAttribute('aria-expanded', String(state.open));
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
      root.querySelectorAll('.col-filter-toggle, .col-filter-wrap').forEach((node) => node.remove());
    };
  }, [screenKey]);

  return null;
}
