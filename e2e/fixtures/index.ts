import { test as base, type Page } from '@playwright/test';
import { CampaignBuilder } from './campaign';
import { PledgeBuilder } from './pledge';
import { MockSorobanRpc } from './mock-soroban-rpc';

export { expect } from '@playwright/test';
export * from './api';
export * from './time';
export * from './wallets';

let scopeCounter = 0;

/**
 * Disables the PWA service worker for the page.
 *
 * In dev the app registers `sw.ts` (vite-plugin-pwa `devOptions.enabled`), which
 * routes `/api/campaigns` through workbox `NetworkFirst` with a 10s network
 * timeout and a 24h CacheStorage fallback. In e2e runs that cache survives
 * between specs, so the board can render campaigns from an earlier run (or
 * detach rows mid-interaction when the SW swaps in cached responses).
 * Tests must always observe live backend state, so the SW is blocked from
 * registering and any pre-existing caches are dropped before load.
 */
async function disableServiceWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Remove the accessor from the prototype: `'serviceWorker' in navigator`
    // must be false so both `main.tsx` and vite-plugin-pwa's dev-register
    // HMR path skip registration. `delete navigator.serviceWorker` alone is
    // a silent no-op because the property lives on Navigator.prototype.
    const proto = Object.getPrototypeOf(navigator) as {
      serviceWorker?: unknown;
    };
    delete proto.serviceWorker;
    // Belt and braces for any subclass chain.
    let cursor: object | null = Object.getPrototypeOf(navigator);
    while (cursor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = cursor as Record<string, unknown>;
      if ('serviceWorker' in record) {
        delete record.serviceWorker;
      }
      cursor = Object.getPrototypeOf(cursor) as object | null;
    }
  });
  await page.addInitScript(() => {
    if ('caches' in window) {
      window.caches.keys().then((keys) => {
        for (const key of keys) {
          if (key.includes('api-cache')) {
            void window.caches.delete(key);
          }
        }
      });
    }
  });
}

export const test = base.extend<{
  campaign: CampaignBuilder;
  pledge: PledgeBuilder;
  sorobanRpc: MockSorobanRpc;
}>({
  page: async ({ page }, use) => {
    await disableServiceWorker(page);
    await use(page);
  },
  campaign: async ({ request }, use) => {
    await use(new CampaignBuilder(request, `scope-${++scopeCounter}-${Date.now()}`));
  },
  pledge: async ({ request }, use) => {
    await use(new PledgeBuilder(request));
  },
  sorobanRpc: async ({}, use) => {
    const rpc = new MockSorobanRpc();
    await rpc.start();
    await use(rpc);
    await rpc.stop();
  },
});
