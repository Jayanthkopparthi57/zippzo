import React, { useState } from 'react';
import Header from '../components/layout/Header';
import TabBar from '../components/layout/TabBar';
import Sidebar from '../components/layout/Sidebar';
import { ArrowDownToLine, Boxes, ClipboardList, Home, Menu } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useAuth } from '../context/AuthContext';

/**
 * The shared chrome of the two apps that have a sidebar: the store console and
 * the customer app. The rider app deliberately does not use this — a delivery
 * partner has one screen and no navigation to hide behind.
 */
export default function Shell({ children }) {
  const { appKey, isDarkStore } = useAuth();
  const isOperationsApp = appKey === 'store' || appKey === 'wms';
  const isFloorApp = isOperationsApp && typeof window !== 'undefined' && (
    document.documentElement.dataset.surface === 'app' ||
    window.Capacitor?.isNativePlatform?.() === true
  );
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' && (
      window.Capacitor?.isNativePlatform?.() === true || window.matchMedia('(max-width: 600px)').matches
    )
  );
  const { openTab } = useTabs();

  const openMobileTab = (id, label, icon) => {
    openTab(id, label, icon);
    setCollapsed(true);
  };
  const closeMobileMenu = () => {
    if (isFloorApp) setCollapsed(true);
  };

  return (
    <div className={`app-container${isFloorApp ? ' floor-app' : ''}`}>
      <Sidebar collapsed={collapsed} onNavigate={closeMobileMenu} />

      <div className="app-main">
        <Header
          onToggleSidebar={() => setCollapsed(prev => !prev)}
        />

        <TabBar />

        <main className="workspace-viewport">
          {children}
        </main>
      </div>

      {isFloorApp && (
        <nav className="floor-bottom-nav" aria-label="Floor app navigation">
          <button type="button" onClick={() => openMobileTab('dashboard', 'Operations home', 'Home')}>
            <Home size={19} /><span>Flow</span>
          </button>
          <button
            type="button"
            onClick={() => openMobileTab(isDarkStore ? 'ds-lpn-receipt' : 'asns', isDarkStore ? 'Receive totes' : 'Receipts & consignments', 'ArrowDownToLine')}
          >
            <ArrowDownToLine size={19} /><span>Receive</span>
          </button>
          <button
            type="button"
            onClick={() => openMobileTab(isDarkStore ? 'ds-picking' : 'batches', isDarkStore ? 'Order picking' : 'Replenishment picking', 'ClipboardList')}
          >
            <ClipboardList size={19} /><span>Pick</span>
          </button>
          <button type="button" onClick={() => openMobileTab(isDarkStore ? 'ds-shelf-putaway' : 'putaway-tasks', isDarkStore ? 'Shelf stock tasks' : 'Warehouse stock tasks', 'Boxes')}>
            <Boxes size={19} /><span>Stock</span>
          </button>
          <button type="button" onClick={() => setCollapsed((value) => !value)}>
            <Menu size={19} /><span>Menu</span>
          </button>
        </nav>
      )}

    </div>
  );
}
