import { test, expect } from '@playwright/test';
import { login, APP_ENTRIES, TEST_USERS } from './utils';

/**
 * The reference-data registry.
 *
 * Every entity the 36-table design calls for is reachable from one screen:
 * a domain rail, an entity rail and a table with a create/edit/delete modal.
 * These tests pin two things that were broken before: each nav item opens a
 * real endpoint (the old screen called `/master/*` and `/platform/*` routes
 * that did not exist) and each registry tab renders its own table rather than
 * a 404 or an error banner.
 *
 * The CRUD test writes and then deletes a uniquely-coded organization, so it
 * is safe to run repeatedly against any environment that has the migrations.
 */

const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL || TEST_USERS.admin.email,
  password: process.env.E2E_ADMIN_PASSWORD || TEST_USERS.admin.password,
};

const NAV_CASES: Array<[string, string]> = [
  ['master-organizations', 'organizations'],
  ['master-warehouses', 'sites'],
  ['master-stores', 'stores'],
  ['master-zones', 'zones'],
  ['master-bins', 'locations'],
  ['master-equipment', 'equipment'],
  ['master-skus', 'skus'],
  ['master-vendors', 'vendors'],
  ['master-carriers', 'carriers'],
  ['master-vehicles', 'vehicles'],
  ['shipments', 'shipments'],
  ['shipping-scans', 'shipping-scans'],
  ['cycle-counts', 'cycle-counts'],
  ['work-assignments', 'work-assignments'],
  ['productivity', 'productivity'],
  ['picker-zones', 'picker-zones'],
];

test.describe('Reference-data registry', () => {
  test('every registry nav item opens a table without an error', async ({ page }) => {
    test.setTimeout(300_000);
    const apiErrors: string[] = [];
    page.on('response', (resp) => {
      if (resp.url().includes('/api/') && resp.status() >= 500) {
        apiErrors.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await login(page, ADMIN, APP_ENTRIES.store);

    for (const [navId, tableId] of NAV_CASES) {
      const nav = page.locator(`[data-testid="nav-${navId}"]`);
      await expect(nav, `nav item ${navId}`).toBeVisible({ timeout: 30_000 });
      await nav.click();

      await expect(page.locator('[data-testid="master-data-root"]'), navId)
        .toBeVisible({ timeout: 30_000 });
      await expect(page.locator(`[data-testid="md-table-${tableId}"]`), `${navId} table`)
        .toBeVisible({ timeout: 60_000 });

      const error = page.locator('[data-testid="md-error"]');
      if (await error.count()) {
        throw new Error(`${navId} rendered an error: ${await error.first().innerText()}`);
      }
    }

    expect(apiErrors, 'API 5xx responses').toEqual([]);
  });

  test('every registry entity tab loads its table', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page, ADMIN, APP_ENTRIES.store);
    await page.locator('[data-testid="nav-master-organizations"]').click();
    await expect(page.locator('[data-testid="md-table-organizations"]'))
      .toBeVisible({ timeout: 60_000 });

    const groups = [
      'network', 'facilities', 'catalog', 'fleet',
      'transport', 'inventory', 'people',
    ];
    const seen: string[] = [];

    for (const group of groups) {
      await page.locator(`[data-testid="md-group-${group}"]`).click();
      const tabs = page.locator('[data-testid^="md-tab-"]');
      const count = await tabs.count();
      for (let i = 0; i < count; i += 1) {
        const tab = tabs.nth(i);
        const testId = await tab.getAttribute('data-testid');
        if (!testId) continue;
        await tab.click();
        await expect(page.locator('[data-testid="master-data-root"]')).toBeVisible();
        await expect(
          page.locator(`[data-testid="md-table-${testId.replace('md-tab-', '')}"]`),
        ).toBeVisible({ timeout: 60_000 });
        const error = page.locator('[data-testid="md-error"]');
        if (await error.count()) {
          throw new Error(`${testId} rendered an error: ${await error.first().innerText()}`);
        }
        seen.push(testId);
      }
    }

    expect(seen.length).toBeGreaterThanOrEqual(24);
  });

  test('organization create, edit and delete round trip', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, ADMIN, APP_ENTRIES.store);
    await page.locator('[data-testid="nav-master-organizations"]').click();
    await expect(page.locator('[data-testid="md-table-organizations"]'))
      .toBeVisible({ timeout: 60_000 });

    const code = `E2E-ORG-${Date.now()}`;

    await page.locator('[data-testid="md-add"]').click();
    await expect(page.locator('[data-testid="md-form"]')).toBeVisible();
    await page.fill('#md-field-code', code);
    await page.fill('#md-field-name', 'E2E Organization');
    await page.selectOption('#md-field-kind', 'VENDOR');
    await page.locator('[data-testid="md-save"]').click();
    await expect(page.locator('[data-testid="md-form"]')).toBeHidden({ timeout: 30_000 });

    const row = page
      .locator('[data-testid="md-table-organizations"] tbody tr')
      .filter({ hasText: code });
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.locator('button[title="Edit this record"]').click();
    await expect(page.locator('[data-testid="md-form"]')).toBeVisible();
    await page.fill('#md-field-name', 'E2E Organization Renamed');
    await page.locator('[data-testid="md-save"]').click();
    await expect(page.locator('[data-testid="md-form"]')).toBeHidden({ timeout: 30_000 });
    await expect(
      page.locator('[data-testid="md-table-organizations"]')
        .getByText('E2E Organization Renamed'),
    ).toBeVisible({ timeout: 30_000 });

    page.once('dialog', (dialog) => dialog.accept());
    const renamedRow = page
      .locator('[data-testid="md-table-organizations"] tbody tr')
      .filter({ hasText: code });
    await renamedRow.locator('button[title="Edit this record"]').click();
    await expect(page.locator('[data-testid="md-delete"]')).toBeVisible();
    await page.locator('[data-testid="md-delete"]').click();
    await expect(page.locator('[data-testid="md-form"]')).toBeHidden({ timeout: 30_000 });
    await expect(
      page.locator('[data-testid="md-table-organizations"]').getByText(code, { exact: true }),
    ).toHaveCount(0, { timeout: 30_000 });
  });
});
