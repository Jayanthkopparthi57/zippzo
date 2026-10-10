import React from 'react';
import { AuthProvider } from '../context/AuthContext';
import { TabProvider, useTabs } from '../context/TabContext';
import AuthGate from './AuthGate';
import Shell from './Shell';
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

  return <Shell>{renderActiveView()}</Shell>;
}

/**
 * The customer application: a storefront, an order drawer, notifications and
 * an account. None of the warehouse or store-operator screens are in this
 * bundle at all.
 */
export default function ShopperApp() {
  return (
    <AuthProvider appKey="shopper">
      <AuthGate appKey="shopper">
        <TabProvider appKey="shopper">
          <ShopperContent />
        </TabProvider>
      </AuthGate>
    </AuthProvider>
  );
}
