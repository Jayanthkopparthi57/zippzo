/* A rider's phone is the only thing that knows where the rider is.

 * The fleet board used to be a list of names: the store could see who was
 * online but not where. Now the rider app pushes a pin while it is online,
 * and the Rider Fleet screen reads it back - last seen, coordinates, open
 * jobs - so a counter can answer "where is Ravi?" without a phone call.
 *
 * Nothing here is typed in by an operator: the endpoint is me/location on
 * the rider's own profile, and the board just renders whatever the device
 * last said. This test drives the real path - a browser with a mock
 * position, the rider console watching it, and the store reading the pin.
 */
import { test, expect, type Page } from '@playwright/test';
import { login, loginRider, selectDarkStore, TEST_USERS } from './utils';

async function apiGet(page: Page, path: string): Promise<any> {
  return page.evaluate(async (p) => {
    const token = window.findZippzoJwt();
    const res = await fetch(p, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path);
}

test.describe('rider GPS and the fleet board', () => {
  test.use({ actionTimeout: 120_000, navigationTimeout: 90_000, expect: { timeout: 30_000 } });

  test('a rider online with a position shows up pinned on the fleet board',
    async ({ browser }) => {
      test.setTimeout(420_000);

      const baseURL = (test.info().project.use as any)?.baseURL ?? 'http://localhost:3000';
      const pin = { latitude: 17.4012, longitude: 78.479 };
      const riderCtx = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 900 },
        geolocation: pin,
        permissions: ['geolocation'],
      });
      const rider = await riderCtx.newPage();
      const store = await browser.newPage();

      try {
        /* ── 1. Rider: online, with a device that reports a position ── */
        await loginRider(rider);
        const me = await apiGet(rider, '/api/delivery/rider-profiles/me/');
        expect(me.status).toBe(200);
        expect(me.body.has_profile, 'the rider account has no profile to pin')
          .toBe(true);
        const site: string | undefined = me.body.current_site_code;
        expect(site, 'the rider account has no home store').toBeTruthy();
        const riderId: string = me.body.rider_id;

        // Go online through the console's own button: the flip starts the
        // location watcher in the same state change the rider would trigger
        // on the road. (A page reload cannot be used to restart the watcher -
        // the session-restore path validates against /iam/users/, which a
        // rider is refused, so a reload would drop the rider back to login.)
        if (!me.body.is_online) {
          await rider.getByRole('button', { name: 'Go online' }).click();
        }
        await expect(rider.locator('[data-testid="rd-loc"]')).toBeVisible({
          timeout: 60_000,
        });

        // The device pin has to actually reach the server, not just render.
        await expect
          .poll(async () => {
            const r = await apiGet(rider, '/api/delivery/rider-profiles/me/');
            return r.body?.last_lat ?? null;
          }, { timeout: 60_000, intervals: [2000] })
          .not.toBeNull();
        const after = await apiGet(rider, '/api/delivery/rider-profiles/me/');
        expect(after.body.last_lat).toBeCloseTo(pin.latitude, 3);
        expect(after.body.last_lng).toBeCloseTo(pin.longitude, 3);
        expect(after.body.last_seen_at, 'the pin was not stamped with a time')
          .toBeTruthy();
        await expect(rider.locator('[data-testid="rd-loc"]'))
          .toContainText('sharing location');

        /* ── 2. Store: the same pin, on the fleet board ── */
        await selectDarkStore(store, site);
        await store.click('[data-testid="nav-riders"]');
        const row = store.locator(`[data-testid="rf-row-${riderId}"]`);
        await expect(row).toBeVisible({ timeout: 60_000 });
        await expect(store.locator(`[data-testid="rf-online-${riderId}"]`))
          .toContainText('Online');
        await expect(store.locator(`[data-testid="rf-pin-${riderId}"]`))
          .toContainText('17.4012', { timeout: 30_000 });
        await expect(store.locator(`[data-testid="rf-lastseen-${riderId}"]`))
          .toContainText('just now');
      } finally {
        await riderCtx.close();
        await store.close();
      }
    });

  test('the orders board lists this store\'s live work', async ({ page }) => {
    test.setTimeout(300_000);

    await selectDarkStore(page);
    const storeCode = await page.inputValue('[data-testid="facility-switcher"]');
    expect(storeCode, 'no dark store was selected').toBeTruthy();

    // Whichever orders this store actually has, the board shows exactly the
    // live ones - and never a silently empty screen with no explanation.
    // The board is scoped by site id, so resolve this store's id first and
    // compare against the same slice the screen fetches.
    const sites = await apiGet(page, '/api/network/sites/?page_size=100');
    expect(sites.status).toBe(200);
    const siteRows: any[] = Array.isArray(sites.body) ? sites.body : sites.body?.results ?? [];
    const site = siteRows.find((s) => s.code === storeCode);
    expect(site, 'the selected store is not in the facility directory').toBeTruthy();

    const orders = await apiGet(
      page, `/api/orders/orders/?site=${site.site_id}&page_size=100`);
    expect(orders.status).toBe(200);
    const rows: any[] = Array.isArray(orders.body) ? orders.body : orders.body?.results ?? [];
    const liveStatuses = new Set([
      'PLACED', 'CONFIRMED', 'PRICE_FINALIZED', 'ALLOCATED', 'PICKING',
      'PACKED', 'STAGED', 'RIDER_ASSIGNED', 'OUT_FOR_DELIVERY', 'ARRIVED',
      'PICKED_UP',
    ]);

    await page.click('[data-testid="nav-orders"]');
    await expect(page.locator('[data-testid="ov-refresh"]')).toBeVisible({
      timeout: 60_000,
    });

    const live = rows.filter((o) => liveStatuses.has(o.status));
    if (live.length === 0) {
      await expect(page.locator('[data-testid="ov-empty"]')).toBeVisible();
    } else {
      // At least the most recent live order is on the board, with its status.
      const latest = live[0];
      const card = page.locator(`[data-testid="ov-order-${latest.order_no}"]`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(`[data-testid="ov-status-${latest.order_no}"]`))
        .toContainText(latest.status);
    }
  });
});
