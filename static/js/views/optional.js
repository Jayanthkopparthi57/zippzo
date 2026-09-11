/* ==========================================================================
   Zippzo WMS — Optional Modules: Cycle Counts & Replenishment (3/3 APIs)
   ========================================================================== */

let activeOptionalTab = 'cycle-counts';

async function renderOptional(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">OPTIONAL & EXTENDED AUDIT MODULES</div>
        <div class="page-subtitle">Physical cycle count inventory audits, blind count line verifications, and pickface replenishments.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="loadOptionalTab(activeOptionalTab)">
          <span>↺</span>
          <span>REFRESH</span>
        </button>
      </div>
    </div>

    <div class="tabs" id="optionalTabs">
      <button class="tab ${activeOptionalTab==='cycle-counts'?'active':''}" onclick="switchOptionalTab('cycle-counts')">Cycle Counts</button>
      <button class="tab ${activeOptionalTab==='cycle-count-lines'?'active':''}" onclick="switchOptionalTab('cycle-count-lines')">Cycle Count Lines</button>
      <button class="tab ${activeOptionalTab==='replenishments'?'active':''}" onclick="switchOptionalTab('replenishments')">Replenishments</button>
    </div>

    <div id="optionalContent">${loadingHTML()}</div>
  `;

  loadOptionalTab(activeOptionalTab);
}

function switchOptionalTab(tab) {
  activeOptionalTab = tab;
  document.querySelectorAll('#optionalTabs .tab').forEach(t => t.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('#optionalTabs .tab')).find(b => {
    return b.getAttribute('onclick')?.includes(`'${tab}'`);
  });
  if (activeBtn) activeBtn.classList.add('active');

  loadOptionalTab(tab);
}

async function loadOptionalTab(tab) {
  const content = document.getElementById('optionalContent');
  if (!content) return;
  content.innerHTML = loadingHTML();

  try {
    const data = await api.get(`/optional/${tab}/`);
    const count = data.count ?? data.results?.length ?? 0;
    const results = data.results || (Array.isArray(data) ? data : []);

    let tableHTML = '';

    if (tab === 'cycle-counts') {
      tableHTML = buildTable([
        { label: 'Count Code', key: 'code', isCode: true },
        { label: 'Site Code', key: 'site_code' },
        { label: 'Target Zone', key: 'zone_code' },
        { label: 'Count Type', key: 'type', badge: true },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Created At', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Cycle Count: ${row.code}`, buildDetail(row)));

    } else if (tab === 'cycle-count-lines') {
      tableHTML = buildTable([
        { label: 'Line ID', key: 'line_id', isCode: true },
        { label: 'Count ID', key: 'count_id', isCode: true },
        { label: 'Bin Coordinate', key: 'bin_code', format: v => `<span class="bin-tag">${v}</span>` },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'System Qty', key: 'system_qty' },
        { label: 'Counted Qty', key: 'counted_qty' },
        { label: 'Variance', key: 'variance_qty', format: v => {
          const num = parseFloat(v || 0);
          if (num === 0) return '<span style="color:#48a968">0</span>';
          return `<span style="color:var(--c-rust);font-weight:700">${num > 0 ? '+' + num : num}</span>`;
        }},
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Count Line Audit`, buildDetail(row)));

    } else if (tab === 'replenishments') {
      tableHTML = buildTable([
        { label: 'Replenish Code', key: 'code', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'Source Reserve Bin', key: 'source_bin_code', format: v => `<span class="bin-tag">${v}</span>` },
        { label: 'Target Pick Bin', key: 'target_bin_code', format: v => `<span class="bin-tag">${v}</span>` },
        { label: 'Transfer Qty', key: 'qty' },
        { label: 'Priority', key: 'priority', badge: true },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Triggered', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Replenishment: ${row.code}`, buildDetail(row)));
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">OPTIONAL / ${tab.replace(/-/g, ' ').toUpperCase()}</div>
          <div class="card-subtitle">${count} inventory audit records</div>
        </div>
        ${tableHTML}
      </div>
    `;

  } catch (err) {
    content.innerHTML = `<div class="toast error" style="position:static">Failed loading optional modules [${tab}]: ${err.message}</div>`;
  }
}
