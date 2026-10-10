import React from 'react';
import { AuthProvider } from '../context/AuthContext';
import AuthGate from './AuthGate';
import RiderDashboardView from '../views/RiderDashboardView';

/**
 * The delivery-partner application. One screen, no sidebar, no tabs: a rider
 * opening the app wants their next task, not a navigation tree. None of the
 * warehouse, store or customer views are in this bundle.
 */
export default function RiderApp() {
  return (
    <AuthProvider appKey="rider">
      <AuthGate appKey="rider">
        <RiderDashboardView />
      </AuthGate>
    </AuthProvider>
  );
}
