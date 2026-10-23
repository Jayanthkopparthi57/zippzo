import React, { useCallback, useState } from 'react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { TabProvider, useTabs } from '../context/TabContext';
import AuthGate from './AuthGate';
import ShopShell from './ShopShell';
import ShopperSetup from './ShopperSetup';
import ShopperStorefrontView from '../views/shopper/StorefrontView';
import MyOrdersView from '../views/shopper/MyOrdersView';
import NotificationsView from '../views/shopper/NotificationsView';
import AccountView from '../views/shopper/AccountView';

function ShopperContent() {
  const { activeTabId } = useTabs();

  const renderActiveView = () => {
    switch (activeTabId) {
      case 'shop-orders':
        return <MyOrdersView />;
      case 'shop-notifications':
        return <NotificationsView />;
      case 'shop-account':
        return <AccountView />;
      case 'shop-storefront':
      default:
        return <ShopperStorefrontView />;
    }
  };

  return <ShopShell>{renderActiveView()}</ShopShell>;
}

/**
 * The customer application: a storefront, an order drawer, notifications and
 * an account. None of the warehouse or store-operator screens are in this
 * bundle at all, and neither is the sidebar chrome they live in - a shopper
 * gets ShopShell, a bar and four destinations, not an operator console.
 *
 * A freshly provisioned login has no customer row behind it, so ShopperSetup
 * runs first and hands the created profile back here. Until that exists there
 * is nothing useful in the other three tabs - checkout, addresses and the
 * order drawer all belong to a customer, not a login.
 *
 * "Set up" is tracked per *account*: the flag used to live as component state
 * that survived a logout, so the next login - a different shopper, or the same
 * one on a fresh device - inherited the previous profile and opened the
 * storefront straight over ShopperSetup for an account with no customer row.
 */
export default function ShopperApp() {
  return (
    <AuthProvider appKey="shopper">
      <AuthGate appKey="shopper">
        <ShopperSession />
      </AuthGate>
    </AuthProvider>
  );
}

function ShopperSession() {
  const { user } = useAuth();
  const [readyFor, setReadyFor] = useState(null);

  const onReady = useCallback(() => setReadyFor(user?.user_id ?? null), [user]);

  if (!user || readyFor !== user.user_id) {
    return <ShopperSetup onReady={onReady} />;
  }

  return (
    <TabProvider appKey="shopper">
      <ShopperContent />
    </TabProvider>
  );
}
