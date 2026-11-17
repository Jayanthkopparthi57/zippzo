/* The store's return lifecycle, driven through the console it is actually
 * written for.
 *
 * `ReturnsView` used to render a return it had no way to act on. `/qc/`
 * refused until `received_at_ds` was set and only `/restock/` set it;
 * `/restock/` refused until `qc_disposition` was RESTOCK and only `/qc/` set
 * that. Receipt had no setter anywhere in the application, so every gate
 * blocked the gate behind it and the buttons the screen did have were
 * unreachable.
 *
 * Receipt is its own step now, in the order the goods really move - receive,
 * inspect, restock - and this drives all three from a return the shopper opens
 * themselves, on the store that delivered the order, against the real API.
 *
 * The start state is read from the return rather than assumed, because the
 * shared dev database keeps returns left behind by earlier runs and the
 * console has to work from wherever they are.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { loginShopper, selectDarkStore, openTab } from './utils';

async function api(page: Page, method: string, path: string, payload?: unknown) {
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

test.describe('dark store: the return lifecycle', () => {
  test.use({ actionTimeout: 180_000, navigationTimeout: 120_000, expect: { timeout: 60_000 } });

  test('receives, inspects and restocks a return back into sellable stock', async ({ browser }) => {
    test.setTimeout(600_000);

    const baseURL = (test.info().project.use as any)?.baseURL ?? 'http://localhost:3000';
    // `test.use` only configures the built-in page fixture. These contexts are
    // built by hand, and without their own timeouts a locator that never
    // appears waits until the whole test times out rather than failing fast.
    const ctxOpts = {
      baseURL,
      viewport: { width: 1440, height: 900 },
      actionTimeout: 180_000,
      navigationTimeout: 120_000,
    };
    const shopperCtx = await browser.newContext(ctxOpts);
    const storeCtx = await browser.newContext(ctxOpts);
    const shopper = await shopperCtx.newPage();
    const store = await storeCtx.newPage();
    const pageErrors: string[] = [];
    store.on('pageerror', (e) => pageErrors.push(String(e)));

    let returnId = '';
    let closedShopper = false;

    try {
      /* ── 1. the shopper opens a return against something they actually bought ── */

      await loginShopper(shopper);
      const orders = await api(shopper, 'GET', '/api/orders/orders/?page_size=200');
      expect(orders.status, 'the shopper can list their own orders').toBe(200);
      const rows: any[] = orders.body?.results ?? orders.body ?? [];
      const delivered = rows.filter((o) => o.status === 'DELIVERED');
      test.skip(delivered.length === 0, 'the seeded shopper has nothing delivered to return');

      let siteUuid = '';
      for (const order of delivered) {
        const opened = await api(shopper, 'POST', '/api/reverse/returns/', {
          order: order.order_id,
          reason: 'The pack arrived crushed; the contents are unusable.',
        });
        if (opened.status === 201) {
          returnId = opened.body.return_id;
          siteUuid = String(order.site);
          break;
        }
        // An earlier run left this one open. It is still driveable as long as
        // the store has not closed it off already.
        if (opened.status === 409 && opened.body?.return_id) {
          const held = await api(shopper, 'GET', `/api/reverse/returns/${opened.body.return_id}/`);
          const status = String(held.body?.status ?? '');
          const received = !!held.body?.received_at_ds;
          const settled = status === 'CLOSED' || status === 'RETURN_DENIED';
          const disposition = String(held.body?.qc_disposition ?? '');
          // Still walkable: not received yet, received but not inspected, or
          // inspected as RESTOCK and waiting for the shelf. Only that second
          // shape used to be taken, so a return sitting at REFUND_DECISION was
          // passed over and the skip below blamed 08 for a return this store
          // simply had not finished with.
          const driveable =
            !settled &&
            (!received ||
              !disposition ||
              (disposition === 'RESTOCK' && status !== 'CLOSED'));
          if (driveable) {
            returnId = opened.body.return_id;
            siteUuid = String(order.site);
            break;
          }
        } else {
          throw new Error(
            `opening a return on ${order.order_no} came back HTTP ${opened.status}: ` +
              JSON.stringify(opened.body),
          );
        }
      }
      test.skip(
        !returnId,
        'no walkable return: every delivered order already has one that is ' +
          'settled or waiting mid-flow - deliver one more with ' +
          'tests/08-three-app-journey.spec.ts',
      );
      const shortId = returnId.slice(0, 8);
      await shopperCtx.close();
      closedShopper = true;

      /* ── 2. the store console opens on the store that delivered it ── */

      await selectDarkStore(store);
      const sites = await api(store, 'GET', '/api/network/sites/?page_size=200');
      expect(sites.status).toBe(200);
      const siteRows: any[] = sites.body?.results ?? sites.body ?? [];
      const storeCode = siteRows.find(
        (s) => String(s.site_id ?? s.id) === siteUuid,
      )?.code as string | undefined;
      expect(storeCode, 'the order was delivered from a store in the network').toBeTruthy();

      const picker = store.locator('[data-testid="facility-switcher"]');
      if ((await picker.inputValue()) !== storeCode) {
        await picker
          .locator(`option[value="${storeCode}"]`)
          .waitFor({ state: 'attached', timeout: 60_000 });
        await picker.selectOption(storeCode!);
        await store
          .locator('[data-testid="nav-ds-dashboard"]')
          .waitFor({ state: 'visible', timeout: 90_000 });
        await store.waitForLoadState('networkidle');
      }

      /* ── 3. walk it from wherever it is to back on the shelf ── */

      await openTab(store, 'ds-returns');
      const row = store
        .locator('[data-testid^="ds-return-row-"]')
        .filter({ hasText: shortId })
        .first();
      await row.waitFor({ state: 'visible', timeout: 90_000 });

      /** Click the control and hold out for the call it makes, so a refusal
       *  reports its own message instead of timing out on a row that never
       *  moves. */
      const post = async (endpoint: string, target: Locator) => {
        const waited = store.waitForResponse(
          (r) => r.url().includes(endpoint) && r.request().method() === 'POST',
        );
        await target.first().click();
        const res = await waited;
        if (res.status() >= 400) {
          const body = await res.json().catch(() => null);
          throw new Error(`${endpoint} refused: HTTP ${res.status()} ${JSON.stringify(body)}`);
        }
      };

      const panel = store.locator('[data-testid="ds-return-work"]');
      const closePanel = async () => {
        await expect(panel, 'the panel closes on success').toHaveCount(0, { timeout: 90_000 });
      };

      // Each step is chosen from the return's own state rather than from what
      // happens to be on screen, so a step that does not run says which one.
      for (let step = 0; step < 4; step += 1) {
        const view = await api(store, 'GET', `/api/reverse/returns/${returnId}/`);
        expect(view.status, 'the store can read the return it is working on').toBe(200);
        const state = view.body ?? {};
        const status = String(state.status ?? '');
        console.log(`returns step ${step}: status=${status} received=${!!state.received_at_ds} qc=${state.qc_disposition}`);
        if (status === 'CLOSED') break;

        if (!state.received_at_ds) {
          const receive = row.locator('[data-testid^="ds-return-receive-"]');
          await expect(receive, `row offers Receive at ${status}`).toBeVisible({ timeout: 60_000 });
          await post('/receive/', receive);
          await expect(receive, 'the row advances once the goods are received').toHaveCount(0, {
            timeout: 90_000,
          });
          continue;
        }

        const action = row.locator('[data-testid^="ds-return-open-"]');
        if (!state.qc_disposition) {
          await expect(action, `row offers Inspect at ${status}`).toHaveText('Inspect', {
            timeout: 60_000,
          });
          await action.click();
          await panel.waitFor({ state: 'visible', timeout: 60_000 });
          await store.selectOption('[data-testid="ds-return-qc-disposition"]', 'RESTOCK');
          await post('/qc/', store.locator('[data-testid="ds-return-qc-confirm"]'));
          await closePanel();
          continue;
        }

        expect(
          String(state.qc_disposition),
          `only a RESTOCK disposition can go back on the shelf, saw ${status}`,
        ).toBe('RESTOCK');
        await expect(action, `row offers Restock at ${status}`).toHaveText('Restock', {
          timeout: 60_000,
        });
        await action.click();
        await panel.waitFor({ state: 'visible', timeout: 60_000 });
        await post('/restock/', store.locator('[data-testid="ds-return-confirm"]'));
        await closePanel();
      }

      /* ── 4. it is settled, and the ledger says the units came back ── */

      await expect(
        store
          .locator('[data-testid="ds-return-settled"] [data-testid^="ds-return-row-"]')
          .filter({ hasText: shortId }),
        'the return moves into the settled list',
      ).toBeVisible({ timeout: 90_000 });

      const after = await api(store, 'GET', `/api/reverse/returns/${returnId}/`);
      expect(after.status).toBe(200);
      expect(after.body.status, 'a restocked return is closed').toBe('CLOSED');
      expect(after.body.qc_disposition).toBe('RESTOCK');
      expect(after.body.received_at_ds, 'receipt is what unblocks inspection').toBeTruthy();

      const moves = await api(store, 'GET', '/api/inventory/movements/?page_size=200');
      expect(moves.status).toBe(200);
      const movements: any[] = moves.body?.results ?? moves.body ?? [];
      const landed = movements.filter((m) => String(m.ref_id) === returnId);
      expect(
        landed.map((m) => m.movement_ref),
        'the units come back as a RETURN movement, which is what the ledger renders',
      ).toContain('RETURN');
      expect(
        landed.every((m) => m.movement_ref),
        'movement_ref carries the type; movement_type is deliberately blank',
      ).toBe(true);

      expect(pageErrors, 'the returns screen throws nothing').toEqual([]);
    } finally {
      if (!closedShopper) await shopperCtx.close();
      await storeCtx.close();
    }
  });
});
