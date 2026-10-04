import { defineConfig, devices } from '@playwright/test';

/**
 * CI-friendly, parallel-safe Playwright config.
 *
 * Isolation levers (safe under `fullyParallel` / shard / matrix):
 * - Ports + baseURL come from env so concurrent CI jobs do not collide.
 * - Per-worker output/report dirs avoid clobbering artifacts.
 * - `forbidOnly` + retries only in CI; local keeps `reuseExistingServer`.
 */
const FRONTEND_PORT = process.env.PLAYWRIGHT_FRONTEND_PORT || '3000';
const BACKEND_PORT = process.env.PLAYWRIGHT_BACKEND_PORT || '3001';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${FRONTEND_PORT}`;
const BACKEND_HEALTH =
  process.env.PLAYWRIGHT_BACKEND_HEALTH_URL ||
  `http://localhost:${BACKEND_PORT}/api/health`;
const OUTPUT_DIR = process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results';
const REPORT_DIR = process.env.PLAYWRIGHT_HTML_REPORT || 'playwright-report';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? Number(process.env.PLAYWRIGHT_WORKERS || 2) : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: REPORT_DIR }],
  ],
  outputDir: OUTPUT_DIR,
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      pathTemplate: '{testDir}/screenshots/{testFilePath}/{arg}{ext}',
    },
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : [
        {
          command: `PORT=${BACKEND_PORT} npm run dev:backend`,
          url: BACKEND_HEALTH,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 120_000,
        },
        {
          command: `PORT=${FRONTEND_PORT} npm run dev:frontend`,
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 120_000,
        },
      ],
});
