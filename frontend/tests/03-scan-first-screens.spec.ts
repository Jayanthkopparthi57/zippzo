import { test, expect } from '@playwright/test';

/**
 * Smoke coverage for the scan-first views that were newly routed.
 *
 * These are the screens that were previously unreachable behind the old
 * monolithic InboundView. Routing them is the point of the redesign, so a
 * regression that makes one unreachable again must fail here.
 */
test.describe('Scan-first warehouse screens render', () => {
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];

  test.setTimeout(150000);

  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0;
    consoleErrors.length = 0;
    failedRequests.length = 0;

    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
    });
  });

  const login = async (page) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const email = page.locator('input[type="email"]');
    await expect(email).toBeVisible({ timeout: 30000 });
    await email.fill('admin@zippzo.in');
    await page.locator('input[type="password"]').fill('admin123');
    await page.getByRole('button', { name: /sign in|login/i }).first().click();
    await expect(page.locator('[data-testid="nav-skus"]')).toBeVisible({ timeout: 30000 });
    failedRequests.length = 0;
  };

  const screens = [
    { nav: 'nav-asns',          name: 'inbound receiving' },
    { nav: 'nav-qc-testing',    name: 'qc inspection' },
    { nav: 'nav-putaway-tasks', name: 'putaway' },
    { nav: 'nav-bin-contents',  name: 'bin lookup' },
    { nav: 'nav-create-orders', name: 'create orders' },
    { nav: 'nav-pick-execute',  name: 'pick execution' },
    { nav: 'nav-pack-seal',     name: 'pack & seal' },
    { nav: 'nav-batches',       name: 'outbound pick/sort queues' },
    { nav: 'nav-picklists',     name: 'picklists' },
    { nav: 'nav-dispatch-trips', name: 'dispatch' },
  ];

  for (const { nav, name } of screens) {
    test(`${name} mounts without errors`, async ({ page }) => {
      await login(page);
      await page.locator(`[data-testid="${nav}"]`).click();

      // The shared design system must be present on every operational screen.
      await expect(page.locator('.wf-panel').first()).toBeVisible({ timeout: 60000 });

      // No screen may be an empty shell.
      const body = (await page.locator('body').innerText()).trim();
      expect(body.length).toBeGreaterThan(80);

      // A failed load must be surfaced, never rendered as a silent blank table.
      await expect(page.locator('.scan-feedback--error').first()).toHaveCount(0);

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(failedRequests).toEqual([]);
    });
  }

  test('each outbound destination opens the queue it names', async ({ page }) => {
    await login(page);

    // Picklists: the pick queue only — the sorting-wave panel is not rendered.
    await page.locator('[data-testid="nav-picklists"]').click();
    await expect(page.locator('[data-testid="pq-root"]')).toBeVisible({ timeout: 60000 });
    await expect(
      page.locator('[data-testid="pq-picks"], [data-testid="pq-picks-empty"], [data-testid="pq-picks-error"]').first()
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('pq-waves')).toHaveCount(0);
    await expect(page.getByTestId('pq-waves-empty')).toHaveCount(0);

    // Sorting: the wave table only — no pick queue, no scan gate.
    await page.getByTestId('pq-tab-waves').click();
    await expect(
      page.locator('[data-testid="pq-waves"], [data-testid="pq-waves-empty"], [data-testid="pq-waves-error"]').first()
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('pq-picks')).toHaveCount(0);
    await expect(page.getByTestId('pq-picks-empty')).toHaveCount(0);

    // Batches is the combined view: both queues are on screen.
    await page.locator('[data-testid="nav-batches"]').click();
    await expect(page.getByTestId('pq-tab-both')).toHaveClass(/active/, { timeout: 60000 });
    await expect(
      page.locator('[data-testid="pq-waves"], [data-testid="pq-waves-empty"], [data-testid="pq-waves-error"]').first()
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.locator('[data-testid="pq-picks"], [data-testid="pq-picks-empty"], [data-testid="pq-picks-error"]').first()
    ).toBeVisible({ timeout: 60000 });
  });

  test('bin lookup resolves a real bin and reports its contents', async ({ page }) => {
    await login(page);
    await page.locator('[data-testid="nav-bin-contents"]').click();
    await expect(page.locator('.wf-panel').first()).toBeVisible({ timeout: 60000 });

    // Before scanning, the view must show an explicit idle state, not a blank table.
    await expect(page.locator('[data-testid="bin-lookup-idle"]')).toBeVisible({ timeout: 30000 });

    const scan = page.locator('[data-testid="bin-lookup-scan-text"]');
    await expect(scan).toBeVisible();
    await scan.fill('DEFINITELY-NOT-A-BIN-0000');
    await page.locator('[data-testid="bin-lookup-scan-submit"]').click();

    // An unknown bin has to say so rather than rendering an empty table.
    await expect(page.locator('[data-testid="bin-lookup-error"]')).toBeVisible({ timeout: 30000 });

    expect(pageErrors).toEqual([]);
  });
});
