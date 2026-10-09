/* Replenishment + storage flow coverage: PackSealView / BinLookupView /
 * CreateOrderView are routed (nav pack-seal / bin-contents / create-orders), so
 * these tests drive them through the bundled app rather than a mount harness. */
import { test, expect, type Page } from '@playwright/test';
import { login, openTab } from './utils';

const API = '/api';
const TS = Date.now();
const LONG = { timeout: 240_000 };

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

async function apiDelete(page: Page, path: string, token: string) {
  await page.request.delete(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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

/** A barcoded product that exists in the catalog, used for reject-path scans. */
function outsiderSku(skus: Json[], used: Set<string>) {
  const s = skus.find((x) => !used.has(String(x.sku_id)));
  expect(s, 'a catalog SKU not on the order exists').toBeTruthy();
  return s;
}

/**
 * Fixture teardown has to survive a mid-test failure: a failed assertion used to
 * leave a PACKED LPN and a transfer flipped to PACKING in the dev database, and
 * the next run then failed for reasons that had nothing to do with the code.
 */
let cleanup: null | (() => Promise<void>) = null;

test.afterEach(async () => {
  if (!cleanup) return;
  const fn = cleanup;
  cleanup = null;
  await fn();
});

test.describe('replenishment + storage views — real flows', () => {
  test.use({ actionTimeout: 180_000, navigationTimeout: 120_000, expect: { timeout: 240_000 } });

  test('all three views mount clean with no pageerror / console error / failed request', async ({ page }) => {
    test.setTimeout(600_000);
    test.slow();
    await login(page);
    const w = watch(page);

    // ---- CreateOrderView: lane + real stock load ----
    await openTab(page, 'create-orders');
    await expect(page.locator('[data-testid="co-stepper"]')).toBeVisible();
    await expect(page.locator('[data-testid="co-refs-error"]')).toHaveCount(0, LONG);
    await expect(page.locator('[data-testid="co-source"]')).toHaveValue(/[0-9a-f-]{36}/i, LONG);
    await expect(page.locator('[data-testid="co-dest"]')).toHaveValue(/[0-9a-f-]{36}/i, LONG);
    // The stock panel must resolve against the real ledger, empty or not.
    await expect(page.locator('[data-testid="co-stock-count"]')).not.toHaveText('', LONG);

    // ---- PackSealView: the queue must load without a load error ----
    await openTab(page, 'pack-seal');
    await expect(page.locator('[data-testid="pack-stepper"]')).toBeVisible();
    await expect(page.locator('[data-testid="pack-load-error"]')).toHaveCount(0, LONG);
    await expect(page.locator('[data-testid="pack-queue"], [data-testid="pack-empty"]').first()).toBeVisible(LONG);

    // ---- BinLookupView: idle shell ----
    await openTab(page, 'bin-contents');
    await expect(page.locator('[data-testid="bin-lookup-idle"]')).toBeVisible();
    await expect(page.locator('[data-testid="bin-lookup-scan-text"]')).toBeVisible();
    await expect(page.locator('[data-testid="bin-lookup-idle"]')).toBeVisible();

    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });

  test('PackSealView: real LPN + contents + verify/seal + label print', async ({ page }) => {
    test.setTimeout(1_200_000);
    test.slow();
    await login(page);
    const w = watch(page);
    const token = await tokenOf(page);

    // ---------- fixtures, all real records ----------
    const skus = (await apiGet(page, '/catalog/skus/?page_size=200', token)).results as Json[];
    expect(skus.length, 'catalog has SKUs').toBeGreaterThan(0);

    // A COMPLETED pick batch that belongs to a real transfer order, so the
    // order is genuinely ready to pack.
    const completed = (await apiGet(page, '/ds-ops/pick-tasks/?status=COMPLETED&page_size=200', token)).results as Json[];
    const byBatch = new Map<string, Json[]>();
    completed.forEach((p) => byBatch.set(String(p.batch), [...(byBatch.get(String(p.batch)) || []), p]));
    const transfers = (await apiGet(page, '/ds-ops/transfer-orders/?page_size=200', token)).results as Json[];
    const batch = [...byBatch.keys()].find((b) => transfers.some((t) => String(t.transfer_id) === b));
    expect(batch, 'a completed pick batch matching a transfer order exists').toBeTruthy();
    const transfer = transfers.find((t) => String(t.transfer_id) === batch)!;
    const picks = byBatch.get(batch)!;

    // Expected totals are computed exactly as the view computes them, so the
    // assertions below are a genuine check of the view's own arithmetic.
    const expectedBySku = new Map<string, number>();
    picks.forEach((p) => expectedBySku.set(String(p.sku), (expectedBySku.get(String(p.sku)) || 0) + (Number(p.picked_qty) || Number(p.qty) || 0)));
    const expectedTotal = [...expectedBySku.values()].reduce((a, b) => a + b, 0);
    expect(expectedTotal, 'the batch has a positive expected total').toBeGreaterThan(0);

    const skuOf = (id: string) => skus.find((s) => String(s.sku_id) === String(id));
    const onOrder = new Set(expectedBySku.keys());
    const outsider = outsiderSku(skus, onOrder);

    // Put the transfer into a packable state, and remember what it was so the
    // fixture is left exactly as it was found.
    const originalStatus = transfer.status;
    await page.request.patch(`${API}/ds-ops/transfer-orders/${transfer.transfer_id}/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'PACKING' },
    });
    let createdLpn = '';
    cleanup = async () => {
      if (createdLpn) {
        for (const c of ((await apiGet(page, `/inventory/lpn-contents/?lpn=${encodeURIComponent(createdLpn)}&page_size=200`, token)).results as Json[])) {
          await apiDelete(page, `/inventory/lpn-contents/${c.id}/`, token);
        }
        await apiDelete(page, `/inventory/lpns/${createdLpn}/`, token);
      }
      await page.request.patch(`${API}/ds-ops/transfer-orders/${transfer.transfer_id}/`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { status: originalStatus },
      });
    };
    // Start from a clean tote count for the expected line we will scan.
    await openTab(page, 'pack-seal');

    // ---------- 1. the queue offers this transfer ----------
    const row = page.locator(`[data-testid="pack-queue-${transfer.transfer_id}"]`);
    await expect(row, 'the packable transfer is listed').toBeVisible(LONG);
    await row.click();

    // ---------- 2. create the tote ----------
    await expect(page.locator('[data-testid="pack-await-tote"]')).toBeVisible(LONG);
    await expect(page.locator('[data-testid="pack-expected"]')).toHaveText(String(expectedTotal), LONG);
    await expect(page.locator('[data-testid="pack-packed"]')).toHaveText('0', LONG);

    await page.click('[data-testid="pack-create-tote"]');
    await expect(page.locator('[data-testid="pack-unit-scan-text"]'), 'the scan input appears once the LPN exists').toBeVisible(LONG);
    await expect(page.locator('[data-testid="pack-label"]')).toBeVisible(LONG);

    // The LPN really is persisted and really is bound to this transfer.
    const lpnId = (await page.locator('[data-testid="pack-label"] .tote-label__title').innerText()).trim();
    expect(lpnId, 'a tote id was minted').toMatch(/^TOTE/);
    createdLpn = lpnId;
    const lpnRow = (await apiGet(page, `/inventory/lpns/?search=${encodeURIComponent(lpnId)}&page_size=5`, token)).results.find(
      (l: Json) => String(l.lpn_id) === lpnId
    );
    expect(lpnRow, 'the LPN was written to the database').toBeTruthy();
    expect(String(lpnRow.transfer), 'LPN is bound to the transfer').toBe(String(transfer.transfer_id));
    expect(String(lpnRow.status), 'a fresh tote is CREATED').toBe('CREATED');

    // ---------- 3. a product that is not on the order is rejected ----------
    await page.fill('[data-testid="pack-unit-scan-text"]', outsider.sku_code);
    await page.press('[data-testid="pack-unit-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="pack-unit-scan-feedback"]')).toContainText(/rejected|not on this order/i, LONG);
    await expect(page.locator('[data-testid="pack-rejects"]')).toContainText(outsider.sku_code, LONG);
    await expect(page.locator('[data-testid="pack-packed"]')).toHaveText('0', LONG);
    // And nothing was written for the rejected product.
    const afterReject = (await apiGet(page, `/inventory/lpn-contents/?lpn=${encodeURIComponent(lpnId)}&page_size=50`, token)).results as Json[];
    expect(afterReject.length, 'a rejected scan writes no LPN content').toBe(0);

    // ---------- 4. scan real units in ----------
    let packedSoFar = 0;
    for (const [skuId, want] of expectedBySku.entries()) {
      const s = skuOf(skuId);
      expect(s, `catalog row for ${skuId}`).toBeTruthy();
      for (let i = 0; i < want; i += 1) {
        packedSoFar += 1;
        await page.fill('[data-testid="pack-unit-scan-text"]', s.sku_code);
        await page.press('[data-testid="pack-unit-scan-text"]', 'Enter');
        await expect
          .poll(async () => Number(await page.locator('[data-testid="pack-packed"]').innerText()), LONG)
          .toBe(packedSoFar);
      }
    }
    await expect(page.locator('[data-testid="pack-packed"]')).toHaveText(String(expectedTotal), LONG);
    await expect(page.locator('[data-testid="pack-short"]')).toHaveText('0', LONG);
    await expect(page.locator('[data-testid="pack-over"]')).toHaveText('0', LONG);

    // ---------- 5. contents really are on the LPN ----------
    const contents = (await apiGet(page, `/inventory/lpn-contents/?lpn=${encodeURIComponent(lpnId)}&page_size=50`, token)).results as Json[];
    const totalOnLpn = contents.reduce((t, c) => t + Number(c.qty), 0);
    expect(totalOnLpn, 'LPN contents sum to the packed total').toBe(expectedTotal);
    contents.forEach((c) => {
      expect(String(c.lpn)).toBe(lpnId);
      expect(Number(c.qty)).toBeGreaterThan(0);
    });

    // ---------- 6. verification passes and the tote seals ----------
    await expect(page.locator('[data-testid="pack-verify-text"]')).toContainText(/matches the pick list/i, LONG);
    await expect(page.locator('[data-testid="pack-seal"]')).toBeEnabled(LONG);
    await page.click('[data-testid="pack-seal"]');
    await expect(page.locator('[data-testid="toast-success"]')).toContainText(/Tote sealed/i, LONG);
    await expect(page.locator('[data-testid="pack-sealed-msg"]')).toContainText(lpnId, LONG);

    const sealedLpn = (await apiGet(page, `/inventory/lpns/?search=${encodeURIComponent(lpnId)}&page_size=5`, token)).results.find(
      (l: Json) => String(l.lpn_id) === lpnId
    );
    // PACKED is one of the two statuses TransferOrderViewSet._lpns_for accepts,
    // so this is exactly what makes dispatch publish the tote.
    expect(sealedLpn.status, 'the LPN is PACKED after sealing').toBe('PACKED');

    // ---------- 7. the label carries the tote id, the destination and the lines ----------
    const label = page.locator('[data-testid="pack-label-preview"]');
    await expect(label).toContainText(lpnId, LONG);
    const destCode = (await apiGet(page, `/network/sites/?site_type=DS&page_size=200`, token)).results.find(
      (s: Json) => String(s.site_id) === String(transfer.dest_site)
    )?.code;
    expect(destCode, 'the destination site has a code').toBeTruthy();
    await expect(label).toContainText(destCode!, LONG);
    const labelRows = page.locator('[data-testid="pack-label-lines"] .tote-label__row');
    await expect(labelRows, 'the label lists one row per product').toHaveCount(expectedBySku.size, LONG);
    for (const [skuId, want] of expectedBySku.entries()) {
      await expect(labelRows.filter({ hasText: skuOf(skuId)!.sku_code })).toContainText(String(want), LONG);
    }

    // ---------- 8. onPrint really calls print() on a label-only document ----------
    await page.evaluate(() => {
      (window as any).__printed = 0;
      (window as any).__printDoc = '';
      (window as any).__realOpen = window.open;
      // Capture the print document instead of opening a real window, and record
      // that print() was invoked on it. document.write and print() must share
      // one buffer, or the recorded document is always empty.
      (window as any).open = () => {
        const doc: any = {
          _html: '',
          write(s: string) { doc._html += s; },
          close() {},
          focus() {},
          print() { (window as any).__printed += 1; (window as any).__printDoc = doc._html; },
          document: {
            write(s: string) { doc._html += s; },
            close() {},
          },
        };
        (window as any).__printWin = doc;
        return doc;
      };
    });
    await page.click('[data-testid="pack-label-print"]');
    await expect.poll(async () => page.evaluate(() => (window as any).__printed as number), LONG).toBe(1);
    const printed = await page.evaluate(() => (window as any).__printDoc as string);
    expect(printed, 'the printed document is the label').toContain(lpnId);
    expect(printed, 'the printed document lists the contents').toContain(skuOf([...expectedBySku.keys()][0])!.sku_code);
    await page.evaluate(() => { (window as any).open = (window as any).__realOpen; });

    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });

  test('BinLookupView: a real bin barcode resolves to its real contents', async ({ page }) => {
    test.setTimeout(600_000);
    test.slow();
    await login(page);
    const w = watch(page);
    const token = await tokenOf(page);

    // A real barcoded bin location.
    const bins = (await apiGet(page, '/network/locations/?location_type=BIN&page_size=50', token)).results as Json[];
    expect(bins.length, 'bin locations exist').toBeGreaterThan(0);
    const stocked = bins.find((b) => b.barcode);
    expect(stocked, 'a bin with a barcode exists').toBeTruthy();

    await openTab(page, 'bin-contents');

    // ---------- 1. a real bin barcode resolves ----------
    await page.fill('[data-testid="bin-lookup-scan-text"]', stocked.barcode);
    await page.press('[data-testid="bin-lookup-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="bin-lookup-result"]')).toBeVisible(LONG);
    await expect(page.locator('[data-testid="bin-lookup-location"]')).toHaveText(stocked.location_id, LONG);

    // The view's own result must equal the ledger's answer for that bin.
    const truth = (await apiGet(
      page,
      `/inventory/positions?location_id=${encodeURIComponent(stocked.location_id)}`,
      token
    )).results as Json[];
    const shown = page.locator('[data-testid="bin-lookup-rows"] > [data-testid^="bin-lookup-row-"]');
    if (truth.length === 0) {
      // Must say the bin is EMPTY, never render a blank table.
      await expect(page.locator('[data-testid="bin-lookup-empty"]')).toBeVisible(LONG);
      await expect(page.locator('[data-testid="bin-lookup-empty"]')).toContainText(/empty/i, LONG);
    } else {
      await expect(shown, 'one card per stock row').toHaveCount(truth.length, LONG);
      const truthQty = truth.reduce((t, r) => t + Number(r.qty), 0);
      const truthSku = truth[0].sku_code;
      await expect(page.locator('[data-testid="bin-lookup-summary"]')).toContainText(String(truthQty), LONG);
      await expect(page.locator('[data-testid="bin-lookup-rows"]')).toContainText(truthSku, LONG);
    }

    // ---------- 2. an unknown bin is an explicit error, not an empty table ----------
    await page.fill('[data-testid="bin-lookup-scan-text"]', `NO-SUCH-BIN-${TS}`);
    await page.press('[data-testid="bin-lookup-scan-text"]', 'Enter');
    await expect(page.locator('[data-testid="bin-lookup-error"]')).toContainText(/no bin matches/i, LONG);

    // ---------- 3. a bin that exists but is empty says so ----------
    // Find a real location that genuinely holds nothing.
    const allBins = (await apiGet(page, '/network/locations/?location_type=BIN&page_size=100', token)).results as Json[];
    let emptyBin: Json | null = null;
    for (const b of allBins.slice(0, 12)) {
      const rows = (await apiGet(page, `/inventory/positions?location_id=${encodeURIComponent(b.location_id)}`, token)).results as Json[];
      if (rows.length === 0) { emptyBin = b; break; }
    }
    if (emptyBin) {
      await page.fill('[data-testid="bin-lookup-scan-text"]', emptyBin.barcode);
      await page.press('[data-testid="bin-lookup-scan-text"]', 'Enter');
      await expect(page.locator('[data-testid="bin-lookup-result"]')).toBeVisible(LONG);
      await expect(page.locator('[data-testid="bin-lookup-empty"]')).toBeVisible(LONG);
      await expect(page.locator('[data-testid="bin-lookup-empty"]')).toContainText(/empty/i, LONG);
    } else {
      // Say so rather than pretending: every probed bin had stock.
      test.info().annotations.push({ type: 'note', description: 'no empty bin found among the first 12 probed bins' });
    }

    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });

  test('CreateOrderView: builds and persists a transfer order from real stock', async ({ page }) => {
    test.setTimeout(1_200_000);
    test.slow();
    await login(page);
    const w = watch(page);
    const token = await tokenOf(page);

    await openTab(page, 'create-orders');
    await expect(page.locator('[data-testid="co-source"]')).toHaveValue(/[0-9a-f-]{36}/i, LONG);

    // ---------- 1. pick a source that actually has stock ----------
    const mh = (await apiGet(page, '/network/sites/?site_type=MH&page_size=200', token)).results as Json[];
    expect(mh.length, 'mother hubs exist').toBeGreaterThan(0);
    let stocked: { site: Json; rows: Json[] } | null = null;
    for (const s of mh) {
      const rows = (await apiGet(page, `/inventory/positions?site_code=${encodeURIComponent(s.code)}&container=BIN`, token)).results as Json[];
      if (rows.length) { stocked = { site: s, rows }; break; }
    }
    expect(stocked, 'a mother hub with real BIN stock exists').toBeTruthy();

    await page.selectOption('[data-testid="co-source"]', String(stocked!.site.site_id));
    await expect(page.locator('[data-testid="co-stock-count"]')).toHaveText(String(stocked!.rows.length), LONG);

    // ---------- 2. add a real product line ----------
    const pick = stocked!.rows[0];
    const card = page.locator(`[data-testid="co-stock-${pick.sku}::${pick.lot}::${pick.container_ref}"]`);
    await expect(card, 'the real stock row is offered').toBeVisible(LONG);
    await card.click();
    await expect(page.locator('[data-testid="co-lines"] > [data-testid^="co-line-"]')).toHaveCount(1, LONG);
    await expect(page.locator('[data-testid="co-lines"]')).toContainText(pick.sku_code, LONG);

    // Cap the quantity at the real available amount.
    const avail = Number(pick.qty);
    expect(avail).toBeGreaterThan(0);
    await page.fill(`[data-testid="co-line-qty-${pick.sku}::${pick.lot}::${pick.container_ref}"]`, String(avail));
    await expect(page.locator('[data-testid="co-line-qty-' + `${pick.sku}::${pick.lot}::${pick.container_ref}` + '"]')).toHaveValue(String(avail), LONG);

    // ---------- 3. create + release ----------
    await page.click('[data-testid="co-create"]');
    await expect(page.locator('[data-testid="toast-success"]')).toContainText(/Replenishment order created/i, LONG);
    await expect(page.locator('[data-testid="co-result"]')).toBeVisible(LONG);

    const transferId = (await page.locator('[data-testid="co-result-id"]').innerText()).trim();
    expect(transferId, 'a transfer id is shown').toMatch(/[0-9a-f-]{36}/i);
    cleanup = async () => {
      for (const t of ((await apiGet(page, `/ds-ops/pick-tasks/?batch=${encodeURIComponent(transferId)}&page_size=200`, token)).results as Json[])) {
        await apiDelete(page, `/ds-ops/pick-tasks/${t.id}/`, token);
      }
      await apiDelete(page, `/ds-ops/transfer-orders/${transferId}/`, token);
    };
    await expect(page.locator('[data-testid="co-result-status"]')).toHaveText('PICKING', LONG);
    await expect(page.locator('[data-testid="co-result-total"]')).toHaveText(String(avail), LONG);

    // ---------- 4. it is really persisted, with its pick task ----------
    const persisted = await apiGet(page, `/ds-ops/transfer-orders/${transferId}/`, token);
    expect(persisted.transfer_id).toBe(transferId);
    expect(persisted.status, 'released to PICKING').toBe('PICKING');
    expect(Number(persisted.total_qty)).toBe(avail);
    expect(String(persisted.source_site)).toBe(String(stocked!.site.site_id));

    const tasks = (await apiGet(page, `/ds-ops/pick-tasks/?batch=${encodeURIComponent(transferId)}&page_size=50`, token)).results as Json[];
    expect(tasks.length, 'one pick task per line').toBe(1);
    expect(String(tasks[0].sku), 'the pick task names the real SKU').toBe(String(pick.sku));
    expect(String(tasks[0].lot), 'the pick task names the real lot').toBe(String(pick.lot));
    expect(Number(tasks[0].qty)).toBe(avail);
    expect(tasks[0].status, 'released to the pick queue').toBe('NOT_STARTED');
    expect(String(tasks[0].bin), 'the pick task names the real bin').toBe(String(pick.container_ref));

    // The result panel must show the persisted task, not the request payload.
    await expect(page.locator('[data-testid="co-result-tasks"] > [data-testid^="co-result-task-"]')).toHaveCount(1, LONG);

    // ---------- 5. the packer must not be offered an order whose picks are open ----------
    // A replenishment order is released to PICKING, and the pack queue only
    // offers PICKED / SORTED / PACKING. Asserting the gate, not a wish.
    await openTab(page, 'pack-seal');
    await expect(
      page.locator(`[data-testid="pack-queue-${transferId}"]`),
      'a PICKING order is not offered to the packer'
    ).toHaveCount(0, LONG);
    await expect(page.locator('[data-testid="pack-load-error"]')).toHaveCount(0, LONG);

    // Once picking has actually happened, the order does reach the pack queue —
    // and opening it then must refuse, because its pick lines are NOT_STARTED.
    await page.request.patch(`${API}/ds-ops/transfer-orders/${transferId}/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'PICKED' },
    });
    await page.click('[data-testid="pack-refresh"]');
    const queueRow = page.locator(`[data-testid="pack-queue-${transferId}"]`);
    await expect(queueRow, 'a PICKED order reaches the pack queue').toBeVisible(LONG);
    // The lane is shown from the row's own sites, not a placeholder.
    await expect(queueRow).toContainText(stocked!.site.code, LONG);
    await queueRow.click();
    await expect(page.locator('[data-testid="pack-order-scan-feedback"]'))
      .toContainText(/no completed pick lines/i, LONG);
    await expect(page.locator('[data-testid="pack-create-tote"]'), 'no tote may be created for an unpicked order')
      .toHaveCount(0, LONG);

    // ---------- cleanup ----------
    for (const t of tasks) await apiDelete(page, `/ds-ops/pick-tasks/${t.id}/`, token);
    await apiDelete(page, `/ds-ops/transfer-orders/${transferId}/`, token);

    expect(w.pageErrors, 'pageerror').toEqual([]);
    expect(w.consoleErrors, 'console error').toEqual([]);
    expect(w.failed, 'failed request').toEqual([]);
  });
});