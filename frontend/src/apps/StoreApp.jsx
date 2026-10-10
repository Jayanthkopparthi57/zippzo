import React from 'react';
import { AuthProvider } from '../context/AuthContext';
import { TabProvider, useTabs } from '../context/TabContext';
import AuthGate from './AuthGate';
import Shell from './Shell';
import DashboardView from '../views/DashboardView';
import InventoryView from '../views/InventoryView';
import OutboundProcessView from '../views/OutboundProcessView';
import PackingView from '../views/PackingView';
import BinTransferView from '../views/BinTransferView';
import TransferOrderView from '../views/TransferOrderView';
import ShippingView from '../views/ShippingView';
import FacilityView from '../views/FacilityView';
import MasterCatalogView from '../views/MasterCatalogView';
import PickExecutionView from '../views/replenishment/PickExecutionView';
import InboundReceivingView from '../views/inbound/InboundReceivingView';
import QcInspectionView from '../views/inbound/QcInspectionView';
import PutawayView from '../views/inbound/PutawayView';
import PackSealView from '../views/replenishment/PackSealView';
import CreateOrderView from '../views/replenishment/CreateOrderView';
import BinLookupView from '../views/storage/BinLookupView';
import DispatchView from '../views/outbound/DispatchView';
import PickQueuesView from '../views/outbound/PickQueuesView';
import FleetView from '../views/FleetView';
import EmployeeAssignmentView from '../views/EmployeeAssignmentView';
import AdminSettingsView from '../views/AdminSettingsView';
import CommandCenterView from '../views/darkstore/CommandCenterView';
import LpnReceiptView from '../views/darkstore/LpnReceiptView';
import ShelfPutawayView from '../views/darkstore/ShelfPutawayView';
import ShelfInventoryView from '../views/darkstore/ShelfInventoryView';
import StockLedgerView from '../views/darkstore/StockLedgerView';
import OrderPickingView from '../views/darkstore/OrderPickingView';
import OrderPackingView from '../views/darkstore/OrderPackingView';
import RiderHandoffView from '../views/darkstore/RiderHandoffView';
import ReturnsView from '../views/darkstore/ReturnsView';

function StoreContent() {
  const { activeTabId } = useTabs();

  const renderActiveView = () => {
    switch (activeTabId) {
      // INBOUND (scan-first: receive -> inspect -> put away)
      case 'asns':
        return <InboundReceivingView />;
      case 'qc-testing':
        return <QcInspectionView />;
      case 'putaway-tasks':
        return <PutawayView />;

      // STORAGE & INVENTORY
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

      // PACKING
      case 'packing':
      case 'packing-batches':
        return <PackingView />;

      // BIN OPERATIONS
      case 'bin-transfer':
        return <BinTransferView />;
      case 'bin-contents':
      case 'bin-lookup':
        return <BinLookupView />;
      case 'transfer-orders':
        return <TransferOrderView />;

      // SHIPPING & DISPATCH
      case 'shipping':
      case 'cross-dock':
        return <ShippingView initialTab={activeTabId === 'cross-dock' ? 'cross-dock' : 'dispatch-trips'} />;

      // PICK & PACK EXECUTION (dark-store replenishment)
      case 'pick-execute':
        return <PickExecutionView />;
      case 'pack-seal':
      case 'packing-seal':
        return <PackSealView />;
      case 'create-orders':
        return <CreateOrderView />;

      // OUTBOUND / FULFILLMENT
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

      // FLEET
      case 'active-trips':
        return <FleetView initialTab={activeTabId} />;

      // FACILITY
      case 'sites-registry':
      case 'zones':
      case 'dock-doors':
        return <FacilityView initialTab={activeTabId} />;

      // MASTER DATA
      case 'skus':
      case 'vendors':
      case 'categories':
      case 'transporters':
        return <MasterCatalogView initialTab={activeTabId} />;

      // EMPLOYEE ASSIGNMENTS
      case 'employee-roster':
      case 'employee-tasks':
      case 'employee-productivity':
        return <EmployeeAssignmentView initialTab={activeTabId === 'employee-tasks' ? 'tasks' : activeTabId === 'employee-productivity' ? 'productivity' : 'roster'} />;

      // ADMIN SETTINGS
      case 'admin-settings':
        return <AdminSettingsView />;

      // STORE OPS (dark store: receive -> put away -> pick -> hand off).
      // Keyed `ds-*` so no store screen can fall through to a hub view.
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

      case 'dashboard':
      default:
        return <DashboardView />;
    }
  };

  return <Shell>{renderActiveView()}</Shell>;
}

/**
 * The store-partner application: every warehouse screen plus every dark-store
 * screen, in one shell. Which of the two menu sets renders depends on the
 * facility the operator has selected, not on a second app mode.
 */
export default function StoreApp() {
  return (
    <AuthProvider appKey="store">
      <AuthGate appKey="store">
        <TabProvider appKey="store">
          <StoreContent />
        </TabProvider>
      </AuthGate>
    </AuthProvider>
  );
}
