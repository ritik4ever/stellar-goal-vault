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
  }) => {
    const dashboard = new DashboardPage(page);
    const campaignTitle = `E2E Campaign ${Date.now()}`;

    await dashboard.goto();

    await test.step('Create Campaign', async () => {
      await dashboard.creatorInput.fill(TEST_CREATORS.alice);
      await dashboard.titleInput.fill(campaignTitle);
      await dashboard.descriptionInput.fill(
        'This is a test campaign created by Playwright E2E test suite.',
      );
      await dashboard.targetAmountInput.fill('100');
      // 0.01h = 36s: long enough to complete create/pledge, and guarantees the
      // post-deadline reload lands past the backend's 30s detail-cache TTL so
      // the UI observes fresh claimable state.
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

    await test.step('Wait for Deadline and Claim', async () => {
      // Poll until the backend reports the deadline has passed, instead of a
      // wall-clock waitForTimeout.
      await campaign.waitForClaimableByTitle(campaignTitle, 45_000);

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
