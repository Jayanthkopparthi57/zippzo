/* ==========================================================================
   Zippzo WMS — Inventory & Storage Lots (4/4 APIs)
   ========================================================================== */

let activeInventoryTab = 'lots';

async function renderInventory(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">INVENTORY, LOTS & TOTES MANAGEMENT</div>
        <div class="page-subtitle">Real-time bin balances, SKU transaction audit logs, LPN containers, and droplist transfers.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="loadInventoryTab(activeInventoryTab)">
          <span>↺</span>
          <span>REFRESH</span>
        </button>
      </div>
    </div>

    <div class="tabs" id="inventoryTabs">
      <button class="tab ${activeInventoryTab==='lots'?'active':''}" onclick="switchInventoryTab('lots')">Inventory Lots</button>
      <button class="tab ${activeInventoryTab==='transactions'?'active':''}" onclick="switchInventoryTab('transactions')">Audit Log (Tx)</button>
      <button class="tab ${activeInventoryTab==='lpns'?'active':''}" onclick="switchInventoryTab('lpns')">LPNs / Totes</button>
      <button class="tab ${activeInventoryTab==='droplists'?'active':''}" onclick="switchInventoryTab('droplists')">Droplists (Movement)</button>
    </div>

    <div id="inventoryContent">${loadingHTML()}</div>
  `;

  loadInventoryTab(activeInventoryTab);
}

function switchInventoryTab(tab) {
  activeInventoryTab = tab;
  document.querySelectorAll('#inventoryTabs .tab').forEach(t => t.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('#inventoryTabs .tab')).find(b => {
    return b.getAttribute('onclick')?.includes(`'${tab}'`);
  });
  if (activeBtn) activeBtn.classList.add('active');

  loadInventoryTab(tab);
}

async function loadInventoryTab(tab) {
  const content = document.getElementById('inventoryContent');
  if (!content) return;
  content.innerHTML = loadingHTML();

  try {
    const data = await api.get(`/inventory/${tab}/`);
    const count = data.count ?? data.results?.length ?? 0;
    const results = data.results || (Array.isArray(data) ? data : []);

    let tableHTML = '';

    if (tab === 'lots') {
      tableHTML = buildTable([
        { label: 'Lot Code', key: 'lot_code', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'Product Name', key: 'sku_name' },
        { label: 'Bin Coordinate', key: 'bin_code', format: v => `<span class="bin-tag">${v}</span>` },
        { label: 'Available Qty', key: 'qty' },
        { label: 'MRP', key: 'mrp', format: fmtCurrency },
        { label: 'Bucket', key: 'bucket', badge: true },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Expiry Date', key: 'expiry_date', format: fmtDateOnly },
      ], results, row => openModal(`Inventory Lot: ${row.lot_code}`, buildDetail(row)));

    } else if (tab === 'transactions') {
      tableHTML = buildTable([
        { label: 'Tx ID', key: 'tx_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'Flow Direction', key: 'flow', badge: true },
        { label: 'Quantity', key: 'qty' },
        { label: 'Origin Bin', key: 'from_bin', format: v => v ? `<span class="bin-tag">${v}</span>` : '—' },
        { label: 'Target Bin', key: 'to_bin', format: v => v ? `<span class="bin-tag">${v}</span>` : '—' },
        { label: 'Operator ID', key: 'user_id', isCode: true },
        { label: 'Timestamp', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Transaction Audit #${row.tx_id}`, buildDetail(row)));

    } else if (tab === 'lpns') {
      tableHTML = buildTable([
        { label: 'LPN / Tote ID', key: 'lpn_code', format: v => `<span class="lpn-tag">${v}</span>` },
        { label: 'LPN Type', key: 'type', badge: true },
        { label: 'Current Bin', key: 'current_bin_code', format: v => v ? `<span class="bin-tag">${v}</span>` : '—' },
        { label: 'Item Count', key: 'item_count' },
        { label: 'Total Qty', key: 'total_qty' },
        { label: 'QC Passed', key: 'is_qc_cleared', format: v => v ? '✓ YES' : '✕ NO' },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Created At', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`LPN: ${row.lpn_code}`, buildDetail(row)));

    } else if (tab === 'droplists') {
      tableHTML = buildTable([
        { label: 'Droplist ID', key: 'code', isCode: true },
        { label: 'Site Code', key: 'site_code' },
        { label: 'Source Zone', key: 'source_zone_code' },
        { label: 'Target Zone', key: 'dest_zone_code' },
        { label: 'LPNs Count', key: 'lpn_count' },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Created', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Droplist Movement: ${row.code}`, buildDetail(row)));
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">INVENTORY / ${tab.replace(/-/g, ' ').toUpperCase()}</div>
          <div class="card-subtitle">${count} inventory ledger entries</div>
        </div>
        ${tableHTML}
      </div>
    `;

  } catch (err) {
    content.innerHTML = `<div class="toast error" style="position:static">Failed loading inventory [${tab}]: ${err.message}</div>`;
  }
}
