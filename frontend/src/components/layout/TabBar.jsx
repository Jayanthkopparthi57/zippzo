import React from 'react';
import { useTabs } from '../../context/TabContext';
import { X, FileText, ArrowDownToLine, Package, ShoppingCart, Truck, Activity, Warehouse, Settings } from 'lucide-react';

const TAB_ICON_MAP = {
  'metrics-dashboard': Activity,
  'inbound-asns': ArrowDownToLine,
  'inbound-grns': ArrowDownToLine,
  'inbound-putaway': ArrowDownToLine,
  'inbound-discrepancies': ArrowDownToLine,
  'sto': Package,
  'transfer-orders': Package,
  'picklists': ShoppingCart,
  'batches': ShoppingCart,
  'vehicle-assign': Truck,
  'active-trips': Truck,
  'inventory-lots': Warehouse,
  'sites': Settings,
  'skus': FileText,
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
