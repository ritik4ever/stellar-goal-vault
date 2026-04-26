import { test, expect } from '@playwright/test';
import { DashboardPage } from './dashboard';

test.describe('Campaign Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Freighter API
    await page.addInitScript(() => {
      (window as any).freighter = {
        isConnected: () => Promise.resolve(true),
        requestAccess: () => Promise.resolve("GBAF7Y6PJY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY"),
        getNetworkDetails: () => Promise.resolve({ 
          networkPassphrase: "Test SDF Network ; September 2015",
          sorobanRpcUrl: "https://soroban-testnet.stellar.org:443" 
        }),
        signTransaction: (xdr: string) => Promise.resolve(xdr),
      };
    });
  });

  test('should complete a full campaign lifecycle (Create -> Pledge -> Funded -> Claim)', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    const campaignTitle = `E2E Campaign ${Date.now()}`;
    const creator = "GBAF7Y6PJY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY6PY";

    await dashboard.goto();

    // 1. Create Campaign with a very short deadline
    await test.step('Create Campaign', async () => {
      await dashboard.creatorInput.fill(creator);
      await dashboard.titleInput.fill(campaignTitle);
      await dashboard.descriptionInput.fill('This is a test campaign created by Playwright E2E test suite.');
      await dashboard.targetAmountInput.fill('100');
      await dashboard.deadlineHoursInput.fill('0.001'); // ~3.6 seconds
      await dashboard.createButton.click();
      await expect(page.locator(`text=${campaignTitle}`)).toBeVisible();
    });

    // 2. Select the campaign
    await test.step('Select Campaign', async () => {
      await dashboard.selectCampaign(campaignTitle);
      await expect(page.locator('.detail-panel h2')).toHaveText(campaignTitle);
    });

    // 3. Connect Wallet
    await test.step('Connect Wallet', async () => {
      await dashboard.connectWallet();
    });

    // 4. Submit Pledge (Completes Funding)
    await test.step('Submit Pledge', async () => {
      await dashboard.pledge('100');
      await expect(page.locator('.detail-stat:has-text("Remaining") strong')).toHaveText('0');
    });

    // 5. Wait for deadline and Claim
    await test.step('Wait for Deadline and Claim', async () => {
      // Wait for the deadline to pass
      await page.waitForTimeout(5000); 
      
      // Re-select to refresh status or just try to claim
      await dashboard.claim();
      await expect(page.locator('text=Campaign claimed successfully')).toBeVisible();
    });
  });
});
