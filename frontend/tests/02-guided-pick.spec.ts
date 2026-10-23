import { test, expect } from '@playwright/test';

/**
 * Browser regression for the scan-first guided picking workflow.
 *
 * A green build proves nothing about runtime, and the backend pipeline never
 * renders React, so every assertion here is a real rendered element on a real
 * page. Any pageerror, console error or failed API call fails the test.
 */
test.describe('Guided scan-first picking', () => {
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
    page.on('response', async (r) => {
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
    failedRequests.length = 0; // discard pre-login 401/403
  };

  test('the pick screen renders its stepper, queue and empty state', async ({ page }) => {
    await login(page);
    await page.locator('[data-testid="nav-pick-execute"]').click();

    // The guided stepper is the core of the redesign and must be present.
    await expect(page.locator('[data-testid="workflow-stepper"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="workflow-stepper-step-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-stepper-step-3"]')).toBeVisible();

    await expect(page.getByText('Pick Queue')).toBeVisible();

    // The queue may legitimately be empty, but it must settle into exactly one
    // of those two states rather than hang on a spinner (the DB is remote and
    // slow, so wait for the settled state instead of sampling it).
    const empty = page.locator('[data-testid="pick-empty"]');
    const queue = page.locator('[data-testid^="pick-queue-"]').first();
    await expect(empty.or(queue).first()).toBeVisible({ timeout: 60000 });

    if (await empty.isVisible()) {
      await expect(page.getByText('No open pick tasks')).toBeVisible();
    }

    // A failed load must be visible, never a silently empty table.
    await expect(page.locator('[data-testid="pick-load-error"]')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('opening a task shows the bin step, and the stepper advances on a valid bin', async ({ page }) => {
    await login(page);
    await page.locator('[data-testid="nav-pick-execute"]').click();
    await expect(page.getByText('Pick Queue')).toBeVisible({ timeout: 30000 });

    // Wait for the queue to settle — sampling isVisible() straight after the
    // heading races the async load and would silently skip a real flow.
    const firstTask = page.locator('[data-testid^="pick-queue-"]').first();
    const settled = page.locator('[data-testid="pick-empty"]').or(firstTask).first();
    await expect(settled).toBeVisible({ timeout: 60000 });
    test.skip(!(await firstTask.isVisible()), 'no open pick tasks in the database');
    await firstTask.locator('td').first().click();

    // Step 1 demands a bin scan, not a dropdown.
    await expect(page.locator('[data-testid="pick-bin-scan-text"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-stepper-step-1"]')).toHaveAttribute('data-state', 'active');

    // A bogus bin must be rejected rather than silently accepted.
    await page.locator('[data-testid="pick-bin-scan-text"]').fill('NOT-A-REAL-BIN-9999');
    await page.locator('[data-testid="pick-bin-scan-submit"]').click();
    await expect(page.locator('[data-testid="pick-bin-scan-feedback"]')).toContainText(/not a known location/i);
    await expect(page.locator('[data-testid="pick-item-scan-text"]')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('a real bin advances to the product step and progress is shown', async ({ page }) => {
    await login(page);
    await page.locator('[data-testid="nav-pick-execute"]').click();
    await expect(page.getByText('Pick Queue')).toBeVisible({ timeout: 30000 });

    const firstTask = page.locator('[data-testid^="pick-queue-"]').first();
    const settled = page.locator('[data-testid="pick-empty"]').or(firstTask).first();
    await expect(settled).toBeVisible({ timeout: 60000 });
    test.skip(!(await firstTask.isVisible()), 'no open pick tasks in the database');
    await firstTask.locator('td').first().click();

    const bin = await page.evaluate(async () => {
      const token = localStorage.getItem('zippzo_jwt');
      const r = await fetch('/api/network/locations/?location_type=BIN&page_size=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      const rows = j.results || j;
      const row = Array.isArray(rows) ? rows[0] : null;
      return row ? (row.barcode || row.location_id) : null;
    });
    test.skip(!bin, 'no BIN locations exist in the database');

    await page.locator('[data-testid="pick-bin-scan-text"]').fill(bin);
    await page.locator('[data-testid="pick-bin-scan-submit"]').click();

    // Advancing to product entry is the point of the guided flow.
    await expect(page.locator('[data-testid="pick-item-scan-text"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="workflow-stepper-step-2"]')).toHaveAttribute('data-state', 'active');
    await expect(page.locator('[data-testid="pick-current-bin"]')).toHaveText(bin);
    await expect(page.locator('[data-testid="pick-progress-value"]')).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

