import React, { useState, useEffect } from 'react';
import { TabProvider, useTabs } from './context/TabContext';
import { useDarkStore } from '../views/darkstore/useDarkStore';
import Header from './components/layout/Header';
import TabBar from './components/layout/TabBar';
import Sidebar from './components/layout/Sidebar';
import ApiDiagnosticsModal from './components/ui/ApiDiagnosticsModal';
import TableFilterBar from './components/TableFilterBar';
import WorkflowWorkspace from './views/WorkflowWorkspace';

// Dark Store views
import CommandCenterView from './views/CommandCenterView';
import OrdersView from '../views/darkstore/OrdersView';
import OrderPickingView from '../views/darkstore/OrderPickingView';
import OrderPackingView from '../views/darkstore/OrderPackingView';
import RiderHandoffView from '../views/darkstore/RiderHandoffView';
import QcInspectionView from '../views/darkstore/QcInspectionView';
import PutawayView from '../views/inbound/PutawayView';
import CancellationPutawayView from '../views/darkstore/CancellationPutawayView';
import StorageOpsView from '../views/darkstore/StorageOpsView';
import EmployeeTrackingView from '../views/darkstore/EmployeeTrackingView';
import ReturnsView from '../views/darkstore/ReturnsView';
import RiderFleetView from '../views/darkstore/RiderFleetView';
import EmployeeRegisterView from '../views/darkstore/EmployeeRegisterView';
import AuthenticationView from '../views/darkstore/AuthenticationView';
import ProductRegistrationView from '../views/darkstore/ProductRegistrationView';
import StockLedgerView from '../views/darkstore/StockLedgerView';
import ServiceAreasView from './views/ServiceAreasView';
import CashRegisterView from '../views/darkstore/CashRegisterView';
import NotificationInboxView from '../views/NotificationInboxView';
import PricingOffersView from '../views/darkstore/PricingOffersView';

// Only storage bins remain available from the shared master-data surface in
// the Dark Store console; catalog/configuration administration belongs to the
// WMS console.
import MasterDataView from '../wms-console/views/master/MasterDataView';
import InboundView from '../wms-console/views/inbound/InboundView';
import LotsView from '../wms-console/views/inventory/LotsView';

import './index.css';

function AppContent({ user, logout }) {
  const { activeTabId } = useTabs();
  const { site, reason } = useDarkStore();
  // On phones the sidebar starts as an icon rail; the header toggle opens it
  // as an overlay so tables and workflows keep the full screen width.
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 900
  );
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    document.body.classList.remove('theme-parchment');
    localStorage.removeItem('zippzo_theme');
  }, []);

  const renderActiveView = () => {
    switch (activeTabId) {
      // Store Operations
      case 'ds-command-center':
      case 'ds-metrics-dashboard':
        return <CommandCenterView onOpenDiagnostics={() => setShowDiagnostics(true)} />;
      case 'ds-orders':
        return <OrdersView />;
      case 'ds-employee-tracking':
        return <EmployeeTrackingView />;
      case 'ds-pricing-offers':
        return <PricingOffersView site={site} />;

      case 'ds-inbound-workflow':
        return <WorkflowWorkspace workflow="inbound" site={site} />;
      case 'ds-inventory-workflow':
        return <WorkflowWorkspace workflow="inventory" site={site} />;
      case 'ds-product-registration':
        return <ProductRegistrationView />;
      case 'ds-outbound-workflow':
        return <WorkflowWorkspace workflow="outbound" site={site} />;

      // Inbound
      case 'ds-inbound-asns':
      case 'ds-inbound-grns':
      case 'ds-inbound-discrepancies':
        return (
          <InboundView
            initialSubtab={activeTabId.replace('ds-inbound-', '')}
            darkStoreSiteId={site?.site_id || ''}
            darkStoreMode
          />
        );
      case 'ds-inbound-putaway':
      case 'ds-shelf-putaway':
        return <PutawayView siteId={site?.site_id || ''} darkStoreMode />;
      // Bundle receipt is the same scan surface the WMS uses: the label is
      // scanned or pasted, resolved against the LPN, and posted to
      // /ds-ops/receive-lpn which is idempotent per facility.
      case 'ds-lpn-receipt':
        return (
          <InboundView
            initialSubtab="asns"
            darkStoreSiteId={site?.site_id || ''}
            darkStoreMode
          />
        );
      case 'ds-qc-inspection':
        return <QcInspectionView />;
      case 'ds-cancellation-putaway':
        return <CancellationPutawayView />;

      // Outbound
      case 'ds-picking':
        return <OrderPickingView />;
      case 'ds-packing':
        return <OrderPackingView />;
      case 'ds-rider-handoff':
        return <RiderHandoffView />;

      // Inventory
      case 'ds-shelf-inventory':
      case 'ds-inventory-lots':
        return <LotsView initialTab="inventory-lots" siteId={site?.site_id || ''} siteCode={site?.code || ''} darkStoreMode />;
      case 'ds-customer-availability':
        return <LotsView initialTab="customer-availability" siteId={site?.site_id || ''} siteCode={site?.code || ''} darkStoreMode />;
      case 'ds-transactions':
        return <StockLedgerView />;
      case 'ds-droplists':
        return <LotsView initialTab="droplists" siteId={site?.site_id || ''} darkStoreMode />;
      case 'ds-stock-ledger':
        return <StockLedgerView />;
      case 'ds-cycle-counts':
        return <StorageOpsView initialTab="cycle-counts" />;
      case 'ds-replenishment':
        return <StorageOpsView initialTab="replenishment" />;

      // Storage
      case 'ds-storage-locations':
        return <StorageOpsView initialTab="locations" />;
      case 'ds-bin-transfers':
        return <StorageOpsView initialTab="bin-transfers" />;

      // Storage
      case 'ds-bins':
        return <MasterDataView initialTab="bins" allowedTabs={['bins']} siteId={site?.site_id || ''} description="Create and manage storage bins at this dark store." darkStoreMode />;

      // Returns & QC
      case 'ds-returns':
        return <ReturnsView />;

      // Rider
      case 'ds-rider-fleet':
        return <RiderFleetView />;

      // Store operations that remain in the Dark Store console
      case 'ds-authentication':
        return <AuthenticationView />;
      case 'ds-employee-register':
        return <EmployeeRegisterView />;
      case 'ds-notifications':
        return <NotificationInboxView />;
      case 'ds-cash-register':
        return <CashRegisterView />;
      case 'ds-service-areas':
        return <ServiceAreasView />;

      default:
        return <CommandCenterView />;
    }
  };

  return (
    <div className="app-container">
      <Sidebar collapsed={collapsed} />
      <div className="app-main">
        <Header
          user={user}
          logout={logout}
          onToggleSidebar={() => setCollapsed(prev => !prev)}
          facilityLabel={site
            ? `${site.network_code || 'DARK STORE'} | ${site.code || 'STORE'}${site.name ? ` - ${site.name}` : ''}`
            : `DARK STORE | ${reason || 'Select facility'}`}
        />
        <TabBar />
        <main className="workspace-viewport">
          <TableFilterBar />
          {renderActiveView()}
        </main>
      </div>
      {showDiagnostics && (
        <ApiDiagnosticsModal onClose={() => setShowDiagnostics(false)} />
      )}
    </div>
  );
}

export default function App({ user, logout }) {
  const role = String(user?.role || '').toUpperCase();
  const start = role.includes('PICK') || role.includes('FULFIL')
    ? { id: 'ds-picking', title: 'Picking', view: 'OrderPickingView', closable: false }
    : role.includes('INBOUND') || role.includes('RECEIV')
      ? { id: 'ds-inbound-asns', title: 'Inbound', view: 'InboundView', initialSubtab: 'asns', closable: false }
      : { id: 'ds-command-center', title: 'Overview', view: 'CommandCenterView', closable: false };
  return (
    <TabProvider initialTabs={[start]} initialActiveTabId={start.id}>
      <AppContent user={user} logout={logout} />
    </TabProvider>
  );
}
