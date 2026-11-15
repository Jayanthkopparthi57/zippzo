import React from 'react';
import { useTabs } from '../../context/TabContext';
import { X, FileText, ArrowDownToLine, Package, ShoppingCart, Truck, Activity, Warehouse, Users } from 'lucide-react';

const TAB_ICON_MAP = {
  'ds-command-center': Activity,
  'ds-metrics-dashboard': Activity,
  'ds-orders': ShoppingCart,
  'ds-picking': ShoppingCart,
  'ds-packing': Package,
  'ds-rider-handoff': Truck,
  'ds-lpn-receipt': ArrowDownToLine,
  'ds-inbound-asns': ArrowDownToLine,
  'ds-inbound-grns': ArrowDownToLine,
  'ds-inbound-putaway': ArrowDownToLine,
  'ds-inbound-discrepancies': ArrowDownToLine,
  'ds-shelf-putaway': ArrowDownToLine,
  'ds-shelf-inventory': Warehouse,
  'ds-qc-inspection': FileText,
  'ds-cancellation-putaway': ArrowDownToLine,
  'ds-storage-locations': Warehouse,
  'ds-bin-transfers': Package,
  'ds-replenishment': Package,
  'ds-cycle-counts': Activity,
  'ds-employee-tracking': Activity,
  'ds-notifications': FileText,
  'ds-cash-register': FileText,
  'ds-stock-ledger': FileText,
  'ds-transactions': FileText,
  'ds-inventory-lots': Warehouse,
  'ds-customer-availability': Warehouse,
  'ds-droplists': Package,
  'ds-returns': Package,
  'ds-rider-fleet': Truck,
  'ds-bins': Warehouse,
  'ds-product-registration': Warehouse,
  'ds-employee-register': Users,
};

export default function TabBar() {
  const { tabs, activeTabId, setActiveTabId, closeTab } = useTabs();

  return (
    <div className="mdi-tab-bar">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const IconComponent = TAB_ICON_MAP[tab.id] || FileText;

        return (
          <div
            key={tab.id}
            className={`mdi-tab ${isActive ? 'active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <IconComponent size={11} className="mdi-tab-icon" style={{ opacity: isActive ? 1 : 0.65 }} />
            <span>{tab.title}</span>
            {tab.closable && (
              <span
                className="mdi-tab-close"
                onClick={(e) => closeTab(tab.id, e)}
                title="Close Tab"
              >
                <X size={10} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
