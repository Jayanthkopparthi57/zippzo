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
  darkstore: '/darkstore.html',
  shopper: '/shopper.html',
  rider: '/rider.html',
};

/** Each app keeps its own localStorage bucket, so nothing crosses tabs. */
const NAMESPACED_APP_KEYS: Record<string, string> = {
  '/index.html': 'wms',
  '/operations-app.html': 'wms',
  '/darkstore.html': 'darkstore',
  '/shopper.html': 'shopper',
  '/rider.html': 'rider',
};

export function appKeyForEntry(entry: string): string {
  const path = entry.split('?')[0].split('#')[0];
  return NAMESPACED_APP_KEYS[path] || 'wms';
}

/** Read whichever app's JWT is in this page's session storage. */
export function findZippzoJwt(): string {
  if (typeof window === 'undefined') return '';
  for (const key of ['zippzo_jwt:wms', 'zippzo_jwt:darkstore', 'zippzo_jwt:shopper', 'zippzo_jwt:rider']) {
    const value = window.localStorage.getItem(key);
    if (value) return value;
  }
  return '';
}

/** Wait for a specific auth call and click the wizard's primary button. */
async function submitStep(page: Page, endpoint: string) {
  const response = page.waitForResponse(
    r => r.url().includes(endpoint),
    { timeout: 60_000 },
  );
  await page.locator('[data-testid="login-submit"]').click();
  return response;
}

async function readJson(response: any) {
  try { return await response.json(); } catch { return null; }
}

/**
 * Complete the staff sign-in wizard.
 *
 * The server decides the path: rider/consumer accounts receive a token from the
 * password step; single-site staff go straight to the one-time code; multi-site
 * staff first choose one of the facilities the server returned. In development
 * `OTP_DEV_ECHO=1` includes the code so the suite never needs an SMS provider.
 */
export async function login(
  page: Page,
  user = TEST_USERS.admin,
  entry: string = APP_ENTRIES.store,
) {
  await page.goto(entry);
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);

  let response = await submitStep(page, '/api/iam/auth/login');
  let body = await readJson(response);

  if (body?.facility_required) {
    const options = page.locator('[data-testid="login-facility-option"]');
    await options.first().waitFor({ state: 'visible', timeout: 30_000 });
    const preferred = entry.includes('darkstore')
      ? options.filter({ hasText: 'Dark store' })
      : entry.includes('index') ? options.filter({ hasText: 'Warehouse' }) : options;
    const target = (await preferred.count()) ? preferred.first() : options.first();
    response = page.waitForResponse(
      r => r.url().includes('/api/iam/auth/facility'),
      { timeout: 60_000 },
    );
    await target.click();
    response = await response;
    body = await readJson(response);
  }

  if (body?.otp_required || response.status() === 403) {
    const otp = body?.dev_otp;
    if (!otp) throw new Error(`login as ${user.email}: the server did not return a development OTP`);
    await page.locator('[data-testid="login-otp"]').fill(String(otp));
    response = await submitStep(page, '/api/iam/auth/otp/verify');
    body = await readJson(response);
  }

  if (response.status() !== 200) {
    throw new Error(`login as ${user.email} failed with HTTP ${response.status()}: ${JSON.stringify(body)}`);
  }

  const jwtKey = `zippzo_jwt:${appKeyForEntry(entry)}`;
  await page.waitForFunction(
    (key: string) => !!window.localStorage.getItem(key),
    jwtKey,
    { timeout: 60_000 },
  );
  await page.locator('input[type="email"]').waitFor({ state: 'hidden', timeout: 90_000 });
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
export async function selectDarkStore(page: Page, siteCode?: string): Promise<string> {
  await login(page, TEST_USERS.admin, APP_ENTRIES.darkstore);

  const gate = page.locator('[data-testid="ds-store-gate"]');
  const resolved = page.locator(
    '[data-testid="ds-overview-tiles"], [data-testid="ds-overview-error"]'
  );

  await Promise.race([
    gate.waitFor({ state: 'visible', timeout: 90_000 }),
    resolved.first().waitFor({ state: 'visible', timeout: 90_000 }),
  ]);

  if (await gate.isVisible().catch(() => false)) {
    const options = page.locator('[data-testid^="ds-store-option-"]');
    await options.first().waitFor({ state: 'visible', timeout: 60_000 });
    const target = siteCode
      ? page.locator(`[data-testid="ds-store-option-${siteCode}"]`)
      : options.first();
    await target.click();
    await gate.waitFor({ state: 'hidden', timeout: 90_000 });
  }

  const code = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('zippzo_auth_facility:darkstore');
      return raw ? JSON.parse(raw)?.code || '' : '';
    } catch {
      return '';
    }
  });
  if (!code) throw new Error('dark store resolved but no facility code was persisted');
  return code;
}

/** Navigate to a tab by its sidebar testid and wait for a wf-panel to render. */
export async function openDarkStoreTab(page: Page, title: string) {
  const item = page.locator('button.subnav-item', { hasText: title });

  if ((await item.count()) === 0) {
    for (const header of [
      'Outbound · Customer Orders',
      'Inbound · Store Stock',
      'Store control',
      'Administration',
    ]) {
      const group = page.locator('button.accordion-header', { hasText: header });
      if ((await group.count()) === 0) continue;
      const isOpen = await group
        .evaluate((el) => el.classList.contains('open'))
        .catch(() => false);
      if (!isOpen) await group.click();
      if ((await item.count()) > 0) break;
    }
  }

  await item.first().click();
  await page
    .locator('.wf-panel, .screen-header, .data-table, .tally-grid')
    .first()
    .waitFor({ state: 'visible', timeout: 90_000 });
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
