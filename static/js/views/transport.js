/* ==========================================================================
   Zippzo WMS — Transport & Fleet Logistics (3/3 APIs)
   ========================================================================== */

let activeTransportTab = 'trips';

async function renderTransport(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">FLEET TRANSPORT & VEHICLE CHECK-INS</div>
        <div class="page-subtitle">Trip manifests, gate vehicle inspections (DL/RC), and return leg turnaround operations.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="loadTransportTab(activeTransportTab)">
          <span>↺</span>
          <span>REFRESH</span>
        </button>
      </div>
    </div>

    <div class="tabs" id="transportTabs">
      <button class="tab ${activeTransportTab==='trips'?'active':''}" onclick="switchTransportTab('trips')">Scheduled Trips</button>
      <button class="tab ${activeTransportTab==='vehicle-checkins'?'active':''}" onclick="switchTransportTab('vehicle-checkins')">Vehicle Check-ins</button>
      <button class="tab ${activeTransportTab==='trip-return-legs'?'active':''}" onclick="switchTransportTab('trip-return-legs')">Return Legs</button>
    </div>

    <div id="transportContent">${loadingHTML()}</div>
  `;

  loadTransportTab(activeTransportTab);
}

function switchTransportTab(tab) {
  activeTransportTab = tab;
  document.querySelectorAll('#transportTabs .tab').forEach(t => t.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('#transportTabs .tab')).find(b => {
    return b.getAttribute('onclick')?.includes(`'${tab}'`);
  });
  if (activeBtn) activeBtn.classList.add('active');

  loadTransportTab(tab);
}

async function loadTransportTab(tab) {
  const content = document.getElementById('transportContent');
  if (!content) return;
  content.innerHTML = loadingHTML();

  try {
    const data = await api.get(`/transport/${tab}/`);
    const count = data.count ?? data.results?.length ?? 0;
    const results = data.results || (Array.isArray(data) ? data : []);

    let tableHTML = '';

    if (tab === 'trips') {
      tableHTML = buildTable([
        { label: 'Trip Number', key: 'trip_no', isCode: true },
        { label: 'Direction', key: 'direction', badge: true },
        { label: 'Dest Facility', key: 'dest_site' },
        { label: 'Vehicle Plate', key: 'vehicle_no', isCode: true },
        { label: 'Driver', key: 'driver_name' },
        { label: 'LPNs Loaded', key: 'lpns_loaded' },
        { label: 'Delay Telemetry', key: 'delay_status', badge: true },
        { label: 'GPS Tracking', key: 'gps_status', badge: true },
        { label: 'Trip Status', key: 'status', badge: true },
      ], results, row => openModal(`Trip: ${row.trip_no}`, buildDetail(row)));

    } else if (tab === 'vehicle-checkins') {
      tableHTML = buildTable([
        { label: 'Vehicle Number', key: 'vehicle_no', isCode: true },
        { label: 'Trip Ref', key: 'trip_no', isCode: true },
        { label: 'Gate Direction', key: 'direction', badge: true },
        { label: 'Driver Name', key: 'driver_name' },
        { label: 'DL Validated', key: 'dl_valid', format: v => v ? '✓ VALID' : '<span style="color:var(--c-rust)">✕ INVALID</span>' },
        { label: 'RC Validated', key: 'rc_valid', format: v => v ? '✓ VALID' : '<span style="color:var(--c-rust)">✕ INVALID</span>' },
        { label: 'Check-in Time', key: 'checkin_time', format: fmtDate },
        { label: 'Gate Status', key: 'status', badge: true },
      ], results, row => openModal(`Vehicle Check-in: ${row.vehicle_no}`, buildDetail(row)));

    } else if (tab === 'trip-return-legs') {
      tableHTML = buildTable([
        { label: 'Return Leg ID', key: 'leg_id', isCode: true },
        { label: 'Trip Ref', key: 'trip_no', isCode: true },
        { label: 'Origin Site', key: 'origin_site' },
        { label: 'Return Dest', key: 'dest_site' },
        { label: 'Return LPNs', key: 'return_lpn_count' },
        { label: 'Cutoff Met', key: 'dock_cutoff_met', format: v => v ? '✓ ON-TIME' : '<span style="color:var(--c-rust)">✕ BREACH</span>' },
        { label: 'Leg Status', key: 'status', badge: true },
      ], results, row => openModal(`Trip Return Leg: ${row.trip_no}`, buildDetail(row)));
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">TRANSPORT / ${tab.replace(/-/g, ' ').toUpperCase()}</div>
          <div class="card-subtitle">${count} fleet logs</div>
        </div>
        ${tableHTML}
      </div>
    `;

  } catch (err) {
    content.innerHTML = `<div class="toast error" style="position:static">Failed loading transport data [${tab}]: ${err.message}</div>`;
  }
}
