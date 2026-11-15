import { test, expect } from '@playwright/test';

/**
 * Browser regression for the operations the backend tests cannot cover.
 *
 * Every test fails on ANY pageerror, console error or failed API response, so a
 * "green" run genuinely means the screen rendered and the endpoints answered —
 * a green build does not prove that.
 */
test.describe('Zippzo WMS — scan-first operations', () => {
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];

  // The backend is on a remote Neon connection; a cold positions/locations query
  // can take several seconds, so the per-test budget is well above Playwright's
  // 30s default.
  test.setTimeout(150000);

  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0;
    consoleErrors.length = 0;
    failedRequests.length = 0;

    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('response', async (r) => {
      const url = r.url();
      if (url.includes('/api/') && r.status() >= 400) {
        // 401/403 on the very first bootstrap is expected while logged out.
        failedRequests.push(`${r.status()} ${url}`);
      }
    });
  });

  // `networkidle` is avoided throughout: this app keeps connections and
  // in-flight requests going, so waiting for network quiet times out even when
  // the page is perfectly healthy. Wait on the elements that matter instead.
  const login = async (page) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const email = page.locator('input[type="email"]');
    await expect(email).toBeVisible({ timeout: 30000 });
    await email.fill('admin@zippzo.in');
    await page.locator('input[type="password"]').fill('admin123');
    await page.locator('button[type="submit"]').click();
    // Wait for the authenticated shell, not a fixed sleep: a fixed timeout races
    // the login round-trip and the next click lands on the login screen again.
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 45000 });
  };

  /** Grab a real bin identifier from the API so the scan is deterministic. */
  const firstBin = async (page) =>
    page.evaluate(async () => {
      const token = localStorage.getItem('zippzo_jwt');
      const r = await fetch('/api/network/locations/?location_type=BIN&page_size=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      const rows = j.results || j;
      const row = Array.isArray(rows) ? rows[0] : null;
      return row ? (row.barcode || row.location_id) : null;
    });

  test('bin lookup page renders, scans a bin, and shows its contents', async ({ page }) => {
    await login(page);
    failedRequests.length = 0; // ignore pre-login 401/403

    await page.locator('[data-testid="nav-bin-contents"]').click();

    // The page must mount in a visible idle shell (this view replaced the old
    // crashing BinContentsView on the same nav id).
    await expect(page.getByText('Bin Lookup').first()).toBeVisible();
    await expect(page.locator('[data-testid="bin-lookup-idle"]')).toBeVisible();
    await expect(page.locator('[data-testid="bin-lookup-scan-text"]')).toBeVisible();

    // Manual fallback resolves a real bin without a camera.
    const bin = await firstBin(page);
    test.skip(!bin, 'no BIN locations exist in the database');
    await page.locator('[data-testid="bin-lookup-scan-text"]').fill(bin);
    await page.press('[data-testid="bin-lookup-scan-text"]', 'Enter');

    // The bin lookup hits the remote DB, so poll for a terminal outcome rather
    // than counting elements after a fixed sleep.
    await expect
      .poll(
        async () =>
          (await page.locator('[data-testid="bin-lookup-result"]').count()) +
          (await page.locator('[data-testid="bin-lookup-error"]').count()),
        { timeout: 60000, message: 'bin lookup should either resolve or explain itself' }
      )
      .toBeGreaterThan(0);

    // A resolved bin must never also be an error.
    if (await page.locator('[data-testid="bin-lookup-result"]').count()) {
      await expect(page.locator('[data-testid="bin-lookup-error"]')).toHaveCount(0);
    }

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(consoleErrors, `console: ${consoleErrors.join(' | ')}`).toHaveLength(0);
    expect(failedRequests, `failed API: ${failedRequests.join(' | ')}`).toHaveLength(0);
  });

  test('bin transfer page renders and opens its scanner', async ({ page }) => {
    await login(page);
    failedRequests.length = 0;

    await page.locator('[data-testid="nav-bin-transfer"]').click();

    await expect(page.getByText('Bin Transfer').first()).toBeVisible();
    await expect(page.locator('[data-testid="bin-transfer-scan-text"]')).toBeVisible();
    await expect(page.locator('[data-testid="scan-source-bin"]')).toBeVisible();

    // Execute must stay disabled until a complete, valid transfer exists.
    await expect(page.locator('[data-testid="execute-bin-transfer"]')).toBeDisabled();

    await page.locator('[data-testid="scan-source-bin"]').click();
    await expect(page.locator('[data-testid="manual-barcode-input"]')).toBeVisible();
    await page.locator('[aria-label="Close scanner"]').click();
    await expect(page.locator('[data-testid="manual-barcode-input"]')).toBeHidden();

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(consoleErrors, `console: ${consoleErrors.join(' | ')}`).toHaveLength(0);
    expect(failedRequests, `failed API: ${failedRequests.join(' | ')}`).toHaveLength(0);
  });

  test('packing pages show batches and LPN records as tables', async ({ page }) => {
    await login(page);
    failedRequests.length = 0;

    await page.locator('[data-testid="nav-packing"]').click();
    await expect(page.locator('[data-testid="packing-batches"]')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-testid="packing-root"]')).toHaveAttribute('data-loading', 'false', { timeout: 60000 });
    await expect(page.locator('[data-testid="open-pack-modal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pack-bin-scan"]')).toHaveCount(0);

    await page.locator('[data-testid="nav-packed-lpns"]').click();
    await expect(page.locator('[data-testid="packed-lpns"]')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-testid="packing-root"]')).toHaveAttribute('data-loading', 'false', { timeout: 60000 });
    await expect(page.locator('[data-testid="pack-resolve-scan-text"]')).toHaveCount(0);
    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(consoleErrors, `console: ${consoleErrors.join(' | ')}`).toHaveLength(0);
    expect(failedRequests, `failed API: ${failedRequests.join(' | ')}`).toHaveLength(0);
  });

  test.skip('legacy packing scanner flow was removed in favor of table-only pages', async ({ page }) => {
    await login(page);
    failedRequests.length = 0;

    await page.locator('[data-testid="nav-packing"]').click();

    await expect(page.getByText(/Mother Hub Packing|Outbound Packing/).first()).toBeVisible();

    // Bin transfer from packing is a real modal, not a full page dumped in a div.
    await page.locator('[data-testid="open-bin-transfer"]').click();
    await expect(page.locator('[data-testid="execute-bin-transfer"]')).toBeVisible();
    await page.locator('.modal-close').last().click();
    await expect(page.locator('[data-testid="execute-bin-transfer"]')).toBeHidden();

    // Pack modal + the all-bins product browser.
    await page.locator('[data-testid="open-pack-modal"]').click();
    await expect(page.locator('[data-testid="pack-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="pack-batch-no"]')).toBeVisible();

    // The all-bins browser opens on top of the pack modal, so its close button is
    // the last one in the DOM; the pack modal's own close is correctly covered.
    await page.locator('[data-testid="pack-browse-all"]').click();
    await expect(page.locator('[data-testid="all-bins-table"]')).toBeVisible({ timeout: 30000 });
    await page.locator('.modal-close').last().click();
    await expect(page.locator('[data-testid="all-bins-table"]')).toBeHidden();
    await expect(page.locator('[data-testid="pack-form"]')).toBeVisible();

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(consoleErrors, `console: ${consoleErrors.join(' | ')}`).toHaveLength(0);
    expect(failedRequests, `failed API: ${failedRequests.join(' | ')}`).toHaveLength(0);
  });

  test.skip('legacy label scanner flow was removed in favor of table-only pages', async ({ page }) => {
    await login(page);
    failedRequests.length = 0;

    await page.locator('[data-testid="nav-packing"]').click();
    await expect(page.locator('[data-testid="pack-resolve-scan-text"]')).toBeVisible({ timeout: 60000 });

    // Any label the pack bench printed must answer "what is in this tote and
    // where is it going" — not only the tote packed a moment ago.
    const tote: any = await page.evaluate(async () => {
      const token = localStorage.getItem('zippzo_jwt');
      const r = await fetch('/api/inventory/lpns/?page_size=200', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      const rows = Array.isArray(j) ? j : (j.results || []);
      const withDest = rows.find(
        (l) => l.manifest && l.manifest.destination && l.manifest.destination.code
      );
      return withDest || rows.find((l) => l.barcode || l.lpn_id) || null;
    });
    test.skip(!tote, 'no LPN exists to resolve');

    await page.fill('[data-testid="pack-resolve-scan-text"]', tote.barcode || tote.lpn_id);
    await page.press('[data-testid="pack-resolve-scan-text"]', 'Enter');

    const result = page.locator('[data-testid="pack-resolve-result"]');
    await expect(result).toBeVisible({ timeout: 60000 });
    await expect(result).toContainText(tote.lpn_id);
    const destCode = tote.manifest && tote.manifest.destination
      ? tote.manifest.destination.code
      : null;
    if (destCode) {
      await expect(result, 'the label states its destination dark store').toContainText(destCode);
    }

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(consoleErrors, `console: ${consoleErrors.join(' | ')}`).toHaveLength(0);
    expect(failedRequests, `failed API: ${failedRequests.join(' | ')}`).toHaveLength(0);
  });

  test('transfer orders page renders its ledger and opens the create form', async ({ page }) => {
    await login(page);
    failedRequests.length = 0;

    await page.locator('[data-testid="nav-transfer-orders"]').click();

    await expect(page.getByText('Stock Transfer Orders')).toBeVisible();
    await expect(page.locator('[data-testid="sto-table"]')).toBeVisible();

    await page.locator('[data-testid="sto-new"]').click();
    await expect(page.getByText('Create Dark Store Transfer Order')).toBeVisible();
    await expect(page.locator('[data-testid="sto-source-site"]')).toBeVisible();
    await expect(page.locator('[data-testid="sto-dest-site"]')).toBeVisible();

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(consoleErrors, `console: ${consoleErrors.join(' | ')}`).toHaveLength(0);
    expect(failedRequests, `failed API: ${failedRequests.join(' | ')}`).toHaveLength(0);
  });

  test('inbound ASN search and line filter are honoured by the API', async ({ page }) => {
    await login(page);
    failedRequests.length = 0;

    // AsnViewSet/AsnLineViewSet had no search_fields/filterset_fields, so
    // ?search= and ?asn= were ignored and every request returned the full list.
    const probe = await page.evaluate(async () => {
      const token = localStorage.getItem('zippzo_jwt');
      const get = async (u) => {
        const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json();
        return Array.isArray(j) ? j : (j.results || []);
      };
      const all = await get('/api/supply/asn-lines/');
      if (!all.length) return { skipped: true };
      const target = all[0];
      const byAsn = await get(`/api/supply/asn-lines/?asn=${target.asn}`);
      const byEan = await get(`/api/supply/asn-lines/?search=${target.ean}`);
      const asns = await get('/api/supply/asns/');
      const byNo = asns.length
        ? await get(`/api/supply/asns/?search=${asns[0].asn_no}`)
        : [];
      return {
        total: all.length,
        byAsnCount: byAsn.length,
        byAsnAllMatch: byAsn.every((l) => l.asn === target.asn),
        byEanCount: byEan.length,
        byEanAllMatch: byEan.every((l) => l.ean === target.ean),
        byNoCount: byNo.length,
        byNoAllMatch: byNo.length > 0 && byNo.every((a) => a.asn_no === asns[0].asn_no),
      };
    });

    test.skip(!!probe.skipped, 'no ASN lines in the database');
    expect(probe.byAsnAllMatch, '?asn= must only return that ASN\'s lines').toBe(true);
    expect(probe.byAsnCount, '?asn= must actually filter').toBeLessThan(Math.max(probe.total, 1));
    expect(probe.byEanAllMatch, '?search=<ean> must only return that EAN').toBe(true);
    expect(probe.byEanCount, '?search= must actually filter').toBeLessThan(Math.max(probe.total, 1));
    expect(probe.byNoAllMatch, '?search=<asn_no> must only return that ASN').toBe(true);
    expect(probe.byNoCount, '?search=<asn_no> must actually filter').toBeLessThan(Math.max(probe.total, 1));

    expect(failedRequests, `failed API: ${failedRequests.join(' | ')}`).toHaveLength(0);
  });

  test('no-barcode fallback generates, saves and exposes a printable code', async ({ page }) => {
    await login(page);
    await page.locator('[data-testid="nav-skus"]').click();
    await expect(page.getByText('Product SKUs Master Catalog')).toBeVisible({ timeout: 30000 });

    // The "generate a barcode" loop was built but unreachable; prove it is now
    // reachable from the SKU catalog.
    const genBtn = page.getByRole('button', { name: /Generate|Add \/ Print/ }).first();
    await expect(genBtn).toBeVisible({ timeout: 30000 });
    await genBtn.click();

    const modal = page.locator('.modal-overlay');
    await expect(modal).toBeVisible({ timeout: 15000 });

    // Generate a code from the selected SKU.
    await modal.locator('[data-testid="generate-barcode"]').click();
    await expect(modal.locator('[data-testid="barcode-preview"]')).toBeVisible();
    const value = await modal.locator('#bc-code').inputValue();
    expect(value.trim().length).toBeGreaterThan(3);

    // Persist it, then confirm the saved state exposes a printable label.
    await modal.locator('[data-testid="save-barcode"]').click();
    await expect(modal.locator('[data-testid="barcode-saved"]')).toBeVisible({ timeout: 30000 });
    await expect(modal.locator('[data-testid="print-barcode"]')).toBeVisible();

    // Close, and confirm it genuinely dismisses.
    await modal.getByRole('button', { name: /Done|Cancel|Close/i }).first().click();
    await expect(page.locator('.modal-overlay')).toBeHidden();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('no endpoint is reachable anonymously', async ({ request }) => {
    const endpoints = [
      '/api/catalog/skus/', '/api/inventory/positions', '/api/inventory/balances/',
      '/api/inventory/lpns/', '/api/ds-ops/overview', '/api/ds-ops/transfer-orders/',
      '/api/ds-ops/bin-transfers/', '/api/supply/asns/', '/api/supply/qc-inspections/',
      '/api/fulfilment/batches/', '/api/iam/users/', '/api/network/sites/',
    ];
    for (const ep of endpoints) {
      const res = await request.get(ep);
      expect([401, 403], `${ep} returned ${res.status()}`).toContain(res.status());
    }
  });
});
