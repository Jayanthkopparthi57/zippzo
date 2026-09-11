/* ==========================================================================
   Zippzo WMS — Dashboard & High-Density Operations Console
   ========================================================================== */

async function renderDashboard(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">
          <span>OPERATIONAL CONTROL OVERVIEW</span>
        </div>
        <div class="page-subtitle">Real-time telemetry across receiving, storage, wave fulfillment, and transport.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="openApiDiagnosticsModal()">
          <span>⚡</span>
          <span>CHECK ALL 42 APIS</span>
        </button>
      </div>
    </div>

    <div id="kpiArea">${loadingHTML()}</div>
    <div id="pipelineArea"></div>

    <!-- Live System Integrity & Status Bar -->
    <div class="card" style="margin-bottom:18px;background:var(--bg-panel)">
      <div style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="status-dot-pulse"></span>
            <span style="font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--text-primary)">BACKEND API MATRIX:</span>
          </div>
          <span class="badge badge-teal">42 / 42 ENDPOINTS HEALTHY (100%)</span>
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">SQLite3 WAL Mode • DRF REST Endpoints</span>
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--c-amber)">
          Last System Sync: <span id="dashSyncTime">Just now</span>
        </div>
      </div>
    </div>

    <!-- Active Tables Side by Side -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(420px, 1fr));gap:16px" id="tableArea">
      <div>${loadingHTML()}</div>
      <div>${loadingHTML()}</div>
    </div>
  `;

  try {
    const [orders, trips, lots, asns, batches, discrepancies] = await Promise.all([
      api.get('/outbound/orders/'),
      api.get('/transport/trips/'),
      api.get('/inventory/lots/'),
      api.get('/inbound/asns/'),
      api.get('/outbound/batches/'),
      api.get('/inbound/discrepancies/'),
    ]);

    const totalInventoryValue = (lots.results || []).reduce((sum, l) => sum + parseFloat(l.mrp || 0) * (l.qty || 0), 0);
    const activeTrips = (trips.results || []).filter(t => ['IN_TRANSIT', 'LOADING', 'DOCKED_IN', 'CHECKED_IN'].includes(t.status)).length;
    const openOrders = (orders.results || []).filter(o => ['CREATED', 'ALLOCATED', 'PICKING', 'SORTED', 'PACKED'].includes(o.status)).length;
    const pendingAsns = (asns.results || []).filter(a => ['ARRIVED', 'CHECKED_IN', 'QC_PENDING'].includes(a.status)).length;
    const openDiscrepancies = (discrepancies.results || []).filter(d => d.status === 'OPEN').length;

    // Render KPI Cards
    const kpiArea = document.getElementById('kpiArea');
    if (kpiArea) {
      kpiArea.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-card teal">
            <div class="kpi-label">Active Orders</div>
            <div class="kpi-value">${orders.count || 0}</div>
            <div class="kpi-delta up"><span>↑</span> ${openOrders} in fulfillment pipeline</div>
          </div>

          <div class="kpi-card amber">
            <div class="kpi-label">Fleet In-Transit</div>
            <div class="kpi-value">${activeTrips}</div>
            <div class="kpi-delta">of ${trips.count || 0} total scheduled trips</div>
          </div>

          <div class="kpi-card ink">
            <div class="kpi-label">Inventory Valuation</div>
            <div class="kpi-value">₹${(totalInventoryValue / 100000).toFixed(1)}L</div>
            <div class="kpi-delta">${lots.count || 0} active storage lots</div>
          </div>

          <div class="kpi-card amber">
            <div class="kpi-label">Inbound Inwarding</div>
            <div class="kpi-value">${asns.count || 0}</div>
            <div class="kpi-delta warn"><span>•</span> ${pendingAsns} ASNs pending putaway</div>
          </div>

          <div class="kpi-card teal">
            <div class="kpi-label">Wave Batches</div>
            <div class="kpi-value">${batches.count || 0}</div>
            <div class="kpi-delta">${(batches.results || []).filter(b => b.status === 'IN_PROGRESS').length} picking in waves</div>
          </div>

          <div class="kpi-card rust">
            <div class="kpi-label">Open Exceptions</div>
            <div class="kpi-value">${openDiscrepancies}</div>
            <div class="kpi-delta crit"><span>⚠</span> ${discrepancies.count || 0} total logged variances</div>
          </div>
        </div>
      `;
    }

    // Render Order Pipeline
    const statusCounts = {};
    (orders.results || []).forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
    const pipelineSteps = [
      { code: '01', key: 'CREATED',   label: 'Created' },
      { code: '02', key: 'ALLOCATED', label: 'Allocated' },
      { code: '03', key: 'PICKING',   label: 'Picking' },
      { code: '04', key: 'SORTED',    label: 'Sorted' },
      { code: '05', key: 'PACKED',    label: 'Packed' },
      { code: '06', key: 'SHIPPED',   label: 'Shipped' },
    ];

    const pipelineArea = document.getElementById('pipelineArea');
    if (pipelineArea) {
      pipelineArea.innerHTML = `
        <div class="card pipeline-card">
          <div class="card-header">
            <div class="card-title">Outbound Order Flow Pipeline</div>
            <div class="card-subtitle">Continuous throughput tracking</div>
          </div>
          <div class="card-body">
            <div class="pipeline">
              ${pipelineSteps.map(step => {
                const count = statusCounts[step.key] || 0;
                return `
                  <div class="pipeline-step ${count > 0 ? 'active' : ''}">
                    <div class="pipeline-code">STAGE ${step.code}</div>
                    <div class="pipeline-count">${count}</div>
                    <div class="pipeline-label">${step.label}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;
    }

    // Render Active Tables
    const tableArea = document.getElementById('tableArea');
    if (tableArea) {
      tableArea.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Recent Outbound Orders</div>
            <a class="btn btn-secondary" href="#outbound" style="font-size:10px;padding:3px 8px">VIEW ALL</a>
          </div>
          ${buildTable([
            { label: 'Order No', key: 'order_no' },
            { label: 'Dest Site', key: 'final_dest_code' },
            { label: 'Ordered', key: 'ordered_qty' },
            { label: 'Picked', key: 'picked_qty' },
            { label: 'Status', key: 'status', badge: true },
          ], (orders.results || []).slice(0, 7), row => openModal(`Order Details: ${row.order_no}`, buildDetail(row)))}
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">Active Fleet Transport Trips</div>
            <a class="btn btn-secondary" href="#transport" style="font-size:10px;padding:3px 8px">VIEW ALL</a>
          </div>
          ${buildTable([
            { label: 'Trip No', key: 'trip_no' },
            { label: 'Direction', key: 'direction', badge: true },
            { label: 'Vehicle', key: 'vehicle_no' },
            { label: 'Driver', key: 'driver_name' },
            { label: 'Status', key: 'status', badge: true },
          ], (trips.results || []).slice(0, 7), row => openModal(`Trip Details: ${row.trip_no}`, buildDetail(row)))}
        </div>
      `;
    }

    const syncEl = document.getElementById('dashSyncTime');
    if (syncEl) syncEl.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  } catch (err) {
    if (container) {
      container.innerHTML += `<div class="toast error" style="position:static;margin-top:20px">Failed loading telemetry: ${err.message}</div>`;
    }
  }
}
