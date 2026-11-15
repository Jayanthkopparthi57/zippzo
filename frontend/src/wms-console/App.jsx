import React, { useState, useEffect } from 'react';
import { TabProvider, useTabs } from './context/TabContext';
import Header from './components/layout/Header';
import TabBar from './components/layout/TabBar';
import Sidebar from './components/layout/Sidebar';
import ApiDiagnosticsModal from './components/ui/ApiDiagnosticsModal';
import { useAuth } from '../context/AuthContext';

// Views
import InboundView from './views/inbound/InboundView';
import CrossDockView from './views/inbound/CrossDockView';
import StoView from './views/outbound/StoView';
import VehicleAssignmentView from './views/linehaul/VehicleAssignmentView';
import DispatchPlanView from './views/outbound/DispatchPlanView';
import ActiveTripsView from './views/linehaul/ActiveTripsView';
import PicklistView from './views/outbound/PicklistView';
import LotsView from './views/inventory/LotsView';
import MasterDataView from './views/master/MasterDataView';
import DashboardView from './views/dashboard/DashboardView';
import StoreManagementView from './views/store/StoreManagementView';
import ManPowerView from './views/metrics/ManPowerView';

// The console design system from the committed WMS console. It is imported
// here (after the shared app stylesheet in the entry point) so the client's
// approved visual language wins for the warehouse shell.
import './index.css';

function AppContent({ user, logout }) {
  const { activeTabId } = useTabs();
  const { facility, facilitiesList } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Resolve the warehouse the operator is actually assigned to. The session
  // facility is a code, so it is matched against the real site directory; a
  // network with exactly one mother hub is unambiguous even if the session
  // never picked one. Nothing is invented when it cannot be resolved.
  const warehouses = facilitiesList?.warehouses || [];
  const activeFacility = (() => {
    const wanted = String(facility?.code || '').trim().toUpperCase();
    if (wanted) {
      const exact = warehouses.find(s => String(s.code || '').trim().toUpperCase() === wanted);
      if (exact) return exact;
    }
    if (warehouses.length === 1) return warehouses[0];
    return facility || null;
  })();
  const facilityLabel = activeFacility
    ? `${activeFacility.network_code || 'WMS'} | ${activeFacility.code || 'FACILITY'}${activeFacility.name ? ` - ${activeFacility.name}` : ''}`
    : 'WMS | Select facility';

  useEffect(() => {
    document.body.classList.remove('theme-parchment');
    localStorage.removeItem('zippzo_theme');
  }, []);

  const renderActiveView = () => {
    switch (activeTabId) {
      // Store Operations Management
      case 'store-management':
        return <StoreManagementView />;
      case 'man-power':
        return <ManPowerView />;
      // Inbound
      case 'inbound-asns':
        return <InboundView initialSubtab="asns" />;
      case 'inbound-grns':
        return <InboundView initialSubtab="grns" />;
      case 'inbound-qc':
        return <InboundView initialSubtab="qc" />;
      case 'inbound-putaway':
        return <InboundView initialSubtab="putaway" />;
      case 'inbound-discrepancies':
        return <InboundView initialSubtab="discrepancies" />;

      // Outbound
      case 'sto':
      case 'transfer-orders':
        return <StoView initialTab={activeTabId} />;
      case 'picklists':
      case 'batches':
      case 'sorting-list':
        return <PicklistView initialTab={activeTabId} />;
      case 'dispatch-plan':
      case 'manifests':
      case 'totes-lpns':
        return <DispatchPlanView initialTab={activeTabId} />;
      case 'cross-dock':
        return <CrossDockView />;

      // Linehaul Transport
      case 'vehicle-assign':
        return <VehicleAssignmentView />;
      case 'active-trips':
      case 'all-trips':
      case 'vehicle-checkin':
        return <ActiveTripsView />;

      // Inventory
      case 'inventory-lots':
      case 'transactions':
      case 'droplists':
      case 'cycle-counts':
      case 'replenishment':
        return <LotsView initialTab={activeTabId} />;

      // Master Configs & Catalog
      case 'sites':
      case 'bins':
      case 'zones':
      case 'dock-doors':
      case 'cluster-zones':
      case 'vehicle-types':
        return <MasterDataView initialTab={activeTabId} />;

      case 'skus':
      case 'categories':
      case 'vendors':
      case 'transporters':
        return <MasterDataView initialTab={activeTabId} />;

      case 'users':
      case 'reason-codes':
        return <MasterDataView initialTab={activeTabId} />;

      // Dashboard
      case 'metrics-dashboard':
        return <DashboardView onOpenDiagnostics={() => setShowDiagnostics(true)} />;

      default:
        return <DashboardView onOpenDiagnostics={() => setShowDiagnostics(true)} />;
    }
  };

  return (
    <div className="app-container">
      {/* Hierarchical Accordion Sidebar */}
      <Sidebar collapsed={collapsed} />

      {/* Main Column */}
      <div className="app-main">
        {/* Top Facility Header */}
        <Header
          user={user}
          logout={logout}
          onToggleSidebar={() => setCollapsed(prev => !prev)}
          facilityLabel={facilityLabel}
        />

        {/* Zepto Multi-Tab MDI Bar */}
        <TabBar />

        {/* Active Tab Viewport */}
        <main className="workspace-viewport">
          {renderActiveView()}
        </main>
      </div>

      {/* 42-API Diagnostics Matrix Modal */}
      {showDiagnostics && (
        <ApiDiagnosticsModal onClose={() => setShowDiagnostics(false)} />
      )}
    </div>
  );
}

/**
 * WMS console shell. Authentication and session state come from the shared
 * application AuthContext (AuthGate wraps this component); only the visual
 * shell and tab workspace are owned here.
 */
export default function App({ user, logout }) {
  const role = user?.role;
  const startId = role === 'WAREHOUSE_STAFF' ? 'inbound-asns' : 'metrics-dashboard';
  const startTab = role === 'WAREHOUSE_STAFF'
    ? [{ id: 'inbound-asns', title: 'Inbound', view: 'InboundView', initialSubtab: 'asns', closable: false }]
    : undefined;
  return (
    <TabProvider initialTabs={startTab} initialActiveTabId={startId}>
      <AppContent user={user} logout={logout} />
    </TabProvider>
  );
}
