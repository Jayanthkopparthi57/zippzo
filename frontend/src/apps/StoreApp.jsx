import React from 'react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import AuthGate from './AuthGate';
import WmsConsoleApp from '../wms-console/App';

/**
 * The client-approved WMS console. Sessions, facilities and authorization come
 * from the shared AuthContext; the shell itself is the committed enterprise
 * console design (accordion sidebar, facility bar, multi-tab workspace).
 */
function WmsConsole() {
  const { user, logout } = useAuth();
  return <WmsConsoleApp user={user} logout={logout} />;
}

export default function StoreApp() {
  return (
    <AuthProvider appKey="store">
      <AuthGate appKey="store">
        <WmsConsole />
      </AuthGate>
    </AuthProvider>
  );
}
