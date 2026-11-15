import React, { createContext, useContext, useState } from 'react';

const TabContext = createContext(null);

export const defaultInitialTabs = [
  { id: 'ds-command-center', title: 'Overview', view: 'CommandCenterView', closable: false },
];

export function TabProvider({ children, initialTabs = defaultInitialTabs, initialActiveTabId = 'ds-command-center' }) {
  const [tabs, setTabs] = useState(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialActiveTabId);
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
        setActiveTabId('ds-command-center');
        return defaultInitialTabs.map(tab => ({ ...tab }));
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
