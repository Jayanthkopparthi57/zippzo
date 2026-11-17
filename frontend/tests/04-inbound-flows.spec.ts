/* Inbound flow coverage: receiving -> QC -> putaway persists against the real API.
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
  const t = await page.evaluate(() => window.findZippzoJwt() || '');
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
    await expect(page.locator('[data-testid="rcv-load-error"]')).toHaveCount(0, LONG);
    await expect(page.locator('[data-testid="rcv-asn-scan-text"]')).toBeVisible();

    await openTab(page, 'qc-testing');
    await expect(page.locator('[data-testid="qc-batch-scan-text"]')).toBeVisible();
    await expect(page.locator('[data-testid="qc-load-error"]')).toHaveCount(0, LONG);
    await expect(page.locator('[data-testid="qc-queue"], [data-testid="qc-empty"]').first()).toBeVisible(LONG);

    await openTab(page, 'putaway-tasks');
    await expect(page.locator('[data-testid="put-refresh"]')).toBeVisible();
    await expect(page.locator('[data-testid="put-load-error"]')).toHaveCount(0, LONG);
    await expect(page.locator('[data-testid="put-queue"], [data-testid="put-empty"]').first()).toBeVisible(LONG);

    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });

  test('receiving -> QC -> putaway persists against the real API', async ({ page }) => {
    test.setTimeout(1_500_000);
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

    // Pick a destination-site bin with room for both units. The same capacity
    // numbers the putaway screen shows are enforced at the write.
    const siteBins = (await apiGet(
      page,
      `/supply/putaway-bins/?site=${encodeURIComponent(bin.site)}&limit=200`,
      token
    )).results;
    expect(siteBins.length, 'the destination site has bins').toBeGreaterThan(0);
    const putBin = siteBins.find((b: Json) => b.capacity_qty == null)
      || siteBins.find((b: Json) => Number(b.free_qty ?? 0) >= 4)
      || siteBins[0];
    expect(putBin.barcode, 'the chosen bin is scannable').toBeTruthy();

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
    await rcvRow.locator('td').nth(1).click();

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

    // step 2 — two real units of each product; the count comes from scans
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

    // step 3 — complete receiving. This records arrival and sends the batch to
    // QC; it does not accept a single unit.
    await expect(page.locator('[data-testid="rcv-complete"]')).toBeEnabled(LONG);
    await page.click('[data-testid="rcv-complete"]');
    await expect(page.locator('[data-testid="toast-success"]')).toContainText(/Receiving complete/i, LONG);
    await expect(page.locator(`[data-testid="rcv-queue-${asnId}"]`)).toHaveCount(0, LONG);

    const grns = (await apiGet(page, `/supply/grns/?asn=${asnId}`, token)).results;
    expect(grns.length, 'exactly one GRN, created by the UI').toBe(1);
    expect(grns[0].status, 'GRN closed by complete()').toBe('COMPLETED');
    const grnId = grns[0].grn_id;

    const arrived = (await apiGet(page, `/supply/grn-lines/?grn=${grnId}&page_size=10`, token)).results;
    expect(arrived.length).toBe(2);
    expect(arrived.every((l: Json) => Number(l.received_qty) === 2), 'units counted from scans').toBe(true);
    expect(
      arrived.every((l: Json) => Number(l.accepted_qty) === 0),
      'receiving records arrival only; QC decides what is accepted'
    ).toBe(true);
    expect(
      (await apiGet(page, `/supply/putaway-tasks/?grn_line__grn=${grnId}&page_size=10`, token)).results.length,
      'no putaway task can exist before QC accepts a unit'
    ).toBe(0);

    // ================= 2. QC =================
    await openTab(page, 'qc-testing');
    await page.fill('[data-testid="qc-batch-scan-text"]', ASN_NO);
    await page.press('[data-testid="qc-batch-scan-text"]', 'Enter');
    const qcLines = page.locator('[data-testid="qc-batch-lines"] > [data-testid^="qc-batch-line-"]');
    await expect(qcLines).toHaveCount(2, LONG);

    const grnLines = (await apiGet(page, `/supply/grn-lines/?grn=${grnId}&page_size=10`, token)).results;
    const lineFor = (skuId: string) => grnLines.find((gl: Json) => String(gl.sku) === String(skuId));
    const inspectionsFor = async (lineId: string) => {
      const j = await apiGet(page, `/supply/qc-inspections/?grn_line=${lineId}&page_size=10`, token);
      return j.results as Json[];
    };
    const lineOf = async (lineId: string) => (await apiGet(
      page, `/supply/grn-lines/?grn=${grnId}&page_size=10`, token
    )).results.find((gl: Json) => String(gl.line_id) === String(lineId));

    const lineA = lineFor(skuA.sku_id);
    const lineB = lineFor(skuB.sku_id);

    // Every received unit must be inspected before a result can be recorded:
    // scan both units of line A as PASS.
    await qcLines.first().click();
    await expect(page.locator('[data-testid="qc-unit-scan-text"]')).toBeVisible();
    for (let i = 0; i < 2; i += 1) {
      await page.fill('[data-testid="qc-unit-scan-text"]', skuA.sku_code);
      await page.press('[data-testid="qc-unit-scan-text"]', 'Enter');
    }
    await expect(page.locator('[data-testid="qc-pass"]')).toHaveText('2', LONG);
    await expect(page.locator('[data-testid="qc-record"]')).toBeEnabled(LONG);
    await page.click('[data-testid="qc-record"]');
    await expect(page.locator('[data-testid="toast-success"]')).toContainText(/QC recorded/i, LONG);

    const graded = await inspectionsFor(lineA.line_id);
    expect(graded.length, 'one inspection persisted for the graded line').toBe(1);
    expect(graded[0].pass_count, 'both scanned units passed').toBe(2);
    expect(graded[0].fail_count).toBe(0);
    expect(graded[0].status).toBe('PASSED');
    expect(Number((await lineOf(lineA.line_id)).accepted_qty), 'only PASS units are accepted').toBe(2);

    const tasksAfterA = (await apiGet(page, `/supply/putaway-tasks/?grn_line__grn=${grnId}&page_size=10`, token)).results;
    expect(tasksAfterA.length, 'accepting a line mints exactly one putaway task').toBe(1);
    expect(Number(tasksAfterA[0].qty), 'the task covers accepted units only').toBe(2);
    expect(tasksAfterA[0].status).toBe('GENERATED');
    expect((await inspectionsFor(lineB.line_id)).length, 'the untouched line has no inspection').toBe(0);

    // Scanning the *other* product while line A is open must open line B's own
    // inspection. Reusing line A's id would inflate its pass_count to 3.
    await qcLines.first().click();
    await page.fill('[data-testid="qc-unit-scan-text"]', skuB.sku_code);
    await page.press('[data-testid="qc-unit-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="qc-pass"]')).toHaveText('1', LONG);

    const afterA = await inspectionsFor(lineA.line_id);
    expect(afterA[0].pass_count, 'line A keeps its own count').toBe(2);
    const afterB = await inspectionsFor(lineB.line_id);
    expect(afterB.length, 'the cross-line scan opened line B').toBe(1);
    expect(afterB[0].pass_count).toBe(1);
    expect(afterB[0].grn_line, 'the new inspection belongs to line B').toBe(lineB.line_id);

    // Finish line B, then record the verdict.
    await page.fill('[data-testid="qc-unit-scan-text"]', skuB.sku_code);
    await page.press('[data-testid="qc-unit-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="qc-pass"]')).toHaveText('2', LONG);
    await page.click('[data-testid="qc-record"]');
    await expect(page.locator('[data-testid="toast-success"]')).toContainText(/QC recorded/i, LONG);
    expect(Number((await lineOf(lineB.line_id)).accepted_qty), 'line B is accepted too').toBe(2);

    const tasks = (await apiGet(page, `/supply/putaway-tasks/?grn_line__grn=${grnId}&page_size=10`, token)).results;
    expect(tasks.length, 'one putaway task per accepted line').toBe(2);
    expect(tasks.every((t: Json) => Number(t.qty) === 2), 'task qty equals accepted qty').toBe(true);
    expect(tasks.every((t: Json) => t.status === 'GENERATED')).toBe(true);

    // ================= 3. PUTAWAY =================
    await openTab(page, 'putaway-tasks');
    const task = tasks.find((t: Json) => t.sku === skuA.sku_id) || tasks[0];
    const taskSku = task.sku === skuA.sku_id ? skuA : skuB;

    const putRow = page.locator(`[data-testid="put-queue-${task.task_id}"]`);
    await expect(putRow).toBeVisible(LONG);
    await putRow.locator('td').first().click();

    // Step 1 — the bin list is the first thing on screen, with capacity, free
    // space and what is already inside each bin.
    await expect(page.locator('[data-testid="put-bin-list"]')).toBeVisible(LONG);
    await expect(page.locator(`[data-testid="put-bin-row-${putBin.location_id}-free"]`)).toBeVisible(LONG);

    // a bin that does not exist is rejected
    await page.fill('[data-testid="put-bin-scan-text"]', 'NO-SUCH-BIN-000');
    await page.press('[data-testid="put-bin-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="put-bin-scan-feedback"]')).toContainText(/rejected|no match|not|no bin|unknown/i, LONG);

    // a real bin is accepted and starts the bin session
    await page.fill('[data-testid="put-bin-scan-text"]', putBin.barcode);
    await page.press('[data-testid="put-bin-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="put-current-bin"]')).toContainText(putBin.barcode, LONG);
    await expect(page.locator('[data-testid="put-product-scan-text"]')).toBeVisible(LONG);

    // Step 2 — a product other than the task's SKU is rejected
    const other = taskSku.sku_id === skuA.sku_id ? skuB : skuA;
    await page.fill('[data-testid="put-product-scan-text"]', other.sku_code);
    await page.press('[data-testid="put-product-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="put-product-scan-feedback"]')).toContainText(/rejected|not|different|wrong|no match/i, LONG);
    await expect(page.locator('[data-testid="put-current-sku"]')).not.toContainText(other.sku_code);

    // the task's real product is accepted, and Proceed stores that one unit
    await page.fill('[data-testid="put-product-scan-text"]', taskSku.sku_code);
    await page.press('[data-testid="put-product-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="put-current-sku"]')).toContainText(taskSku.sku_code, LONG);
    // Read the bin immediately before the write, so the occupancy assertion is
    // about this Proceed rather than anything that changed since the fixture
    // list was loaded.
    const beforeOccupied = Number((await apiGet(
      page,
      `/supply/putaway-bins/?search=${encodeURIComponent(putBin.barcode)}&limit=25`,
      token
    )).results.find((b: Json) => b.location_id === putBin.location_id).occupied_qty || 0);
    await expect(page.locator('[data-testid="put-proceed"]')).toBeEnabled(LONG);
    await page.click('[data-testid="put-proceed"]');

    await expect(page.locator('[data-testid="put-progress"]')).toContainText(`1 of ${task.qty}`, LONG);
    await expect(page.locator('[data-testid="put-need-rest"]'), 'partial-fill warning').toBeVisible(LONG);
    await expect(page.locator('[data-testid="put-drop"]'), 'Drop is refused until every unit is stored').toBeDisabled();

    // Proceed persisted the unit — task, bin occupancy and ledger all moved
    // before the task was closed.
    const placedOnce = await apiGet(page, `/supply/putaway-tasks/${task.task_id}/`, token);
    expect(Number(placedOnce.placed_qty), 'Proceed persisted the unit immediately').toBe(1);
    expect(placedOnce.status).toBe('IN_PROGRESS');
    expect(placedOnce.confirmed_bin).toBe(putBin.location_id);

    const binAfterOne = (await apiGet(
      page,
      `/supply/putaway-bins/?search=${encodeURIComponent(putBin.barcode)}&limit=25`,
      token
    )).results.find((b: Json) => b.location_id === putBin.location_id);
    expect(Number(binAfterOne.occupied_qty), 'bin occupancy moved with the Proceed').toBe(beforeOccupied + 1);

    const refused = await apiPost(page, `/supply/putaway-tasks/${task.task_id}/complete/`, token, {
      destination_location_id: putBin.location_id,
    });
    expect(refused.status, 'complete() refuses a partly placed task').toBe(400);
    expect(String(refused.body.detail)).toMatch(/still to place/i);

    // Next bin ends this bin session without closing the task.
    await page.click('[data-testid="put-next-bin"]');
    await expect(page.locator('[data-testid="put-bin-scan-text"]')).toBeVisible(LONG);
    const stillOpen = await apiGet(page, `/supply/putaway-tasks/${task.task_id}/`, token);
    expect(stillOpen.status, 'ending a bin session leaves the task open').toBe('IN_PROGRESS');
    expect(Number(stillOpen.placed_qty)).toBe(1);

    // Resume in the same bin and place the last unit.
    await page.fill('[data-testid="put-bin-scan-text"]', putBin.barcode);
    await page.press('[data-testid="put-bin-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="put-product-scan-text"]')).toBeVisible(LONG);
    await page.fill('[data-testid="put-product-scan-text"]', taskSku.sku_code);
    await page.press('[data-testid="put-product-scan-text"]', 'Enter');
    await page.click('[data-testid="put-proceed"]');
    await expect(page.locator('[data-testid="put-progress"]')).toContainText(`${task.qty} of ${task.qty}`, LONG);
    await expect(page.locator('[data-testid="put-drop"]'), 'Drop opens once every unit is placed').toBeEnabled(LONG);

    // Drop completes the task; stock was already written by the Proceeds.
    await page.click('[data-testid="put-drop"]');
    await expect(page.locator('[data-testid="toast-success"]')).toContainText(/Putaway complete/i, LONG);
    await expect(page.locator(`[data-testid="put-queue-${task.task_id}"]`)).toHaveCount(0, LONG);

    const closed = await apiGet(page, `/supply/putaway-tasks/${task.task_id}/`, token);
    expect(closed.status, 'task CONFIRMED by Drop').toBe('CONFIRMED');
    expect(Number(closed.placed_qty)).toBe(Number(task.qty));
    expect(closed.confirmed_bin, 'confirmed_bin written to the real location').toBe(putBin.location_id);

    // The bin list is the screen's own view of the shelf, and it reads the
    // stock balances directly (the generic ledger endpoint is site-scoped for
    // this operator, so it is not the right probe here).
    const finalBin = (await apiGet(
      page,
      `/supply/putaway-bins/?search=${encodeURIComponent(putBin.barcode)}&limit=25`,
      token
    )).results.find((b: Json) => b.location_id === putBin.location_id);
    expect(finalBin, 'the chosen bin is still listed').toBeTruthy();
    expect(Number(finalBin.occupied_qty), 'bin occupancy grew by every placed unit').toBe(beforeOccupied + Number(task.qty));
    const shelved = (finalBin.contents || []).find(
      (c: Json) => c.sku_code === taskSku.sku_code && String(c.lot) === String(task.lot)
    );
    expect(shelved, 'the scanned units landed in the chosen bin').toBeTruthy();
    expect(Number(shelved.qty), 'every placed unit is on the shelf').toBe(Number(task.qty));

    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });
});
