import { test, expect } from '@playwright/test';
import { DashboardPage } from './dashboard';

test.describe('Pledge and Refund Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Freighter wallet for signing
    await page.addInitScript(() => {
      (window as any).freighter = {
        isConnected: () => Promise.resolve(true),
        requestAccess: () =>
          Promise.resolve('GBAF7A6PJ7A6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA'),
        getNetworkDetails: () =>
          Promise.resolve({
            networkPassphrase: 'Test SDF Network ; September 2015',
            sorobanRpcUrl: 'https://soroban-testnet.stellar.org:443',
          }),
        signTransaction: (xdr: string) => Promise.resolve(xdr),
      };
    });
  });

  test('should complete full pledge+refund lifecycle (Create -> Pledge -> Verify Progress -> Fail -> Refund -> Verify Refunded)', async ({
    page,
    request,
  }) => {
    const dashboard = new DashboardPage(page);
    const campaignTitle = `E2E Refund Test ${Date.now()}`;
    const creator = 'GBAF7A6PJ7A6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA'; // Valid Stellar address (56 chars, base32 A-Z,2-7)
    const pledgeAmount = '50';

    await dashboard.goto();

    // Create campaign via API (workaround for broken Create Campaign form in E2E)
    let campaignId: string;
    await test.step('Create Campaign with Short Deadline via API', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 4; // 4 seconds from now
      const response = await request.post('http://localhost:3001/api/campaigns', {
        data: {
          creator,
          title: campaignTitle,
          description: 'This is a test campaign for refund lifecycle testing.',
          acceptedTokens: ['USDC'],
          targetAmount: 100,
          deadline,
        },
      });
      if (!response.ok()) {
        const error = await response.text();
        console.log('Campaign creation error:', error);
      }
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      campaignId = data.data.id;

      // Navigate directly to campaign detail page using campaign ID
      await page.goto(`/campaigns/${campaignId}`, { waitUntil: 'networkidle' });
    });

    // Skip wallet connection - Freighter mock handles signing directly

    await test.step('Submit Partial Pledge', async () => {
      await dashboard.pledge(pledgeAmount);
      
      // Verify progress shows partial funding
      await expect(page.locator('.detail-stat:has-text("Remaining") strong')).toHaveText('50');
      await expect(page.locator('.detail-stat:has-text("Pledged") strong')).toHaveText(pledgeAmount);
      await expect(page.locator('text=Open')).toBeVisible();
    });

    await test.step('Wait for Deadline to Pass (Campaign Fails)', async () => {
      // Wait for the short deadline to pass (0.001 hours = ~3.6 seconds)
      await page.waitForTimeout(5000);

      // Re-select campaign to refresh status
      await dashboard.selectCampaign(campaignTitle);
      
      // Verify campaign status changed to Failed
      await expect(page.locator('.detail-stat:has-text("Status")')).toContainText('Failed');
    });

    await test.step('Refund Pledge', async () => {
      // Verify refund button is visible/enabled for failed campaigns
      await expect(dashboard.refundButton).toBeVisible();
      
      await dashboard.refund();
      
      await expect(page.locator('text=Refund processed successfully')).toBeVisible();
    });

    await test.step('Verify Refunded Status', async () => {
      // Re-select campaign to refresh status
      await dashboard.selectCampaign(campaignTitle);
      
      // Verify pledged amount is now 0 (refunded)
      await expect(page.locator('.detail-stat:has-text("Pledged") strong')).toHaveText('0');
      
      // Verify campaign still shows as failed
      await expect(page.locator('.detail-stat:has-text("Status")')).toContainText('Failed');
    });
  });
});
