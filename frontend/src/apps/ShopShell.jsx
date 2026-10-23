import React, { useCallback, useEffect, useState } from 'react';
import {
  ShoppingBasket, ClipboardList, Bell, Users, MapPin, Clock,
} from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { myAddresses, asList } from '../views/darkstore/useDarkStore';

/**
 * Fired on `window` by the storefront and the address book whenever the saved
 * addresses change, so this bar never sits there claiming there is no address
 * while the basket next to it is using one.
 */
const ADDRESSES_CHANGED = 'zippzo:addresses-changed';

/**
 * The customer chrome. The store console keeps the sidebar shell; a shopper
 * gets a phone-shaped app instead: one dark bar with the wordmark, four
 * destinations and a deliver-to chip, then the screen itself.
 *
 * The nav is a single element in the DOM at every width - on a phone CSS
 * pulls it out of the bar and pins it to the bottom of the viewport - because
 * the test ids on those four buttons have to stay unique.
 */
const NAV = [
  { id: 'shop-storefront', label: 'Shop', title: 'Order Groceries', icon: ShoppingBasket },
  { id: 'shop-orders', label: 'Orders', title: 'My Orders', icon: ClipboardList },
  { id: 'shop-notifications', label: 'Alerts', title: 'Notifications', icon: Bell },
  { id: 'shop-account', label: 'Account', title: 'Account & Address Book', icon: Users },
];

export default function ShopShell({ children }) {
  const { activeTabId, openTab } = useTabs();
  const [addresses, setAddresses] = useState([]);

  const loadAddresses = useCallback(() => {
    myAddresses()
      .then((rows) => setAddresses(asList(rows, 'addresses') || []))
      .catch(() => { /* the bar shows "Add an address"; the basket still blocks */ });
  }, []);

  // On arrival, on every tab change (the address book is one tab away) and
  // whenever either screen says the book changed.
  useEffect(() => { loadAddresses(); }, [loadAddresses, activeTabId]);
  useEffect(() => {
    window.addEventListener(ADDRESSES_CHANGED, loadAddresses);
    return () => window.removeEventListener(ADDRESSES_CHANGED, loadAddresses);
  }, [loadAddresses]);

  const home = addresses.find((a) => a.is_default) || addresses[0] || null;
  const where = home ? [home.line1, home.city].filter(Boolean).join(', ') : 'Add an address';

  const goAccount = () => openTab('shop-account', 'Account & Address Book', 'Users');

  return (
    <div className="shop-app">
      <header className="shop-topbar">
        <div className="shop-brand">
          <span className="shop-brand__mark">Z</span>
          Zippzo
        </div>

        <nav className="shop-nav" aria-label="Shopper">
          {NAV.map((item) => {
            const Icon = item.icon;
            const on = activeTabId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className="shop-nav__item"
                data-testid={`nav-${item.id}`}
                aria-current={on ? 'page' : undefined}
                onClick={() => openTab(item.id, item.title, item.icon.name)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="shop-topbar__spacer" />

        <span className="shop-eta">
          <Clock size={13} /> 10-min delivery
        </span>

        <button
          type="button"
          className="shop-addr"
          onClick={goAccount}
          title={home ? where : 'Add a delivery address'}
        >
          <MapPin size={15} />
          <span className="shop-addr__body">
            <span className="shop-addr__label">Deliver to</span>
            <span className="shop-addr__text">{where}</span>
          </span>
          <span className="shop-addr__cta">{home ? 'Change' : 'Add'}</span>
        </button>
      </header>

      <main className="shop-main workspace-viewport">{children}</main>
    </div>
  );
}
