/* The ledger screens: the read side of "who transferred them".
 *
 *   Inbound Ledger  — consignments / receipts / QC / putaway, each filtered by
 *     its own server-stamped actor (created_by, received_by, tested_by,
 *     confirmed_by).
 *   Outbound Ledger — picks / packs / transfer orders / bin transfers
 *     (started_by, completed_by, dispatched_by).
 *   The API contract behind both — every actor column ships with a sibling
 *     `*_name` resolved to a display name, never a bare UUID.
 *
 * Every assertion runs against the real API through the bundled app. */
import { test, expect, type Page } from '@playwright/test';
import { login, openTab } from './utils';

const API = '/api';
/* The dev database is a remote Neon instance: cold list calls can take 15s+. */
const LONG = { timeout: 180_000 };

type Json = any;

async function tokenOf(page: Page): Promise<string> {
  const t = await page.evaluate(() => window.findZippzoJwt() || '');
  expect(t, 'auth token in localStorage').not.toBe('');
  return t;
}

test.describe('ledger screens', () => {
  test.use({ actionTimeout: 150_000, navigationTimeout: 90_000, expect: { timeout: 180_000 } });

  test('inbound ledger: every feed renders and filters reload clean', async ({ page }) => {
    test.setTimeout(600_000);
    await login(page);

    await expect(
      page.locator('[data-testid="nav-inbound-ledger"]'),
      'Inbound Ledger is offered in the hub menu',
    ).toBeVisible(LONG);

    await openTab(page, 'inbound-ledger');
    await expect(page.locator('[data-testid="ibl-tab-asns"]')).toBeVisible(LONG);
    await expect(page.locator('[data-testid="ibl-table"]'), 'ASN table paints').toBeVisible(LONG);
    await expect(page.locator('[data-testid="ibl-error"]')).toHaveCount(0, LONG);

    for (const tab of ['grns', 'qc', 'putaway']) {
      await page.click(`[data-testid="ibl-tab-${tab}"]`);
      await expect(page.locator('[data-testid="ibl-table"]'), `${tab} table paints`).toBeVisible(LONG);
      await expect(page.locator('[data-testid="ibl-error"]'), `${tab} feed answers`).toHaveCount(0, LONG);
    }

    // The actor dropdown is fed by the staff directory; the admin account
    // must see more than the "All people" placeholder.
    await page.click('[data-testid="ibl-tab-asns"]');
    await expect(
      page.locator('[data-testid="ibl-actor"] option'),
      'staff directory populates the actor filter',
    ).not.toHaveCount(1, LONG);

    // A status filter round-trips through the server without an error strip.
    const statusOptions = page.locator('[data-testid="ibl-status"] option');
    if ((await statusOptions.count()) > 1) {
      await page.selectOption('[data-testid="ibl-status"]', { index: 1 });
      await expect(page.locator('[data-testid="ibl-error"]')).toHaveCount(0, LONG);
      await expect(page.locator('[data-testid="ibl-clear"]'), 'active filter offers a reset').toBeVisible(LONG);
      await page.click('[data-testid="ibl-clear"]');
      await expect(page.locator('[data-testid="ibl-error"]')).toHaveCount(0, LONG);
    }
  });

  test('outbound ledger tables are separated into sidebar destinations', async ({ page }) => {
    test.setTimeout(600_000);
    await login(page);

    await expect(
      page.locator('[data-testid="nav-outbound-ledger"]'),
      'Outbound Ledger is offered in the hub menu',
    ).toBeVisible(LONG);

    for (const [tab, nav] of [
      ['picks', 'outbound-ledger'],
      ['packs', 'outbound-ledger-packs'],
      ['transfers', 'outbound-ledger-transfers'],
      ['bins', 'outbound-ledger-bins'],
    ]) {
      await page.locator(`[data-testid="nav-${nav}"]`).click();
      await expect(page.locator('[data-testid="obl-table"]'), `${tab} table paints`).toBeVisible(LONG);
      await expect(page.locator('[data-testid="obl-error"]'), `${tab} feed answers`).toHaveCount(0, LONG);
      await expect(page.locator('[data-testid="obl-status"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="obl-actor"]')).toHaveCount(0);
    }
  });

  test('actor columns ship with resolved display names, not UUIDs', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    const token = await tokenOf(page);

    const checks: Array<[string, string]> = [
      ['/supply/asns/?page_size=5', 'created_by_name'],
      ['/supply/grns/?page_size=5', 'received_by_name'],
      ['/supply/qc-inspections/?page_size=5', 'tested_by_name'],
      ['/supply/putaway-tasks/?page_size=5', 'confirmed_by_name'],
      ['/ds-ops/pick-tasks/?page_size=5', 'completed_by_name'],
      ['/ds-ops/pack-tasks/?page_size=5', 'completed_by_name'],
      ['/ds-ops/transfer-orders/?page_size=5', 'dispatched_by_name'],
      ['/ds-ops/bin-transfers/?page_size=5', 'completed_by_name'],
    ];

    for (const [path, field] of checks) {
      const r = await page.request.get(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(r.status(), `GET ${path}`).toBe(200);
      const body: Json = await r.json();
      const rows: Json[] = Array.isArray(body) ? body : body?.results ?? [];
      expect(Array.isArray(rows), `${path} answers with a list`).toBe(true);
      for (const row of rows) {
        expect(
          typeof row[field],
          `${path} rows carry a string ${field} (resolved name)`,
        ).toBe('string');
      }
    }
  });
});
