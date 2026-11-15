import { test, expect } from '@playwright/test';

const account = {
  user_id: '11111111-1111-4111-8111-111111111111',
  email: 'floor@zippzo.test',
  full_name: 'Floor Operator',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
};

test('floor app opens facility-specific work and routes into the real putaway screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // This routing test is intentionally offline; WebSocket behavior is
    // covered by the ASGI integration run and should not affect the UI check.
    class QuietSocket {
      static OPEN = 1;
      readyState = 1;
      close() { this.readyState = 3; }
    }
    window.WebSocket = QuietSocket as unknown as typeof WebSocket;
  });

  await page.route('**/api/iam/auth/login', (route) => route.fulfill({ json: {
    status: 'success',
    user: account,
    facility: { code: 'WH-01', name: 'Main Hub', site_type: 'MH', site_id: '22222222-2222-4222-8222-222222222222' },
    target_app: 'WMS',
    allowed_apps: ['WMS'],
    token: 'test-token',
  } }));
  await page.route('**/api/network/overview*', (route) => route.fulfill({ json: {
    warehouses: [{ code: 'WH-01', name: 'Main Hub', site_type: 'MH', site_id: '22222222-2222-4222-8222-222222222222' }],
    dark_stores: [],
  } }));
  await page.route('**/api/supply/putaway-tasks/**', (route) => route.fulfill({ json: { count: 0, results: [] } }));
  await page.route('**/api/catalog/skus/**', (route) => route.fulfill({ json: { count: 0, results: [] } }));
  await page.route('**/api/iam/users/**', (route) => route.fulfill({ json: { count: 0, results: [] } }));

  await page.goto('/operations-app.html');
  await page.getByTestId('login-email').fill(account.email);
  await page.locator('input[type="password"]').fill('not-a-real-password');
  await page.getByRole('button', { name: /sign in|login/i }).click();

  await expect(page.getByTestId('floor-work-home')).toBeVisible();
  await expect(page.locator('.floor-home__header p')).toContainText('Main Hub');
  await expect(page.getByTestId('floor-job-putaway-tasks')).toBeVisible();
  await expect(page.getByTestId('floor-job-ds-order-picking')).toHaveCount(0);

  await page.getByTestId('floor-job-putaway-tasks').click();
  await expect(page.getByTestId('put-empty')).toBeVisible();
});

test('floor app switches its work list to dark-store order fulfillment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    class QuietSocket {
      static OPEN = 1;
      readyState = 1;
      close() { this.readyState = 3; }
    }
    window.WebSocket = QuietSocket as unknown as typeof WebSocket;
  });
  const store = { code: 'DS-01', name: 'North Store', site_type: 'DS', site_id: '33333333-3333-4333-8333-333333333333' };
  await page.route('**/api/iam/auth/login', (route) => route.fulfill({ json: {
    status: 'success', user: account, facility: store, target_app: 'WMS', allowed_apps: ['WMS'], token: 'test-token',
  } }));
  await page.route('**/api/network/overview*', (route) => route.fulfill({ json: { warehouses: [], dark_stores: [store] } }));
  await page.route('**/api/orders/orders/**', (route) => route.fulfill({ json: { count: 0, results: [] } }));
  await page.route('**/api/catalog/skus/**', (route) => route.fulfill({ json: { count: 0, results: [] } }));

  await page.goto('/operations-app.html');
  await page.getByTestId('login-email').fill(account.email);
  await page.locator('input[type="password"]').fill('not-a-real-password');
  await page.getByRole('button', { name: /sign in|login/i }).click();

  await expect(page.getByTestId('floor-work-home')).toBeVisible();
  await expect(page.locator('.floor-home__header p')).toContainText('North Store');
  await expect(page.getByTestId('floor-job-ds-order-picking')).toBeVisible();
  await expect(page.getByTestId('floor-job-putaway-tasks')).toHaveCount(0);
  await page.getByTestId('floor-job-ds-order-picking').click();
  await expect(page.getByTestId('ds-pick-empty')).toBeVisible();
});
