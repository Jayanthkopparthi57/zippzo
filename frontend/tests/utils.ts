import { test, Page, Locator, expect } from '@playwright/test';

export const TEST_USERS = {
  admin: { email: 'admin@zippzo.in', password: 'admin123', role: 'SUPER_ADMIN' },
  opsManager: { email: 'ops@zippzo.in', password: 'ops123', role: 'OPS_MANAGER' },
  warehouseStaff: { email: 'warehouse@zippzo.in', password: 'warehouse123', role: 'WAREHOUSE_STAFF' },
  rider: { email: 'rider@zippzo.in', password: 'rider123', role: 'RIDER' },
  customer: { email: 'customer@zippzo.in', password: 'customer123', role: 'CUSTOMER' },
};

/**
 * The three Zippzo applications are three separate web entries out of one
 * source tree. An account only signs in on the entry that matches its role, so
 * each helper below starts from its own HTML file.
 */
export const APP_ENTRIES = {
  store: '/index.html',
  shopper: '/shopper.html',
  rider: '/rider.html',
};

export async function login(
  page: Page,
  user = TEST_USERS.admin,
  entry: string = APP_ENTRIES.store,
) {
  await page.goto(entry);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);

  // The token is the load-bearing landmark: every downstream helper (tokenOf,
  // apiGet) reads it from localStorage, and the login form can disappear
  // before AuthContext has stored the response. A nav testid cannot be used
  // either — three shells render after login (WMS, shopper, rider) and only
  // the WMS one has nav-skus.
  //
  // One bounded retry, because the shared dev backend sits in front of a cold
  // remote Neon instance that has been known to answer login with a 500 and
  // then fail every following test in the file. Wrong credentials fail both
  // attempts, so this cannot hide an auth regression.
  let failure: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.click('button[type="submit"]');
    try {
      await page.waitForFunction(
        () => !!window.localStorage.getItem('zippzo_jwt'),
        undefined,
        { timeout: 60_000 },
      );
      failure = null;
      break;
    } catch (err) {
      failure = err;
      if (attempt === 1) break;
      await page.fill('input[type="email"]', user.email);
      await page.fill('input[type="password"]', user.password);
    }
  }
  if (failure) throw failure;

  await page.locator('input[type="email"]').waitFor({ state: 'hidden', timeout: 90_000 });
  await page.waitForLoadState('networkidle');
}

/**
 * The three applications each boot their own bundle, and login() allows itself
 * two 60s waits before giving up. The 30s Playwright default would kill a
 * merely-slow cold-backend login, so give these helpers room.
 */
function allowSlowLogin() {
  const info = test.info();
  if (info && info.timeout < 120_000) info.setTimeout(120_000);
}

/** The customer application: storefront, orders, notifications, account. */
export async function loginShopper(page: Page, user = TEST_USERS.customer) {
  allowSlowLogin();
  await login(page, user, APP_ENTRIES.shopper);
  await page
    .locator('[data-testid="nav-shop-storefront"]')
    .waitFor({ state: 'visible', timeout: 90_000 });
}

/** Rider gets an isolated console (no sidebar), on its own entry point. */
export async function loginRider(page: Page, user = TEST_USERS.rider) {
  allowSlowLogin();
  await login(page, user, APP_ENTRIES.rider);
  await page
    .locator('[data-testid="rider-shell"], [data-testid="rider-setup"], [data-testid="rider-loading"]')
    .first()
    .waitFor({ state: 'visible', timeout: 90_000 });
}

/**
 * The store-ops sections are not a separate console: they are part of the WMS
 * shell and appear when the operator selects a dark-store site. No seeded role
 * gets a DS facility at login, so log in as a WMS operator and pick the store
 * from the header site picker.
 */
export async function selectDarkStore(page: Page, siteCode?: string) {
  await login(page, TEST_USERS.admin);
  const picker = page.locator('[data-testid="facility-switcher"]');
  await picker.waitFor({ state: 'visible', timeout: 60_000 });
  // The site directory loads after the header renders, so an option read too
  // early comes back empty and selectOption() rejects the disabled placeholder.
  const dsOption = page.locator(
    '[data-testid="facility-switcher"] optgroup[label="Dark stores"] option'
  );
  await dsOption.first().waitFor({ state: 'attached', timeout: 60_000 });
  const code = siteCode ?? (await dsOption.first().getAttribute('value'));
  if (!code) throw new Error('no dark store site is offered in the facility picker');
  await picker.selectOption(code);
  await page.locator('[data-testid="nav-ds-dashboard"]').waitFor({ state: 'visible', timeout: 90_000 });
  await page.waitForLoadState('networkidle');
}

/** Navigate to a tab by its sidebar testid and wait for a wf-panel to render. */
export async function openTab(page: Page, tabId: string) {
  await page.click(`[data-testid="nav-${tabId}"]`);
  await page.locator('.wf-panel').first().waitFor({ state: 'visible', timeout: 90_000 });
}

export async function navigateTo(page: Page, tabId: string) {
  await page.click(`[data-testid="nav-${tabId}"]`);
  await page.waitForLoadState('networkidle');
}

export async function waitForApi(page: Page, urlPattern: string | RegExp) {
  return page.waitForResponse(r => r.url().includes(typeof urlPattern === 'string' ? urlPattern : ''));
}

export async function fillForm(page: Page, fields: Record<string, string>) {
  for (const [selector, value] of Object.entries(fields)) {
    await page.fill(selector, value);
  }
}

export async function selectOption(page: Page, selector: string, value: string) {
  await page.selectOption(selector, value);
}

export async function expectToast(page: Page, text: string) {
  await expect(page.locator('.toast, [role="alert"], .alert-success, .alert-error').filter({ hasText: text })).toBeVisible({ timeout: 10000 });
}

export async function expectError(page: Page, text: string) {
  await expect(page.locator('.error, .alert-error, [role="alert"]').filter({ hasText: text })).toBeVisible({ timeout: 10000 });
}

export function generateId(prefix = 'TEST') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}