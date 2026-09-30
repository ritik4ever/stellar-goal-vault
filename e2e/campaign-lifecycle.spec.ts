import { test, expect } from './fixtures';
import { DashboardPage } from './dashboard';
import { mockFreighter, TEST_CREATORS } from './fixtures';

test.describe('Campaign Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await mockFreighter(page, TEST_CREATORS.alice);
  });

  test('should complete a full campaign lifecycle (Create -> Pledge -> Funded -> Claim)', async ({
    page,
    campaign,
    clock,
  }) => {
    const dashboard = new DashboardPage(page);
    const campaignTitle = `E2E Campaign ${clock.now()}`;

    await dashboard.goto();

    await test.step('Create Campaign', async () => {
      await dashboard.creatorInput.fill(TEST_CREATORS.alice);
      await dashboard.titleInput.fill(campaignTitle);
      await dashboard.descriptionInput.fill(
        'This is a test campaign created by Playwright E2E test suite.',
      );
      await dashboard.targetAmountInput.fill('100');
      // 0.01h = 36 virtual seconds. The clock is frozen, so the deadline is
      // exactly FIXED_NOW + 36s rather than "now + 36s" on the wall clock.
      await dashboard.deadlineHoursInput.fill('0.01');

      await dashboard.createButton.click();
      await expect(page.locator(`text=${campaignTitle}`)).toBeVisible();
    });

    await test.step('Select Campaign', async () => {
      await dashboard.selectCampaign(campaignTitle);
      await expect(page.locator('.detail-panel h2')).toHaveText(campaignTitle);
    });

    // Connect Wallet
    await test.step('Connect Wallet', async () => {
      await dashboard.connectWallet();
    });

    await test.step('Submit Pledge', async () => {
      await dashboard.pledge('100');
      await expect(page.locator('.detail-stat:has-text("Remaining") strong')).toHaveText('0');
      await expect(page.locator('text=Funded')).toBeVisible();
    });

    await test.step('Advance past the deadline and Claim', async () => {
      // Jump both clocks past the deadline instead of sleeping ~36 seconds on
      // the wall clock; clearBrowserCache() in the clock makes the reload fresh.
      await clock.advance(60);

      // Sanity-check that the backend already considers the campaign claimable.
      await campaign.waitForClaimableByTitle(campaignTitle, 15_000);

      // Reload to establish fresh UI state now that the server says claimable.
      await page.reload();
      await dashboard.connectWallet();
      await dashboard.selectCampaign(campaignTitle);
      await dashboard.claim();

      await expect(page.locator('text=Campaign claimed successfully')).toBeVisible();
      await expect(page.locator('.detail-stat:has-text("Status")')).toContainText('Claimed');
    });
  });
});
