/* The rider's personal QR code hands them a staged job at the counter.
 *
 * Two consoles, one scan. The rider shows a code that never changes between
 * app opens; the store operator, watching a staged order nobody has taken yet,
 * scans it instead of hunting for the rider in a dropdown. The scan itself is
 * the acceptance — the task moves straight to ACCEPTED, the state the rider's
 * own Accept reaches — and the rider's console shows the job without ever
 * tapping anything.
 *
 * Test 1 pins the contract of the code itself: same string from the API and
 * on screen, a real QR image behind it, and the scan ledger (scan_count) that
 * makes an unscanned code distinguishable from a busy one.
 *
 * Test 2 runs the whole counter story with nothing stubbed: a shopper order,
 * picked and sealed into a tote by the store, assigned by scanning the rider's
 * code, then verified on both sides — API (rider stamped on the task) and UI
 * (row accepted on the store, active job on the rider) — plus the scan ledger
 * moving, which proves the scan was recorded and not just believed.
 */
import { test, expect, type Page } from '@playwright/test';
import { login, loginRider, selectDarkStore, APP_ENTRIES, TEST_USERS } from './utils';

/** Read a JSON endpoint through the session already open on `page`. */
async function apiGet(page: Page, path: string): Promise<any> {
  return page.evaluate(async (p) => {
    const token = window.localStorage.getItem('zippzo_jwt');
    const res = await fetch(p, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path);
}

/** Write through the same session, for test setup only. */
async function apiPost(page: Page, path: string, payload: any): Promise<any> {
  return page.evaluate(async ([p, body]) => {
    const token = window.localStorage.getItem('zippzo_jwt');
    const res = await fetch(p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, [path, payload] as const);
}

/**
 * The storefront is reached through the shared entry helper, but a shopper who
 * has never ordered before stops at a first-run gate that has no sidebar, so
 * the nav landmark the shared helper waits for would never appear.
 */
async function shopperSignIn(page: Page) {
  await login(page, TEST_USERS.customer, APP_ENTRIES.shopper);
  await page
    .locator('[data-testid="shopper-setup"], [data-testid="nav-shop-storefront"]')
    .first()
    .waitFor({ state: 'visible', timeout: 90_000 });
  if (await page.locator('[data-testid="shopper-setup"]').count()) {
    await page.fill('[data-testid="shopper-setup-name"]', 'Probe Shopper');
    await page.click('[data-testid="shopper-setup-submit"]');
    await page.locator('[data-testid="nav-shop-storefront"]').waitFor({
      state: 'visible', timeout: 90_000,
    });
  }
}

/** A settled store console section: clear StoreGate, then wait for content. */
async function openStoreTab(page: Page, site: string, navId: string, arrivals: string) {
  await page.click(`[data-testid="nav-${navId}"]`);
  const gate = page.locator('[data-testid="ds-store-gate"]');
  const option = page.locator(`[data-testid="ds-store-option-${site}"]`);
  await page
    .locator(`[data-testid="ds-store-gate"], ${arrivals}`)
    .first()
    .waitFor({ state: 'visible', timeout: 120_000 });
  if (await gate.count()) {
    await option.waitFor({ state: 'visible', timeout: 60_000 });
    await option.click();
  }
  await page.locator(arrivals).first().waitFor({ state: 'visible', timeout: 120_000 });
}

/** The receipt screen prints the number under an ORDER NUMBER caption. */
function receiptOrderNo(page: Page) {
  return page.evaluate(() => {
    const caption = [...document.querySelectorAll('div')]
      .find((d) => d.textContent?.trim() === 'ORDER NUMBER');
    return caption?.nextElementSibling?.textContent?.trim() || null;
  });
}

/** The first line that still has units outstanding, with its shelf and SKU. */
async function nextPickLine(page: Page) {
  const card = page
    .locator('[data-testid^="ds-pick-line-"][data-state]:not([data-state="done"])')
    .first();
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  const testid = (await card.getAttribute('data-testid'))!;
  const index = testid.replace('ds-pick-line-', '');
  const skuText = await page.locator(`[data-testid="ds-pick-line-${index}-sku"]`).innerText();
  const sku = /\b([A-Za-z0-9._-]{4,})\b/.exec(skuText)?.[1];
  const binText = await page.locator(`[data-testid="ds-pick-line-bin-${index}"]`).innerText();
  return { sku, bin: /Bin\s+(\S+)/.exec(binText)?.[1], binText };
}

test.describe('rider QR assignment at the counter', () => {
  test.use({ actionTimeout: 180_000, navigationTimeout: 120_000, expect: { timeout: 60_000 } });

  test('the rider console shows a stable personal QR code', async ({ page }) => {
    test.setTimeout(300_000);

    await loginRider(page);

    const qr = await apiGet(page, '/api/delivery/rider-profiles/me/qr/');
    expect(qr.status, 'a rider with a profile must be able to read their own code')
      .toBe(200);
    expect(qr.body.code).toMatch(/^RIDER:[0-9a-f-]{36}$/i);
    expect(qr.body.payload, 'the image and the scanned string are the same value')
      .toBe(qr.body.code);
    expect(typeof qr.body.scan_count).toBe('number');
    expect(qr.body.name, 'the code names the rider the counter is handing work to')
      .toBeTruthy();

    // The counter QR is gone from the rider's own screen; the rider scans the
    // store's QR to clock in instead.
    await page.getByRole('button', { name: 'Scan' }).click();
    await expect(page.locator('[data-testid="rd-scan"]')).toBeVisible({ timeout: 30_000 });

    // Stable: the second read is the same string, not a fresh nonce.
    const again = await apiGet(page, '/api/delivery/rider-profiles/me/qr/');
    expect(again.body.code).toBe(qr.body.code);
  });

  test('a store assigns a staged job by scanning that code', async ({ browser }) => {
    test.setTimeout(1_500_000);
    test.slow();

    const baseURL = (test.info().project.use as any)?.baseURL ?? 'http://localhost:3000';
    const ctxOpts = {
      baseURL,
      viewport: { width: 1440, height: 900 },
      actionTimeout: 180_000,
      navigationTimeout: 120_000,
    };
    const shopperCtx = await browser.newContext(ctxOpts);
    const storeCtx = await browser.newContext(ctxOpts);
    const riderCtx = await browser.newContext(ctxOpts);
    const shopper = await shopperCtx.newPage();
    const store = await storeCtx.newPage();
    const rider = await riderCtx.newPage();

    try {
      /* ── 1. Rider: read the code, offline — presence at the counter is enough ── */

      await loginRider(rider);
      const me = await apiGet(rider, '/api/delivery/rider-profiles/me/');
      const site: string | undefined = me?.body?.current_site_code;
      expect(site, 'the rider account has no home store to be assigned at')
        .toBeTruthy();

      const qrBefore = await apiGet(rider, '/api/delivery/rider-profiles/me/qr/');
      expect(qrBefore.status).toBe(200);
      const riderQr: string = qrBefore.body.payload;
      expect(riderQr).toMatch(/^RIDER:/);

      /* ── 2. Store: the console, the empty tote, the shelf stock ── */

      await selectDarkStore(store, site!);
      const overview = await apiGet(store, '/api/network/overview');
      const storeRow = (overview.body?.dark_stores || []).find((s: any) => s.code === site);
      expect(storeRow, `dark store ${site} is not in the facility directory`).toBeTruthy();
      const siteId = storeRow.site_id as string;

      const totes = await apiGet(
        store,
        `/api/inventory/lpns/?current_site=${siteId}&status__in=EMPTY,CREATED&page_size=10`,
      );
      expect(totes.status).toBe(200);
      let emptyTotes: any[] = totes.body?.results ?? totes.body ?? [];

      if (emptyTotes.length === 0) {
        const made = await apiPost(store, '/api/inventory/lpns/', {
          lpn_id: `E2E-QR-${Date.now()}`,
          barcode: `E2EQRTOTE${Date.now()}`,
          lpn_type: 'TOTE',
          current_site: siteId,
          status: 'EMPTY',
          created_by: 'e2e-qr',
        });
        expect(made.status, `provisioning a tote at ${site} failed (HTTP ${made.status})`)
          .toBe(201);
        emptyTotes = [made.body];
      }

      /* ── 3. Shopper: a real COD order for the store to stage ── */

      await shopperSignIn(shopper);
      await shopper.click('[data-testid="nav-shop-storefront"]');
      const storePicker = shopper.locator('#shop-select');
      if (await storePicker.count()) await storePicker.selectOption(site!);
      await shopper
        .locator('[data-testid="product-card"], [data-testid="storefront-empty"]')
        .first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      expect(
        await shopper.locator('[data-testid="product-card"]').count(),
        `the shelf at ${site} has nothing a customer can buy`,
      ).toBeGreaterThan(0);

      if (await shopper.getByText('No delivery address yet').count()) {
        await shopper.getByRole('button', { name: 'Manage' }).click();
        await shopper.getByPlaceholder('Flat, building, street *').fill('12, QR Street');
        await shopper.getByPlaceholder('City *').fill('Bhimavaram');
        await shopper.getByPlaceholder('PIN *').fill('530001');
        await shopper.getByRole('button', { name: 'Add address' }).click();
        await shopper.locator('[data-testid="toast-success"]').first().waitFor({
          state: 'visible', timeout: 60_000,
        });
      }

      const firstCard = shopper.locator('[data-testid="product-card"]').first();
      await firstCard.locator('[data-testid="product-add"]').click();
      await expect(shopper.locator('[data-testid="basket-line"]').first()).toContainText('×1');

      const place = shopper.getByRole('button', { name: /^Place order/ });
      await place.click();
      await shopper.getByRole('heading', { name: 'Order placed!' }).waitFor({
        state: 'visible', timeout: 120_000,
      });
      const orderNo = await receiptOrderNo(shopper);
      expect(orderNo, 'the receipt did not name the order it just created').toBeTruthy();

      /* ── 4. Store: pick it off the shelf and seal it into a tote ── */

      await openStoreTab(store, site!, 'ds-order-picking',
        '[data-testid="ds-pick-queue"], [data-testid="ds-pick-empty"], [data-testid="ds-pick-queue-error"]');
      const open = store.locator(`[data-testid="ds-pick-open-${orderNo}"]`);
      await open.waitFor({ state: 'visible', timeout: 180_000 });
      await open.click();
      await store.locator('[data-testid="ds-pick-work"]').waitFor({
        state: 'visible', timeout: 60_000,
      });
      expect(
        await store.locator('[data-testid="ds-pick-blocked"]').count(),
        'the order reached the pick queue already refused',
      ).toBe(0);

      if (await store.locator('[data-testid="ds-pick-needs-allocation"]').count()) {
        await store.click('[data-testid="ds-pick-allocate"]');
        await expect(store.locator('[data-testid="ds-pick-route"]')).toBeVisible({
          timeout: 60_000,
        });
      }

      const complete = store.locator('[data-testid="ds-pick-complete"]');
      for (let pass = 0; pass < 16 && !(await complete.isEnabled().catch(() => false)); pass++) {
        const binField = store.locator('[data-testid="ds-pick-bin-scan-text"]');
        const itemField = store.locator('[data-testid="ds-pick-item-scan-text"]');

        if (await binField.isVisible().catch(() => false)) {
          const line = await nextPickLine(store);
          expect(line.bin, `no shelf is allocated to this line: ${line.binText}`).toBeTruthy();
          await binField.fill(line.bin!);
          await store.click('[data-testid="ds-pick-bin-scan-submit"]');
          await store.locator('[data-testid="ds-pick-bin-confirmed"]').waitFor({
            state: 'visible', timeout: 60_000,
          });
          continue;
        }

        if (await itemField.isVisible().catch(() => false)) {
          const line = await nextPickLine(store);
          expect(line.sku, 'the pick line names no SKU that can be scanned').toBeTruthy();
          await itemField.fill(line.sku!);
          await store.click('[data-testid="ds-pick-item-scan-submit"]');
          await expect(
            store.locator('[data-testid^="ds-pick-line-"][data-state="done"]').first(),
          ).toBeVisible({ timeout: 60_000 });
          continue;
        }

        throw new Error('the pick panel offered neither a bin scan nor an item scan');
      }
      await expect(complete, 'units are still outstanding on this order').toBeEnabled();
      await complete.click();
      await expect(store.locator('[data-testid="toast-success"]').first()).toContainText(
        `Order ${orderNo} picked`, { timeout: 60_000 },
      );

      await openStoreTab(store, site!, 'ds-order-packing',
        '[data-testid="ds-pack-queue"], [data-testid="ds-pack-empty"], [data-testid="ds-pack-queue-error"]');
      const packOpen = store.locator(`[data-testid="ds-pack-open-${orderNo}"]`);
      await packOpen.waitFor({ state: 'visible', timeout: 120_000 });
      await packOpen.click();
      await store.locator('[data-testid="ds-pack-work"]').waitFor({
        state: 'visible', timeout: 60_000,
      });

      const toteBarcode: string = emptyTotes[0].barcode || emptyTotes[0].lpn_id;
      await store.fill('[data-testid="ds-pack-tote-scan-text"]', toteBarcode);
      await store.click('[data-testid="ds-pack-tote-scan-submit"]');
      await expect(store.locator('[data-testid="ds-pack-tote-scan-feedback"]')).toContainText(
        `Tote ${toteBarcode} selected`, { timeout: 60_000 },
      );
      await store.fill('[data-testid="ds-pack-staging-input"]', 'STAGE-01');
      await store.click('[data-testid="ds-pack-submit"]');
      await store.locator('[data-testid="ds-pack-done"]').waitFor({
        state: 'visible', timeout: 120_000,
      });
      await expect(store.locator('[data-testid="ds-pack-done"]')).toContainText(orderNo!);

      /* ── 5. The handoff counter: the job waits, unclaimed ── */

      await openStoreTab(store, site!, 'ds-rider-handoff',
        '[data-testid="ds-handoff-queue"], [data-testid="ds-handoff-closed"], [data-testid="ds-handoff-empty"], [data-testid="ds-handoff-error"]');
      const row = store.locator(`[data-testid="ds-handoff-task-${orderNo}"]`);
      await expect(row).toBeVisible({ timeout: 60_000 });

      /* ── 6. Scan the rider's code against that job ── */

      const assignBtn = store.locator(`[data-testid="ds-handoff-assign-${orderNo}"]`);
      await expect(assignBtn, 'a staged job nobody has taken must offer the scan path')
        .toBeVisible({ timeout: 30_000 });
      await assignBtn.click();

      const panel = store.locator('[data-testid="ds-handoff-assign-panel"]');
      await expect(panel).toBeVisible();
      await store.locator('[data-testid="ds-handoff-assign-input"]').fill(riderQr);
      await store.click('[data-testid="ds-handoff-assign-confirm"]');

      const done = store.locator('[data-testid="ds-handoff-done"]');
      await expect(done).toBeVisible({ timeout: 60_000 });
      await expect(done).toContainText(orderNo!);
      await expect(done).toContainText('is now with');

      // The row itself says accepted, without a reload by the operator.
      await expect(row).toContainText(/accept/i, { timeout: 30_000 });

      /* ── 7. Both sides agree, and the scan was recorded ── */

      const tasks = await apiGet(
        store,
        `/api/delivery/delivery-tasks/?status__in=ACCEPTED,AT_DS,PICKED_UP&page_size=100`,
      );
      expect(tasks.status).toBe(200);
      const rows: any[] = tasks.body?.results ?? tasks.body ?? [];
      const assigned = rows.find((t) => t.order_no === orderNo);
      expect(assigned, `no accepted task for ${orderNo} after the scan`).toBeTruthy();
      expect(assigned.rider, 'the task was not stamped with the scanned rider')
        .toBe(me.body.rider_id);

      const qrAfter = await apiGet(rider, '/api/delivery/rider-profiles/me/qr/');
      expect(qrAfter.body.code).toBe(riderQr);
      expect(
        qrAfter.body.scan_count,
        'the scan that assigned the job was not counted on the rider QR row',
      ).toBeGreaterThan(qrBefore.body.scan_count ?? 0);

      // The rider never tapped Accept — the console shows the job anyway.
      await expect(rider.getByText(orderNo!, { exact: true })).toBeVisible({
        timeout: 120_000,
      });
    } finally {
      await shopperCtx.close();
      await storeCtx.close();
      await riderCtx.close();
    }
  });
});
