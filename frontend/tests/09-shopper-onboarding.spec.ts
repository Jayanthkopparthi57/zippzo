/* A brand-new customer, from no profile to a shelf they can buy off.
 *
 * This is the gap that had no path at all before: `Customer.user` is read-only
 * on the serializer, so nothing in the application could ever set it, the
 * NOT NULL on `customers.user_id` surfaced as a 500, and `CheckoutView` then
 * refused the account with "no customer account is linked to your login". A
 * shopper could open the storefront and buy nothing.
 *
 * The fix is two halves that have to agree - a first-run gate in the shopper
 * app, and `perform_create` on the customer API - and neither is exercised by
 * the journey spec, because that one signs in as the seeded customer who
 * already has a row. So the account is created fresh here, through the real
 * admin API, and the whole onboarding is driven through the UI.
 */
import { test, expect, type Page } from '@playwright/test';
import { login, APP_ENTRIES, TEST_USERS } from './utils';

async function api(page: Page, method: string, path: string, payload?: any) {
  return page.evaluate(async ([m, p, body]) => {
    const token = window.findZippzoJwt();
    const res = await fetch(p, {
      method: m,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, [method, path, payload] as const);
}

test.describe('a brand-new shopper', () => {
  test.use({ actionTimeout: 180_000, navigationTimeout: 120_000, expect: { timeout: 60_000 } });

  test('creates the profile the storefront would not let them shop without', async ({ browser }) => {
    test.setTimeout(600_000);
    test.slow();

    const baseURL = (test.info().project.use as any)?.baseURL ?? 'http://localhost:3000';
    // A context made by hand does not inherit the project's action/navigation
    // timeouts: it defaults to "no timeout at all", so a locator that never
    // appears hangs the run for the whole test timeout instead of failing fast.
    const ctxOpts = {
      baseURL,
      viewport: { width: 1440, height: 900 },
      actionTimeout: 180_000,
      navigationTimeout: 120_000,
    };
    const adminCtx = await browser.newContext(ctxOpts);
    const shopperCtx = await browser.newContext(ctxOpts);
    const admin = await adminCtx.newPage();
    const shopper = await shopperCtx.newPage();

    let userId = '';
    const email = `onboard.${Date.now().toString(36)}@zippzo.in`;
    const password = 'Onboard123';

    try {
      /* ── 1. provision the login, exactly as an operator would ── */

      await login(admin, TEST_USERS.admin, APP_ENTRIES.store);
      const created = await api(admin, 'POST', '/api/iam/users/', {
        email,
        password,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        full_name: 'Fresh Shopper',
      });
      expect(
        created.status,
        `could not create the login (HTTP ${created.status}): ${JSON.stringify(created.body)}`,
      ).toBe(201);
      userId = created.body.user_id;
      expect(userId).toBeTruthy();

      /* ── 2. sign in on the shopper entry point ── */

      await login(shopper, { email, password, role: 'CUSTOMER' }, APP_ENTRIES.shopper);

      // The gate is the whole point: it only shows for a login with no
      // customer row, which is exactly the state this login is in.
      const gate = shopper.locator('[data-testid="shopper-setup"]');
      await gate.waitFor({ state: 'visible', timeout: 90_000 });
      await expect(shopper.locator('[data-testid="shopper-setup-name"]')).toBeVisible();

      /* ── 3. fill it in, and land on a working storefront ── */

      await shopper.fill('[data-testid="shopper-setup-name"]', 'Fresh Shopper');
      await shopper.click('[data-testid="shopper-setup-submit"]');
      await shopper.locator('[data-testid="nav-shop-storefront"]').waitFor({
        state: 'visible', timeout: 90_000,
      });

      /* ── 4. the profile belongs to this login, and only this login ── */

      const list = await api(shopper, 'GET', '/api/orders/customers/');
      expect(list.status).toBe(200);
      const rows: any[] = list.body?.results ?? list.body ?? [];
      expect(rows.length, 'exactly one shopper profile for one login').toBe(1);
      expect(
        String(rows[0].user),
        'the profile is owned by the login, not by whoever the payload named',
      ).toBe(userId);
      expect(rows[0].name).toBe('Fresh Shopper');
      // Trust is the platform's judgement, not something onboarding sets.
      expect(rows[0].trust_tier).toBe('T0');

      /* ── 5. and the storefront they were promised actually renders ── */

      await shopper.click('[data-testid="nav-shop-storefront"]');
      await shopper
        .locator('[data-testid="product-card"], [data-testid="storefront-empty"]')
        .first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      const text = await shopper.locator('main.workspace-viewport').innerText();
      expect(text.trim().length, 'the storefront is not blank').toBeGreaterThan(30);
    } finally {
      if (userId) {
        await api(admin, 'DELETE', `/api/iam/users/${userId}/`).catch(() => null);
      }
      await adminCtx.close();
      await shopperCtx.close();
    }
  });
});
