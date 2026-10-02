import { test as base, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const RAW_DIR = path.join(process.cwd(), 'coverage', 'e2e', 'raw');

/**
 * Playwright fixture that collects Chromium JS coverage when E2E_COVERAGE=1 or CI=true.
 * Raw V8 coverage dumps are written under coverage/e2e/raw/ for scripts/e2e-coverage-report.mjs.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const collect =
      process.env.E2E_COVERAGE === '1' ||
      process.env.E2E_COVERAGE === 'true' ||
      process.env.CI === 'true' ||
      process.env.CI === '1';

    if (!collect) {
      await use(page);
      return;
    }

    let started = false;
    try {
      await page.coverage.startJSCoverage({
        resetOnNavigation: false,
        reportAnonymousScripts: false,
      });
      started = true;
    } catch {
      // Coverage APIs are Chromium-only; fall through without collection.
    }

    await use(page);

    if (!started) {
      return;
    }

    try {
      const entries = await page.coverage.stopJSCoverage();
      if (!entries.length) {
        return;
      }
      fs.mkdirSync(RAW_DIR, { recursive: true });
      const safe = testInfo.titlePath
        .join('_')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 120);
      const out = path.join(
        RAW_DIR,
        `${safe}-w${testInfo.workerIndex}-${Date.now()}.json`,
      );
      fs.writeFileSync(out, JSON.stringify(entries));
    } catch {
      // Ignore stop/write failures so tests still surface their own errors.
    }
  },
});

export { expect };
