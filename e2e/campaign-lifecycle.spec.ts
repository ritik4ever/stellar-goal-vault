import { test, expect } from '@playwright/test';
import { DashboardPage } from './dashboard';

test.describe('Campaign Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).freighter = {
        isConnected: () => Promise.resolve(true),
        requestAccess: () => Promise.resolve("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
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
    const campaignTitle = `E2E Test Campaign ${Date.now()}`;
    const creator = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    await dashboard.goto();

    await test.step('Create Campaign', async () => {
      await dashboard.creatorInput.fill(creator);
      await dashboard.titleInput.fill(campaignTitle);
      await dashboard.descriptionInput.fill('Playwright E2E full lifecycle test campaign.');
      await dashboard.targetAmountInput.fill('100');
      await dashboard.deadlineHoursInput.fill('0.001');
      
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
      await page.waitForTimeout(4000); 
      
      await dashboard.claim();
      
      await expect(page.locator('text=Campaign claimed successfully')).toBeVisible();
      await expect(page.locator('.detail-stat:has-text("Status")')).toContainText('Claimed');
    });
  });
});