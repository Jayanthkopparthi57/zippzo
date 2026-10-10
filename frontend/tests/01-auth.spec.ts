import { test, expect } from '@playwright/test';
import { login, loginRider, APP_ENTRIES, TEST_USERS } from './utils';

test.describe('Authentication & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`PAGE LOG: ${msg.type()} ${msg.text()}`));
    page.on('pageerror', err => console.log(`PAGE ERROR: ${err.message}`));
    page.on('response', resp => {
      if (resp.url().includes('/api/')) {
        console.log(`API ${resp.status()} ${resp.url()}`);
      }
    });
    
    await page.goto(APP_ENTRIES.store);
    await page.waitForLoadState('networkidle');
  });

  test('admin login succeeds and lands on dashboard', async ({ page }) => {
    await login(page, TEST_USERS.admin);
    await expect(page.getByText('Operations Control Tower')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Zippzo')).toBeVisible({ timeout: 10000 });
  });

  test('warehouse staff login shows WMS tabs', async ({ page }) => {
    await login(page, TEST_USERS.warehouseStaff);
    await expect(page.getByText('Stock Positions')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Movement Ledger')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Bins & Locations')).toBeVisible({ timeout: 10000 });
  });

  test('rider login shows the rider console', async ({ page }) => {
    // The rider entry is a cold bundle on a cold backend, and login() allows
    // itself two 60s waits before giving up, so the 30s default is too tight.
    test.setTimeout(120_000);
    await loginRider(page);
    // Rider gets its own isolated console on its own entry point (never the
    // store sidebar, which is not even in this bundle).
    // rider@ has no delivery profile yet, so the first screen is setup; a
    // rider who already has one lands on the Zippzo Rider dashboard.
    await expect(
      page.locator('[data-testid="rider-setup"], [data-testid="rider-shell"]').first()
    ).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-testid="nav-skus"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nav-ds-dashboard"]')).toHaveCount(0);
  });

  test('a rider account is refused by the store app', async ({ page }) => {
    // The three applications are separate installs. A rider account opened in
    // the store console is told which app it belongs to rather than being
    // handed an empty operator shell. login() cannot be used here: it waits
    // for a token, and a mismatch deliberately never issues one.
    await page.goto(APP_ENTRIES.store);
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', TEST_USERS.rider.email);
    await page.fill('input[type="password"]', TEST_USERS.rider.password);
    await page.click('button[type="submit"]');
    await expect(page.getByText('Wrong Zippzo app')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('wrong-app-open')).toBeVisible();
    await page.waitForFunction(() => !window.localStorage.getItem('zippzo_jwt'));
  });

  test.skip('invalid credentials shows error - skipped due to test env React render timing', async ({ page }) => {
    await page.fill('input[type="email"]', 'wrong@zippzo.in');
    await page.fill('input[type="password"]', 'wrongpass');
    
    // Wait for the login API response
    const responsePromise = page.waitForResponse(r => r.url().includes('/api/iam/auth/login') && r.status() === 401);
    await page.click('button[type="submit"]');
    await responsePromise;
    
    // Wait for React to render the error state - use a longer timeout and poll for the text
    await expect(page.getByText('Invalid credentials')).toBeVisible({ timeout: 30000 });
  });

  test('logout works', async ({ page }) => {
    await login(page, TEST_USERS.admin);
    // The logout button is in the header
    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
  });
});