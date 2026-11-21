import { defineConfig, devices } from '@playwright/test';

/**
 * Lightweight runner for fixture-only specs that do not need the app servers
 * (no live funds, no Freighter extension, no backend SQLite).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/wallet-fixtures-reliability.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // Prefer the locally installed Chrome channel so fixture-only runs do not
      // require downloading Playwright's Chromium build (flaky on some networks).
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
