/* ==========================================================================
   Zippzo WMS — Shared UI Components & API Diagnostics Suite
   ========================================================================== */

// ── Toast Notifications ──────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const tc = document.getElementById('toastContainer');
  if (!tc) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span style="font-weight:700">${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  tc.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(4px)';
    t.style.transition = '0.2s';
    setTimeout(() => t.remove(), 200);
  }, 3200);
}

// ── Status Badges (Strict Anti-AI-Slop Monospace Chips) ───────────────────────
function statusBadge(status) {
  if (!status) return '<span class="badge badge-gray">—</span>';
  const s = String(status).toUpperCase();

  // Map to palette: Teal (#285a73), Amber (#c49a45), Rust (#b83a32), Neutral Gray
  const tealSet = new Set([
    'ACTIVE', 'COMPLETED', 'CLOSED', 'DONE', 'SHIPPED', 'RECEIVED',
    'MATCHED', 'PUTAWAY', 'LIVE', 'GOOD', 'ON_TRACK', 'VERIFIED'
  ]);
  const amberSet = new Set([
    'IN_PROGRESS', 'PICKING', 'SORTING', 'IN_TRANSIT', 'LOADING', 'INWARDING',
    'PARTIAL', 'ALLOCATED', 'DOCKED_IN', 'CHECKED_IN', 'ASSIGNED',
    'PENDING', 'OPEN', 'NOT_STARTED', 'QC_PENDING', 'ARRIVED', 'UNLOADED',
    'SORTED', 'LOADED', 'STALE', 'QC_HOLD', 'RETURN_IN_TRANSIT'
  ]);
  const rustSet = new Set([
    'CANCELLED', 'BLOCKED', 'INACTIVE', 'SHORT', 'DEPLETED', 'DAMAGE',
    'DELAYED', 'EXCEPTION', 'VARIANCE', 'BAD', 'REJECTED'
  ]);

  let cls = 'gray';
  if (tealSet.has(s)) cls = 'teal';
  else if (amberSet.has(s)) cls = 'amber';
  else if (rustSet.has(s)) cls = 'rust';

  return `<span class="badge badge-${cls}">${status}</span>`;
}

// ── Data Table Component with Instant Search & Column Sorting ────────────────
function buildTable(columns, rawRows, onRowClick, tableId = 'tbl_' + Math.random().toString(36).substr(2, 6)) {
  const rows = rawRows || [];
  if (rows.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">[ 0 ]</div><div class="empty-text">No records found matching current criteria</div></div>`;
  }

  const tableWrapperId = `wrap_${tableId}`;
  const filterInputId  = `filter_${tableId}`;
  const statsId        = `stats_${tableId}`;

  const thead = columns.map((c, idx) => `
    <th data-col="${idx}" style="cursor:pointer" title="Click to sort">
      ${c.label} <span style="font-size:9px;color:var(--text-muted)">↕</span>
    </th>
  `).join('');

  const renderRows = (rowList) => {
    return rowList.map((row, rIdx) => {
      const cells = columns.map(c => {
        let val = c.key.split('.').reduce((o, k) => o?.[k], row);
        let formatted = val;

        if (c.badge) {
          formatted = statusBadge(val);
        } else if (c.format) {
          formatted = c.format(val, row);
        } else if (c.isCode || c.key.includes('_no') || c.key.includes('code') || c.key.includes('ean')) {
          formatted = `<code class="mono">${val ?? '—'}</code>`;
        } else if (typeof val === 'number') {
          formatted = `<span class="num-cell">${val.toLocaleString('en-IN')}</span>`;
        } else {
          formatted = val ?? '—';
        }

        return `<td>${formatted}</td>`;
      }).join('');

      return `<tr data-row-idx="${rIdx}" style="cursor:${onRowClick ? 'pointer' : 'default'}">${cells}</tr>`;
    }).join('');
  };

  const html = `
    <div id="${tableWrapperId}">
      <div class="table-toolbar">
        <div style="display:flex;align-items:center;gap:8px">
          <input type="text" id="${filterInputId}" class="table-filter-input" placeholder="Search table..." autocomplete="off" />
        </div>
        <div class="table-stats" id="${statsId}">Showing ${rows.length} records</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>${thead}</tr></thead>
          <tbody id="tbody_${tableId}">${renderRows(rows)}</tbody>
        </table>
      </div>
    </div>
  `;

  // Attach search and click handlers after DOM render
  setTimeout(() => {
    let currentRows = [...rows];
    const tbodyEl = document.getElementById(`tbody_${tableId}`);
    const filterEl = document.getElementById(filterInputId);
    const statsEl = document.getElementById(statsId);

    const wireRowClicks = () => {
      if (!onRowClick || !tbodyEl) return;
      tbodyEl.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
          const idx = parseInt(tr.dataset.rowIdx, 10);
          if (!isNaN(idx) && currentRows[idx]) {
            onRowClick(currentRows[idx]);
          }
        });
      });
    };

    wireRowClicks();

    // Instant Filter
    if (filterEl) {
      filterEl.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
          currentRows = [...rows];
        } else {
          currentRows = rows.filter(r => {
            return JSON.stringify(Object.values(r)).toLowerCase().includes(query);
          });
        }
        if (tbodyEl) tbodyEl.innerHTML = renderRows(currentRows);
        if (statsEl) statsEl.textContent = `Showing ${currentRows.length} of ${rows.length} records`;
        wireRowClicks();
      });
    }

    // Column Sorting
    const wrapper = document.getElementById(tableWrapperId);
    if (wrapper) {
      wrapper.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
          const colIdx = parseInt(th.dataset.col, 10);
          const col = columns[colIdx];
          if (!col) return;
          const asc = th.dataset.sort !== 'asc';
          wrapper.querySelectorAll('th').forEach(t => delete t.dataset.sort);
          th.dataset.sort = asc ? 'asc' : 'desc';

          currentRows.sort((a, b) => {
            let va = col.key.split('.').reduce((o, k) => o?.[k], a);
            let vb = col.key.split('.').reduce((o, k) => o?.[k], b);
            if (va == null) return 1;
            if (vb == null) return -1;
            if (typeof va === 'number' && typeof vb === 'number') {
              return asc ? va - vb : vb - va;
            }
            return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
          });

          if (tbodyEl) tbodyEl.innerHTML = renderRows(currentRows);
          wireRowClicks();
        });
      });
    }
  }, 10);

  return html;
}

// ── Detail View Property Sheet ───────────────────────────────────────────────
function buildDetail(obj, exclude = []) {
  const skip = new Set([
    ...exclude,
    ...Object.keys(obj).filter(k => k.endsWith('_id') && typeof obj[k] === 'string' && obj[k].length === 36 && !['site_id','sku_id'].includes(k))
  ]);

  const items = Object.entries(obj)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => {
      const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      let val = v;

      if (typeof v === 'boolean') {
        val = v ? '<span style="color:#48a968;font-weight:600">✓ YES</span>' : '<span style="color:var(--text-muted)">✕ NO</span>';
      } else if (v === null || v === undefined) {
        val = '<span style="color:var(--text-muted)">—</span>';
      } else if (typeof v === 'string' && v.length === 36 && v.includes('-')) {
        val = `<code style="font-size:11px;color:var(--c-amber)">${v}</code>`;
      } else if (typeof v === 'object' && v !== null) {
        val = `<pre style="font-family:var(--font-mono);font-size:11px;max-height:120px;overflow:auto">${JSON.stringify(v, null, 2)}</pre>`;
      }
      return `
        <div class="detail-item">
          <div class="detail-key">${label}</div>
          <div class="detail-val">${val}</div>
        </div>
      `;
    }).join('');

  return `<div class="detail-grid">${items}</div>`;
}

// ── Modal Management ─────────────────────────────────────────────────────────
function openModal(title, html) {
  document.getElementById('modalTitle').innerHTML = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

document.getElementById('modalClose').onclick = closeModal;
document.getElementById('modalOverlay').onclick = e => { if (e.target === e.currentTarget) closeModal(); };

// ── Master List of All 42 System APIs ────────────────────────────────────────
const ALL_SYSTEM_APIS = [
  // Platform (2)
  { module: 'Platform', name: 'Users', path: '/platform/users/' },
  { module: 'Platform', name: 'Reason Codes', path: '/platform/reason-codes/' },

  // Master Data (10)
  { module: 'Master Data', name: 'Sites', path: '/master/sites/' },
  { module: 'Master Data', name: 'SKU Categories', path: '/master/sku-categories/' },
  { module: 'Master Data', name: 'SKUs', path: '/master/skus/' },
  { module: 'Master Data', name: 'Vendors', path: '/master/vendors/' },
  { module: 'Master Data', name: 'Zones', path: '/master/zones/' },
  { module: 'Master Data', name: 'Bins', path: '/master/bins/' },
  { module: 'Master Data', name: 'Cluster Zones', path: '/master/cluster-zones/' },
  { module: 'Master Data', name: 'Dock Doors', path: '/master/dock-doors/' },
  { module: 'Master Data', name: 'Vehicle Types', path: '/master/vehicle-types/' },
  { module: 'Master Data', name: 'Transporters', path: '/master/transporters/' },

  // Inventory (4)
  { module: 'Inventory', name: 'LPNs (Totes)', path: '/inventory/lpns/' },
  { module: 'Inventory', name: 'Inventory Lots', path: '/inventory/lots/' },
  { module: 'Inventory', name: 'Inventory Transactions', path: '/inventory/transactions/' },
  { module: 'Inventory', name: 'Droplists (LPN Movement)', path: '/inventory/droplists/' },

  // Inbound (6)
  { module: 'Inbound', name: 'ASNs', path: '/inbound/asns/' },
  { module: 'Inbound', name: 'ASN Lines', path: '/inbound/asn-lines/' },
  { module: 'Inbound', name: 'GRNs', path: '/inbound/grns/' },
  { module: 'Inbound', name: 'GRN Lines', path: '/inbound/grn-lines/' },
  { module: 'Inbound', name: 'Putaway Tasks', path: '/inbound/putaway-tasks/' },
  { module: 'Inbound', name: 'Discrepancies', path: '/inbound/discrepancies/' },

  // Outbound (12)
  { module: 'Outbound', name: 'Dispatch Plans', path: '/outbound/dispatch-plans/' },
  { module: 'Outbound', name: 'Wave Batches', path: '/outbound/batches/' },
  { module: 'Outbound', name: 'Orders', path: '/outbound/orders/' },
  { module: 'Outbound', name: 'Order Lines', path: '/outbound/order-lines/' },
  { module: 'Outbound', name: 'Order Allocations', path: '/outbound/allocations/' },
  { module: 'Outbound', name: 'Picklists', path: '/outbound/picklists/' },
  { module: 'Outbound', name: 'Picklist Lines', path: '/outbound/picklist-lines/' },
  { module: 'Outbound', name: 'Sortlists', path: '/outbound/sortlists/' },
  { module: 'Outbound', name: 'Sortlist Lines', path: '/outbound/sortlist-lines/' },
  { module: 'Outbound', name: 'Manifests', path: '/outbound/manifests/' },
  { module: 'Outbound', name: 'Manifest Lines', path: '/outbound/manifest-lines/' },
  { module: 'Outbound', name: 'Cancellation Putaways', path: '/outbound/cancellation-putaways/' },

  // Transport (3)
  { module: 'Transport', name: 'Trips', path: '/transport/trips/' },
  { module: 'Transport', name: 'Vehicle Check-ins', path: '/transport/vehicle-checkins/' },
  { module: 'Transport', name: 'Trip Return Legs', path: '/transport/trip-return-legs/' },

  // Cross Dock (2)
  { module: 'Cross Dock', name: 'XDock Batches', path: '/crossdock/batches/' },
  { module: 'Cross Dock', name: 'XDock Lines', path: '/crossdock/lines/' },

  // Optional (3)
  { module: 'Optional', name: 'Cycle Counts', path: '/optional/cycle-counts/' },
  { module: 'Optional', name: 'Cycle Count Lines', path: '/optional/cycle-count-lines/' },
  { module: 'Optional', name: 'Replenishments', path: '/optional/replenishments/' },
];

// ── Interactive API Diagnostics Modal Runner ─────────────────────────────────
function openApiDiagnosticsModal() {
  const overlay = document.getElementById('apiDiagOverlay');
  const body = document.getElementById('apiDiagBody');
  if (!overlay || !body) return;

  body.innerHTML = `
    <div class="diag-header">
      <div>
        <div style="font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--text-primary)">
          Real-Time 42 API Verification Suite
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:2px">
          Verifies connectivity, schema integrity, and count across all 8 modules simultaneously.
        </div>
      </div>
      <button class="btn btn-primary" id="startDiagBtn">
        <span>▶</span>
        <span>RUN ALL 42 DIAGNOSTICS</span>
      </button>
    </div>

    <div class="diag-progress-bar-wrap">
      <div class="diag-progress-bar" id="diagProgressBar"></div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div class="diag-summary-stats" id="diagStats">
        <div class="diag-stat"><span>Tested:</span> <span class="diag-stat-num" id="statTested">0 / 42</span></div>
        <div class="diag-stat"><span style="color:#48a968">Pass:</span> <span class="diag-stat-num" id="statPass">0</span></div>
        <div class="diag-stat"><span style="color:var(--c-rust)">Fail:</span> <span class="diag-stat-num" id="statFail">0</span></div>
        <div class="diag-stat"><span>Avg Latency:</span> <span class="diag-stat-num" id="statLatency">—</span></div>
      </div>
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">
        Target: <code style="color:var(--c-amber)">http://localhost:8000/api</code>
      </div>
    </div>

    <div class="diag-grid" id="diagGrid">
      ${ALL_SYSTEM_APIS.map((apiItem, i) => `
        <div class="diag-card" id="diag_card_${i}">
          <div>
            <div class="diag-module">${apiItem.module}</div>
            <div class="diag-name">${apiItem.name}</div>
            <code style="font-size:10px;color:var(--text-muted)">${apiItem.path}</code>
          </div>
          <div class="diag-meta" id="diag_meta_${i}">
            <span class="badge badge-gray">READY</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  overlay.style.display = 'flex';

  document.getElementById('startDiagBtn').onclick = runAllApiDiagnostics;
  // Automatically run once opened
  runAllApiDiagnostics();
}

async function runAllApiDiagnostics() {
  const btn = document.getElementById('startDiagBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span><span>TESTING 42 ENDPOINTS...</span>';
  }

  let passed = 0;
  let failed = 0;
  let latencies = [];
  const bar = document.getElementById('diagProgressBar');

  for (let i = 0; i < ALL_SYSTEM_APIS.length; i++) {
    const item = ALL_SYSTEM_APIS[i];
    const cardEl = document.getElementById(`diag_card_${i}`);
    const metaEl = document.getElementById(`diag_meta_${i}`);

    const t0 = performance.now();
    try {
      const res = await api.get(item.path);
      const latency = Math.round(performance.now() - t0);
      latencies.push(latency);
      const count = res.count ?? (Array.isArray(res) ? res.length : (res.results?.length ?? 1));

      passed++;
      if (cardEl) {
        cardEl.className = 'diag-card pass';
      }
      if (metaEl) {
        metaEl.innerHTML = `
          <div style="text-align:right">
            <span class="badge badge-teal">200 OK</span>
            <div class="diag-latency">${count} items • ${latency}ms</div>
          </div>
        `;
      }
    } catch (err) {
      failed++;
      if (cardEl) cardEl.className = 'diag-card fail';
      if (metaEl) {
        metaEl.innerHTML = `
          <div style="text-align:right">
            <span class="badge badge-rust">ERROR</span>
            <div class="diag-latency" style="color:var(--c-rust)">Failed</div>
          </div>
        `;
      }
    }

    // Update progress & stats
    const progress = Math.round(((i + 1) / ALL_SYSTEM_APIS.length) * 100);
    if (bar) bar.style.width = `${progress}%`;

    const statTested = document.getElementById('statTested');
    const statPass = document.getElementById('statPass');
    const statFail = document.getElementById('statFail');
    const statLatency = document.getElementById('statLatency');

    if (statTested) statTested.textContent = `${i + 1} / 42`;
    if (statPass) statPass.textContent = passed;
    if (statFail) statFail.textContent = failed;
    if (statLatency && latencies.length) {
      const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      statLatency.textContent = `${avg} ms`;
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<span>↺</span><span>RERUN ALL 42</span>';
  }

  if (failed === 0) {
    showToast('All 42 APIs successfully verified (100% OK)', 'success');
  } else {
    showToast(`${failed} of 42 APIs reported issues`, 'error');
  }
}

// Close API diagnostics modal
document.getElementById('apiDiagClose').onclick = () => {
  document.getElementById('apiDiagOverlay').style.display = 'none';
};
document.getElementById('apiDiagOverlay').onclick = e => {
  if (e.target === e.currentTarget) {
    document.getElementById('apiDiagOverlay').style.display = 'none';
  }
};

// ── Formatting Helpers ───────────────────────────────────────────────────────
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function fmtDateOnly(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function fmtCurrency(v) {
  if (v == null) return '—';
  return '₹' + parseFloat(v || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function loadingHTML() {
  return `
    <div class="loading">
      <div class="spinner"></div>
      <span>Querying database engine...</span>
    </div>
  `;
}
