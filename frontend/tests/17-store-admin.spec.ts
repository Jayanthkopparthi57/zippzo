/* The dark-store admin panel: delivery areas, pricing levers, manpower, riders.
 *
 * These are the quick-commerce controls a store manager actually uses:
 *  - publish a pincode the store will deliver to, see the coverage check agree,
 *    then withdraw it again;
 *  - set a free-delivery threshold and confirm the rule lands on the server;
 *  - see the staffing board and rider roster render from live data.
 *
 * Everything the test creates is removed again, and the pricing rule is put
 * back to "never free", so later specs see the estate they expect.
 */
import { test, expect, type Page } from '@playwright/test';
import { login, loginShopper, TEST_USERS } from './utils';

async function apiGet(page: Page, path: string): Promise<any> {
  return page.evaluate(async (p) => {
    const token = window.findZippzoJwt();
    const res = await fetch(p, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path);
}

async function apiSend(page: Page, path: string, method: string, body?: any): Promise<any> {
  return page.evaluate(async ({ p, m, b }) => {
    const token = window.findZippzoJwt();
    const res = await fetch(p, {
      method: m,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { p: path, m: method, b: body });
}

async function firstDarkStore(page: Page): Promise<any> {
  const sites = await apiGet(page, '/api/network/sites/?page_size=100');
  expect(sites.status).toBe(200);
  const rows: any[] = Array.isArray(sites.body) ? sites.body : sites.body?.results ?? [];
  const store = rows.find((s) => s.site_type === 'DS' || s.site_type === 'DARK_STORE');
  expect(store, 'no dark store is listed in the facility directory').toBeTruthy();
  return store;
}

test.describe('dark-store admin panel', () => {
  test.use({ actionTimeout: 120_000, navigationTimeout: 90_000, expect: { timeout: 30_000 } });

  test('an admin publishes a delivery area, checks coverage, and withdraws it', async ({ page }) => {
    test.setTimeout(300_000);

    await login(page, TEST_USERS.admin);
    const store = await firstDarkStore(page);
    // A pincode unique to this run: a leftover from an aborted run must not
    // turn the "add" step into a duplicate-key failure.
    const pincode = `56${String(1000 + Math.floor(Math.random() * 8999))}`;

    await page.click('[data-testid="nav-admin-settings"]');
    await page.click('[data-testid="admin-tab-areas"]');
    await expect(page.getByTestId('da-panel')).toBeVisible({ timeout: 60_000 });

    // The panel defaults to a real store; make sure it is this one.
    await page.getByTestId('da-site').selectOption(store.site_id);
    await page.getByTestId('da-pincode').fill(pincode);
    await page.getByTestId('da-add').click();
    await expect(page.getByTestId(`da-row-${pincode}`)).toBeVisible({ timeout: 60_000 });

    // The server has it, and checkout would now honour it.
    await expect.poll(async () => {
      const res = await apiGet(page, `/api/routing/delivery-areas/?site=${store.site_id}&page_size=500`);
      const list: any[] = res.body?.results ?? res.body ?? [];
      return list.some((row) => row.pincode === pincode && row.is_active);
    }, { timeout: 30_000 }).toBe(true);

    // Coverage check tells the admin which stores serve this pincode.
    await page.getByTestId('da-check-pincode').fill(pincode);
    await page.getByTestId('da-check').click();
    await expect(page.getByTestId('da-check-result')).toContainText(store.code, { timeout: 30_000 });

    // Withdraw it through the UI and confirm the server agrees.
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`da-del-${pincode}`).click();
    await expect(page.getByTestId(`da-row-${pincode}`)).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(async () => {
      const res = await apiGet(page, `/api/routing/delivery-areas/?site=${store.site_id}&page_size=500`);
      const list: any[] = res.body?.results ?? res.body ?? [];
      return list.some((row) => row.pincode === pincode);
    }, { timeout: 30_000 }).toBe(false);
  });

  test('free delivery above a threshold is saved and then switched off again', async ({ page }) => {
    test.setTimeout(300_000);

    await login(page, TEST_USERS.admin);
    const store = await firstDarkStore(page);

    await page.click('[data-testid="nav-admin-settings"]');
    await page.click('[data-testid="admin-tab-pricing"]');
    await expect(page.getByTestId(`pricing-row-${store.code}`)).toBeVisible({ timeout: 60_000 });

    const freeInput = page.getByTestId(`pricing-free-${store.code}`);
    await freeInput.fill('499');
    await page.click(`[data-testid="pricing-save-${store.code}"]`);

    await expect.poll(async () => {
      const res = await apiGet(page, `/api/money/pricing-rules/?site=${store.site_id}`);
      const list: any[] = res.body?.results ?? res.body ?? [];
      const rule = list.find((r) => String(r.site) === String(store.site_id));
      return rule ? Number(rule.free_above) : null;
    }, { timeout: 30_000 }).toBe(499);
    await expect(page.getByTestId(`pricing-current-${store.code}`)).toContainText('499');

    // Put the lever back where it was so the next spec is charged normally.
    await page.getByTestId(`pricing-free-${store.code}`).fill('0');
    await page.click(`[data-testid="pricing-save-${store.code}"]`);
    await expect.poll(async () => {
      const res = await apiGet(page, `/api/money/pricing-rules/?site=${store.site_id}`);
      const list: any[] = res.body?.results ?? res.body ?? [];
      const rule = list.find((r) => String(r.site) === String(store.site_id));
      return rule ? Number(rule.free_above) : 0;
    }, { timeout: 30_000 }).toBe(0);
  });

  test('the manpower board and rider roster render live data', async ({ page }) => {
    test.setTimeout(300_000);

    await login(page, TEST_USERS.admin);
    await page.click('[data-testid="nav-admin-settings"]');

    await page.click('[data-testid="admin-tab-manpower"]');
    await expect(page.getByTestId('mp-panel')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('mp-stat-rostered')).toBeVisible();
    await expect(page.getByTestId('mp-stat-monthly')).toHaveText(/[\d,]+/);
    // Either the board has rows or it states the roster is empty - never blank.
    await expect(
      page.locator('[data-testid="mp-table"], [data-testid="mp-empty"]').first()
    ).toBeVisible({ timeout: 60_000 });

    await page.click('[data-testid="admin-tab-riders"]');
    await expect(page.getByTestId('rv-panel')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('rv-table')).toBeVisible({ timeout: 60_000 });

    await page.click('[data-testid="admin-tab-stores"]');
    await expect(page.getByTestId(`site-accepting-${(await firstDarkStore(page)).code}`))
      .toBeVisible({ timeout: 60_000 });
  });

  test('a warehouse operator cannot open the admin panel', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page, TEST_USERS.warehouseStaff);
    await expect(page.getByTestId('nav-admin-settings')).toHaveCount(0);
  });

  test('a shopper is told when their address is outside the store it delivers from', async ({ page, browser }) => {
    test.setTimeout(600_000);

    // Publishing one pincode turns a store from "delivers anywhere" into
    // "delivers here only", which is the wall the shopper must see.
    await login(page, TEST_USERS.admin);
    const store = await firstDarkStore(page);

    const shopperContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL as string,
    });
    const shopperPage = await shopperContext.newPage();
    let elsewhere = '';
    let createdAddress: any = null;
    try {
      await loginShopper(shopperPage);

      // The shopper's own address decides the pincode. Give them one if this
      // is a fresh account, then publish a neighbouring pincode instead: the
      // store now serves *that* pincode and not theirs.
      let addresses = await apiGet(shopperPage, '/api/orders/addresses/');
      let list: any[] = addresses.body?.results ?? addresses.body ?? [];
      if (!list.length) {
        const made = await apiSend(shopperPage, '/api/orders/addresses/', 'POST', {
          label: 'E2E', line1: '1 Test Lane', city: 'Bhimavaram', pincode: '560001',
          is_default: true,
        });
        expect(made.status, 'a shopper address can be created for the check').toBeLessThan(300);
        createdAddress = made.body;
        addresses = await apiGet(shopperPage, '/api/orders/addresses/');
        list = addresses.body?.results ?? addresses.body ?? [];
      }
      const home = list.find((a) => a.is_default) || list[0];
      const last = Number(home.pincode.slice(-1));
      elsewhere = `${home.pincode.slice(0, 5)}${(last + 1) % 10}`;

      await page.click('[data-testid="nav-admin-settings"]');
      await page.click('[data-testid="admin-tab-areas"]');
      await expect(page.getByTestId('da-panel')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('da-site').selectOption(store.site_id);
      await page.getByTestId('da-pincode').fill(elsewhere);
      await page.getByTestId('da-add').click();
      await expect(page.getByTestId(`da-row-${elsewhere}`)).toBeVisible({ timeout: 60_000 });

      await shopperPage.click('[data-testid="nav-shop-storefront"]');
      const picker = shopperPage.locator('#shop-select');
      if (await picker.count()) await picker.selectOption(store.code);
      // The shelf was loaded before the pincode was published; Refresh asks
      // the server the same question again with the address attached.
      await shopperPage.locator('button.shop-refresh').click();

      await expect(shopperPage.getByTestId('serviceability-banner'))
        .toBeVisible({ timeout: 90_000 });
      await expect(shopperPage.getByTestId('serviceability-banner')).toContainText(home.pincode);

      // A basket cannot be checked out at that door.
      const cards = shopperPage.locator('[data-testid="product-card"]');
      if (await cards.count()) {
        await cards.first().locator('[data-testid="product-add"]').click();
        await expect(shopperPage.getByTestId('place-order')).toBeDisabled({ timeout: 30_000 });
      }
    } finally {
      // Never leave the store pinned to the test pincode, and never leave the
      // throwaway address behind.
      if (elsewhere) {
        const areas = await apiGet(page, `/api/routing/delivery-areas/?site=${store.site_id}&page_size=500`);
        for (const row of (areas.body?.results ?? areas.body ?? [])) {
          if (row.pincode === elsewhere) {
            await apiSend(page, `/api/routing/delivery-areas/${row.area_id}/`, 'DELETE');
          }
        }
      }
      if (createdAddress?.address_id && !shopperPage.isClosed()) {
        await apiSend(shopperPage, `/api/orders/addresses/${createdAddress.address_id}/`, 'DELETE');
      }
      await shopperContext.close();
    }
  });
});
