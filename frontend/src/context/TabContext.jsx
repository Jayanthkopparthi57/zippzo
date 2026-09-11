import React, { createContext, useContext, useState } from 'react';

const TabContext = createContext(null);

export const defaultInitialTabs = [
  { id: 'store-management', title: 'Store Management', view: 'StoreManagementView', closable: true },
  { id: 'man-power', title: 'Man Power', view: 'ManPowerView', closable: true },
  { id: 'metrics-dashboard', title: 'Dashboard', view: 'DashboardView', closable: false },
  { id: 'inbound-asns', title: 'Inbound ASNs', view: 'InboundView', closable: true },
  { id: 'sto', title: 'STO', view: 'StoView', closable: true },
  { id: 'picklists', title: 'Picklists', view: 'PicklistView', closable: true },
  { id: 'vehicle-assign', title: 'Vehicle Assignment', view: 'VehicleAssignmentView', closable: true },
  { id: 'active-trips', title: 'Active Trips', view: 'ActiveTripsView', closable: true },
];

export function TabProvider({ children }) {
  const [tabs, setTabs] = useState(defaultInitialTabs);
  const [activeTabId, setActiveTabId] = useState('metrics-dashboard');
  const [tabCache, setTabCache] = useState({});

  const openTab = (newTab) => {
    setTabs(prev => {
      const exists = prev.find(t => t.id === newTab.id);
      if (exists) return prev;
      return [...prev, { ...newTab, closable: newTab.closable !== false }];
    });
    setActiveTabId(newTab.id);
  };

  const closeTab = (tabId, e) => {
    if (e) e.stopPropagation();
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId);
      if (remaining.length === 0) {
        return [{ id: 'metrics-dashboard', title: 'Dashboard', view: 'DashboardView', closable: false }];
      }
      if (activeTabId === tabId) {
        const closedIdx = prev.findIndex(t => t.id === tabId);
        const nextActive = remaining[Math.max(0, closedIdx - 1)] || remaining[0];
        setActiveTabId(nextActive.id);
      }
      return remaining;
    });
  };

  const setCache = (tabId, data) => {
    setTabCache(prev => ({
      ...prev,
      [tabId]: { ...(prev[tabId] || {}), ...data }
    }));
  };

  return (
    <TabContext.Provider value={{ tabs, activeTabId, setActiveTabId, openTab, closeTab, tabCache, setCache }}>
      {children}
    </TabContext.Provider>
  );
}

export function useTabs() {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error('useTabs must be used within TabProvider');
  return ctx;
}
