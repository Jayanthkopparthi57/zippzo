import React from 'react';
import { X, Layers, Plus } from 'lucide-react';
import { useTabs } from '../../context/TabContext';

export default function TabBar() {
  const { tabs, activeTabId, setActiveTabId, closeTab } = useTabs();

  return (
    <div className="tab-bar">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`tab-item ${isActive ? 'active' : ''}`}
            data-testid={`tab-${tab.id}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <Layers size={11} style={{ opacity: 0.6 }} />
            <span>{tab.label}</span>
            {tabs.length > 1 && (
              <X
                size={12}
                className="tab-close"
                onClick={(e) => closeTab(tab.id, e)}
              />
            )}
          </div>
        );
      })}
      <button type="button" className="tab-add" title="Open a module from the sidebar">
        <Plus size={13} />
      </button>
    </div>
  );
}
