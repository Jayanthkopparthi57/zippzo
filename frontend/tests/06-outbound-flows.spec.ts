/* Outbound regression coverage: DispatchView + PickQueuesView, routed.
 *
 * The views are now routed through the app shell (nav dispatch-trips / batches),
 * so these tests reach them the way a user would. Every API call goes over the
 * real Vite /api proxy to the real Django backend — nothing is stubbed. The
 * tests also keep a hard assertion that no request URL ever contains
 * "/undefined" — the exact bug class that produced
 * "Dispatch failed: PATCH /fulfilment/batches/undefined/ -> 404".
 */
import { test, expect, type Page } from '@playwright/test';
import { login, openTab } from './utils';

const API = '/api';
const LONG = { timeout: 240_000 };

type Json = any;

/** The exact READY_STATUS list DispatchView filters server-side with. */
const READY_STATUS = ['PACKED', 'LOADED', 'SORTED', 'PACKING'];
const BATCH_OPEN = ['UPLOADED', 'ALLOCATING', 'ALLOCATED', 'IN_PROGRESS'];

async function tokenOf(page: Page): Promise<string> {
  const t = await page.evaluate(() => window.findZippzoJwt() || '');
  expect(t, 'auth token in localStorage').not.toBe('');
  return t;
}

async function apiGet(page: Page, path: string, token: string): Promise<Json> {
  // A managed-Postgres blip can answer one GET with a bare 500. Reads are
  // idempotent, so retry that once rather than failing the whole dispatch run.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status() === 200) return r.json();
    if (r.status() >= 500 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    expect(r.status(), `GET ${path}`).toBe(200);
  }
  throw new Error(`GET ${path} never answered`);
}

async function apiPatch(page: Page, path: string, token: string, data: Json) {
  const r = await page.request.patch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  return r.status();
}

/**
 * Watch from mount onwards so nothing the view itself does is missed: page
 * errors, console errors, non-2xx responses, and — the bug class that a green
 * build cannot catch — any request URL containing "undefined".
 */
function watch(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  const undefinedUrls: string[] = [];
  const apiCalls: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => failed.push(`REQFAIL ${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/')) apiCalls.push(`${r.method()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
    if (u.includes('/undefined') || u.includes('/undefined?')) undefinedUrls.push(`${r.method()} ${u}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return { pageErrors, consoleErrors, failed, undefinedUrls, apiCalls };
}

/**
 * Wait for the view's own load to finish, and retry it a few times if the
 * remote dev backend returned a transient 5xx. The remote Neon DB behind the
 * shared dev server 500s under concurrent load, which is infrastructure, not a
 * defect in the view — so this retries through the view's own Refresh button and
 * still fails loudly (with the real error text) if it never settles.
 */
async function settle(page: Page, rootTestId: string, errSelectors: string[], refreshTestId: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.locator(`[data-testid="${rootTestId}"][data-loading="false"]`).waitFor({ timeout: 240_000 });
    const errs = page.locator(errSelectors.join(','));
    if ((await errs.count()) === 0) return;
    if (attempt === 3) {
      const text = await errs.allInnerTexts();
      throw new Error(`view still reporting load errors after 4 attempts: ${text.join(' | ')}`);
    }
    await page.locator(`[data-testid="${refreshTestId}"]`).click();
  }
}

test.describe('outbound DispatchView / PickQueuesView — real API, table first', () => {
  test.use({ actionTimeout: 180_000, navigationTimeout: 120_000, expect: { timeout: 240_000 } });

  test('Vite serves both new view modules as transformed JS (not a 500)', async ({ page }) => {
    for (const p of ['/src/views/outbound/DispatchView.jsx', '/src/views/outbound/PickQueuesView.jsx']) {
      const r = await page.request.get(p);
      expect(r.status(), `vite transform ${p}`).toBe(200);
      const body = await r.text();
      expect(body.length, `${p} is a real transformed module`).toBeGreaterThan(1000);
      // A "Failed to resolve import" 500 body is the symptom of a bad relative
      // path depth, so assert the module actually came back as code.
      expect(body, `${p} must not be an error page`).not.toContain('Failed to resolve import');
    }
  });

  test('Dispatch navigation shows each record family in its own table', async ({ page }) => {
    test.setTimeout(900_000);
    test.slow();
    await login(page);
    const w = watch(page);

    await page.locator('[data-testid="nav-dispatch-trips"]').click();
    await expect(page.locator('[data-testid="dispatch-root"]')).toHaveAttribute('data-loading', 'false', LONG);
    await expect(page.locator('[data-testid="dispatch-transfers"]')).toBeVisible(LONG);
    await expect(page.locator('[data-testid="dispatch-batches"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dispatch-routes"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dispatch-scan"]')).toHaveCount(0);
    await expect(page.getByText('Every row below is real API data.')).toHaveCount(0);

    await page.locator('[data-testid="nav-shipment-batches"]').click();
    await expect(page.locator('[data-testid="dispatch-batches"]')).toBeVisible(LONG);
    await expect(page.locator('[data-testid="dispatch-transfers"]')).toHaveCount(0);

    await page.locator('[data-testid="nav-route-plans"]').click();
    await expect(page.locator('[data-testid="dispatch-routes"]')).toBeVisible(LONG);
    await expect(page.locator('[data-testid="dispatch-batches"]')).toHaveCount(0);

    expect(w.undefinedUrls).toEqual([]);
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
    expect(w.failed).toEqual([]);
  });

  test.skip('legacy dispatch board scan-highlighting flow was replaced with sidebar table navigation', async ({ page }) => {
    test.setTimeout(900_000);
    test.slow();
    await login(page);
    const w = watch(page);
    const token = await tokenOf(page);

    // Ground truth straight from the API, so the UI is checked against real rows.
    const statusLists = await Promise.all(
      READY_STATUS.map((s) => apiGet(page, `/ds-ops/transfer-orders/?status=${s}&page_size=100`, token))
    );
    const expectedTransfers: Json[] = [];
    statusLists.forEach((p) => (p.results || []).forEach((t: Json) => expectedTransfers.push(t)));
    const allBatches = await apiGet(page, '/fulfilment/batches/?page_size=200', token);
    const allRoutes = await apiGet(page, '/delivery/route-plans/?page_size=200', token);
    const sites = await apiGet(page, '/network/sites/?page_size=200', token);
    const riders = await apiGet(page, '/delivery/rider-profiles/?page_size=200', token);
    const lpns = await apiGet(page, '/inventory/lpns/?page_size=500', token);

    expect(allBatches.count, 'real shipment batches exist').toBeGreaterThan(0);
    expect(allRoutes.count, 'real route plans exist').toBeGreaterThan(0);

    await page.locator('[data-testid="nav-dispatch-trips"]').click();
    await settle(
      page,
      'dispatch-root',
      [
        '[data-testid="dispatch-load-error"]',
        '[data-testid="dispatch-transfers-error"]',
        '[data-testid="dispatch-batches-error"]',
        '[data-testid="dispatch-routes-error"]',
      ],
      'dispatch-refresh'
    );

    // ---------- tables render with NO scan at all ----------
    await expect(page.locator('[data-testid="dispatch-transfers"]'), 'transfers table renders').toBeVisible(LONG);
    await expect(page.locator('[data-testid="dispatch-batches"]'), 'batches table renders').toBeVisible(LONG);
    await expect(page.locator('[data-testid="dispatch-routes"]'), 'routes table renders').toBeVisible(LONG);

    // ---------- real rows, real values, nothing fabricated ----------
    const transferRows = page.locator('[data-testid="dispatch-transfers"] tbody tr');
    await expect(transferRows, 'one row per ready transfer').toHaveCount(expectedTransfers.length, LONG);
    for (const t of expectedTransfers) {
      const row = page.locator(`[data-testid="dispatch-transfer-${t.transfer_id}"]`);
      await expect(row, `real transfer ${t.transfer_id}`).toHaveCount(1, LONG);
      // The real API total_qty, not a placeholder.
      await expect(
        page.locator(`[data-testid="dispatch-transfer-qty-${t.transfer_id}"]`),
        `real total_qty for ${t.transfer_id}`
      ).toHaveText(String(Number(t.total_qty) || 0), LONG);
      // Its real destination site code.
      const destCode = (sites.results || []).find((s: Json) => String(s.site_id) === String(t.dest_site))?.code;
      if (destCode) await expect(row, `real dest code ${destCode}`).toContainText(destCode, LONG);
      // Its real LPN barcodes (LpnMaster.transfer), which are NOT a filterset field.
      const mine = (lpns.results || []).filter((l: Json) => String(l.transfer) === String(t.transfer_id));
      for (const l of mine) {
        await expect(
          page.locator(`[data-testid="dispatch-transfer-lpns-${t.transfer_id}"]`),
          `tote ${l.lpn_id} listed on its transfer`
        ).toContainText(l.barcode || l.lpn_id, LONG);
      }
    }

    const batchRows = page.locator('[data-testid="dispatch-batches"] tbody tr');
    await expect(batchRows).toHaveCount(allBatches.count, LONG);
    for (const b of allBatches.results.slice(0, 5)) {
      await expect(
        page.locator(`[data-testid="dispatch-batch-no-${b.batch_id}"]`),
        `real batch_no ${b.batch_no}`
      ).toHaveText(b.batch_no, LONG);
      // CLOSED batches are history: the action must be disabled and say why.
      if (!BATCH_OPEN.includes(String(b.status).toUpperCase())) {
        await expect(page.locator(`[data-testid="dispatch-batch-go-${b.batch_id}"]`)).toBeDisabled(LONG);
      }
    }

    const routeRows = page.locator('[data-testid="dispatch-routes"] tbody tr');
    await expect(routeRows).toHaveCount(allRoutes.count, LONG);
    const firstRoute = allRoutes.results[0];
    const riderName = (riders.results || []).find((r: Json) => String(r.rider_id) === String(firstRoute.rider))?.name;
    if (riderName) {
      await expect(
        page.locator(`[data-testid="dispatch-route-rider-${firstRoute.route_id}"]`),
        `real rider name ${riderName}`
      ).toHaveText(riderName, LONG);
    }

    // ---------- scan a REAL transfer id: row is highlighted ----------
    expect(expectedTransfers.length, 'a dispatch-ready transfer exists to scan').toBeGreaterThan(0);
    const target = expectedTransfers[0];
    await page.fill('[data-testid="dispatch-scan-text"]', String(target.transfer_id).slice(0, 8));
    await page.press('[data-testid="dispatch-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="dispatch-scan-feedback"]')).toContainText(/highlighted/i, LONG);
    await expect(
      page.locator(`[data-testid="dispatch-transfer-${target.transfer_id}"]`),
      'the scanned transfer row carries data-scan-hit'
    ).toHaveAttribute('data-scan-hit', 'true', LONG);

    // ---------- scan a REAL tote barcode: its transfer row is highlighted ----------
    const lpnHit = (lpns.results || []).find(
      (l: Json) => expectedTransfers.some((t: Json) => String(t.transfer_id) === String(l.transfer))
    );
    if (lpnHit) {
      await page.fill('[data-testid="dispatch-scan-text"]', lpnHit.barcode);
      await page.press('[data-testid="dispatch-scan-text"]', 'Enter');
      await expect(
        page.locator(`[data-testid="dispatch-transfer-${lpnHit.transfer}"]`)
      ).toHaveAttribute('data-scan-hit', 'true', LONG);
    }

    // ---------- scan a REAL batch_no ----------
    await page.fill('[data-testid="dispatch-scan-text"]', allBatches.results[0].batch_no);
    await page.press('[data-testid="dispatch-scan-text"]', 'Enter');
    await expect(
      page.locator(`[data-testid="dispatch-batch-${allBatches.results[0].batch_id}"]`)
    ).toHaveAttribute('data-scan-hit', 'true', LONG);

    // ---------- an unknown code gets explicit feedback, not silence ----------
    await page.fill('[data-testid="dispatch-scan-text"]', 'NOT-A-REAL-CODE-999');
    await page.press('[data-testid="dispatch-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="dispatch-scan-feedback"]')).toContainText(
      /No dispatch record matches/i, LONG
    );

    // ---------- the RoutePlan status contract, verified against the live API ----------
    // RoutePlan.STATUS_CHOICES has no IN_TRANSIT, so the view writes IN_PROGRESS.
    // Assert the documented 400 rather than trusting the comment.
    const bad = await page.request.patch(`${API}/delivery/route-plans/${firstRoute.route_id}/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'IN_TRANSIT' },
    });
    expect(bad.status(), 'IN_TRANSIT is not a valid RoutePlan status').toBe(400);
    const stillThere = await apiGet(page, `/delivery/route-plans/${firstRoute.route_id}/`, token);
    expect(String(stillThere.status), 'the rejected PATCH wrote nothing').toBe(String(firstRoute.status));

    // ---------- hygiene ----------
    expect(w.undefinedUrls, 'no URL built with an undefined id').toEqual([]);
    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });

  test('PickQueuesView: real open picks in a table, Complete is correctly disabled, sorting waves render', async ({ page }) => {
    test.setTimeout(900_000);
    test.slow();
    await login(page);
    const w = watch(page);
    const token = await tokenOf(page);

    const notStarted = await apiGet(page, '/ds-ops/pick-tasks/?status=NOT_STARTED&page_size=200', token);
    const inProgress = await apiGet(page, '/ds-ops/pick-tasks/?status=IN_PROGRESS&page_size=200', token);
    const completed = await apiGet(page, '/ds-ops/pick-tasks/?status=COMPLETED&page_size=200', token);
    const waves = await apiGet(page, '/ds-ops/sorting-waves/?page_size=200', token);
    const skus = await apiGet(page, '/catalog/skus/?page_size=500', token);

    // The bug this guards: an unfiltered first page is all COMPLETED history.
    expect(completed.count, 'COMPLETED history exists and must NOT be listed').toBeGreaterThan(0);
    const expectedOpen = [...(notStarted.results || []), ...(inProgress.results || [])];

    await openTab(page, 'batches');
    await settle(
      page,
      'pq-root',
      [
        '[data-testid="pq-load-error"]',
        '[data-testid="pq-picks-error"]',
        '[data-testid="pq-waves-error"]',
      ],
      'pq-refresh'
    );

    // Batches opens on the picklists summary; the line table is one tab away.
    await page.getByTestId('pq-tab-picks').click();
    await expect(
      page.locator('[data-testid="pq-picks"], [data-testid="pq-picks-empty"], [data-testid="pq-picks-error"]').first()
    ).toBeVisible(LONG);

    const pickRows = page.locator('[data-testid="pq-picks"] tbody tr');
    await expect(pickRows).toHaveCount(expectedOpen.length, LONG);
    for (const p of expectedOpen) {
      await expect(page.locator(`[data-testid="pq-row-${p.id}"]`)).toHaveCount(1, LONG);
      await expect(page.locator(`[data-testid="pq-picked-${p.id}"]`)).toHaveText(
        String(Number(p.picked_qty) || 0), LONG
      );
      const sku = (skus.results || []).find((s: Json) => String(s.sku_id) === String(p.sku));
      if (sku) {
        await expect(page.locator(`[data-testid="pq-sku-${p.id}"]`), `real sku_code ${sku.sku_code}`).toContainText(
          sku.sku_code, LONG
        );
      }
      // Complete is only offered for IN_PROGRESS lines that already have a pick.
      const btn = page.locator(`[data-testid="pq-complete-${p.id}"]`);
      const canComplete = String(p.status).toUpperCase() === 'IN_PROGRESS' && Number(p.picked_qty) > 0;
      if (canComplete) await expect(btn).toBeEnabled(LONG);
      else {
        await expect(btn, `Complete disabled for ${p.status} with picked_qty=${p.picked_qty}`).toBeDisabled(LONG);
        const title = await btn.getAttribute('title');
        expect(String(title), 'a disabled Complete must explain why').toBeTruthy();
        expect(String(title).length).toBeGreaterThan(10);
      }
    }
    if (expectedOpen.length === 0) {
      await expect(page.locator('[data-testid="pq-picks-empty"]')).toBeVisible(LONG);
    }

    // ---------- sorting waves: table or an honest empty state ----------
    await page.getByTestId('pq-tab-waves').click();
    if (waves.count > 0) {
      await expect(page.locator('[data-testid="pq-waves"] tbody tr')).toHaveCount(waves.count, LONG);
    } else {
      await expect(page.locator('[data-testid="pq-waves-empty"]'), 'honest empty wave state').toBeVisible(LONG);
    }

    expect(w.undefinedUrls, 'no URL built with an undefined id').toEqual([]);
    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });

  test('DispatchView: one REAL transfer dispatch through the UI, then restore the database', async ({ page }) => {
    test.setTimeout(900_000);
    test.slow();
    await login(page);
    const token = await tokenOf(page);

    // Capture the exact pre-state before touching anything, so the fixture can be
    // put back even if an assertion fails midway.
    const pre = (await apiGet(page, '/ds-ops/transfer-orders/?status=PACKING&page_size=100', token)).results as Json[];
    expect(pre.length, 'a PACKING transfer exists to dispatch').toBeGreaterThan(0);
    const target = pre[0];

    const preLpns = ((await apiGet(page, '/inventory/lpns/?page_size=500', token)).results as Json[])
      .filter((l) => String(l.transfer) === String(target.transfer_id))
      .map((l) => ({ lpn_id: l.lpn_id, status: l.status }));

    const cleanup = async () => {
      await apiPatch(page, `/ds-ops/transfer-orders/${target.transfer_id}/`, token, { status: target.status });
      for (const l of preLpns) {
        await apiPatch(page, `/inventory/lpns/${encodeURIComponent(l.lpn_id)}/`, token, { status: l.status });
      }
    };
    try {
      const w = watch(page);
      await openTab(page, 'dispatch-trips');
      await expect(page.locator('[data-testid="dispatch-root"]')).toHaveAttribute('data-loading', 'false', LONG);
      await expect(page.locator('[data-testid="dispatch-load-error"]')).toHaveCount(0, LONG);

      const row = page.locator(`[data-testid="dispatch-transfer-${target.transfer_id}"]`);
      await expect(row, 'the dispatch-ready transfer is listed').toHaveCount(1, LONG);
      await expect(
        page.locator(`[data-testid="dispatch-transfer-status-${target.transfer_id}"]`)
      ).toHaveText(target.status, LONG);

      // ---------- click the real Dispatch button ----------
      await page.click(`[data-testid="dispatch-transfer-go-${target.transfer_id}"]`);
      await expect(page.locator('[data-testid="toast-success"]')).toContainText(/Transfer dispatched/i, LONG);

      // ---------- persisted truth, straight from the database ----------
      const after = await apiGet(page, `/ds-ops/transfer-orders/${target.transfer_id}/`, token);
      expect(String(after.status), 'transfer is persisted IN_TRANSIT').toBe('IN_TRANSIT');

      const afterLpns = ((await apiGet(page, '/inventory/lpns/?page_size=500', token)).results as Json[])
        .filter((l) => String(l.transfer) === String(target.transfer_id));
      // _mark_in_transit publishes only LPNs that BOTH name this transfer, are in
      // PACKED/CREATED, and actually hold contents — an EMPTY tote that still has
      // stale LpnContent rows is deliberately left alone.
      const contentRows = await Promise.all(
        preLpns.map((l) =>
          apiGet(page, `/inventory/lpn-contents/?lpn=${encodeURIComponent(l.lpn_id)}&page_size=100`, token)
        )
      );
      preLpns.forEach((l, i) => {
        const held = (contentRows[i].results || []).reduce((t: number, c: Json) => t + Number(c.qty), 0);
        const publishable = ['PACKED', 'CREATED'].includes(String(l.status).toUpperCase()) && held > 0;
        const rowAfter = afterLpns.find((x) => String(x.lpn_id) === String(l.lpn_id));
        if (publishable) {
          expect(String(rowAfter?.status), `tote ${l.lpn_id} (${l.status}, ${held} units) was published`).toBe('IN_TRANSIT');
        } else {
          expect(String(rowAfter?.status), `tote ${l.lpn_id} (${l.status}, ${held} units) was not published`).toBe(String(l.status));
        }
      });

      // ---------- the row left the READY table, because it is no longer ready ----------
      await expect(
        page.locator(`[data-testid="dispatch-transfer-${target.transfer_id}"]`),
        'a dispatched transfer is no longer listed as ready'
      ).toHaveCount(0, LONG);

      expect(w.undefinedUrls, 'no URL built with an undefined id').toEqual([]);
      expect(w.pageErrors, 'pageerror').toEqual([]);
      expect(w.consoleErrors, 'console error').toEqual([]);
      expect(w.failed, 'failed request').toEqual([]);
    } finally {
      await cleanup();
      const restored = await apiGet(page, `/ds-ops/transfer-orders/${target.transfer_id}/`, token);
      expect(String(restored.status), 'database restored').toBe(String(target.status));
      for (const l of preLpns) {
        const back = ((await apiGet(page, '/inventory/lpns/?page_size=500', token)).results as Json[])
          .find((x) => String(x.lpn_id) === String(l.lpn_id));
        expect(String(back?.status), `tote ${l.lpn_id} restored`).toBe(String(l.status));
      }
    }
  });
});
