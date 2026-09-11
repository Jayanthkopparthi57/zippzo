/* ==========================================================================
   Zippzo WMS — Platform & User Administration (2/2 APIs)
   ========================================================================== */

let activePlatformTab = 'users';

async function renderPlatform(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">PLATFORM ROLES & SYSTEM REASON CODES</div>
        <div class="page-subtitle">Warehouse operators (Picker, Packer, Sorter, GRN, Supervisor) and operational exception reason taxonomy.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="loadPlatformTab(activePlatformTab)">
          <span>↺</span>
          <span>REFRESH</span>
        </button>
      </div>
    </div>

    <div class="tabs" id="platformTabs">
      <button class="tab ${activePlatformTab==='users'?'active':''}" onclick="switchPlatformTab('users')">Operators & Users</button>
      <button class="tab ${activePlatformTab==='reason-codes'?'active':''}" onclick="switchPlatformTab('reason-codes')">Reason Codes</button>
    </div>

    <div id="platformContent">${loadingHTML()}</div>
  `;

  loadPlatformTab(activePlatformTab);
}

function switchPlatformTab(tab) {
  activePlatformTab = tab;
  document.querySelectorAll('#platformTabs .tab').forEach(t => t.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('#platformTabs .tab')).find(b => {
    return b.getAttribute('onclick')?.includes(`'${tab}'`);
  });
  if (activeBtn) activeBtn.classList.add('active');

  loadPlatformTab(tab);
}

async function loadPlatformTab(tab) {
  const content = document.getElementById('platformContent');
  if (!content) return;
  content.innerHTML = loadingHTML();

  try {
    const data = await api.get(`/platform/${tab}/`);
    const count = data.count ?? data.results?.length ?? 0;
    const results = data.results || (Array.isArray(data) ? data : []);

    let tableHTML = '';

    if (tab === 'users') {
      tableHTML = buildTable([
        { label: 'Employee Code', key: 'emp_code', isCode: true },
        { label: 'Full Display Name', key: 'name' },
        { label: 'Operational Role', key: 'role', badge: true },
        { label: 'Phone Number', key: 'phone' },
        { label: 'Assigned Site', key: 'site_id', isCode: true },
        { label: 'Account Status', key: 'status', badge: true },
        { label: 'Registered', key: 'created_at', format: fmtDate },
      ], results, row => openModal(`Operator: ${row.name} (${row.emp_code})`, buildDetail(row)));

    } else if (tab === 'reason-codes') {
      tableHTML = buildTable([
        { label: 'Reason Code', key: 'code', isCode: true },
        { label: 'Category', key: 'category', badge: true },
        { label: 'Description & Action', key: 'description' },
        { label: 'Photo Required', key: 'requires_photo', format: v => v ? '✓ MANDATORY' : '—' },
        { label: 'Remark Required', key: 'requires_remark', format: v => v ? '✓ MANDATORY' : '—' },
      ], results, row => openModal(`Reason Code: ${row.code}`, buildDetail(row)));
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">PLATFORM / ${tab.toUpperCase()}</div>
          <div class="card-subtitle">${count} system administrative records</div>
        </div>
        ${tableHTML}
      </div>
    `;

  } catch (err) {
    content.innerHTML = `<div class="toast error" style="position:static">Failed loading platform data [${tab}]: ${err.message}</div>`;
  }
}
