/* ==========================================================================
   Zippzo WMS — Outbound Fulfillment & Dispatch Waves (12/12 APIs)
   ========================================================================== */

let activeOutboundTab = 'orders';

async function renderOutbound(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">OUTBOUND FULFILLMENT & DISPATCH ENGINE</div>
        <div class="page-subtitle">Wave batches, order allocations, picking, sorting, manifests, dispatch plans, and cancellations (12 entities).</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="loadOutboundTab(activeOutboundTab)">
          <span>↺</span>
          <span>REFRESH</span>
        </button>
      </div>
    </div>

    <div class="tabs" id="outboundTabs">
      <button class="tab ${activeOutboundTab==='orders'?'active':''}" onclick="switchOutboundTab('orders')">Orders</button>
      <button class="tab ${activeOutboundTab==='order-lines'?'active':''}" onclick="switchOutboundTab('order-lines')">Order Lines</button>
      <button class="tab ${activeOutboundTab==='allocations'?'active':''}" onclick="switchOutboundTab('allocations')">Allocations</button>
      <button class="tab ${activeOutboundTab==='batches'?'active':''}" onclick="switchOutboundTab('batches')">Batches</button>
      <button class="tab ${activeOutboundTab==='picklists'?'active':''}" onclick="switchOutboundTab('picklists')">Picklists</button>
      <button class="tab ${activeOutboundTab==='picklist-lines'?'active':''}" onclick="switchOutboundTab('picklist-lines')">Picklist Lines</button>
      <button class="tab ${activeOutboundTab==='sortlists'?'active':''}" onclick="switchOutboundTab('sortlists')">Sortlists</button>
      <button class="tab ${activeOutboundTab==='sortlist-lines'?'active':''}" onclick="switchOutboundTab('sortlist-lines')">Sortlist Lines</button>
      <button class="tab ${activeOutboundTab==='manifests'?'active':''}" onclick="switchOutboundTab('manifests')">Manifests</button>
      <button class="tab ${activeOutboundTab==='manifest-lines'?'active':''}" onclick="switchOutboundTab('manifest-lines')">Manifest Lines</button>
      <button class="tab ${activeOutboundTab==='dispatch-plans'?'active':''}" onclick="switchOutboundTab('dispatch-plans')">Dispatch Plans</button>
      <button class="tab ${activeOutboundTab==='cancellation-putaways'?'active':''}" onclick="switchOutboundTab('cancellation-putaways')">Cancel Putaways</button>
    </div>

    <div id="outboundContent">${loadingHTML()}</div>
  `;

  loadOutboundTab(activeOutboundTab);
}

function switchOutboundTab(tab) {
  activeOutboundTab = tab;
  document.querySelectorAll('#outboundTabs .tab').forEach(t => t.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('#outboundTabs .tab')).find(b => {
    return b.getAttribute('onclick')?.includes(`'${tab}'`);
  });
  if (activeBtn) activeBtn.classList.add('active');

  loadOutboundTab(tab);
}

async function loadOutboundTab(tab) {
  const content = document.getElementById('outboundContent');
  if (!content) return;
  content.innerHTML = loadingHTML();

  try {
    const data = await api.get(`/outbound/${tab}/`);
    const count = data.count ?? data.results?.length ?? 0;
    const results = data.results || (Array.isArray(data) ? data : []);

    let tableHTML = '';

    if (tab === 'orders') {
      tableHTML = buildTable([
        { label: 'Order Number', key: 'order_no', isCode: true },
        { label: 'Order Type', key: 'type', badge: true },
        { label: 'Shipment Type', key: 'shipment_type', badge: true },
        { label: 'Destination', key: 'final_dest_code' },
        { label: 'Ordered Qty', key: 'ordered_qty' },
        { label: 'Picked Qty', key: 'picked_qty' },
        { label: 'Shipped Qty', key: 'shipped_qty' },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Created', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Order: ${row.order_no}`, buildDetail(row)));

    } else if (tab === 'order-lines') {
      tableHTML = buildTable([
        { label: 'Line ID', key: 'order_line_id', isCode: true },
        { label: 'Order ID', key: 'order_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'SKU Name', key: 'sku_name' },
        { label: 'Ordered Qty', key: 'ordered_qty' },
        { label: 'Picked Qty', key: 'picked_qty' },
        { label: 'Shipped Qty', key: 'shipped_qty' },
        { label: 'MRP', key: 'mrp', format: fmtCurrency },
      ], results, row => openModal(`Order Line Details`, buildDetail(row)));

    } else if (tab === 'allocations') {
      tableHTML = buildTable([
        { label: 'Alloc ID', key: 'allocation_id', isCode: true },
        { label: 'Order Line ID', key: 'order_line_id', isCode: true },
        { label: 'Lot ID', key: 'lot_id', isCode: true },
        { label: 'Allocated Qty', key: 'allocated_qty' },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Allocated At', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Allocation Record`, buildDetail(row)));

    } else if (tab === 'batches') {
      tableHTML = buildTable([
        { label: 'Batch No', key: 'batch_no', isCode: true },
        { label: 'Wave Type', key: 'type', badge: true },
        { label: 'Ordered Qty', key: 'ordered_qty' },
        { label: 'Picked Qty', key: 'picked_qty' },
        { label: 'Sorted Qty', key: 'sorted_qty' },
        { label: 'Cutoff Window', key: 'cutoff', format: fmtDate },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Wave Batch: ${row.batch_no}`, buildDetail(row)));

    } else if (tab === 'picklists') {
      tableHTML = buildTable([
        { label: 'Picklist Code', key: 'code', isCode: true },
        { label: 'Batch No', key: 'batch_no', isCode: true },
        { label: 'Picking Type', key: 'type', badge: true },
        { label: 'Assigned Qty', key: 'assigned_qty' },
        { label: 'Picked Qty', key: 'picked_qty' },
        { label: 'Picker ID', key: 'picker_user_id', isCode: true },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Picklist: ${row.code}`, buildDetail(row)));

    } else if (tab === 'picklist-lines') {
      tableHTML = buildTable([
        { label: 'Line ID', key: 'line_id', isCode: true },
        { label: 'Picklist ID', key: 'picklist_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'Source Bin', key: 'bin_code', format: v => `<span class="bin-tag">${v}</span>` },
        { label: 'Expected Qty', key: 'expected_qty' },
        { label: 'Picked Qty', key: 'picked_qty' },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Picklist Line Details`, buildDetail(row)));

    } else if (tab === 'sortlists') {
      tableHTML = buildTable([
        { label: 'Sortlist Code', key: 'code', isCode: true },
        { label: 'Batch No', key: 'batch_no', isCode: true },
        { label: 'Assigned Qty', key: 'assigned_qty' },
        { label: 'Sorted Qty', key: 'sorted_qty' },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Sortlist: ${row.code}`, buildDetail(row)));

    } else if (tab === 'sortlist-lines') {
      tableHTML = buildTable([
        { label: 'Line ID', key: 'line_id', isCode: true },
        { label: 'Sortlist ID', key: 'sortlist_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'Target Tote', key: 'tote_lpn', format: v => `<span class="lpn-tag">${v}</span>` },
        { label: 'Assigned Qty', key: 'assigned_qty' },
        { label: 'Sorted Qty', key: 'sorted_qty' },
      ], results, row => openModal(`Sortlist Line Details`, buildDetail(row)));

    } else if (tab === 'manifests') {
      tableHTML = buildTable([
        { label: 'Manifest Code', key: 'code', isCode: true },
        { label: 'Trip No', key: 'trip_no', isCode: true },
        { label: 'Total LPNs', key: 'total_lpns' },
        { label: 'Total Orders', key: 'total_orders' },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Generated', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Manifest: ${row.code}`, buildDetail(row)));

    } else if (tab === 'manifest-lines') {
      tableHTML = buildTable([
        { label: 'Line ID', key: 'line_id', isCode: true },
        { label: 'Manifest ID', key: 'manifest_id', isCode: true },
        { label: 'LPN / Tote', key: 'lpn_code', format: v => `<span class="lpn-tag">${v}</span>` },
        { label: 'Order ID', key: 'order_id', isCode: true },
        { label: 'Item Count', key: 'item_count' },
      ], results, row => openModal(`Manifest Line Details`, buildDetail(row)));

    } else if (tab === 'dispatch-plans') {
      tableHTML = buildTable([
        { label: 'Plan Code', key: 'code', isCode: true },
        { label: 'Origin Site', key: 'origin_site_code' },
        { label: 'Dest Site', key: 'dest_site_code' },
        { label: 'Total Orders', key: 'order_count' },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Planned Cutoff', key: 'cutoff_time', format: fmtDate },
      ], results, row => openModal(`Dispatch Plan: ${row.code}`, buildDetail(row)));

    } else if (tab === 'cancellation-putaways') {
      tableHTML = buildTable([
        { label: 'Putaway ID', key: 'putaway_id', isCode: true },
        { label: 'Order ID', key: 'order_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'Target Restock Bin', key: 'target_bin_code', format: v => `<span class="bin-tag">${v}</span>` },
        { label: 'Restock Qty', key: 'qty' },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Cancellation Putaway Record`, buildDetail(row)));
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">OUTBOUND / ${tab.replace(/-/g, ' ').toUpperCase()}</div>
          <div class="card-subtitle">${count} operational records</div>
        </div>
        ${tableHTML}
      </div>
    `;

  } catch (err) {
    content.innerHTML = `<div class="toast error" style="position:static">Failed loading outbound data [${tab}]: ${err.message}</div>`;
  }
}
