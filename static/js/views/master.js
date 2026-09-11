/* ==========================================================================
   Zippzo WMS — Master Data View (10/10 Architecture Entities)
   ========================================================================== */

let activeMasterTab = 'sites';

async function renderMaster(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">MASTER DATA ARCHITECTURE</div>
        <div class="page-subtitle">Sites, SKUs, storage bins, zones, vendors, fleet types, and dock doors (10 entities).</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="loadMasterTab(activeMasterTab)">
          <span>↺</span>
          <span>REFRESH</span>
        </button>
      </div>
    </div>

    <div class="tabs" id="masterTabs">
      <button class="tab ${activeMasterTab==='sites'?'active':''}" onclick="switchMasterTab('sites')">Sites</button>
      <button class="tab ${activeMasterTab==='sku-categories'?'active':''}" onclick="switchMasterTab('sku-categories')">Categories</button>
      <button class="tab ${activeMasterTab==='skus'?'active':''}" onclick="switchMasterTab('skus')">SKUs</button>
      <button class="tab ${activeMasterTab==='vendors'?'active':''}" onclick="switchMasterTab('vendors')">Vendors</button>
      <button class="tab ${activeMasterTab==='zones'?'active':''}" onclick="switchMasterTab('zones')">Zones</button>
      <button class="tab ${activeMasterTab==='bins'?'active':''}" onclick="switchMasterTab('bins')">Bins</button>
      <button class="tab ${activeMasterTab==='cluster-zones'?'active':''}" onclick="switchMasterTab('cluster-zones')">Cluster Zones</button>
      <button class="tab ${activeMasterTab==='dock-doors'?'active':''}" onclick="switchMasterTab('dock-doors')">Dock Doors</button>
      <button class="tab ${activeMasterTab==='vehicle-types'?'active':''}" onclick="switchMasterTab('vehicle-types')">Vehicle Types</button>
      <button class="tab ${activeMasterTab==='transporters'?'active':''}" onclick="switchMasterTab('transporters')">Transporters</button>
    </div>

    <div id="masterContent">${loadingHTML()}</div>
  `;

  loadMasterTab(activeMasterTab);
}

function switchMasterTab(tab) {
  activeMasterTab = tab;
  document.querySelectorAll('#masterTabs .tab').forEach(t => {
    t.classList.remove('active');
  });
  const activeBtn = Array.from(document.querySelectorAll('#masterTabs .tab')).find(b => {
    return b.getAttribute('onclick')?.includes(`'${tab}'`);
  });
  if (activeBtn) activeBtn.classList.add('active');

  loadMasterTab(tab);
}

async function loadMasterTab(tab) {
  const content = document.getElementById('masterContent');
  if (!content) return;
  content.innerHTML = loadingHTML();

  try {
    const data = await api.get(`/master/${tab}/`);
    const count = data.count ?? data.results?.length ?? 0;
    const results = data.results || (Array.isArray(data) ? data : []);

    let tableHTML = '';

    if (tab === 'sites') {
      tableHTML = buildTable([
        { label: 'Site Code', key: 'code', isCode: true },
        { label: 'Facility Name', key: 'name' },
        { label: 'Site Type', key: 'type', badge: true },
        { label: 'DH Precedence', key: 'dh_precedence' },
        { label: 'SS Precedence', key: 'ss_precedence' },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Site: ${row.code}`, buildDetail(row)));

    } else if (tab === 'sku-categories') {
      tableHTML = buildTable([
        { label: 'Category ID', key: 'category_id', isCode: true },
        { label: 'Category Name', key: 'name' },
        { label: 'Parent ID', key: 'parent_id', isCode: true },
        { label: 'Created', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Category: ${row.name}`, buildDetail(row)));

    } else if (tab === 'skus') {
      tableHTML = buildTable([
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'Product Name', key: 'name' },
        { label: 'Barcode (EAN)', key: 'ean', isCode: true },
        { label: 'Category', key: 'category_name' },
        { label: 'MRP', key: 'mrp', format: fmtCurrency },
        { label: 'WAC', key: 'wac', format: fmtCurrency },
        { label: 'Pack Size', key: 'pack_size' },
        { label: 'Storage Zone', key: 'storage_zone', badge: true },
        { label: 'Shelf Life (Days)', key: 'shelf_life_days' },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`SKU: ${row.sku_code} — ${row.name}`, buildDetail(row)));

    } else if (tab === 'vendors') {
      tableHTML = buildTable([
        { label: 'Vendor Code', key: 'code', isCode: true },
        { label: 'Vendor Name', key: 'name' },
        { label: 'Org Entity', key: 'org_entity' },
        { label: 'GSTIN', key: 'gstin', isCode: true },
        { label: 'Is Customer', key: 'is_customer', format: v => v ? '✓ YES' : '—' },
        { label: 'SKU Vendor', key: 'is_sku_vendor', format: v => v ? '✓ YES' : '—' },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Vendor: ${row.code} — ${row.name}`, buildDetail(row)));

    } else if (tab === 'zones') {
      tableHTML = buildTable([
        { label: 'Zone Code', key: 'code', isCode: true },
        { label: 'Site Code', key: 'site_code' },
        { label: 'Category', key: 'category' },
        { label: 'Zone Type', key: 'zone_type', badge: true },
        { label: 'Commingled Max', key: 'max_commingled' },
        { label: 'Hazardous', key: 'is_hazardous_allowed', format: v => v ? '✓ YES' : '✕ NO' },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Zone: ${row.code}`, buildDetail(row)));

    } else if (tab === 'bins') {
      tableHTML = buildTable([
        { label: 'Bin Coordinate', key: 'code', format: v => `<span class="bin-tag">${v}</span>` },
        { label: 'Aisle', key: 'aisle' },
        { label: 'Rack', key: 'rack' },
        { label: 'Level', key: 'level' },
        { label: 'Bin Type', key: 'bin_type' },
        { label: 'Max Putaway', key: 'putaway_max' },
        { label: 'Pickzone', key: 'is_pickzone', format: v => v ? '✓' : '—' },
        { label: 'Condition', key: 'condition', badge: true },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Bin: ${row.code}`, buildDetail(row)));

    } else if (tab === 'cluster-zones') {
      tableHTML = buildTable([
        { label: 'Cluster Code', key: 'code', isCode: true },
        { label: 'Site Code', key: 'site_code' },
        { label: 'PTL Light Slots', key: 'slot_count' },
        { label: 'Created', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Cluster Zone: ${row.code}`, buildDetail(row)));

    } else if (tab === 'dock-doors') {
      tableHTML = buildTable([
        { label: 'Door Code', key: 'code', isCode: true },
        { label: 'Site Code', key: 'site_code' },
        { label: 'Door Type', key: 'type', badge: true },
        { label: 'Occupancy', key: 'is_occupied', format: v => v ? '<span class="badge badge-rust">OCCUPIED</span>' : '<span class="badge badge-teal">AVAILABLE</span>' },
        { label: 'Current Vehicle', key: 'current_vehicle_no', isCode: true },
      ], results, row => openModal(`Dock Door: ${row.code}`, buildDetail(row)));

    } else if (tab === 'vehicle-types') {
      tableHTML = buildTable([
        { label: 'Type Code', key: 'code', isCode: true },
        { label: 'Payload Capacity (kg)', key: 'payload_capacity_kg' },
        { label: 'Volume (CBM)', key: 'volume_cbm' },
        { label: 'Tote Capacity', key: 'tote_capacity' },
        { label: 'Dock Door Type', key: 'dock_door_type', badge: true },
      ], results, row => openModal(`Vehicle Type: ${row.code}`, buildDetail(row)));

    } else if (tab === 'transporters') {
      tableHTML = buildTable([
        { label: 'Transporter Code', key: 'code', isCode: true },
        { label: 'Transporter Name', key: 'name' },
        { label: 'Contact Person', key: 'contact_person' },
        { label: 'Phone', key: 'phone' },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Transporter: ${row.name}`, buildDetail(row)));
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${tab.replace(/-/g, ' ').toUpperCase()} REGISTRY</div>
          <div class="card-subtitle">${count} total records registered</div>
        </div>
        ${tableHTML}
      </div>
    `;

  } catch (err) {
    content.innerHTML = `<div class="toast error" style="position:static">Failed loading master data [${tab}]: ${err.message}</div>`;
  }
}
