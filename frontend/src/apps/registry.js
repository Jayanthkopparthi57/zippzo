/**
 * Zippzo app surfaces, built from this shared source tree.
 *
 * They are separate installs in the same way the big quick-commerce players
 * ship a customer app, a store-partner app and a delivery-partner app: each
 * bundle contains only its own shell, and the backend picks which one an
 * account belongs to via target_app_for() in bounded/iam/views.py.
 *
 * `targetApp` is the value the backend returns for this account. A login whose
 * target_app does not match the bundle it was opened in is rejected with a
 * "wrong app" screen rather than silently rendering an empty console.
 */
export const APPS = {
  wms: {
    key: 'wms',
    targetApp: 'WMS',
    name: 'Zippzo Warehouse Management',
    tagline: 'Warehouse inbound, storage, replenishment and outbound dispatch',
    brand: 'Zippzo WMS',
    htmlTitle: 'Zippzo WMS — Warehouse Operations',
    emailLabel: 'Staff email',
    emailPlaceholder: 'operator@zippzo.com',
    icon: '🏬',
    entry: 'index.html',
    allowedRoles: ['SUPER_ADMIN', 'OPS_MANAGER', 'WAREHOUSE_STAFF'],
  },
  darkstore: {
    key: 'darkstore',
    targetApp: 'DARK_STORE',
    name: 'Zippzo Dark Store',
    tagline: 'Dark-store receiving, shelf operations and customer fulfillment',
    brand: 'Zippzo Dark Store',
    htmlTitle: 'Zippzo Dark Store — Store Fulfillment Console',
    emailLabel: 'Store email',
    emailPlaceholder: 'store@zippzo.in',
    icon: '🏪',
    entry: 'darkstore.html',
    allowedRoles: ['SUPER_ADMIN', 'OPS_MANAGER', 'WAREHOUSE_STAFF'],
  },
  shopper: {
    key: 'shopper',
    targetApp: 'SHOPPER',
    name: 'Zippzo Groceries',
    tagline: 'Groceries in minutes',
    brand: 'Zippzo',
    htmlTitle: 'Zippzo — Groceries in minutes',
    emailLabel: 'Customer email',
    emailPlaceholder: 'you@example.com',
    icon: '🛒',
    entry: 'shopper.html',
    allowedRoles: ['CUSTOMER', 'SENDER', 'SUPER_ADMIN'],
  },
  rider: {
    key: 'rider',
    targetApp: 'RIDER',
    name: 'Zippzo Rider',
    tagline: 'Delivery Partner Console',
    brand: 'Zippzo Rider',
    htmlTitle: 'Zippzo Rider — Delivery Partner',
    emailLabel: 'Rider email',
    emailPlaceholder: 'rider@zippzo.in',
    icon: '🚴',
    entry: 'rider.html',
    allowedRoles: ['RIDER', 'SUPER_ADMIN'],
  },
};

// Backwards compatibility alias
APPS.store = APPS.wms;

/**
 * Which app this bundle is, read from the `data-app` attribute of <html>.
 */
export const APP_KEY = (() => {
  const fromDom = typeof document !== 'undefined'
    ? document.documentElement?.dataset?.app
    : null;
  if (APPS[fromDom]) return fromDom;
  if (fromDom === 'store') return 'wms';
  return 'wms';
})();

export const APP = APPS[APP_KEY];

export const APP_NAME = APP.name;
export const APP_BRAND = APP.brand;
export const APP_TAGLINE = APP.tagline;
export const APP_TARGET = APP.targetApp;
