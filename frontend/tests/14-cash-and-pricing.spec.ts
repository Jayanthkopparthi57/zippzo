/* A store sets its own delivery fee, and the counter counts a rider's cash.
 *
 * Pricing: the fee every order carries used to be one flat number hardcoded
 * in checkout. Now a store has a rule of its own, edited on the Admin
 * Pricing tab, and this test drives exactly that - set a fee on a real dark
 * store, watch it land on the server, then put it back so the estate is left
 * the way it was found.
 *
 * Cash: the rider's float and the cash they collect only exist because a
 * person at the counter counted it. The Cash Register screen is where that
 * happens - issue float against the custody ceiling, take the same float
 * back, and be refused when you ask a rider to remit money they are not
 * actually holding. The remittance refusal is the interesting case: it is
 * computed from the live balance, so it holds whether or not earlier specs
 * left this rider carrying COD cash from a delivered order.
 */
import { test, expect, type Page } from '@playwright/test';
import { login, selectDarkStore, TEST_USERS } from './utils';

async function apiGet(page: Page, path: string): Promise<any> {
  return page.evaluate(async (p) => {
    const token = window.findZippzoJwt();
    const res = await fetch(p, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path);
}

test.describe('cash register and delivery pricing', () => {
  test.use({ actionTimeout: 120_000, navigationTimeout: 90_000, expect: { timeout: 30_000 } });

  test('an operator sets a store delivery fee on the Pricing tab', async ({ page }) => {
    test.setTimeout(300_000);

    await login(page, TEST_USERS.admin);

    // A real dark store from the directory - whichever the estate lists first.
    const sites = await apiGet(page, '/api/network/sites/?page_size=100');
    expect(sites.status).toBe(200);
    const rows: any[] = Array.isArray(sites.body) ? sites.body : sites.body?.results ?? [];
    const store = rows.find((s) => s.site_type === 'DS' || s.site_type === 'DARK_STORE');
    expect(store, 'no dark store is listed in the facility directory').toBeTruthy();

    await page.click('[data-testid="nav-admin-settings"]');
    await page.click('[data-testid="admin-tab-pricing"]');
    const table = page.locator('[data-testid="pricing-table"]');
    await expect(table).toBeVisible({ timeout: 60_000 });
    const row = page.locator(`[data-testid="pricing-row-${store.code}"]`);
    await expect(row).toBeVisible();

    await page.locator(`[data-testid="pricing-fee-${store.code}"]`).fill('35');
    await page.click(`[data-testid="pricing-save-${store.code}"]`);

    // The rule lands on the server, and the row says so without a reload.
    await expect
      .poll(async () => {
        const rules = await apiGet(page, `/api/money/pricing-rules/?site=${store.site_id}`);
        const list: any[] = Array.isArray(rules.body) ? rules.body : rules.body?.results ?? [];
        return list.find((r) => String(r.site) === String(store.site_id))?.base_fee ?? null;
      }, { timeout: 30_000 })
      .toBe('35.00');
    await expect(page.locator(`[data-testid="pricing-current-${store.code}"]`))
      .toContainText('35');

    // Put it back: this spec must not change what the next one is charged.
    await page.locator(`[data-testid="pricing-fee-${store.code}"]`).fill('20');
    await page.click(`[data-testid="pricing-save-${store.code}"]`);
    await expect
      .poll(async () => {
        const rules = await apiGet(page, `/api/money/pricing-rules/?site=${store.site_id}`);
        const list: any[] = Array.isArray(rules.body) ? rules.body : rules.body?.results ?? [];
        return list.find((r) => String(r.site) === String(store.site_id))?.base_fee ?? null;
      }, { timeout: 30_000 })
      .toBe('20.00');
  });

  test('the counter issues and takes back float, and refuses a remittance of cash never held',
    async ({ page }) => {
      test.setTimeout(300_000);

      await selectDarkStore(page);
      const storeCode = await page.inputValue('[data-testid="facility-switcher"]');
      expect(storeCode, 'no dark store was selected in the facility picker').toBeTruthy();

      const riders = await apiGet(page, '/api/delivery/rider-profiles/?page_size=200');
      expect(riders.status).toBe(200);
      const riderRows: any[] = Array.isArray(riders.body) ? riders.body : riders.body?.results ?? [];
      expect(riderRows.length, 'no rider exists to be handed float').toBeGreaterThan(0);

      const before = await apiGet(
        page, `/api/money/rider-custody/?site=${encodeURIComponent(storeCode)}&page_size=100`);
      const beforeRows: any[] = Array.isArray(before.body) ? before.body : before.body?.results ?? [];
      const custodyByRider = new Map(beforeRows.map((c) => [String(c.rider_id), c]));

      // Hand float to a rider who has room for it: the counter refuses any
      // issue that would push cash-plus-float over the custody ceiling, and
      // earlier specs leave some riders carrying collected COD. A rider with
      // no custody row yet is ideal - empty and full headroom.
      const headroomOf = (riderId: string) => {
        const c = custodyByRider.get(riderId);
        if (!c) return 5000;
        return Number(c.ceiling_amount || 5000)
          - Number(c.current_cash || 0) - Number(c.current_float || 0);
      };
      const rider = riderRows.find((r) => headroomOf(String(r.rider_id)) >= 500)
        ?? riderRows.reduce((best, r) => (
          headroomOf(String(r.rider_id)) > headroomOf(String(best.rider_id)) ? r : best
        ), riderRows[0]);
      const mine = custodyByRider.get(String(rider.rider_id));
      const floatBefore = Number(mine?.current_float || 0);
      const cashBefore = Number(mine?.current_cash || 0);
      expect(headroomOf(String(rider.rider_id)),
        'every rider is at their custody ceiling; none can be issued float').toBeGreaterThanOrEqual(500);

      await page.click('[data-testid="nav-cash-register"]');
      await expect(page.locator('[data-testid="cr-rider-select"]')).toBeVisible({
        timeout: 60_000,
      });

      await page.selectOption('[data-testid="cr-rider-select"]', String(rider.rider_id));

      /* ── issue float onto this rider ── */
      await page.fill('[data-testid="cr-amount"]', '500');
      await page.click('[data-testid="cr-issue-float"]');
      await expect(page.locator('[data-testid="cr-feedback"]')).toContainText(
        'Float issued', { timeout: 30_000 });

      const afterIssue = await apiGet(
        page, `/api/money/rider-custody/?site=${encodeURIComponent(storeCode)}&page_size=100`);
      const issueRows: any[] = Array.isArray(afterIssue.body)
        ? afterIssue.body : afterIssue.body?.results ?? [];
      const issued = issueRows.find((c) => String(c.rider_id) === String(rider.rider_id));
      expect(Number(issued?.current_float || 0), 'the float did not land on the rider')
        .toBe(floatBefore + 500);
      await expect(page.locator(`[data-testid="cr-rider-${rider.rider_id}"]`))
        .toBeVisible();

      /* ── take the same float back ── */
      await page.fill('[data-testid="cr-amount"]', '500');
      await page.click('[data-testid="cr-return-float"]');
      await expect(page.locator('[data-testid="cr-feedback"]')).toContainText(
        'Float returned', { timeout: 30_000 });

      const afterReturn = await apiGet(
        page, `/api/money/rider-custody/?site=${encodeURIComponent(storeCode)}&page_size=100`);
      const returnRows: any[] = Array.isArray(afterReturn.body)
        ? afterReturn.body : afterReturn.body?.results ?? [];
      const settled = returnRows.find((c) => String(c.rider_id) === String(rider.rider_id));
      expect(Number(settled?.current_float || 0), 'the float did not go back to zero')
        .toBe(floatBefore);

      /* ── a remittance of cash the rider does not hold is refused ── */
      // One more than the live balance: whatever earlier specs left this rider
      // carrying, this amount is always more than they actually have.
      const cashNow = Number(settled?.current_cash ?? cashBefore);
      await page.fill('[data-testid="cr-amount"]', String(cashNow + 1));
      await page.click('[data-testid="cr-remit"]');
      await expect(page.locator('[data-testid="cr-error"]')).toBeVisible({
        timeout: 30_000,
      });

      /* ── the ledger behind the board ── */
      const moves = await apiGet(
        page, `/api/money/cash-movements/?site=${encodeURIComponent(storeCode)}&movement_type=FLOAT_ISSUE&page_size=5`);
      expect(moves.status).toBe(200);
      const moveRows: any[] = Array.isArray(moves.body) ? moves.body : moves.body?.results ?? [];
      expect(
        moveRows.some((m) => Number(m.amount) === 500),
        'the issue this test just counted is not on the cash ledger',
      ).toBe(true);
      await expect(page.locator('[data-testid="cr-movements"]')).toContainText('FLOAT_ISSUE');
    });
});
