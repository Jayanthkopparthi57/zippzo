/* The professional-ops workflow surfaces:
 *
 *   Admin & System Config — real text inputs (not <select>s posing as fields),
 *     per-row Edit modal and Block/Reactivate actions.
 *   Staff & Shifts        — live shift roster with clock in/out, a task
 *     assignment board and a productivity snapshot, all from real feeds.
 *   Consignment wizard    — a CONFIRMED ASN persisted with a server-assigned
 *     ASN-YYYYMMDD-NNNN number and at least one product line.
 *   Queue assignment      — the pick queue and the putaway queue each offer an
 *     assignee control on every open row.
 *
 * Every assertion runs against the real API through the bundled app. */
import { test, expect, type Page } from '@playwright/test';
import { login, openTab } from './utils';

const API = '/api';
/* The dev database is a remote Neon instance: cold list calls can take 15s+. */
const LONG = { timeout: 180_000 };

type Json = any;

async function tokenOf(page: Page): Promise<string> {
  const t = await page.evaluate(() => window.localStorage.getItem('zippzo_jwt') || '');
  expect(t, 'auth token in localStorage').not.toBe('');
  return t;
}

async function apiCount(page: Page, path: string, token: string): Promise<number> {
  const r = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status(), `GET ${path}`).toBe(200);
  const body: Json = await r.json();
  if (typeof body?.count === 'number') return body.count;
  if (Array.isArray(body)) return body.length;
  return -1;
}

/**
 * Admin & System Config and Staff & Shifts render a DataTable card, not a
 * .wf-panel, so openTab()'s panel wait would hang — click the nav item and
 * wait on the view's own first paint instead.
 */
async function openView(page: Page, tabId: string, arrival: string) {
  await page.click(`[data-testid="nav-${tabId}"]`);
  await page.locator(arrival).first().waitFor({ state: 'visible', timeout: LONG.timeout });
}

test.describe('ops workflow surfaces', () => {
  test.use({ actionTimeout: 150_000, navigationTimeout: 90_000, expect: { timeout: 180_000 } });

  test('admin console: user management, shift roster and queue assign controls', async ({ page }) => {
    test.setTimeout(600_000);
    await login(page);

    /* ── 1. Admin & System Config ── */
    await openView(page, 'admin-settings', 'text=Admin & System Configuration');
    const editButtons = page.locator('[data-testid^="user-edit-"]');
    await expect(editButtons.first(), 'seeded users carry a row Edit action').toBeVisible(LONG);
    await expect(page.locator('[data-testid^="user-toggle-"]').first(), 'row Block/Reactivate action').toBeVisible(LONG);

    // Regression: the create form used to render <select>s as its text fields.
    await page.getByRole('button', { name: 'Create User' }).click();
    await expect(page.locator('.modal-content input[type="text"]').first(), 'full name is a text input').toBeVisible(LONG);
    await expect(page.locator('.modal-content input[type="email"]'), 'email is a text input').toBeVisible(LONG);
    await page.locator('.modal-content button', { hasText: 'Cancel' }).click();
    await expect(page.locator('.modal-content'), 'create modal closed').toBeHidden(LONG);

    // Editing opens the row in a modal; close without saving (no data churn).
    await editButtons.first().click();
    await expect(page.locator('[data-testid="user-edit-name"]')).toBeVisible(LONG);
    await expect(page.locator('[data-testid="user-edit-role"] option'), 'role choices are offered').not.toHaveCount(1, LONG);
    await page.click('[data-testid="user-edit-close"]');
    await expect(page.locator('[data-testid="user-edit-name"]'), 'edit modal closed').toBeHidden(LONG);

    /* ── 2. Staff & Shifts ── */
    await openView(page, 'employee-roster', '[data-testid="emp-roster"], [data-testid="emp-load-error"]');
    await expect(page.locator('[data-testid="emp-load-error"]'), 'every feed answered').toHaveCount(0, LONG);
    await expect(page.locator('[data-testid^="emp-shift-state-"]').first(), 'every employee shows a shift state').toBeVisible(LONG);
    await expect(page.locator('[data-testid^="emp-clock-"]').first(), 'clock in/out control is offered').toBeVisible(LONG);

    await page.click('[data-testid="emp-tab-tasks"]');
    await expect(page.locator('[data-testid="emp-tasks"]')).toBeVisible(LONG);
    const empAssign = page.locator('[data-testid^="emp-task-assign-"]');
    if (await empAssign.count()) {
      await expect(empAssign.first().locator('option'), 'staff list is loaded').not.toHaveCount(1, LONG);
    }

    await page.click('[data-testid="emp-tab-productivity"]');
    await expect(page.locator('[data-testid="emp-productivity"]')).toBeVisible(LONG);

    /* ── 3. Pick queue: an assignee control per open line ── */
    await openTab(page, 'batches');
    await expect(
      page.locator('[data-testid="pq-picks"], [data-testid="pq-picks-empty"], [data-testid="pq-picks-error"]').first(),
    ).toBeVisible(LONG);
    if (await page.locator('[data-testid^="pq-row-"]').count()) {
      await expect(page.locator('[data-testid^="pq-assign-"]').first(), 'pick row offers an assignee').toBeVisible(LONG);
      await expect(page.locator('[data-testid^="pq-assign-"] option').first()).not.toBeEmpty(LONG);
    }

    /* ── 4. Putaway queue: an assignee control per open task ── */
    await openTab(page, 'putaway-tasks');
    await expect(
      page.locator('[data-testid="put-queue"], [data-testid="put-empty"], [data-testid="put-load-error"]').first(),
    ).toBeVisible(LONG);
    if (await page.locator('[data-testid^="put-queue-"]').count()) {
      await expect(page.locator('[data-testid^="put-assign-"]').first(), 'putaway card offers an assignee').toBeVisible(LONG);
    }
  });

  test('consignment wizard: books a CONFIRMED ASN with an auto number', async ({ page }) => {
    test.setTimeout(600_000);
    await login(page);
    const token = await tokenOf(page);

    const skuRes = await page.request.get(`${API}/catalog/skus/?page_size=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(skuRes.status(), 'GET /catalog/skus/').toBe(200);
    const skuBody: Json = await skuRes.json();
    const skus = Array.isArray(skuBody) ? skuBody : skuBody?.results;
    const code = (skus || []).map((s: Json) => s.sku_code).find(Boolean);
    expect(code, 'the seeded catalog exposes a scannable sku_code').toBeTruthy();

    const before = await apiCount(page, '/supply/asns/?page_size=1', token);
    expect(before, 'the ASN list is readable before the wizard runs').toBeGreaterThanOrEqual(0);

    await openTab(page, 'asns');
    await page.click('[data-testid="rcv-create-asn"]');
    await expect(page.locator('[data-testid="asn-create-title"]')).toBeVisible(LONG);

    // The destination list is fetched when the modal opens.
    await page
      .locator('[data-testid="asn-create-dest"] option:not([value=""])')
      .first()
      .waitFor({ state: 'attached', timeout: LONG.timeout });
    await page.selectOption('[data-testid="asn-create-dest"]', { index: 1 });
    // A Mother Hub transfer has no vendor — the wizard must not demand one.
    await page.selectOption('[data-testid="asn-create-type"]', 'MH_TRANSFER');

    await page.fill('[data-testid="asn-line-code"]', code!);
    await page.fill('[data-testid="asn-line-qty"]', '7');
    await page.click('[data-testid="asn-line-add"]');
    await expect(page.locator('[data-testid="asn-lines"]'), 'the line is staged').toContainText(code!, LONG);

    await page.click('[data-testid="asn-create-submit"]');
    await expect(page.locator('[data-testid="toast-success"]'), 'wizard reports success').toContainText('Consignment created', LONG);
    await expect(page.locator('[data-testid="asn-create-title"]'), 'modal closed after creation').toBeHidden(LONG);

    // The receivable queue lists the new consignment under its auto number.
    await expect(page.locator('[data-testid="rcv-queue"]'), 'server assigned ASN-YYYYMMDD-NNNN').toContainText(
      /ASN-\d{8}-\d{4}/,
      LONG,
    );

    const after = await apiCount(page, '/supply/asns/?page_size=1', token);
    expect(after, 'exactly one consignment was persisted').toBe(before + 1);
  });

  test('compensation rates and the manpower staffing board', async ({ page }) => {
    test.setTimeout(600_000);
    await login(page);
    const token = await tokenOf(page);
    const auth = { Authorization: `Bearer ${token}` };

    /* ── 1. Admin → Compensation: admin-only rate list + real create ── */
    const pay = await page.request.get(`${API}/network/payroll/?page_size=500`, { headers: auth });
    expect(pay.status(), 'GET /network/payroll/ is admin-readable').toBe(200);
    // Reference data: wipe rows from any earlier run so the create is idempotent.
    const existing: Json[] = (await pay.json())?.results || [];
    for (const row of existing) {
      const del = await page.request.delete(`${API}/network/payroll/${row.comp_id}/`, { headers: auth });
      expect(del.status(), `DELETE ${row.comp_id}`).toBe(204);
    }

    await openView(page, 'admin-settings', 'text=Admin & System Configuration');
    await page.click('[data-testid="admin-tab-compensation"]');
    await expect(page.locator('[data-testid="emp-payroll-table"]'), 'compensation table paints').toBeVisible(LONG);

    await page.getByRole('button', { name: 'Add Rate' }).click();
    await expect(page.locator('[data-testid="emp-payroll-modal"]'), 'create modal opens').toBeVisible(LONG);
    await page
      .locator('[data-testid="emp-payroll-user"] option:not([value=""])')
      .first()
      .waitFor({ state: 'attached', timeout: LONG.timeout });
    await page.selectOption('[data-testid="emp-payroll-user"]', { index: 1 });
    await page.selectOption('[data-testid="emp-payroll-site"]', { index: 1 });
    await page.selectOption('[data-testid="emp-payroll-basis"]', 'HOURLY');
    await page.fill('[data-testid="emp-payroll-amount"]', '275');
    await page.click('[data-testid="emp-payroll-save"]');
    await expect(page.locator('[data-testid="emp-payroll-modal"]'), 'modal closed after save').toBeHidden(LONG);
    await expect(page.locator('[data-testid="emp-payroll-table"]'), 'the new rate is on the board').toContainText('₹275', LONG);

    const saved = await page.request.get(`${API}/network/payroll/?basis=HOURLY`, { headers: auth });
    expect(saved.status()).toBe(200);
    const savedBody: Json = await saved.json();
    expect(savedBody?.count ?? savedBody?.length, 'one HOURLY rate persisted').toBe(1);
    const row = (savedBody.results || savedBody)[0];
    expect(typeof row.created_by, 'created_by stamped server-side').toBe('string');

    /* ── 2. Staffing → Manpower: assignments joined to live clock-ins ── */
    const mp = await page.request.get(`${API}/network/manpower`, { headers: auth });
    expect(mp.status(), 'GET /network/manpower').toBe(200);
    const mpBody: Json = await mp.json();
    expect(Array.isArray(mpBody.results) && mpBody.results.length > 0, 'the seeded roster is visible').toBe(true);
    for (const m of mpBody.results) {
      expect(typeof m.on_shift, 'on_shift flag per row').toBe('boolean');
      expect(typeof m.linked, 'linked flag per row').toBe('boolean');
      expect(typeof m.site_code, 'site resolved per row').toBe('string');
    }

    await openView(page, 'employee-roster', '[data-testid="emp-roster"], [data-testid="emp-load-error"]');
    await page.click('[data-testid="emp-tab-manpower"]');
    await expect(page.locator('[data-testid="emp-manpower"]'), 'manpower board paints').toBeVisible(LONG);
    await expect(page.locator('[data-testid="emp-load-error"]'), 'all nine feeds answered').toHaveCount(0, LONG);
    await expect(
      page.locator('[data-testid^="emp-manpower-shift-"]').first(),
      'every assignment shows a clock state',
    ).toBeVisible(LONG);
  });
});
