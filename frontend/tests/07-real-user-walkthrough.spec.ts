/* Real-user walkthrough: click every sidebar tab in every app mode and demand
 * it settles to real content — or an honest empty state — with zero page
 * errors, zero console errors, zero non-2xx /api/ responses and zero request
 * URLs built from an undefined id.
 *
 * The deep flow tests live in 01-06 and operations.spec.ts. This file is the
 * completeness net: it walks NAVIGATION, which those files only do for the
 * handful of tabs they exercise. Three consoles exist now:
 *
 *   - WMS     (SUPER_ADMIN/OPS_MANAGER/WAREHOUSE_STAFF -> the one shell; the
 *              sidebar shows hub sections or store-ops sections depending on
 *              which facility is selected in the header picker)
 *   - shopper (role CUSTOMER, non-admin -> storefront)
 *   - rider   (role RIDER -> isolated dashboard, no sidebar; covered in 01)
 *
 * No API is stubbed. The only allowance is a bounded retry through each
 * view's own Refresh/Retry control, because the shared dev backend sits in
 * front of a cold remote Neon instance that occasionally 5xxs once.
 */
import { test, expect, type Page } from '@playwright/test';
import { login, loginShopper, selectDarkStore, TEST_USERS } from './utils';

const LONG = { timeout: 240_000 };

/**
 * The customer application is its own entry point with its own sidebar, so the
 * shared store-console `login()` helper cannot be used for it.
 */
async function loginAsCustomer(page: Page) {
  await loginShopper(page, TEST_USERS.customer);
}

type Json = any;

/* Watch everything a view does from mount onwards. */
function watch(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  const undefinedUrls: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => failed.push(`REQFAIL ${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/undefined') || u.includes('/undefined?')) undefinedUrls.push(`${r.method()} ${u}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) {
      failed.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
  return { pageErrors, consoleErrors, failed, undefinedUrls };
}

function clean(w: ReturnType<typeof watch>) {
  expect(w.undefinedUrls, 'no URL built with an undefined id').toEqual([]);
  expect(w.pageErrors, 'pageerror').toEqual([]);
  // Assert the failing request before the console message it produces: the
  // browser only logs "404 (Not Found)", which names nothing, while this line
  // names the exact URL.
  expect(w.failed, 'failed request').toEqual([]);
  expect(w.consoleErrors, 'console error').toEqual([]);
}

/** Wait until ANY of the arrival selectors is visible, then open a view. */
async function waitAny(page: Page, selectors: string[]) {
  const joined = selectors.join(',');
  await page.locator(joined).first().waitFor({ state: 'visible', timeout: 240_000 });
}

/** Retry through a view's own refresh control when it reports an error panel. */
async function settleAgainstErrors(
  page: Page,
  arrival: string[],
  errorSelectors: string[],
  refreshTestId: string | null,
  label: string
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitAny(page, arrival);
    if (errorSelectors.length === 0) return;
    const errs = page.locator(errorSelectors.join(','));
    if ((await errs.count()) === 0) return;
    if (attempt === 3) {
      const text = await errs.allInnerTexts();
      throw new Error(`${label}: view still reporting errors after 4 attempts: ${text.join(' | ')}`);
    }
    if (refreshTestId) {
      await page.locator(`[data-testid="${refreshTestId}"]`).click();
    } else {
      throw new Error(`${label}: error panel without a retry control: ${(await errs.allInnerTexts()).join(' | ')}`);
    }
  }
}

/* ───────────────── prop per-tab navigation ───────────────── */

const GENERIC_ARRIVAL = [
  '.workspace-viewport .data-table',
  '.workspace-viewport .table',
  '.workspace-viewport .wf-panel',
  '.workspace-viewport .panel',
  '.workspace-viewport .card',
  '.workspace-viewport .view-container',
];

interface Tab {
  id: string;
  arrival: string[];
  error?: string[];
  refresh?: string | null;
}

// Every list/queue/ledger container in the store console is a table body, not
// a stack of cards. These ids are contract: each is asserted below.
const LIST_CONTAINERS = [
  'rcv-queue', 'asn-lines', 'rcv-lines', 'qc-queue', 'qc-batch-lines', 'qc-tally',
  'put-queue', 'put-bin-card', 'co-lines', 'co-stock', 'co-result-tasks',
  'pack-queue', 'pack-lines', 'bin-lookup-candidates', 'bin-lookup-rows',
  'pick-queue', 'ds-shelf-rows', 'ds-ledger-rows', 'ds-return-pending',
  'ds-return-settled', 'ds-pick-queue', 'ds-pick-lines', 'ds-pack-queue',
  'ds-handoff-queue', 'ds-handoff-closed', 'ds-receipt-queue',
  'ds-putaway-totes', 'ds-putaway-lines', 'cr-custody', 'cr-movements',
  'ov-table', 'rf-table', 'ds-overview-queues', 'ds-store-options',
];

async function assertListTables(page: Page) {
  const offenders = await page.evaluate((ids) => {
    const out: string[] = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      if (el.tagName !== 'TBODY' || !el.closest('table.data-table')) {
        out.push(`${id}=${el.tagName}`);
      }
    }
    return out;
  }, LIST_CONTAINERS);
  expect(offenders, 'every list section renders as a data table body').toEqual([]);
}

// Every entry visible in the Sidebar for a SUPER_ADMIN (WMS) session, with the
// selector that proves that specific view actually rendered.
const WMS_TABS: Tab[] = [
  { id: 'asns', arrival: ['[data-testid="rcv-queue"]', '[data-testid="rcv-empty"]', '[data-testid="rcv-load-error"]'], error: ['[data-testid="rcv-load-error"]'], refresh: 'rcv-refresh' },
  { id: 'qc-testing', arrival: ['[data-testid="qc-queue"]', '[data-testid="qc-empty"]', '[data-testid="qc-load-error"]'], error: ['[data-testid="qc-load-error"]'], refresh: 'qc-refresh' },
  { id: 'putaway-tasks', arrival: ['[data-testid="put-queue"]', '[data-testid="put-empty"]', '[data-testid="put-load-error"]'], error: ['[data-testid="put-load-error"]'], refresh: 'put-refresh' },
  { id: 'bin-contents', arrival: ['[data-testid="bin-lookup-idle"]', '[data-testid="bin-lookup-candidates"]', '[data-testid="bin-lookup-error"]'], error: ['[data-testid="bin-lookup-error"]'], refresh: 'bin-lookup-refresh' },
  { id: 'inventory-lots', arrival: GENERIC_ARRIVAL },
  { id: 'transaction-log', arrival: GENERIC_ARRIVAL },
  { id: 'storage-bins', arrival: GENERIC_ARRIVAL },
  { id: 'bin-transfer', arrival: ['[data-testid="bin-transfer-lines"]', '[data-testid="scan-source-bin"]', '[data-testid="bin-transfer-error"]'], error: ['[data-testid="bin-transfer-error"]'], refresh: null },
  { id: 'create-orders', arrival: ['[data-testid="co-lines"]', '[data-testid="co-lines-empty"]', '[data-testid="co-stock"]', '[data-testid="co-stock-empty"]', '[data-testid="co-refs-error"]'], error: ['[data-testid="co-refs-error"]', '[data-testid="co-stock-error"]'], refresh: 'co-refresh-refs' },
  { id: 'pick-execute', arrival: ['[data-testid^="pick-queue-"]', '[data-testid="pick-empty"]', '[data-testid="pick-load-error"]'], error: ['[data-testid="pick-load-error"]'], refresh: 'pick-refresh' },
  { id: 'pack-seal', arrival: ['[data-testid="pack-queue"]', '[data-testid="pack-lines"]', '[data-testid="pack-empty"]', '[data-testid="pack-load-error"]'], error: ['[data-testid="pack-load-error"]'], refresh: 'pack-refresh' },
  { id: 'transfer-orders', arrival: GENERIC_ARRIVAL },
  { id: 'sorting-list', arrival: ['[data-testid="pq-picks"]', '[data-testid="pq-picks-empty"]', '[data-testid="pq-waves"]', '[data-testid="pq-waves-empty"]', '[data-testid="pq-load-error"]'], error: ['[data-testid="pq-load-error"]', '[data-testid="pq-picks-error"]', '[data-testid="pq-waves-error"]'], refresh: 'pq-refresh' },
  { id: 'packing', arrival: GENERIC_ARRIVAL },
  { id: 'batches', arrival: ['[data-testid="pq-picks"]', '[data-testid="pq-picks-empty"]', '[data-testid="pq-load-error"]'], error: ['[data-testid="pq-load-error"]', '[data-testid="pq-picks-error"]', '[data-testid="pq-waves-error"]'], refresh: 'pq-refresh' },
  { id: 'picklists', arrival: ['[data-testid="pq-picks"]', '[data-testid="pq-picks-empty"]', '[data-testid="pq-load-error"]'], error: ['[data-testid="pq-load-error"]', '[data-testid="pq-picks-error"]', '[data-testid="pq-waves-error"]'], refresh: 'pq-refresh' },
  { id: 'dispatch-trips', arrival: ['[data-testid="dispatch-transfers"]', '[data-testid="dispatch-transfers-empty"]', '[data-testid="dispatch-batches"]', '[data-testid="dispatch-batches-empty"]', '[data-testid="dispatch-routes"]', '[data-testid="dispatch-routes-empty"]', '[data-testid="dispatch-load-error"]'], error: ['[data-testid="dispatch-load-error"]', '[data-testid="dispatch-transfers-error"]', '[data-testid="dispatch-batches-error"]', '[data-testid="dispatch-routes-error"]'], refresh: 'dispatch-refresh' },
  { id: 'manifests', arrival: ['[data-testid="dispatch-batches"]', '[data-testid="dispatch-batches-empty"]', '[data-testid="dispatch-routes"]', '[data-testid="dispatch-load-error"]'], error: ['[data-testid="dispatch-load-error"]', '[data-testid="dispatch-batches-error"]', '[data-testid="dispatch-routes-error"]'], refresh: 'dispatch-refresh' },
  { id: 'cross-dock', arrival: GENERIC_ARRIVAL },
  { id: 'dashboard', arrival: GENERIC_ARRIVAL },
  { id: 'employee-roster', arrival: GENERIC_ARRIVAL },
  { id: 'sites-registry', arrival: GENERIC_ARRIVAL },
  { id: 'skus', arrival: GENERIC_ARRIVAL },
  { id: 'vendors', arrival: GENERIC_ARRIVAL },
  { id: 'active-trips', arrival: GENERIC_ARRIVAL },
  { id: 'admin-settings', arrival: GENERIC_ARRIVAL },
];

// Every store-ops nav id (dark-store facility selected), gated on StoreGate.
const DS_TABS: Tab[] = [
  { id: 'ds-dashboard', arrival: ['[data-testid="ds-overview-tiles"]', '[data-testid="ds-overview-error"]'], error: ['[data-testid="ds-overview-error"]'], refresh: 'ds-overview-refresh' },
  { id: 'ds-shelf-inventory', arrival: ['[data-testid="ds-shelf-summary"]', '[data-testid="ds-shelf-rows"]', '[data-testid="ds-shelf-empty"]', '[data-testid="ds-shelf-error"]'], error: ['[data-testid="ds-shelf-error"]'], refresh: 'ds-shelf-refresh' },
  // Not in this list until now: the store's Stock Ledger had never been opened
  // by any test, which is how it came to render an empty label on every row.
  { id: 'ds-ledger', arrival: ['[data-testid="ds-ledger-rows"]', '[data-testid="ds-ledger-empty"]', '[data-testid="ds-ledger-error"]'], error: ['[data-testid="ds-ledger-error"]'], refresh: 'ds-ledger-refresh' },
  { id: 'ds-returns', arrival: ['[data-testid="ds-return-pending"]', '[data-testid="ds-return-settled"]', '[data-testid="ds-return-empty"]', '[data-testid="ds-return-error"]'], error: ['[data-testid="ds-return-error"]'], refresh: null },
  { id: 'ds-order-picking', arrival: ['[data-testid="ds-pick-queue"]', '[data-testid="ds-pick-empty"]', '[data-testid="ds-pick-queue-error"]'], error: ['[data-testid="ds-pick-queue-error"]'], refresh: null },
  { id: 'ds-order-packing', arrival: ['[data-testid="ds-pack-queue"]', '[data-testid="ds-pack-empty"]', '[data-testid="ds-pack-queue-error"]'], error: ['[data-testid="ds-pack-queue-error"]'], refresh: null },
  { id: 'ds-rider-handoff', arrival: ['[data-testid="ds-handoff-queue"]', '[data-testid="ds-handoff-closed"]', '[data-testid="ds-handoff-empty"]', '[data-testid="ds-handoff-error"]'], error: ['[data-testid="ds-handoff-error"]'], refresh: null },
  { id: 'ds-lpn-receipt', arrival: ['[data-testid="ds-receipt-queue"]', '[data-testid="ds-receipt-empty"]', '[data-testid="ds-receipt-queue-error"]'], error: ['[data-testid="ds-receipt-queue-error"]'], refresh: null },
  { id: 'ds-shelf-putaway', arrival: ['[data-testid="ds-putaway-totes"]', '[data-testid="ds-putaway-empty"]', '[data-testid="ds-putaway-tote-error"]'], error: ['[data-testid="ds-putaway-tote-error"]'], refresh: null },
  { id: 'employee-roster', arrival: GENERIC_ARRIVAL },
  { id: 'skus', arrival: GENERIC_ARRIVAL },
];

test.describe('real-user walkthrough — every tab, every mode, nothing stubbed', () => {
  test.use({ actionTimeout: 180_000, navigationTimeout: 120_000, expect: { timeout: 240_000 } });

  test('WMS: admin walks every sidebar tab and each settles to real content', async ({ page }) => {
    test.setTimeout(1_800_000);
    test.slow();
    await login(page, TEST_USERS.admin);
    const w = watch(page);

    for (const t of WMS_TABS) {
      await page.click(`[data-testid="nav-${t.id}"]`);
      await settleAgainstErrors(page, t.arrival, t.error || [], t.refresh ?? null, `WMS ${t.id}`);
      // A settled tab must show real content: at least one data row or an
      // honest empty state (never a blank workspace).
      const viewport = page.locator('main.workspace-viewport');
      const text = await viewport.innerText();
      expect(text.trim().length, `WMS ${t.id}: workspace is not blank`).toBeGreaterThan(30);
      await assertListTables(page);
      // Generic DataTable tabs must actually render their content: a data
      // table for tabular views, the metric grid for the dashboard.
      if (t.id === 'transfer-orders') {
        // This tab is the creation form, not a listing — a table is the wrong
        // landmark for it.
        await expect(
          page.getByRole('heading', { name: /Create Dark Store Transfer Order/i }),
          `WMS ${t.id} renders its form`
        ).toBeVisible(LONG);
      } else if (t.id === 'inventory-lots' || t.id === 'transaction-log' || t.id === 'storage-bins' ||
          t.id === 'packing' || t.id === 'cross-dock' ||
          t.id === 'employee-roster' || t.id === 'sites-registry' ||
          t.id === 'skus' || t.id === 'vendors' || t.id === 'active-trips' || t.id === 'admin-settings') {
        await expect(
          page.locator('main.workspace-viewport table, main.workspace-viewport .data-table').first(),
          `WMS ${t.id} renders a data table`
        ).toBeVisible(LONG);
      } else if (t.id === 'dashboard') {
        await expect(
          page.locator('main.workspace-viewport .metrics-grid, main.workspace-viewport .stat-card').first(),
          `WMS dashboard renders metrics`
        ).toBeVisible(LONG);
      }
    }
    clean(w);
  });

  test('dark store: WMS operator selects a DS site and walks every store-ops tab', async ({ page }) => {
    test.setTimeout(1_800_000);
    test.slow();
    // The store sections have no seeded account of their own — they live in
    // the WMS shell and appear once the operator selects a dark-store site in
    // the header picker, which is exactly how a real store operator reaches
    // them.
    await selectDarkStore(page);
    await expect(page.locator('[data-testid="nav-ds-dashboard"]')).toBeVisible(LONG);
    // The dark-store sections belong to the store application's own shell, so
    // picking a site must not swap the sidebar for a second brand.
    await expect(page.locator('.brand-title')).toHaveText('Zippzo Store', LONG);
    const w = watch(page);

    // StoreGate: if the session has no store and more than one dark store is
    // registered, the operator gets a picker. The gate might render before the
    // site directory finishes loading, so wait for the option buttons to
    // appear (or for the overview to resolve without the gate) before deciding.
    await page.click('[data-testid="nav-ds-dashboard"]');
    const gate = page.getByTestId('ds-store-gate');
    const overview = page.locator('[data-testid="ds-overview-tiles"], [data-testid="ds-overview-error"]');
    await Promise.race([
      gate.waitFor({ state: 'visible', timeout: LONG.timeout }),
      overview.first().waitFor({ state: 'visible', timeout: LONG.timeout }),
    ]);
    if ((await gate.count()) > 0) {
      const options = page.locator('[data-testid^="ds-store-option-"]');
      await options.first().waitFor({ state: 'visible', timeout: LONG.timeout });
      const n = await options.count();
      expect(n, 'a dark store exists to pick when the gate appears').toBeGreaterThan(0);
      await options.first().click();
      await expect(overview.first()).toBeVisible(LONG);
    }

    for (const t of DS_TABS) {
      await page.click(`[data-testid="nav-${t.id}"]`);
      await settleAgainstErrors(page, t.arrival, t.error || [], t.refresh ?? null, `DS ${t.id}`);
      const text = await page.locator('main.workspace-viewport').innerText();
      expect(text.trim().length, `DS ${t.id}: workspace is not blank`).toBeGreaterThan(30);
      await assertListTables(page);
    }

    // Mounting is not enough for the ledger: it labels, filters and searches
    // every row from the movement type, and an empty one still renders a
    // perfectly plausible-looking screen. Demand a real type on the rows and
    // in the filter.
    await page.click('[data-testid="nav-ds-ledger"]');
    await waitAny(page, [
      '[data-testid="ds-ledger-rows"]',
      '[data-testid="ds-ledger-empty"]',
      '[data-testid="ds-ledger-error"]',
    ]);
    if (await page.locator('[data-testid="ds-ledger-rows"]').count()) {
      await expect(page.locator('[data-testid="ds-ledger-row-0"] .entity-card__title'))
        .not.toMatch(/^\s*·/);
      const typeLabels = await page
        .locator('[data-testid="ds-ledger-type"] option:not([value="ALL"])')
        .allInnerTexts();
      expect(typeLabels.length, 'the type filter must offer a real movement type').toBeGreaterThan(0);
      for (const label of typeLabels) {
        expect(label.trim(), 'a movement type label must not be blank').not.toBe('');
      }
    }

    clean(w);
  });

  test('shopper: customer storefront serves the real shelf and a working basket', async ({ page }) => {
    test.setTimeout(900_000);
    test.slow();
    await loginAsCustomer(page);
    await page.click('[data-testid="nav-shop-storefront"]');

    const w = watch(page);

    // Wait for either the product grid or the honest empty state.
    const cards = page.locator('[data-testid="product-card"]');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="product-card"]').length > 0 ||
        !!document.querySelector('[data-testid="storefront-empty"]') ||
        document.body.innerText.includes('nothing on its shelves') ||
        document.body.innerText.includes('could not be loaded'),
      undefined, { timeout: 240_000 }
    );

    const n = await cards.count();
    if (n > 0) {
      // The first card must carry a real price and an Add button, and the
      // basket must total that price exactly when one unit is added.
      const first = cards.first();
      await expect(first.locator('[data-testid="product-price"]')).toHaveText(/₹\d+(\.\d{2})?/, LONG);
      await first.locator('[data-testid="product-add"]').click();
      await expect(page.locator('[data-testid="basket-line"]').first()).toContainText('×1', LONG);
      const cardPrice = Number((await first.locator('[data-testid="product-price"]').innerText()).replace(/[^\d.]/g, ''));
      const lineTotal = Number((await page.locator('[data-testid="basket-line-total"]').first().innerText()).replace(/[^\d.]/g, ''));
      expect(lineTotal, 'basket line total equals the card price').toBe(cardPrice);
      // Subtotal equals that line total (the only line, so no delivery fee
      // should appear in subtotal).
      const subtotal = Number((await page.locator('[data-testid="basket-subtotal-value"]').innerText()).replace(/[^\d.]/g, ''));
      expect(subtotal, 'basket subtotal matches the single line').toBe(lineTotal);
      // The grand total must at least cover subtotal + a (possibly 0) fee.
      const grand = Number((await page.locator('[data-testid="basket-total-value"]').innerText()).replace(/[^\d.]/g, ''));
      expect(grand >= subtotal, 'grand total >= subtotal').toBe(true);
    }
    clean(w);
  });
});