/* Three applications, one order: the workflow the split was for.
 *
 * Every other spec drives one console at a time. This one opens three browser
 * contexts - shopper, store and rider - and pushes a single order through all
 * of them with nothing stubbed, asserting only what a real operator and a real
 * customer could see:
 *
 *   shopper  storefront -> address -> basket -> Place order (COD)
 *   store    pick queue -> allocate -> scan bin -> scan item -> Complete pick
 *            pack station -> seal into an empty tote -> rider handoff queue
 *   rider    offer -> accept -> at the store -> collect tote -> on the way ->
 *            at the door -> proof of delivery with the customer's 6-digit code
 *   shopper  My Orders shows the code, then Delivered, and every notification
 *            the journey is supposed to have produced
 *
 * The three accounts are pinned to one dark store, because a job is only ever
 * offered to a rider at the store that packed it: the store is read off the
 * rider's own profile (`current_site_code`) rather than hard-coded, so a rider
 * moved to another store fails with a message that says so instead of timing
 * out on an offer that can never arrive.
 *
 * The only write is test setup, and only for a store that has never packed
 * anything: a tote that has been delivered now goes back into the store's own
 * pool (asserted at the end of this journey), so the provisioning below is a
 * first-run fixture rather than a patch over something the product cannot fix.
 * With it in place, a rider parked at the wrong store or a store with no tote
 * at all fails in seconds with an explanation rather than three minutes later
 * at the bottom of a queue.
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

/** Sign the rider in on its own entry point and make sure it is accepting work. */
async function goOnline(page: Page) {
  await loginRider(page);
  if (await page.getByRole('button', { name: 'Go online' }).count()) {
    await page.getByRole('button', { name: 'Go online' }).click();
  }
  await expect(page.getByRole('button', { name: 'Go offline' })).toBeVisible({
    timeout: 60_000,
  });
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

/**
 * The code only exists once the rider has asked for it, so this is always read
 * after that first refused confirmation. The panel polls every 8 seconds while
 * the order is open.
 */
async function readDeliveryCode(page: Page, orderNo: string): Promise<string> {
  await page.click('[data-testid="nav-shop-orders"]');
  const card = page.getByText(orderNo, { exact: true }).first();
  await card.waitFor({ state: 'visible', timeout: 60_000 });
  // The card toggles: clicking an already-open order would shut it, so only
  // click when no detail body is mounted at all.
  if ((await page.locator('.shop-ordercard__body').count()) === 0) {
    await card.click();
  }
  const heading = page.locator('div:text-is("Your delivery code")');
  await heading.waitFor({ state: 'visible', timeout: 120_000 });
  return (await heading.locator('..').locator(':scope > div').nth(1).innerText()).trim();
}

test.describe('three applications, one order', () => {
  test.use({ actionTimeout: 180_000, navigationTimeout: 120_000, expect: { timeout: 60_000 } });

  test('a shopper order travels shopper -> store -> rider -> shopper', async ({ browser }) => {
    test.setTimeout(1_500_000);
    test.slow();

    // Contexts built by hand do not inherit the fixture's options, so the
    // config's baseURL has to be carried across explicitly or page.goto would
    // resolve against nothing.
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
      /* ── 1. Sign in, and work out which single store ties the three together ── */

      await goOnline(rider);
      const me = await apiGet(rider, '/api/delivery/rider-profiles/me/');
      const site: string | undefined = me?.body?.current_site_code;
      expect(
        site,
        'the rider account has no home store, so no order can ever be offered to it',
      ).toBeTruthy();

      // The rider's store is the anchor: a task is only listed to a rider when
      // `task.site` equals `profile.current_site`, so an order shopped anywhere
      // else would be packed by a store nobody is watching.
      await selectDarkStore(store, site!);
      const overview = await apiGet(store, '/api/network/overview');
      const storeRow = (overview.body?.dark_stores || []).find((s: any) => s.code === site);
      expect(storeRow, `dark store ${site} is not in the facility directory`).toBeTruthy();
      const siteId = storeRow.site_id as string;

      const totes = await apiGet(
        store,
        `/api/inventory/lpns/?current_site=${siteId}&status__in=EMPTY,CREATED&page_size=10`,
      );
      expect(
        totes.status,
        `could not read the empty-tote list at ${site} (HTTP ${totes.status})`,
      ).toBe(200);
      let emptyTotes: any[] = totes.body?.results ?? totes.body ?? [];

      if (emptyTotes.length === 0) {
        // Only a store that has never packed anything is empty now: a delivery
        // puts its tote back into the same pool the pack screen reads (see the
        // assertion at the end of this journey). Provisioning one here is the
        // same POST a store uses to add a tote to its own pool, and it keeps
        // the journey repeatable on a fresh site rather than failing on a
        // shortage there is no operator for yet.
        const made = await apiPost(store, '/api/inventory/lpns/', {
          lpn_id: `E2E-${Date.now()}`,
          barcode: `E2ETOTE${Date.now()}`,
          lpn_type: 'TOTE',
          current_site: siteId,
          status: 'EMPTY',
          created_by: 'e2e-journey',
        });
        expect(
          made.status,
          `no empty tote at ${site} and provisioning one failed (HTTP ${made.status}): `
          + JSON.stringify(made.body),
        ).toBe(201);
        emptyTotes = [made.body];
      }

      await shopperSignIn(shopper);

      /* ── 2. Shopper: a real basket, a real address, a real COD order ── */

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
        await shopper.getByPlaceholder('Flat, building, street *').fill('12, Mango Street');
        await shopper.getByPlaceholder('City *').fill('Bhimavaram');
        await shopper.getByPlaceholder('PIN *').fill('530001');
        await shopper.getByRole('button', { name: 'Add address' }).click();
        await shopper.locator('[data-testid="toast-success"]').first().waitFor({
          state: 'visible', timeout: 60_000,
        });
      }

      const firstCard = shopper.locator('[data-testid="product-card"]').first();
      const priceText = await firstCard.locator('[data-testid="product-price"]').innerText();
      await firstCard.locator('[data-testid="product-add"]').click();
      await expect(shopper.locator('[data-testid="basket-line"]').first()).toContainText('×1');
      const lineTotal = Number(
        (await shopper.locator('[data-testid="basket-line-total"]').first().innerText())
          .replace(/[^\d.]/g, ''),
      );
      expect(lineTotal, 'the basket line equals the shelf price').toBe(
        Number(priceText.replace(/[^\d.]/g, '')),
      );

      const place = shopper.getByRole('button', { name: /^Place order/ });
      await expect(place, 'no address means no order, which is the point').toBeEnabled();
      await place.click();
      await shopper.getByRole('heading', { name: 'Order placed!' }).waitFor({
        state: 'visible', timeout: 120_000,
      });
      const orderNo = await receiptOrderNo(shopper);
      expect(orderNo, 'the receipt did not name the order it just created').toBeTruthy();

      /* ── 3. Store: pick it off the shelf and seal it into a tote ── */

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
          // One scan is one unit; the line card flips to done when the line is
          // satisfied, so this waits on the effect rather than on a timer.
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

      await openStoreTab(store, site!, 'ds-rider-handoff',
        '[data-testid="ds-handoff-queue"], [data-testid="ds-handoff-closed"], [data-testid="ds-handoff-empty"], [data-testid="ds-handoff-error"]');
      await expect(store.locator(`[data-testid="ds-handoff-task-${orderNo}"]`)).toBeVisible({
        timeout: 60_000,
      });

      /* ── 4. Rider: take the job and walk it to the door ── */

      // The offer only appears on the rider's next poll, and only for a task at
      // this rider's own store, so the wait is on the order number itself.
      const offerCard = rider.locator(`[data-testid="rd-offer-${orderNo}"]`);
      await offerCard.waitFor({ state: 'visible', timeout: 240_000 });
      await offerCard.getByRole('button', { name: 'Accept job' }).click();

      const step = async (name: string) => {
        const btn = rider.getByRole('button', { name });
        await btn.waitFor({ state: 'visible', timeout: 120_000 });
        await btn.click();
      };

      await step("I'm at the store");
      await step('Collect tote');
      await step('Confirm pickup');
      await expect(rider.getByText('Collected. The order is now yours.')).toBeVisible({
        timeout: 60_000,
      });

      await step('Start delivery');

      // While the parcel is moving, the shopper is told who has it. The order
      // card is opened once and the block has to be there without a reload.
      await shopper.click('[data-testid="nav-shop-orders"]');
      const liveCard = shopper.getByText(orderNo!, { exact: true }).first();
      await liveCard.waitFor({ state: 'visible', timeout: 60_000 });
      if ((await shopper.getByTestId('tracking-live').count()) === 0) {
        await liveCard.click();
      }
      await expect(shopper.getByTestId('tracking-live')).toBeVisible({ timeout: 60_000 });
      await expect(shopper.getByTestId('tracking-rider')).toContainText(/\w+/);
      await expect(shopper.getByTestId('tracking-location')).toBeVisible();

      await step("I've arrived");
      await step('Complete delivery');

      // The first confirmation is what mints the code: the server refuses with
      // 409 and only then sends it, so a customer can never be asked for a code
      // that does not exist yet.
      await step('Confirm delivery');
      await expect(rider.getByText('has been sent to the customer')).toBeVisible({
        timeout: 60_000,
      });

      /* ── 5. Shopper: read the code the rider has just asked for ── */

      const code = await readDeliveryCode(shopper, orderNo!);
      expect(code).toMatch(/^\d{6}$/);

      /* ── 6. Rider: hand it over, cash and code together ── */

      await rider.getByPlaceholder('6-digit code').fill(code);
      const cash = rider.locator('input[inputmode="decimal"]');
      const due = /₹([\d.]+)\s+due/.exec((await cash.getAttribute('placeholder')) ?? '')?.[1];
      expect(due, 'the POD panel did not say how much cash is outstanding').toBeTruthy();
      await cash.fill(due!);
      await step('Confirm delivery');
      await expect(rider.getByText('Delivered.', { exact: true })).toBeVisible({
        timeout: 60_000,
      });

      /* ── 6b. Store: the tote it just delivered is back in its pool ── */

      // The goods leave the tote at the door, so the tote is empty again at
      // the store that packed it - and that pool is the only place a packer
      // can find one. Pickup used to leave the row IN_TRANSIT with no site at
      // all, so one delivery and the store had nothing left to pack into.
      const refilled = await apiGet(
        store,
        `/api/inventory/lpns/?current_site=${siteId}&status__in=EMPTY,CREATED&page_size=50`,
      );
      expect(refilled.status).toBe(200);
      const pooled: any[] = refilled.body?.results ?? refilled.body ?? [];
      const back = pooled.find(
        (row) => row.barcode === toteBarcode || row.lpn_id === emptyTotes[0].lpn_id,
      );
      expect(
        back,
        `tote ${toteBarcode} is not back in the ${site} pool after delivery: `
        + JSON.stringify(pooled.map((r) => `${r.barcode ?? r.lpn_id}:${r.status}`)),
      ).toBeTruthy();
      expect(back.status).toBe('EMPTY');

      /* ── 7. Shopper: the order is closed, and every update arrived ── */

      await shopper.click('[data-testid="nav-shop-orders"]');
      const orderCard = shopper.getByText(orderNo!, { exact: true }).first();
      await orderCard.waitFor({ state: 'visible', timeout: 60_000 });
      await orderCard.click();
      await expect(shopper.getByText('Delivered', { exact: true }).first()).toBeVisible({
        timeout: 60_000,
      });

      await shopper.click('[data-testid="nav-shop-notifications"]');
      for (const label of [
        'Your order is packed',
        'Your order is on the way',
        'Delivery code ready',
        'Delivered',
      ]) {
        await expect(
          shopper.getByText(label, { exact: true }).first(),
          `the shopper was never told: ${label}`,
        ).toBeVisible({ timeout: 180_000 });
      }
    } finally {
      await shopperCtx.close();
      await storeCtx.close();
      await riderCtx.close();
    }
  });
});
