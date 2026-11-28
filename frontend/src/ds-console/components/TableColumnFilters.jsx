import { useEffect } from 'react';

// Rows that still need action stay above settled rows.
const NEEDS_ACTION = /\b(pending|processing|assigned|offered|queued|waiting|new|open|not started|to verify)\b/i;

/**
 * Click-to-open search for every table column. Where a table already renders
 * a funnel icon in its header, that icon is used; otherwise a small filter
 * button is added.
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

          // Prefer the funnel icon the table already renders; add our own only
          // when the table has none.
          let control = th.querySelector('.th-filter, svg.lucide-filter');
          if (!control) control = th.querySelector(':scope > .col-filter-toggle');
          if (!control) {
            control = document.createElement('button');
            control.type = 'button';
            control.className = 'col-filter-toggle';
            control.textContent = '▾';
            th.appendChild(control);
          }
          control.title = `Filter ${th.innerText.trim() || 'column'}`;
          control.style.cursor = 'pointer';

          let input = th.querySelector(':scope > .col-filter-wrap > .col-filter-input');
          if (!input) {
            const wrap = document.createElement('span');
            wrap.className = 'col-filter-wrap';
            input = document.createElement('input');
            input.type = 'search';
            input.className = 'col-filter-input';
            input.placeholder = 'Filter';
            input.setAttribute('aria-label', `Search ${th.innerText.trim() || 'column'} values`);
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'col-filter-clear';
            clear.textContent = '×';
            clear.title = 'Clear this column filter';
            wrap.append(input, clear);
            th.appendChild(wrap);
          }
          const clear = th.querySelector(':scope > .col-filter-wrap > .col-filter-clear');

          input.hidden = !state.open;
          input.value = state.query;
          clear.hidden = !state.open;
          th.classList.toggle('col-filter-open', state.open);

          if (!control.dataset.filterBound) {
            control.dataset.filterBound = '1';
            control.addEventListener('click', (event) => {
              // Stop the table header's own sort handler from firing.
              event.stopPropagation();
              pause(() => {
                if (state.open) {
                  state.open = false;
                  state.query = '';
                  input.value = '';
                  input.hidden = true;
                  clear.hidden = true;
                  th.classList.remove('col-filter-open');
                  apply(table);
                } else {
                  state.open = true;
                  input.hidden = false;
                  clear.hidden = false;
                  th.classList.add('col-filter-open');
                  input.focus();
                }
              });
            });
          }
          if (!input.dataset.filterBound) {
            input.dataset.filterBound = '1';
            input.addEventListener('click', (event) => event.stopPropagation());
            input.addEventListener('input', (event) => {
              state.query = event.target.value;
              pause(() => apply(table));
            });
          }
          if (!clear.dataset.filterBound) {
            clear.dataset.filterBound = '1';
            clear.addEventListener('click', (event) => {
              event.stopPropagation();
              state.query = '';
              input.value = '';
              pause(() => apply(table));
              input.focus();
            });
          }
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
      root.querySelectorAll('.col-filter-open').forEach((node) => node.classList.remove('col-filter-open'));
    };
  }, [screenKey]);

  return null;
}
