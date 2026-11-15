import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.E2E_WEB_PORT || 3000);
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${webPort}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${webPort}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      VITE_API_BASE: '/api',
    },
  },
  expect: {
    // The dev database is a remote Neon instance: a single cold list call can
    // take 5-15s, and the 5s Playwright default failed assertions that were
    // merely waiting on the answer rather than asserting something false.
    timeout: 30000,
    toHaveScreenshot: { maxDiffPixels: 100 },
  },
});
