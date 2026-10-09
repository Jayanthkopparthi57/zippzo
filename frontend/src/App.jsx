import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TabProvider, useTabs } from './context/TabContext';
import Header from './components/layout/Header';
import TabBar from './components/layout/TabBar';
import Sidebar from './components/layout/Sidebar';
import BarcodeScannerModal from './components/ui/BarcodeScannerModal';
import LoginView from './views/auth/LoginView';
import DashboardView from './views/DashboardView';
// PickListView import removed — not rendered in renderActiveView (dead import)
import InboundView from './views/InboundView'; // kept for legacy compatibility — not rendered directly
import InventoryView from './views/InventoryView';
import OutboundProcessView from './views/OutboundProcessView';
import PackingView from './views/PackingView';
import BinTransferView from './views/BinTransferView';
import BinContentsView from './views/BinContentsView';
import TransferOrderView from './views/TransferOrderView';
import ShippingView from './views/ShippingView';
import FacilityView from './views/FacilityView';
import MasterCatalogView from './views/MasterCatalogView';
import PickExecutionView from './views/replenishment/PickExecutionView';
import InboundReceivingView from './views/inbound/InboundReceivingView';
import QcInspectionView from './views/inbound/QcInspectionView';
import PutawayView from './views/inbound/PutawayView';
import PackSealView from './views/replenishment/PackSealView';
import CreateOrderView from './views/replenishment/CreateOrderView';
import BinLookupView from './views/storage/BinLookupView';
import DispatchView from './views/outbound/DispatchView';
import PickQueuesView from './views/outbound/PickQueuesView';
import FleetView from './views/FleetView';
import EmployeeAssignmentView from './views/EmployeeAssignmentView';
import RiderDashboardView from './views/RiderDashboardView';
import AdminSettingsView from './views/AdminSettingsView';
import CommandCenterView from './views/darkstore/CommandCenterView';
import LpnReceiptView from './views/darkstore/LpnReceiptView';
import ShelfPutawayView from './views/darkstore/ShelfPutawayView';
import ShelfInventoryView from './views/darkstore/ShelfInventoryView';
import StockLedgerView from './views/darkstore/StockLedgerView';
import OrderPickingView from './views/darkstore/OrderPickingView';
import OrderPackingView from './views/darkstore/OrderPackingView';
import RiderHandoffView from './views/darkstore/RiderHandoffView';
import ReturnsView from './views/darkstore/ReturnsView';
import ShopperStorefrontView from './views/shopper/StorefrontView';
import MyOrdersView from './views/shopper/MyOrdersView';
import NotificationsView from './views/shopper/NotificationsView';
import AccountView from './views/shopper/AccountView';

function AppContent() {
  const { activeTabId } = useTabs();
  const [collapsed, setCollapsed] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);

  const renderActiveView = () => {
    switch (activeTabId) {
      // ── INBOUND (scan-first: receive -> inspect -> put away) ──
      case 'asns':
        return <InboundReceivingView />;
      case 'qc-testing':
        return <QcInspectionView />;
      case 'putaway-tasks':
        return <PutawayView />;

      // ── STORAGE & INVENTORY ──
      // InventoryView's subtab ids are positions/feed/bins, so map the nav id
      // rather than forwarding it verbatim.
      case 'positions':
        return <InventoryView initialTab="positions" />;
      case 'movement-feed':
        return <InventoryView initialTab="feed" />;
      case 'bins':
        return <InventoryView initialTab="bins" />;
      // legacy tab ids kept working
      case 'inventory-lots':
        return <InventoryView initialTab="positions" />;
      case 'lpns':
        return <InventoryView initialTab="bins" />;
      case 'transaction-log':
        return <InventoryView initialTab="feed" />;
      case 'storage-bins':
        return <InventoryView initialTab="bins" />;

      // ── PACKING ──
      case 'packing':
      case 'packing-batches':
        return <PackingView />;

      // ── BIN OPERATIONS ──
      // These used to be reachable only as InboundView subtabs, which meant the
      // standalone pages (and the scanner inside them) could never be opened
      // directly from the sidebar.
      case 'bin-transfer':
        return <BinTransferView />;
      case 'bin-contents':
      case 'bin-lookup':
        return <BinLookupView />;
      case 'transfer-orders':
        return <TransferOrderView />;

      // ── SHIPPING & DISPATCH ──
      case 'shipping':
      case 'cross-dock':
        return <ShippingView initialTab={activeTabId === 'cross-dock' ? 'cross-dock' : 'dispatch-trips'} />;

      // ── PICK & PACK EXECUTION (dark-store replenishment: create, scan, pack, dispatch) ──
      case 'pick-execute':
        return <PickExecutionView />;
      case 'pack-seal':
      case 'packing-seal':
        return <PackSealView />;
      case 'create-orders':
        return <CreateOrderView />;

      // ── OUTBOUND / FULFILLMENT ──
      case 'batches':
      case 'picklists':
      case 'sorting-list':
        return <PickQueuesView initialTab={activeTabId} />;

      case 'dispatch-trips':
      case 'manifests':
        return <DispatchView initialTab={activeTabId} />;

      case 'totes-lpns':
      case 'dispatch-plan':
      case 'user-orders':
      case 'picker-details':
      case 'rider-details':
        return <OutboundProcessView initialTab={activeTabId} />;

      // ── FLEET ──
      case 'active-trips':
        return <FleetView initialTab={activeTabId} />;

      // ── FACILITY ──
      case 'sites-registry':
      case 'zones':
      case 'dock-doors':
        return <FacilityView initialTab={activeTabId} />;

      // ── MASTER DATA ──
      case 'skus':
      case 'vendors':
      case 'categories':
      case 'transporters':
        return <MasterCatalogView initialTab={activeTabId} />;

      // ── EMPLOYEE ASSIGNMENTS ──
      case 'employee-roster':
      case 'employee-tasks':
      case 'employee-productivity':
        return <EmployeeAssignmentView initialTab={activeTabId === 'employee-tasks' ? 'tasks' : activeTabId === 'employee-productivity' ? 'productivity' : 'roster'} />;

      // ── ADMIN SETTINGS ──
      case 'admin-settings':
        return <AdminSettingsView />;

      // ── DARK STORE (scan-first: receive -> put away -> pick -> hand off) ──
      // Deliberately keyed `ds-*` so no dark-store screen can fall through to a
      // central-hub view. These wrap the /ds-ops endpoints, not the WMS ones.
      case 'ds-dashboard':
        return <CommandCenterView />;
      case 'ds-lpn-receipt':
        return <LpnReceiptView />;
      case 'ds-shelf-putaway':
        return <ShelfPutawayView />;
      case 'ds-shelf-inventory':
        return <ShelfInventoryView />;
      case 'ds-ledger':
        return <StockLedgerView />;
      case 'ds-order-picking':
        return <OrderPickingView />;
      case 'ds-order-packing':
        return <OrderPackingView />;
      case 'ds-rider-handoff':
        return <RiderHandoffView />;
      case 'ds-returns':
        return <ReturnsView />;

      // ── SHOPPER ──
      case 'shop-storefront':
        return <ShopperStorefrontView />;
      case 'shop-orders':
        return <MyOrdersView />;
      case 'shop-notifications':
        return <NotificationsView />;
      case 'shop-account':
        return <AccountView />;

      // ── DASHBOARD ──
      case 'dashboard':
      default:
        return <DashboardView />;
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
    </div>
  );
}

function AuthGate() {
  const { user, appMode, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
        Loading Zippzo Enterprise Platform...
      </div>
    );
  }

  // Not logged in -> Show Login View
  if (!user) {
    return <LoginView />;
  }

  // Rider gets an isolated dashboard
  if (appMode === 'RIDER') {
    return <RiderDashboardView />;
  }

  // One WMS shell for every warehouse and dark store operator: which sidebar
  // sections render depends on `isDarkStore` (the selected facility), not on a
  // second app mode.
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