import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TabProvider, useTabs } from './context/TabContext';
import Header from './components/layout/Header';
import TabBar from './components/layout/TabBar';
import Sidebar from './components/layout/Sidebar';
import ApiDiagnosticsModal from './components/ui/ApiDiagnosticsModal';
import LoginView from './views/auth/LoginView';

// Views
import InboundView from './views/inbound/InboundView';
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

function AppContent() {
  const { activeTabId } = useTabs();
  const [collapsed, setCollapsed] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

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
      case 'inbound-putaway':
        return <InboundView initialSubtab="putaway" />;
      case 'inbound-discrepancies':
        return <InboundView initialSubtab="discrepancies" />;

      // Outbound
      case 'sto':
      case 'transfer-orders':
      case 'returns':
      case 'cancellation-putaway':
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
        return <InboundView initialSubtab="asns" />;

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
          onToggleSidebar={() => setCollapsed(prev => !prev)}
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

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center', padding: '40px' }}>
          <div className="login-logo-badge" style={{ margin: '0 auto 12px' }}>Z</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <TabProvider>
      <AppContent />
    </TabProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
