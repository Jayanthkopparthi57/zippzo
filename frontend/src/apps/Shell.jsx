import React, { useState } from 'react';
import Header from '../components/layout/Header';
import TabBar from '../components/layout/TabBar';
import Sidebar from '../components/layout/Sidebar';
import BarcodeScannerModal from '../components/ui/BarcodeScannerModal';

/**
 * The shared chrome of the two apps that have a sidebar: the store console and
 * the customer app. The rider app deliberately does not use this — a delivery
 * partner has one screen and no navigation to hide behind.
 */
export default function Shell({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);

  return (
    <div className="app-container">
      <Sidebar collapsed={collapsed} />

      <div className="app-main">
        <Header
          onToggleSidebar={() => setCollapsed(prev => !prev)}
          onOpenScanner={() => setShowScannerModal(true)}
        />

        <TabBar />

        <main className="workspace-viewport">
          {children}
        </main>
      </div>

      {showScannerModal && (
        <BarcodeScannerModal onClose={() => setShowScannerModal(false)} />
      )}
    </div>
  );
}
