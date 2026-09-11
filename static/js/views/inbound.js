/* ==========================================================================
   Zippzo WMS — Inbound Receiving & Inwarding (6/6 APIs)
   ========================================================================== */

let activeInboundTab = 'asns';

async function renderInbound(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">INBOUND RECEIVING & DOCK OPERATIONS</div>
        <div class="page-subtitle">Advance Shipping Notices, Goods Receipts (GRN), Putaway Tasks, and Discrepancies.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="loadInboundTab(activeInboundTab)">
          <span>↺</span>
          <span>REFRESH</span>
        </button>
      </div>
    </div>

    <div class="tabs" id="inboundTabs">
      <button class="tab ${activeInboundTab==='asns'?'active':''}" onclick="switchInboundTab('asns')">ASNs</button>
      <button class="tab ${activeInboundTab==='asn-lines'?'active':''}" onclick="switchInboundTab('asn-lines')">ASN Lines</button>
      <button class="tab ${activeInboundTab==='grns'?'active':''}" onclick="switchInboundTab('grns')">GRNs</button>
      <button class="tab ${activeInboundTab==='grn-lines'?'active':''}" onclick="switchInboundTab('grn-lines')">GRN Lines</button>
      <button class="tab ${activeInboundTab==='putaway-tasks'?'active':''}" onclick="switchInboundTab('putaway-tasks')">Putaway Tasks</button>
      <button class="tab ${activeInboundTab==='discrepancies'?'active':''}" onclick="switchInboundTab('discrepancies')">Discrepancies</button>
    </div>

    <div id="inboundContent">${loadingHTML()}</div>
  `;

  loadInboundTab(activeInboundTab);
}

function switchInboundTab(tab) {
  activeInboundTab = tab;
  document.querySelectorAll('#inboundTabs .tab').forEach(t => t.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('#inboundTabs .tab')).find(b => {
    return b.getAttribute('onclick')?.includes(`'${tab}'`);
  });
  if (activeBtn) activeBtn.classList.add('active');

  loadInboundTab(tab);
}

async function loadInboundTab(tab) {
  const content = document.getElementById('inboundContent');
  if (!content) return;
  content.innerHTML = loadingHTML();

  try {
    const data = await api.get(`/inbound/${tab}/`);
    const count = data.count ?? data.results?.length ?? 0;
    const results = data.results || (Array.isArray(data) ? data : []);

    let tableHTML = '';

    if (tab === 'asns') {
      tableHTML = buildTable([
        { label: 'ASN Number', key: 'asn_no', isCode: true },
        { label: 'Inbound Type', key: 'type', badge: true },
        { label: 'Dest Site', key: 'dest_site_code' },
        { label: 'Total LPNs', key: 'total_lpns' },
        { label: 'Total Qty', key: 'total_qty' },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Created', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`ASN: ${row.asn_no}`, buildDetail(row)));

    } else if (tab === 'asn-lines') {
      tableHTML = buildTable([
        { label: 'Line ID', key: 'line_id', isCode: true },
        { label: 'ASN ID', key: 'asn_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'SKU Name', key: 'sku_name' },
        { label: 'Expected Qty', key: 'expected_qty' },
        { label: 'Received Qty', key: 'received_qty' },
        { label: 'MRP', key: 'mrp', format: fmtCurrency },
      ], results, row => openModal(`ASN Line Details`, buildDetail(row)));

    } else if (tab === 'grns') {
      tableHTML = buildTable([
        { label: 'GRN Number', key: 'grn_no', isCode: true },
        { label: 'ASN Ref', key: 'asn_no', isCode: true },
        { label: 'Dock Door', key: 'dock_door_code' },
        { label: 'Received Qty', key: 'total_received_qty' },
        { label: 'Accepted Qty', key: 'total_accepted_qty' },
        { label: 'Rejected Qty', key: 'total_rejected_qty' },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Created', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`GRN: ${row.grn_no}`, buildDetail(row)));

    } else if (tab === 'grn-lines') {
      tableHTML = buildTable([
        { label: 'GRN Line ID', key: 'grn_line_id', isCode: true },
        { label: 'GRN ID', key: 'grn_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'SKU Name', key: 'sku_name' },
        { label: 'Received Qty', key: 'received_qty' },
        { label: 'Accepted Qty', key: 'accepted_qty' },
        { label: 'Rejected Qty', key: 'rejected_qty' },
      ], results, row => openModal(`GRN Line Details`, buildDetail(row)));

    } else if (tab === 'putaway-tasks') {
      tableHTML = buildTable([
        { label: 'Task ID', key: 'task_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'LPN / Tote', key: 'lpn_code', format: v => `<span class="lpn-tag">${v}</span>` },
        { label: 'Source Bin', key: 'source_bin_code' },
        { label: 'Dest Bin', key: 'dest_bin_code', format: v => `<span class="bin-tag">${v}</span>` },
        { label: 'Qty', key: 'qty' },
        { label: 'Priority', key: 'priority', badge: true },
        { label: 'Status', key: 'status', badge: true },
      ], results, row => openModal(`Putaway Task`, buildDetail(row)));

    } else if (tab === 'discrepancies') {
      tableHTML = buildTable([
        { label: 'Ref Type', key: 'reference_type', badge: true },
        { label: 'Ref ID', key: 'reference_id', isCode: true },
        { label: 'SKU Code', key: 'sku_code', isCode: true },
        { label: 'Expected Qty', key: 'expected_qty' },
        { label: 'Actual Qty', key: 'actual_qty' },
        { label: 'Discrepancy', key: 'discrepancy_qty', format: v => `<span style="color:var(--c-rust);font-weight:700">${v}</span>` },
        { label: 'Status', key: 'status', badge: true },
        { label: 'Logged At', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Discrepancy Details`, buildDetail(row)));
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">INBOUND / ${tab.replace(/-/g, ' ').toUpperCase()}</div>
          <div class="card-subtitle">${count} records in queue</div>
        </div>
        ${tableHTML}
      </div>
    `;

  } catch (err) {
    content.innerHTML = `<div class="toast error" style="position:static">Failed loading inbound data [${tab}]: ${err.message}</div>`;
  }
}
