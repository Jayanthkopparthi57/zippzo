import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShoppingBasket, ClipboardList, Bell, Users, MapPin, ChevronDown,
  Search, X, LogOut, BellRing,
} from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useAuth } from '../context/AuthContext';
import { myAddresses, asList } from '../views/darkstore/useDarkStore';
import { fetchApi } from '../api/client';

/**
 * Fired on `window` by the storefront and the address book whenever the saved
 * addresses change, so the top bar never sits there claiming "Add an address"
 * while the basket next to it is using one.
 */
const ADDRESSES_CHANGED = 'zippzo:addresses-changed';

const SEARCH_EVENT = 'zippzo:search';

/**
 * The customer chrome: a logo lockup, one full-width search bar with the
 * shopper's live delivery city, a notifications badge and a profile menu
 * that carries every account destination (orders, address book, benefits).
 * On phones the search drops to its own row and delivery collapses to the
 * icon-only chip.
 */

/**
 * Phone bottom navigation: the four primary destinations, always reachable
 * with one thumb. Hidden on desktop — the top bar carries the profile menu
 * and search there instead.
 */
const BOTTOM_NAV = [
  { id: 'shop-storefront', label: 'Shop', title: 'Order Groceries', icon: ShoppingBasket },
  { id: 'shop-orders', label: 'Orders', title: 'My Orders', icon: ClipboardList },
  { id: 'shop-notifications', label: 'Alerts', title: 'Notifications', icon: Bell },
  { id: 'shop-account', label: 'Account', title: 'Account & Address Book', icon: Users },
];

export default function ShopShell({ children }) {
  const { activeTabId, openTab } = useTabs();
  const { user, logout } = useAuth();
  const [addresses, setAddresses] = useState([]);
  const [unread, setUnread] = useState(0);
  const [term, setTerm] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const loadAddresses = useCallback(() => {
    myAddresses()
      .then((rows) => setAddresses(asList(rows, 'addresses') || []))
      .catch(() => { /* the chip shows "Add address"; the basket still blocks */ });
  }, []);

  useEffect(() => { loadAddresses(); }, [loadAddresses, activeTabId]);
  useEffect(() => {
    window.addEventListener(ADDRESSES_CHANGED, loadAddresses);
    return () => window.removeEventListener(ADDRESSES_CHANGED, loadAddresses);
  }, [loadAddresses]);

  useEffect(() => {
    let mounted = true;
    const refresh = () => fetchApi('/notifications/notifications/unread_count/')
      .then(result => { if (mounted) setUnread(result?.unread || 0); })
      .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('zippzo:live-event', refresh);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('zippzo:live-event', refresh);
    };
  }, []);

  // Close the profile menu on any outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const home = addresses.find((a) => a.is_default) || addresses[0] || null;
  const where = home ? [home.line1, home.city].filter(Boolean).join(', ') : 'Add an address';

  const go = (id, title) => { setMenuOpen(false); openTab(id, title, 'Boxes'); };
  const goAddress = () => { setMenuOpen(false); openTab('shop-account', 'Account & Address Book', 'Users'); };
  const browse = () => openTab('shop-storefront', 'Order Groceries', 'ShoppingBasket');

  const name = (user?.full_name || '').trim();
  const firstName = name ? name.split(' ')[0] : 'Shopper';
  const initial = (name || user?.email || 'S').trim().charAt(0).toUpperCase();

  const onType = (e) => {
    setTerm(e.target.value);
    window.dispatchEvent(new CustomEvent(SEARCH_EVENT, { detail: e.target.value }));
  };
  const onClear = () => {
    setTerm('');
    window.dispatchEvent(new CustomEvent(SEARCH_EVENT, { detail: '' }));
  };
  const onSubmitSearch = (e) => {
    e.preventDefault();
    browse();
  };

  const searchBar = (cls) => (
    <form className={cls} role="search" onSubmit={onSubmitSearch}>
      <Search size={17} className="shop-searchbar__icon" aria-hidden="true" />
      <input
        value={term}
        onChange={onType}
        type="search"
        aria-label="Search products"
        autoComplete="off"
        placeholder="Search atta, dal, Coke, Maggi…"
      />
      {term && (
        <button type="button" className="shop-searchbar__clear" onClick={onClear} aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </form>
  );

  return (
    <div className="shop-app">
      <header className="shop-topbar">
        <button type="button" className="shop-brand" onClick={browse} title="Zippzo home" aria-label="Zippzo home">
          <img className="shop-brand__mark" src="/zippzo-logo-192.png" alt="Zippzo" />
          <span className="shop-brand__stack">
            <span className="shop-brand__word">ZIPPZO</span>
            <span className="shop-brand__tag">GROCERIES IN MINUTES</span>
          </span>
        </button>

        {searchBar('shop-searchbar shop-searchbar--desktop')}

        <button
          type="button"
          className="shop-deliver"
          onClick={goAddress}
          title={home ? where : 'Add a delivery address'}
        >
          <MapPin size={17} className="shop-deliver__pin" />
          <span className="shop-deliver__body">
            <span className="shop-deliver__label">DELIVER TO</span>
            <span className="shop-deliver__text">{where}</span>
          </span>
          <ChevronDown size={15} className="shop-deliver__chev" />
        </button>

        <div className="shop-topbar__spacer" />

        <button
          type="button"
          className="shop-bell"
          onClick={() => openTab('shop-notifications', 'Notifications', 'Bell')}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          title="Notifications"
        >
          {unread > 0 ? <BellRing size={19} /> : <Bell size={19} />}
          {unread > 0 && (
            <span className="shop-bell__badge" aria-label={`${unread} unread`}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        <div className="shop-profile" ref={menuRef}>
          <button
            type="button"
            className="shop-profile__btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            title="Your account"
          >
            <span className="shop-profile__avatar">{initial}</span>
            <span className="shop-profile__name">{firstName}</span>
            <ChevronDown size={15} className={`shop-profile__chev${menuOpen ? ' shop-profile__chev--open' : ''}`} />
          </button>

          {menuOpen && (
            <div className="shop-profile__menu" role="menu">
              <div className="shop-profile__head">
                <span className="shop-profile__avatar shop-profile__avatar--lg">{initial}</span>
                <span className="shop-profile__headtext">
                  <strong>{name || 'Shopper'}</strong>
                  <span title={user?.email}>{user?.email || ''}</span>
                </span>
              </div>
              <button type="button" role="menuitem" onClick={() => go('shop-orders', 'My Orders')}>
                <ClipboardList size={17} /> My Orders
              </button>
              <button type="button" role="menuitem" onClick={goAddress}>
                <MapPin size={17} /> Address book
              </button>
              <button type="button" role="menuitem" onClick={() => go('shop-account', 'Account & Address Book')}>
                <Users size={17} /> Account & benefits
              </button>
              <button type="button" role="menuitem" onClick={() => go('shop-notifications', 'Notifications')}>
                <Bell size={17} /> Notifications
                {unread > 0 && <span className="shop-menu__badge">{unread}</span>}
              </button>
              <div className="shop-profile__sep" />
              <button type="button" role="menuitem" className="shop-profile__signout" onClick={logout}>
                <LogOut size={17} /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {searchBar('shop-searchbar shop-searchbar--mobile')}

      <main className="shop-main workspace-viewport">{children}</main>

      <nav className="shop-bottombar" aria-label="Shopper">
        {BOTTOM_NAV.map((item) => {
          const Icon = item.icon;
          const on = activeTabId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className="shop-bottombar__item"
              data-testid={`nav-${item.id}`}
              aria-current={on ? 'page' : undefined}
              onClick={() => openTab(item.id, item.title, item.icon.name)}
            >
              <Icon size={19} />
              <span>{item.label}</span>
              {item.id === 'shop-notifications' && unread > 0 && (
                <span className="shop-bottombar__badge" aria-label={`${unread} unread notifications`}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
