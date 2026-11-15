import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TabProvider, useTabs } from './context/TabContext';
import { ToastProvider } from './components/ui/Toast';
import Header from './components/layout/Header';
import TabBar from './components/layout/TabBar';
import Sidebar from './components/layout/Sidebar';
import BarcodeScannerModal from './components/ui/BarcodeScannerModal';
import AppAuthGate from './apps/AuthGate';

import DashboardView from './views/dashboard/DashboardView';
import InboundView from './views/inbound/InboundView';
import StoView from './views/outbound/StoView';
import PicklistView from './views/outbound/PicklistView';
import DispatchPlanView from './views/outbound/DispatchPlanView';
import VehicleAssignmentView from './views/linehaul/VehicleAssignmentView';
import ActiveTripsView from './views/linehaul/ActiveTripsView';
import LotsView from './views/inventory/LotsView';
import MasterDataView from './views/master/MasterDataView';
import StoreManagementView from './views/store/StoreManagementView';
import ManPowerView from './views/metrics/ManPowerView';

import ApiDiagnosticsModal from './components/ui/ApiDiagnosticsModal';
import BinContentsView from './views/BinContentsView';
import BinTransferView from './views/BinTransferView';
import PackSealView from './views/replenishment/PackSealView';
import ScanPickingView from './views/outbound/ScanPickingView';

// ── Inbound sub-views ──────────────────────────────────────────────
import InboundReceivingView from './views/inbound/InboundReceivingView';
import QcInspectionView from './views/inbound/QcInspectionView';
import PutawayView from './views/inbound/PutawayView';
import InboundLedgerView from './views/inbound/InboundLedgerView';

// ── Outbound sub-views ─────────────────────────────────────────────
import DispatchView from './views/outbound/DispatchView';
import PickQueuesView from './views/outbound/PickQueuesView';
import OutboundLedgerView from './views/outbound/OutboundLedgerView';
import PackingView from './views/PackingView';

// ── Storage / Bin ──────────────────────────────────────────────────
import BinLookupView from './views/storage/BinLookupView';

// ── Replenishment Workflows ────────────────────────────────────────
import CreateOrderView from './views/replenishment/CreateOrderView';
import PickExecutionView from './views/replenishment/PickExecutionView';



function AppContent() {
  const { activeTabId, operationalMode } = useTabs();
  const [collapsed, setCollapsed] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

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
      case 'asns':
      case 'inbound-receiving':
        return <InboundReceivingView />;
      case 'qc-testing':
      case 'inbound-qc':
        return <QcInspectionView />;
      case 'putaway-tasks':
      case 'inbound-putaway':
        return <PutawayView />;
      case 'inbound-discrepancies':
        return <InboundView initialSubtab="discrepancies" />;
      case 'inbound-ledger':
        return <InboundLedgerView />;

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
      case 'pick-queues':
        return <PickQueuesView />;
      case 'scan-picking':
        return <ScanPickingView />;
      case 'packing':
        return <PackingView />;
      case 'dispatch-plan':
      case 'manifests':
      case 'totes-lpns':
        return <DispatchPlanView initialTab={activeTabId} />;
      case 'dispatch':
      case 'dispatch-trips':
        return <DispatchView />;
      case 'outbound-ledger':
        return <OutboundLedgerView />;
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

      // Storage / Bins
      case 'bin-lookup':
        return <BinLookupView />;
      case 'bin-transfer':
        return <BinTransferView />;
      case 'bin-contents':
        return <BinContentsView />;

      // Replenishment Workflows
      case 'create-order':
      case 'create-orders':
        return <CreateOrderView />;
      case 'pick-execution':
        return <PickExecutionView />;

      // Master Configs & Catalog
      case 'sites':
      case 'bins':
      case 'zones':
      case 'dock-doors':
      case 'cluster-zones':
      case 'vehicle-types':
      case 'skus':
      case 'categories':
      case 'vendors':
      case 'transporters':
      case 'users':
      case 'reason-codes':
        return <MasterDataView initialTab={activeTabId} />;



      // Pack & Seal (also part of replenishment/outbound)
      case 'pack-seal':
        return <PackSealView />;

      default:
        return <DashboardView onOpenDiagnostics={() => setShowDiagnostics(true)} />;
    }
  };

  return (
    <div className="app-container">
      <Sidebar collapsed={collapsed} />
      <div className="app-main">
        <Header
          onToggleSidebar={() => setCollapsed(prev => !prev)}
          onOpenScanner={() => setShowScannerModal(true)}
        />
        <TabBar />
        <main className="workspace-viewport">
          {renderActiveView()}
        </main>
      </div>
      {showScannerModal && (
        <BarcodeScannerModal onClose={() => setShowScannerModal(false)} />
      )}
      {showDiagnostics && (
        <ApiDiagnosticsModal onClose={() => setShowDiagnostics(false)} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider appKey="wms">
        <AppAuthGate appKey="wms">
          <TabProvider>
            <AppContent />
          </TabProvider>
        </AppAuthGate>
      </AuthProvider>
    </ToastProvider>
  );
}
