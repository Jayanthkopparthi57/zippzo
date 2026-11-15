import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthGate from './apps/AuthGate';
import DsConsoleApp from './ds-console/App';

function DarkStoreConsole() {
  const { user, logout } = useAuth();
  return <DsConsoleApp user={user} logout={logout} />;
}

export default function DarkStoreApp() {
  return (
    <AuthProvider appKey="darkstore">
      <AuthGate appKey="darkstore">
        <DarkStoreConsole />
      </AuthGate>
    </AuthProvider>
  );
}
