import { test, expect } from './fixtures';
import { DashboardPage } from './dashboard';
import {
  mockAppConfigSoroban,
  mockFreighter,
  TEST_CREATORS,
} from './fixtures';

/**
 * The production UI always routes pledges and claims through Freighter signing
 * (TransactionPreviewModal → signTransaction → Soroban RPC), so this lifecycle
 * spec runs against the per-test mock Soroban RPC and the emulated Freighter
 * bridge instead of hitting a live network.
 */
test.describe('Campaign Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await mockFreighter(page, TEST_CREATORS.alice);
  });

  test('should complete a full campaign lifecycle (Create -> Pledge -> Funded -> Claim)', async ({
    page,
    campaign,
    sorobanRpc,
  }) => {
    // The 36s deadline plus wizard/preview interactions cannot fit in the
    // default 30s test timeout.
    test.setTimeout(150_000);
    await page.route('**/api/config', (route) =>
      route.fulfill({ json: { data: mockAppConfigSoroban(sorobanRpc.url) } }),
    );

    const dashboard = new DashboardPage(page);
    const campaignTitle = `E2E Campaign ${Date.now()}`;

    await dashboard.goto();

    await test.step('Create Campaign', async () => {
      // 0.01h = 36s: long enough to complete create/pledge, and guarantees the
      // post-deadline reload lands past the backend's 30s detail-cache TTL so
      // the UI observes fresh claimable state.
      await dashboard.createCampaign(
        TEST_CREATORS.alice,
        campaignTitle,
        'This is a test campaign created by Playwright E2E test suite.',
        '100',
        '0.01',
      );
    });

    await test.step('Select Campaign', async () => {
      await dashboard.selectCampaignByTitle(campaignTitle);
    });

    // Connect Wallet
    await test.step('Connect Wallet', async () => {
      await dashboard.connectWallet();
    });

    await test.step('Submit Pledge', async () => {
      await dashboard.pledge('100');

      const preview = page.locator('.modal-content');
      await expect(preview).toContainText('Transaction Preview');
      await preview.locator('button:has-text("Confirm and Sign")').click();

      await expect(page.locator('.detail-stat:has-text("Remaining") strong')).toHaveText('0', {
        timeout: 20_000,
      });
      // The panel keeps accepting pledges until the deadline passes, so the
      // funded transition is asserted through the backend state.
      await campaign.waitForStatusByTitle(campaignTitle, 'funded', 20_000);
    });

    await test.step('Wait for Deadline and Claim', async () => {
      // Poll until the backend reports the deadline has passed, instead of a
      // wall-clock waitForTimeout.
      await campaign.waitForClaimableByTitle(campaignTitle, 45_000);

      // Reload to establish fresh UI state now that the server says claimable.
      // Navigate first: page.goto resets in-memory wallet state, so the wallet
      // must be connected after the deep link, right before claiming.
      await page.reload();
      await dashboard.selectCampaignByTitle(campaignTitle);
      await dashboard.connectWallet();
      await dashboard.claim();

      const preview = page.locator('.modal-content');
      await expect(preview).toContainText('Transaction Preview');
      await preview.locator('button:has-text("Confirm and Sign")').click();

      await expect(page.locator('text=Campaign claimed successfully')).toBeVisible({
        timeout: 20_000,
      });
      await campaign.waitForStatusByTitle(campaignTitle, 'claimed', 20_000);
    });
  });
});
