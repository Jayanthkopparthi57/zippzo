/**
 * The three Zippzo applications, all built from this one source tree.
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
  store: {
    key: 'store',
    targetApp: 'WMS',
    name: 'Zippzo Store',
    tagline: 'Store Partner Console',
    brand: 'Zippzo Store',
    htmlTitle: 'Zippzo Store — Store Partner Console',
    emailLabel: 'Work email',
    emailPlaceholder: 'operator@zippzo.in',
    // Web entry this app is served from, used by the wrong-app screen to point
    // the operator at the right one. Android installs have no sibling entries.
    entry: 'index.html',
  },
  shopper: {
    key: 'shopper',
    targetApp: 'SHOPPER',
    name: 'Zippzo',
    tagline: 'Groceries in minutes',
    brand: 'Zippzo',
    htmlTitle: 'Zippzo — Groceries in minutes',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    entry: 'shopper.html',
  },
  rider: {
    key: 'rider',
    targetApp: 'RIDER',
    name: 'Zippzo Rider',
    tagline: 'Delivery Partner',
    brand: 'Zippzo Rider',
    htmlTitle: 'Zippzo Rider — Delivery Partner',
    emailLabel: 'Rider email',
    emailPlaceholder: 'rider@zippzo.in',
    entry: 'rider.html',
  },
};

/**
 * Which app this bundle is, read from the `data-app` attribute of <html>.
 *
 * All three entries are emitted by a single Vite build, so an env var cannot
 * differ per entry — the HTML file is the only place that knows which of the
 * three applications it is booting.
 */
export const APP_KEY = (() => {
  const fromDom = typeof document !== 'undefined'
    ? document.documentElement?.dataset?.app
    : null;
  if (APPS[fromDom]) return fromDom;
  // `vite build` copies index.html's attributes, so a stray build without the
  // attribute still lands on the store console rather than crashing.
  return 'store';
})();

export const APP = APPS[APP_KEY];

export const APP_NAME = APP.name;
export const APP_BRAND = APP.brand;
export const APP_TAGLINE = APP.tagline;
export const APP_TARGET = APP.targetApp;
