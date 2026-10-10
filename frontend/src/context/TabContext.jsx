import React, { createContext, useContext, useState } from 'react';

const TabContext = createContext();

const STORE_INITIAL_TABS = [
  { id: 'dashboard', label: 'Dashboard & Overview', icon: 'LayoutDashboard' },
  { id: 'asns', label: 'Consignments', icon: 'PackageCheck' },
  { id: 'inventory-lots', label: 'Storage Inventory', icon: 'Layers' },
  { id: 'packing', label: 'Packing & Units', icon: 'Package' }
];

const SHOPPER_INITIAL_TABS = [
  { id: 'shop-storefront', label: 'Order Groceries', icon: 'ShoppingBasket' },
  { id: 'shop-orders', label: 'My Orders', icon: 'ClipboardList' },
];

export const INITIAL_TABS_BY_APP = {
  store: STORE_INITIAL_TABS,
  shopper: SHOPPER_INITIAL_TABS,
};

export function TabProvider({ children, appKey = 'store', initialTabs }) {
  const defaults = INITIAL_TABS_BY_APP[appKey] || STORE_INITIAL_TABS;
  const startingTabs = initialTabs || defaults;
  const [tabs, setTabs] = useState(startingTabs);
  const [activeTabId, setActiveTabId] = useState(startingTabs[0]?.id || 'dashboard');

  const openTab = (id, label, icon) => {
    if (!tabs.find(t => t.id === id)) {
      setTabs(prev => [...prev, { id, label, icon: icon || 'Boxes' }]);
    }
    setActiveTabId(id);
  };

  const closeTab = (id, e) => {
    if (e) e.stopPropagation();
    if (tabs.length <= 1) return;
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  return (
    <TabContext.Provider value={{ tabs, activeTabId, openTab, closeTab, setActiveTabId }}>
      {children}
    </TabContext.Provider>
  );
}

export function useTabs() {
  return useContext(TabContext);
}
