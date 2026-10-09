import React, { createContext, useContext, useState } from 'react';

const TabContext = createContext();

const INITIAL_TABS = [
  { id: 'dashboard', label: 'Dashboard & Overview', icon: 'LayoutDashboard' },
  { id: 'asns', label: 'Consignments', icon: 'PackageCheck' },
  { id: 'inventory-lots', label: 'Storage Inventory', icon: 'Layers' },
  { id: 'packing', label: 'Packing & Units', icon: 'Package' }
];

export function TabProvider({ children }) {
  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState('dashboard');

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
