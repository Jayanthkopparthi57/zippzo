/* ==========================================================================
   Zippzo WMS — Cross Dock Operations (2/2 APIs)
   ========================================================================== */

let activeCrossdockTab = 'batches';

async function renderCrossdock(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">CROSS DOCK FLOW-THROUGH CONSOLIDATION</div>
        <div class="page-subtitle">Direct pallet/tote transfer from inbound to outbound doors without interim rack storage.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="loadCrossdockTab(activeCrossdockTab)">
          <span>↺</span>
          <span>REFRESH</span>
        </button>
      </div>
    </div>

    <div class="tabs" id="crossdockTabs">
      <button class="tab ${activeCrossdockTab==='batches'?'active':''}" onclick="switchCrossdockTab('batches')">XDock Batches</button>
      <button class="tab ${activeCrossdockTab==='lines'?'active':''}" onclick="switchCrossdockTab('lines')">XDock Lines</button>
    </div>

    <div id="crossdockContent">${loadingHTML()}</div>
  `;

  loadCrossdockTab(activeCrossdockTab);
}

function switchCrossdockTab(tab) {
  activeCrossdockTab = tab;
  document.querySelectorAll('#crossdockTabs .tab').forEach(t => t.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('#crossdockTabs .tab')).find(b => {
    return b.getAttribute('onclick')?.includes(`'${tab}'`);
  });
  if (activeBtn) activeBtn.classList.add('active');

  loadCrossdockTab(tab);
}

async function loadCrossdockTab(tab) {
  const content = document.getElementById('crossdockContent');
  if (!content) return;
  content.innerHTML = loadingHTML();

  try {
    const data = await api.get(`/crossdock/${tab}/`);
    const count = data.count ?? data.results?.length ?? 0;
    const results = data.results || (Array.isArray(data) ? data : []);

    let tableHTML = '';

    if (tab === 'batches') {
      tableHTML = buildTable([
        { label: 'Batch ID', key: 'batch_no', isCode: true },
        { label: 'Site Code', key: 'site_code' },
        { label: 'Inbound Door', key: 'inbound_door_code' },
        { label: 'Outbound Door', key: 'outbound_door_code' },
        { label: 'Total Pallets', key: 'total_pallets' },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Cutoff Window', key: 'cutoff_time', format: fmtDate },
      ], results, row => openModal(`Cross Dock Batch: ${row.batch_no}`, buildDetail(row)));

    } else if (tab === 'lines') {
      tableHTML = buildTable([
        { label: 'Line ID', key: 'line_id', isCode: true },
        { label: 'Batch ID', key: 'batch_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'Source LPN', key: 'from_lpn_code', format: v => `<span class="lpn-tag">${v}</span>` },
        { label: 'Dest LPN', key: 'to_lpn_code', format: v => `<span class="lpn-tag">${v}</span>` },
        { label: 'Transfer Qty', key: 'qty' },
        { label: 'Allocable in XDock Bin', key: 'allocable_qty' },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Cross Dock Line Details`, buildDetail(row)));
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">CROSS DOCK / ${tab.toUpperCase()}</div>
          <div class="card-subtitle">${count} records in transit</div>
        </div>
        ${tableHTML}
      </div>
    `;

  } catch (err) {
    content.innerHTML = `<div class="toast error" style="position:static">Failed loading crossdock data [${tab}]: ${err.message}</div>`;
  }
}
