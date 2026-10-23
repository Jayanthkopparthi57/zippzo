/* Inbound flow coverage: receiving -> putaway -> qc persists against the real API.
 * The three views are routed (nav asns / qc-testing / putaway-tasks), so these
 * tests drive them through the bundled app rather than a mount harness. */
import { test, expect, type Page } from '@playwright/test';
import { login, openTab } from './utils';

const API = '/api';
const TS = Date.now();
/* Dev server answers requests slowly against the remote Neon database. */
const LONG = { timeout: 180_000 };

type Json = any;

async function tokenOf(page: Page): Promise<string> {
  const t = await page.evaluate(() => window.localStorage.getItem('zippzo_jwt') || '');
  expect(t, 'auth token in localStorage').not.toBe('');
  return t;
}

async function apiGet(page: Page, path: string, token: string): Promise<Json> {
  const r = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status(), `GET ${path}`).toBe(200);
  return r.json();
}

async function apiPost(page: Page, path: string, token: string, body: Json): Promise<{ status: number; body: Json }> {
  const r = await page.request.post(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, data: body });
  return { status: r.status(), body: await r.json().catch(() => null) };
}

function watch(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => failed.push(`REQFAIL ${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return { pageErrors, consoleErrors, failed };
}

test.describe('inbound views — render + real flow', () => {
  // The local Django dev server answers every request in ~5s, so a view action
  // that chains 4-6 API calls needs minutes, not seconds.
  test.use({ actionTimeout: 150_000, navigationTimeout: 90_000, expect: { timeout: 180_000 } });

  test('each new view mounts with no pageerror/console error/failed request', async ({ page }) => {
    test.setTimeout(300_000);
    test.slow();
    await login(page);
    const w = watch(page);

    // Each view must reach its own shell and finish its first data load. The
    // queue list is legitimately absent when there is no open work, so accept
    // either the queue or the empty state and assert the load error never shows.
    await openTab(page, 'asns');
    await expect(page.locator('[data-testid="rcv-stepper"]')).toBeVisible();
    await expect(page.locator('[data-testid="rcv-load-error"]')).toHaveCount(0, LONG);
    await expect(page.getByText('Step 1 · Scan the consignment / ASN')).toBeVisible();

    await openTab(page, 'qc-testing');
    await expect(page.locator('[data-testid="qc-stepper"]')).toBeVisible();
    await expect(page.locator('[data-testid="qc-load-error"]')).toHaveCount(0, LONG);
    await expect(page.locator('[data-testid="qc-queue"], [data-testid="qc-empty"]').first()).toBeVisible(LONG);

    await openTab(page, 'putaway-tasks');
    await expect(page.locator('[data-testid="put-stepper"]')).toBeVisible();
    await expect(page.locator('[data-testid="put-load-error"]')).toHaveCount(0, LONG);
    await expect(page.locator('[data-testid="put-queue"], [data-testid="put-empty"]').first()).toBeVisible(LONG);

    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });

  test('receiving -> putaway -> qc persists against the real API', async ({ page }) => {
    test.setTimeout(900_000);
    test.slow();
    await login(page);
    const w = watch(page);
    const token = await tokenOf(page);

    // ---------- fixtures: real records, created through real filters ----------
    const skuList = (await apiGet(page, '/catalog/skus/?page_size=2', token)).results;
    expect(skuList.length, 'two real SKUs').toBe(2);
    const [skuA, skuB] = skuList;

    const bin = (await apiGet(page, '/network/locations/?location_type=BIN&page_size=1', token)).results[0];
    expect(bin, 'at least one BIN location exists').toBeTruthy();

    // asn_no is assigned server-side (ASN-YYYYMMDD-NNNN) and is read-only on
    // the wire, so the fixture works with whatever number comes back.
    const asn = await apiPost(page, '/supply/asns/', token, {
      type: 'VENDOR_PO',
      dest_site: bin.site,
      po_ref: `TMP-PO-${TS}`,
      status: 'CONFIRMED',
      total_skus: 2,
      total_qty: 4,
      slot_start: new Date().toISOString(),
    });
    expect(asn.status, `create ASN: ${JSON.stringify(asn.body)}`).toBe(201);
    const asnId = asn.body.asn_id;
    const ASN_NO: string = asn.body.asn_no;
    expect(ASN_NO, 'the server assigned a real ASN number').toMatch(/^ASN-\d{8}-\d{4}$/);

    for (const [i, sku] of [skuA, skuB].entries()) {
      const line = await apiPost(page, '/supply/asn-lines/', token, {
        asn: asnId, sku: sku.sku_id, ordered_qty: 2,
      });
      expect(line.status, `create ASN line: ${JSON.stringify(line.body)}`).toBe(201);
      expect(line.body.line_no, 'line numbers are assigned server-side').toBe(i + 1);
    }

    // ================= 1. RECEIVING =================
    await openTab(page, 'asns');
    const rcvRow = page.locator(`[data-testid="rcv-queue-${asnId}"]`);
    await expect(rcvRow).toBeVisible(LONG);
    await rcvRow.locator('td').first().click();

    // step 1 — batch / LPN code creates the GRN and expands the expected lines
    await expect(page.getByText(ASN_NO).first()).toBeVisible();
    await page.fill('[data-testid="rcv-batch-scan-text"]', `TMP-LPN-${TS}`);
    await page.press('[data-testid="rcv-batch-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid$="-feedback"]')).toContainText(/GRN|batch|LPN|receipt/i, LONG);
    // ProductCard also emits -name/-qty/-scan testids, so select the card roots
    // as direct children of the list container.
    await expect(page.locator('[data-testid="rcv-lines"] > [data-testid^="rcv-line-"]')).toHaveCount(2, LONG);
    await expect(page.locator('[data-testid="rcv-expected"]')).toHaveText('4', LONG);
    await expect(page.locator('[data-testid="rcv-received"]')).toHaveText('0', LONG);

    // step 2 — a product that is not on the ASN must be rejected, not counted
    await page.fill('[data-testid="rcv-unit-scan-text"]', 'NOT-A-REAL-SKU-99999');
    await page.press('[data-testid="rcv-unit-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid$="-feedback"]')).toContainText(/rejected|not a product|not on|unknown|no match/i, LONG);

    // step 2 — two real units of each product
    for (const sku of [skuA, skuB]) {
      for (let i = 0; i < 2; i += 1) {
        await page.fill('[data-testid="rcv-unit-scan-text"]', sku.sku_code);
        await page.press('[data-testid="rcv-unit-scan-text"]', 'Enter');
      }
    }
    await expect(page.locator('[data-testid="rcv-received"]')).toHaveText('4', LONG);
    await expect(page.locator('[data-testid="rcv-over"]')).toHaveText('0', LONG);
    await expect(page.locator('[data-testid="rcv-short"]')).toHaveText('0', LONG);
    await expect(page.locator('[data-testid="rcv-rejects"]')).toContainText('NOT-A-REAL-SKU-99999', LONG);

    // step 3 — complete receiving
    await expect(page.locator('[data-testid="rcv-complete"]')).toBeEnabled(LONG);
    await page.click('[data-testid="rcv-complete"]');
    // Success is reported as a toast and the view returns to the queue, so the
    // closed consignment must no longer be offered.
    await expect(page.locator('[data-testid="toast-success"]')).toContainText(/Receiving complete/i, LONG);
    await expect(page.locator(`[data-testid="rcv-queue-${asnId}"]`)).toHaveCount(0, LONG);

    const grns = (await apiGet(page, `/supply/grns/?asn=${asnId}`, token)).results;
    expect(grns.length, 'exactly one GRN, created by the UI').toBe(1);
    expect(grns[0].status, 'GRN closed by complete()').toBe('COMPLETED');

    const grnId = grns[0].grn_id;
    const tasks = (await apiGet(page, `/supply/putaway-tasks/?grn_line__grn=${grnId}&page_size=10`, token)).results;
    expect(tasks.length, 'one putaway task per accepted line').toBe(2);
    expect(tasks.every((t: Json) => t.status === 'GENERATED')).toBe(true);

    // ================= 2. PUTAWAY =================
    await openTab(page, 'putaway-tasks');
    const task = tasks.find((t: Json) => t.sku === skuA.sku_id) || tasks[0];
    const taskSku = task.sku === skuA.sku_id ? skuA : skuB;

    const putRow = page.locator(`[data-testid="put-queue-${task.task_id}"]`);
    await expect(putRow).toBeVisible(LONG);
    await putRow.locator('td').first().click();

    // a product other than the task's SKU is rejected
    const other = taskSku.sku_id === skuA.sku_id ? skuB : skuA;
    await page.fill('[data-testid="put-product-scan-text"]', other.sku_code);
    await page.press('[data-testid="put-product-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid$="-feedback"]')).toContainText(/rejected|not|different|wrong|no match/i, LONG);

    // the task's real product is accepted
    await page.fill('[data-testid="put-product-scan-text"]', taskSku.sku_code);
    await page.press('[data-testid="put-product-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="put-current-sku"]')).toContainText(taskSku.sku_code, LONG);

    // a bin that does not exist is rejected
    await page.fill('[data-testid="put-bin-scan-text"]', 'NO-SUCH-BIN-000');
    await page.press('[data-testid="put-bin-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid$="-feedback"]')).toContainText(/rejected|no match|not|no bin|unknown/i, LONG);

    // a real bin is accepted
    await page.fill('[data-testid="put-bin-scan-text"]', bin.barcode);
    await page.press('[data-testid="put-bin-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="put-current-bin"]')).toContainText(bin.barcode, LONG);

    // Proceed keeps the bin in hand ...
    const proceed = page.locator('[data-testid="put-proceed"]');
    const next = page.locator('[data-testid="put-next-bin"]');
    await expect(proceed, 'Proceed visible on confirm step').toBeVisible(LONG);
    await proceed.click();
    await expect(page.locator('[data-testid="put-current-bin"]')).toContainText(bin.barcode, LONG);
    await expect(page.locator('[data-testid="put-progress"]')).toContainText(`1 of ${task.qty}`, LONG);

    // ... and a partly filled bin must refuse to post, because complete() writes
    // the whole task quantity: the ledger must never claim a unit nobody put away.
    if (Number(task.qty) > 1) {
      await expect(page.locator('[data-testid="put-need-rest"]'), 'partial-fill warning').toBeVisible(LONG);
      await next.click();
      await expect(page.locator('[data-testid$="-feedback"]')).toContainText(/still to place/i, LONG);
      const refused = await apiGet(page, `/supply/putaway-tasks/${task.task_id}/`, token);
      expect(refused.status, 'a refused close leaves the task open').toBe('IN_PROGRESS');
      expect(refused.confirmed_bin, 'a refused close writes no bin').toBeFalsy();
    }

    // finish the remaining units, still holding the same bin
    for (let i = 1; i < Number(task.qty); i += 1) {
      await proceed.click();
      await expect(page.locator('[data-testid="put-progress"]')).toContainText(`${i + 1} of ${task.qty}`, LONG);
      await expect(page.locator('[data-testid="put-current-bin"]')).toContainText(bin.barcode, LONG);
    }

    // only now does the close post the stock
    await expect(next, 'Next / Drop Bin after the last Proceed').toBeEnabled(LONG);
    await next.click();
    await expect(page.locator('[data-testid="toast-success"]')).toContainText(/Bin dropped/i, LONG);
    await expect(page.locator(`[data-testid="put-queue-${task.task_id}"]`)).toHaveCount(0, LONG);

    const closed = (await apiGet(page, `/supply/putaway-tasks/?grn_line__grn=${grnId}&page_size=10`, token)).results
      .find((t: Json) => t.task_id === task.task_id);
    expect(closed.status, 'task CONFIRMED by the bin close').toBe('CONFIRMED');
    expect(closed.confirmed_bin, 'confirmed_bin written to the real location').toBe(bin.location_id);

    // ================= 3. QC =================
    await openTab(page, 'qc-testing');
    await page.fill('[data-testid="qc-batch-scan-text"]', ASN_NO);
    await page.press('[data-testid="qc-batch-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="qc-batch-lines"] > [data-testid^="qc-batch-line-"]')).toHaveCount(2, LONG);

    const qcLines = page.locator('[data-testid="qc-batch-lines"] > [data-testid^="qc-batch-line-"]');
    await qcLines.first().click();
    await expect(page.locator('[data-testid="qc-unit-scan-text"]')).toBeVisible();
    await page.fill('[data-testid="qc-unit-scan-text"]', skuA.sku_code);
    await page.press('[data-testid="qc-unit-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="qc-pass"]')).toHaveText('1', LONG);
    await page.click('[data-testid="qc-record"]');
    await expect(page.locator('[data-testid="toast-success"]')).toContainText(/QC recorded/i, LONG);

    const grnLines = (await apiGet(page, `/supply/grn-lines/?grn=${grnId}&page_size=10`, token)).results;
    const lineFor = (skuId: string) => grnLines.find((gl: Json) => String(gl.sku) === String(skuId));
    const inspectionsFor = async (lineId: string) => {
      const j = await apiGet(page, `/supply/qc-inspections/?grn_line=${lineId}&page_size=10`, token);
      return j.results as Json[];
    };

    const lineA = lineFor(skuA.sku_id);
    const lineB = lineFor(skuB.sku_id);
    const graded = await inspectionsFor(lineA.line_id);
    expect(graded.length, 'one inspection persisted for the graded line').toBe(1);
    expect(graded[0].pass_count).toBe(1);
    expect(graded[0].status).toBe('PASSED');
    expect((await inspectionsFor(lineB.line_id)).length, 'the untouched line has no inspection').toBe(0);

    // Scanning the *other* product while line A is open must open line B's own
    // inspection. Reusing line A's id would inflate its pass_count to 2.
    await qcLines.first().click();
    await page.fill('[data-testid="qc-unit-scan-text"]', skuB.sku_code);
    await page.press('[data-testid="qc-unit-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="qc-pass"]')).toHaveText('1', LONG);

    const afterA = await inspectionsFor(lineA.line_id);
    expect(afterA[0].pass_count, 'line A keeps its own count').toBe(1);
    const afterB = await inspectionsFor(lineB.line_id);
    expect(afterB.length, 'the cross-line scan opened line B').toBe(1);
    expect(afterB[0].pass_count).toBe(1);
    expect(afterB[0].grn_line, 'the new inspection belongs to line B').toBe(lineB.line_id);

    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });
});

