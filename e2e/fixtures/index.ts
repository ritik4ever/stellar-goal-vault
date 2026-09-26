import { test as base } from '@playwright/test';
import { CampaignBuilder } from './campaign';
import { PledgeBuilder } from './pledge';
import { createTestClock, type TestClock } from './time';

export { expect } from '@playwright/test';
export * from './api';
export * from './time';
export * from './wallets';

let scopeCounter = 0;

export const test = base.extend<{ clock: TestClock; campaign: CampaignBuilder; pledge: PledgeBuilder }>({
  // Freezes the browser and backend clocks at a fixed UTC epoch. `campaign`
  // depends on it, so every lifecycle/accounting spec runs on virtual time.
  clock: async ({ page, request }, use) => {
    const clock = await createTestClock(page, request);
    await use(clock);
    await clock.reset();
  },
  campaign: async ({ request, clock }, use) => {
    await use(new CampaignBuilder(request, `scope-${++scopeCounter}-${Date.now()}`, clock));
  },
  pledge: async ({ request }, use) => {
    await use(new PledgeBuilder(request));
  },
});
