import { useEffect } from 'react';

// Statuses that still need action are lifted to the top until the operator
// explicitly sorts a column.
const NEEDS_ACTION = /\b(pending|processing|assigned|offered|queued|waiting|new|open|not started|to verify)\b/i;

/**
 * Excel-style column filters for every table in the DS console.
 *
 * Each header cell gets a dropdown with: A→Z / Z→A sort, a value search and a
 * checkbox list of the column's distinct values. Selecting values hides rows
 * that don't match, across all columns at once (AND semantics).
 */
export default function TableColumnFilters({ screenKey }) {
  useEffect(() => {
    const root = document.body;
    if (!root) return undefined;

    let observer;
    let timer = 0;
    let openMenu = null;
    const tableState = new WeakMap();

    const stateFor = (table) => {
      let state = tableState.get(table);
      if (!state) {
        state = { filters: new Map(), sort: null };
        tableState.set(table, state);
      }
      return state;
    };

    const pause = (fn) => {
      observer?.disconnect();
      try { fn(); } finally { observer?.observe(root, { childList: true, subtree: true }); }
    };

    const closeMenu = () => {
      if (openMenu) {
        openMenu.remove();
        openMenu = null;
      }
    };

    const rowText = (row, index) => {
      const cell = row.cells?.[index];
      return (cell?.innerText || cell?.textContent || '').trim();
    };

    const applyFilters = (table) => {
      const body = table.tBodies[0];
      if (!body) return;
      const state = stateFor(table);
      const rows = Array.from(body.rows);
      const keep = [];
      rows.forEach((row) => {
        let matches = true;
        for (const [colIndex, selected] of state.filters.entries()) {
          if (selected && !selected.has(rowText(row, colIndex))) { matches = false; break; }
        }
        if (matches) keep.push(row);
        else row.style.display = 'none';
      });

      if (state.sort) {
        const { col, dir } = state.sort;
        const factor = dir === 'asc' ? 1 : -1;
        keep.sort((a, b) => factor * rowText(a, col).localeCompare(rowText(b, col), undefined, { numeric: true, sensitivity: 'base' }));
      } else {
        const pending = keep.filter((row) => NEEDS_ACTION.test((row.innerText || '').toLowerCase()));
        const settled = keep.filter((row) => !NEEDS_ACTION.test((row.innerText || '').toLowerCase()));
        keep.splice(0, keep.length, ...pending, ...settled);
      }
      keep.forEach((row) => { row.style.display = ''; });
      keep.forEach((row) => body.appendChild(row));
    };

    const showMenu = (table, th, colIndex, anchor) => {
      closeMenu();
      const state = stateFor(table);
      const menu = document.createElement('div');
      menu.className = 'col-filter-menu';
      menu.innerHTML = `
        <div class="col-filter-menu__head">
          <input type="search" placeholder="Search values…" aria-label="Search column values" />
          <button type="button" class="col-filter-menu__close" title="Close">×</button>
        </div>
        <div class="col-filter-menu__sort">
          <button type="button" data-sort="asc" title="Sort A to Z">A → Z</button>
          <button type="button" data-sort="desc" title="Sort Z to A">Z → A</button>
        </div>
        <div class="col-filter-menu__list"></div>
        <div class="col-filter-menu__foot">
          <button type="button" data-action="all">Select all</button>
          <button type="button" data-action="clear">Clear</button>
        </div>`;

      const values = new Map();
      Array.from(table.tBodies[0]?.rows || []).forEach((row) => {
        const value = rowText(row, colIndex) || '(blank)';
        values.set(value, (values.get(value) || 0) + 1);
      });
      const selected = state.filters.get(colIndex);
      const chosen = new Set(selected || values.keys());

      const list = menu.querySelector('.col-filter-menu__list');
      const renderList = (needle = '') => {
        list.innerHTML = '';
        const q = needle.trim().toLowerCase();
        [...values.keys()].filter((value) => !q || value.toLowerCase().includes(q)).slice(0, 300).forEach((value) => {
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = chosen.has(value);
          input.addEventListener('change', () => {
            if (input.checked) chosen.add(value); else chosen.delete(value);
            pause(() => {
              state.filters.set(colIndex, new Set(chosen));
              applyFilters(table);
            });
          });
          const text = document.createElement('span');
          text.textContent = value;
          const count = document.createElement('em');
          count.textContent = values.get(value);
          label.append(input, text, count);
          list.appendChild(label);
        });
        if (!list.children.length) list.textContent = 'No values';
      };
      renderList();

      menu.querySelector('input[type="search"]').addEventListener('input', (event) => renderList(event.target.value));
      menu.querySelector('.col-filter-menu__close').addEventListener('click', closeMenu);
      menu.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => {
        pause(() => {
          state.sort = { col: colIndex, dir: button.dataset.sort };
          applyFilters(table);
        });
      }));
      menu.querySelector('[data-action="all"]').addEventListener('click', () => {
        values.forEach((_count, value) => chosen.add(value));
        renderList(menu.querySelector('input[type="search"]').value);
        pause(() => { state.filters.set(colIndex, new Set(chosen)); applyFilters(table); });
      });
      menu.querySelector('[data-action="clear"]').addEventListener('click', () => {
        chosen.clear();
        renderList(menu.querySelector('input[type="search"]').value);
        pause(() => { state.filters.set(colIndex, new Set(chosen)); applyFilters(table); });
      });

      document.body.appendChild(menu);
      openMenu = menu;
      const box = anchor.getBoundingClientRect();
      menu.style.top = `${Math.min(window.scrollY + box.bottom + 4, window.scrollY + window.innerHeight - 340)}px`;
      menu.style.left = `${Math.max(8, Math.min(window.scrollX + box.left, window.scrollX + window.innerWidth - 250))}px`;
      menu.querySelector('input[type="search"]').focus();
    };

    const decorate = () => {
      root.querySelectorAll('table').forEach((table) => {
        if (table.closest('.col-filter-menu')) return;
        const headRow = table.tHead?.rows[0];
        if (!headRow) return;
        if (table.dataset.colFilters !== 'ready') {
          table.dataset.colFilters = 'ready';
          Array.from(headRow.cells).forEach((th, colIndex) => {
            if (th.querySelector('.col-filter-btn')) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'col-filter-btn';
            button.title = `Filter ${th.innerText.trim() || 'column'}`;
            button.textContent = '▾';
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              if (openMenu?.contains(event.target)) return;
              showMenu(table, th, colIndex, button);
            });
            th.appendChild(button);
          });
        }
        applyFilters(table);
      });
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => pause(decorate), 0);
    };

    const onDocClick = (event) => {
      if (openMenu && !openMenu.contains(event.target) && !event.target.classList?.contains('col-filter-btn')) closeMenu();
    };
    document.addEventListener('click', onDocClick);
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    schedule();

    return () => {
      observer.disconnect();
      clearTimeout(timer);
      document.removeEventListener('click', onDocClick);
      closeMenu();
      root.querySelectorAll('.col-filter-btn').forEach((button) => button.remove());
      root.querySelectorAll('table[data-col-filters]').forEach((table) => { delete table.dataset.colFilters; });
    };
  }, [screenKey]);

  return null;
}
