import { test, expect, Page } from '@playwright/test';
import { login, TEST_USERS } from './utils';

/**
 * Catalog administration, end to end.
 *
 * Covers the back-office loop the ops team asked for: an admin registers a
 * vendor (GSTIN + PAN), a product category, a SKU with an uploaded photo, and
 * finally lists that SKU at a dark store so it can reach a storefront. It also
 * proves the write side is closed to non-admin operators.
 *
 * Every record is created with a run-unique code and removed again through the
 * API at the end, so repeated runs neither collide nor accumulate junk.
 */

const uniqueNumeric = () => `${Date.now()}`.slice(-11);

async function apiJson(page: Page, path: string) {
  return page.evaluate(async (p) => {
    const token = localStorage.getItem('zippzo_jwt');
    const res = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path);
}

async function apiDelete(page: Page, path: string) {
  return page.evaluate(async (p) => {
    const token = localStorage.getItem('zippzo_jwt');
    const res = await fetch(`/api${p}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status;
  }, path);
}

/** A 1x1 PNG, so the upload exercises the real multipart path. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Catalog administration', () => {
  test.setTimeout(300_000);

  test('admin creates a vendor, category, SKU with photo, and store listing', async ({ page }) => {
    const stamp = `${Date.now()}`.slice(-7);
    const vendorCode = `V${stamp}${Math.floor(Math.random() * 90 + 10)}`;
    const vendorName = `E2E Supplier ${stamp}`;
    const vendorNameEdited = `${vendorName} (edited)`;
    const categoryName = `E2E Category ${stamp}`;
    const skuName = `E2E Test Product ${stamp}`;
    const skuNameEdited = `${skuName} v2`;
    const ean = `89${uniqueNumeric()}`.slice(0, 13);

    let skuId = '';
    let listingId = '';
    let categoryId = '';
    let skuCode = '';

    await login(page, TEST_USERS.admin);

    /* ── 1. Vendors: create with statutory IDs, edit, delete ── */
    await page.click('[data-testid="nav-vendors"]');
    await expect(page.getByTestId('ven-table')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Add Vendor' }).click();
    await expect(page.getByTestId('ven-form')).toBeVisible();
    await page.getByTestId('ven-code').fill(vendorCode);
    await page.getByTestId('ven-name').fill(vendorName);
    await page.getByTestId('ven-org').fill('E2E Foods Pvt Ltd');
    await page.getByTestId('ven-gstin').fill('27AABCU9603R1ZM');
    await page.getByTestId('ven-pan').fill('AABCU9603R');
    await page.getByTestId('ven-contact-name').fill('E2E Ravi');
    await page.getByTestId('ven-contact-phone').fill('9876543210');
    await page.getByTestId('ven-save').click();

    await expect(page.getByTestId('ven-table')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(`ven-edit-${vendorCode}`)).toBeVisible({ timeout: 60_000 });
    const vendorRow = page.locator('[data-testid="ven-table"] tr', { hasText: vendorCode });
    await expect(vendorRow).toContainText('AABCU9603R'); // PAN round-trips to the list

    await page.getByTestId(`ven-edit-${vendorCode}`).click();
    await expect(page.getByTestId('ven-form')).toBeVisible();
    await expect(page.getByTestId('ven-pan')).toHaveValue('AABCU9603R');
    await page.getByTestId('ven-name').fill(vendorNameEdited);
    await page.getByTestId('ven-save').click();
    await expect(page.getByTestId(`ven-edit-${vendorCode}`)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="ven-table"] tr', { hasText: vendorCode })).toContainText('(edited)');

    /* ── 2. Categories: create ── */
    await page.click('[data-testid="mc-tab-categories"]');
    await expect(page.getByTestId('cat-table')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('cat-add').click();
    await page.getByTestId('cat-name').fill(categoryName);
    await page.getByTestId('cat-save').click();
    await expect(page.getByTestId('cat-table')).toContainText(categoryName, { timeout: 60_000 });

    const catRes = await apiJson(page, '/catalog/categories/?page_size=500');
    const category = (catRes.body?.results || []).find((c) => c.name === categoryName);
    categoryId = category?.category_id || '';

    /* ── 3. SKUs: create with a real category and an uploaded photo ── */
    await page.click('[data-testid="nav-skus"]');
    await expect(page.getByTestId('sku-table')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Add New SKU' }).click();
    await expect(page.getByTestId('sku-form')).toBeVisible();

    skuCode = await page.getByTestId('sku-code').inputValue();
    expect(skuCode.length).toBeGreaterThan(3);

    await page.getByTestId('sku-name').fill(skuName);
    await page.getByTestId('sku-ean').fill(ean);
    await page.getByTestId('sku-mrp').fill('149.00');
    await page.getByTestId('sku-brand').fill('E2E Brand');
    if (categoryId) await page.getByTestId('sku-category').selectOption(categoryId);

    await page.getByTestId('sku-image-input').setInputFiles({
      name: 'product.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await expect(page.getByTestId('sku-upload-error')).toHaveCount(0);
    await expect(page.getByTestId('sku-image-preview')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('sku-image-preview')).toHaveAttribute('src', /\/media\/sku_images\//);

    await page.getByTestId('sku-save').click();
    await expect(page.getByTestId('sku-table')).toBeVisible({ timeout: 60_000 });

    // The catalog has 100+ seeded products and the table shows 10 a page, so
    // filter down to the record we just created instead of hunting pages.
    const skuSearch = page.locator('[data-testid="sku-table"] input[type="text"]').first();
    await skuSearch.fill(skuCode);
    await expect(page.getByTestId(`sku-edit-${skuCode}`)).toBeVisible({ timeout: 60_000 });

    const skuRow = page.locator('[data-testid="sku-table"] tr', { hasText: skuCode });
    await expect(skuRow).toContainText(categoryName);
    await expect(page.getByTestId(`sku-image-${skuCode}`)).toBeVisible();

    // The photo URL actually serves an image from the media route.
    const skuRes = await apiJson(page, `/catalog/skus/?search=${encodeURIComponent(skuCode)}`);
    const sku = (skuRes.body?.results || []).find((s) => s.sku_code === skuCode);
    expect(sku?.image_url || '').toMatch(/^\/media\/sku_images\/.+\.png$/);
    skuId = sku.sku_id;
    const imageStatus = await page.evaluate(
      async (url) => (await fetch(url)).status,
      sku.image_url,
    );
    expect(imageStatus).toBe(200);

    // Edit round-trip.
    await page.getByTestId(`sku-edit-${skuCode}`).click();
    await expect(page.getByTestId('sku-form')).toBeVisible();
    await page.getByTestId('sku-name').fill(skuNameEdited);
    await page.getByTestId('sku-save').click();
    await expect(page.getByTestId('sku-table')).toBeVisible({ timeout: 60_000 });
    await skuSearch.fill(skuCode);
    await expect(page.locator('[data-testid="sku-table"] tr', { hasText: skuCode })).toContainText(skuNameEdited, { timeout: 60_000 });

    /* ── 4. Listings: put the SKU on sale at a dark store ── */
    await page.click('[data-testid="mc-tab-listings"]');
    await expect(page.getByTestId('lst-table')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('lst-add').click();
    await expect(page.getByTestId('lst-form')).toBeVisible();

    await page.getByTestId('lst-sku').selectOption(skuId);
    const siteOptions = page.locator('[data-testid="lst-site"] option:not([value=""])');
    await expect(siteOptions.first()).toBeAttached({ timeout: 60_000 });
    const siteId = await siteOptions.first().getAttribute('value');
    await page.getByTestId('lst-site').selectOption(siteId);
    await page.getByTestId('lst-price').fill('139.00');
    await page.getByTestId('lst-mrp').fill('149.00');
    await page.getByTestId('lst-save').click();
    await expect(page.getByTestId('lst-table')).toBeVisible({ timeout: 60_000 });
    await page.locator('[data-testid="lst-table"] input[type="text"]').first().fill(skuCode);
    await expect(page.getByTestId('lst-table')).toContainText(skuCode, { timeout: 60_000 });

    const listRes = await apiJson(page, `/catalog/listings/?sku=${skuId}`);
    const listing = (listRes.body?.results || [])[0];
    expect(listing).toBeTruthy();
    expect(listing.is_listed).toBe(true);
    expect(listing.is_available).toBe(true);
    listingId = listing.listing_id;

    /* ── 5. Delete the vendor through the UI (confirm dialog) ── */
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('[data-testid="nav-vendors"]');
    await expect(page.getByTestId(`ven-del-${vendorCode}`)).toBeVisible({ timeout: 60_000 });
    await page.getByTestId(`ven-del-${vendorCode}`).click();
    await expect(page.getByTestId(`ven-del-${vendorCode}`)).toHaveCount(0, { timeout: 60_000 });

    /* ── cleanup: listing -> SKU (cascades) -> category ── */
    if (listingId) expect([200, 204, 404]).toContain(await apiDelete(page, `/catalog/listings/${listingId}/`));
    if (skuId) expect([200, 204, 404]).toContain(await apiDelete(page, `/catalog/skus/${skuId}/`));
    if (categoryId) expect([200, 204, 404]).toContain(await apiDelete(page, `/catalog/categories/${categoryId}/`));
  });

  test('warehouse staff can read the catalog but get no write controls', async ({ page }) => {
    await login(page, TEST_USERS.warehouseStaff);

    await page.click('[data-testid="nav-vendors"]');
    await expect(page.getByTestId('ven-table')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('mc-readonly')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Vendor' })).toHaveCount(0);
    await expect(page.locator('[data-testid^="ven-edit-"]')).toHaveCount(0);

    await page.click('[data-testid="nav-skus"]');
    await expect(page.getByTestId('sku-table')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Add New SKU' })).toHaveCount(0);
    await expect(page.locator('[data-testid^="sku-edit-"]')).toHaveCount(0);

    // Session restore must not need an admin-only endpoint: reloading keeps a
    // warehouse operator signed in instead of bouncing them to the login form.
    await page.reload();
    await expect(page.getByTestId('nav-vendors')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
  });
});
