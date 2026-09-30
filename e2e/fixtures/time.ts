import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Deterministic time control for the Playwright E2E suite.
 *
 * Two clocks have to agree for deadline/lifecycle assertions to be reproducible:
 *
 *  - the **browser** clock — the create-campaign form derives its deadline from
 *    `Date.now()` and countdowns render from it; and
 *  - the **backend** clock — `calculateProgress` and campaign creation compare
 *    the deadline against the injectable clock in `campaignStore`.
 *
 * The browser clock is frozen with `page.clock.setFixedTime()`. The backend clock
 * is frozen through a test-only endpoint (`/api/e2e/time`) that only exists when
 * `E2E_TIME_CONTROL=1` (playwright.config.ts sets it for the dev server; CI sets
 * it for the compose backend). Both start at a constant UTC epoch, so a deadline
 * of "0.01h" is the same instant in every timezone and at every wall-clock time.
 */

export const SECONDS_PER_HOUR = 3600;

/** 2026-01-15T12:00:00Z — the fixed UTC instant every E2E run starts from. */
export const FIXED_NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0);
export const FIXED_NOW_SECONDS = Math.floor(FIXED_NOW_MS / 1000);

/**
 * The virtual "now" shared with assertions. The clock fixture moves it in
 * lock-step with the browser and backend clocks, so `nowInSeconds()` always
 * describes the instant the application sees.
 */
let virtualNowMs = FIXED_NOW_MS;

/** The (frozen) current time in unix seconds. */
export function nowInSeconds(): number {
  return Math.floor(virtualNowMs / 1000);
}

/** The (frozen) current time in unix milliseconds. */
export function nowInMilliseconds(): number {
  return virtualNowMs;
}

/** Unix seconds at `hours` after the frozen epoch — never the wall clock. */
export function deadlineInHours(hours: number): number {
  return FIXED_NOW_SECONDS + Math.round(hours * SECONDS_PER_HOUR);
}

export interface TestClock {
  /** Current virtual time in unix milliseconds. */
  now(): number;
  /** Move both clocks to an absolute unix-millisecond instant. */
  setTo(ms: number): Promise<void>;
  /** Move both clocks forward by whole seconds. */
  advance(seconds: number): Promise<void>;
  /** Restore real time on the backend clock. */
  reset(): Promise<void>;
}

async function pushBackendTime(request: APIRequestContext, nowMs: number): Promise<void> {
  const response = await request.post('/api/e2e/time', { data: { now: nowMs } });
  if (response.status() !== 200) {
    throw new Error(
      `Deterministic time control is unavailable (POST /api/e2e/time -> ${response.status()}). ` +
        'Start the backend with E2E_TIME_CONTROL=1 — playwright.config.ts sets this for you.',
    );
  }
}

/**
 * Chromium caches `/api/*` responses by `Cache-Control: max-age=30`. That TTL is
 * measured against real time, so moving the virtual clock does not expire it;
 * clear it whenever the clock jumps so post-transition reads are fresh.
 */
async function clearBrowserCache(page: Page): Promise<void> {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('Network.clearBrowserCache');
    await session.detach();
  } catch {
    // CDP is Chromium-only; the configured project is Chromium.
  }
}

export async function createTestClock(page: Page, request: APIRequestContext): Promise<TestClock> {
  let current = FIXED_NOW_MS;
  virtualNowMs = FIXED_NOW_MS;

  const setTo = async (ms: number): Promise<void> => {
    current = ms;
    virtualNowMs = ms;
    await page.clock.setFixedTime(ms);
    await pushBackendTime(request, ms);
    await clearBrowserCache(page);
  };

  // Freeze both clocks before the test navigates.
  await setTo(FIXED_NOW_MS);

  return {
    now: () => current,
    setTo,
    advance: (seconds: number) => setTo(current + seconds * 1000),
    reset: async () => {
      virtualNowMs = FIXED_NOW_MS;
      await request.delete('/api/e2e/time').catch(() => undefined);
    },
  };
}
