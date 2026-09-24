import { test as base } from '@playwright/test';
import { CampaignBuilder } from './campaign';
import { PledgeBuilder } from './pledge';

export { expect } from '@playwright/test';
export * from './api';
export * from './time';
export * from './wallets';

let scopeCounter = 0;

export const test = base.extend<{ campaign: CampaignBuilder; pledge: PledgeBuilder }>({
  campaign: async ({ request }, use) => {
    await use(new CampaignBuilder(request, `scope-${++scopeCounter}-${Date.now()}`));
  },
  pledge: async ({ request }, use) => {
    await use(new PledgeBuilder(request));
  },
});
