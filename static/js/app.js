/* ==========================================================================
   Zippzo WMS — Core Application Controller & Router
   ========================================================================== */

const views = {
  dashboard:  renderDashboard,
  inbound:    renderInbound,
  inventory:  renderInventory,
  outbound:   renderOutbound,
  transport:  renderTransport,
  crossdock:  renderCrossdock,
  master:     renderMaster,
  platform:   renderPlatform,
  optional:   renderOptional,
};

let currentView = 'dashboard';

function navigate(view) {
  if (!views[view]) view = 'dashboard';
  currentView = view;

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });

  // Update breadcrumb
  const labels = {
    dashboard: 'Dashboard & Metrics',
    inbound:   'Inbound Dock & Receiving',
    inventory: 'Inventory & Storage Lots',
    outbound:  'Outbound Fulfillment & Waves',
    transport: 'Transport & Fleet Logistics',
    crossdock: 'Cross Dock Consolidation',
    master:    'Master Data Architecture',
    platform:  'Platform & Users',
    optional:  'Optional & Cycle Count',
  };
  const bcEl = document.getElementById('breadcrumb');
  if (bcEl) bcEl.textContent = labels[view] || view;

  // Render view
  const container = document.getElementById('viewContainer');
  if (container) {
    container.innerHTML = '';
    views[view](container);
  }

  // Update browser hash without page reload
  if (location.hash.slice(1) !== view) {
    history.pushState({}, '', '#' + view);
  }
}

// Nav item click handlers
document.querySelectorAll('.nav-item').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    navigate(a.dataset.view);
  });
});

// Sidebar menu toggle
const menuToggle = document.getElementById('menuToggle');
if (menuToggle) {
  menuToggle.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
}

// API Diagnostics Triggers
const openApiDiagBtn = document.getElementById('openApiDiagBtn');
if (openApiDiagBtn) {
  openApiDiagBtn.addEventListener('click', openApiDiagnosticsModal);
}
const sidebarApiDiag = document.getElementById('sidebarApiDiag');
if (sidebarApiDiag) {
  sidebarApiDiag.addEventListener('click', (e) => {
    e.preventDefault();
    openApiDiagnosticsModal();
  });
}

// Theme Toggle (Tactile Ink / Warm Parchment)
const themeBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeToggleIcon');
const themeLabel = document.getElementById('themeToggleLabel');

function applyTheme(isParchment) {
  if (isParchment) {
    document.body.classList.add('theme-parchment');
    if (themeIcon) themeIcon.textContent = '☾';
    if (themeLabel) themeLabel.textContent = 'Ink';
    localStorage.setItem('zippzo_theme', 'parchment');
  } else {
    document.body.classList.remove('theme-parchment');
    if (themeIcon) themeIcon.textContent = '☼';
    if (themeLabel) themeLabel.textContent = 'Parchment';
    localStorage.setItem('zippzo_theme', 'ink');
  }
}

if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const isParchment = !document.body.classList.contains('theme-parchment');
    applyTheme(isParchment);
  });
}

// Global Search keyboard shortcut (press '/' to focus)
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    const gs = document.getElementById('globalSearch');
    if (gs) gs.focus();
  }
});

// Topbar Global Search triggers the active view table filter
const globalSearch = document.getElementById('globalSearch');
if (globalSearch) {
  globalSearch.addEventListener('input', (e) => {
    const q = e.target.value;
    const tableFilter = document.querySelector('.table-filter-input');
    if (tableFilter) {
      tableFilter.value = q;
      tableFilter.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

// Site Selector change
const siteSelect = document.getElementById('siteSelect');
if (siteSelect) {
  const savedSite = localStorage.getItem('zippzo_site');
  if (savedSite) siteSelect.value = savedSite;
  siteSelect.addEventListener('change', (e) => {
    localStorage.setItem('zippzo_site', e.target.value);
    showToast(`Active warehouse site changed to ${e.target.value}`, 'info');
    navigate(currentView);
  });
}

// Initialize on window load
window.addEventListener('load', () => {
  const savedTheme = localStorage.getItem('zippzo_theme');
  if (savedTheme === 'parchment') {
    applyTheme(true);
  }

  const hash = location.hash.slice(1);
  navigate(views[hash] ? hash : 'dashboard');
});

window.addEventListener('popstate', () => {
  const hash = location.hash.slice(1);
  navigate(views[hash] ? hash : 'dashboard');
});
