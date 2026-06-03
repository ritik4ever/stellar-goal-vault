import { test, expect } from '@playwright/test';

const states = [
  { status: 'open', testId: 'campaign-card-open' },
  { status: 'funded', testId: 'campaign-card-funded' },
  { status: 'claimed', testId: 'campaign-card-claimed' },
  { status: 'failed', testId: 'campaign-card-failed' },
] as const;

test.describe('CampaignCard visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 1000 });
  });

  for (const state of states) {
    test(`renders ${state.status} campaign card`, async ({ page }) => {
      await page.goto(`/?visualTest=campaign-card`);
      const card = page.getByTestId(state.testId);
      await expect(card).toBeVisible();
      await expect(card).toHaveScreenshot(`${state.status}.png`, {
        maxDiffPixelRatio: 0.005,
        animations: 'disabled',
      });
    });
  }
});
