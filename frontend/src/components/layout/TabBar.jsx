import React from 'react';
import { X, Layers } from 'lucide-react';
import { useTabs } from '../../context/TabContext';

export default function TabBar() {
  const { tabs, activeTabId, setActiveTabId, closeTab } = useTabs();

  return (
    <div className="tab-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '8px', borderRight: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '11px', fontWeight: '700' }}>
        <Layers size={13} /> MDI VIEWS
      </div>

      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`tab-item ${isActive ? 'active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <span>{tab.label}</span>
            {tabs.length > 1 && (
              <X
                size={14}
                className="tab-close"
                onClick={(e) => closeTab(tab.id, e)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
