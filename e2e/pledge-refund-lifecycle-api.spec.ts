import { test, expect } from '@playwright/test';

test.describe('Pledge and Refund Lifecycle (API)', () => {
  test('should complete pledge lifecycle via backend API (Create -> Pledge -> Verify Progress -> Fail)', async ({
    request,
  }) => {
    const campaignTitle = `E2E Refund Test ${Date.now()}`;
    const creator = 'GBAF7A6PJ7A6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA'; // Valid Stellar address (56 chars, base32 A-Z,2-7)
    const contributor = 'GBAF7A6PJ7A6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA6PA';
    const pledgeAmount = 50;
    const targetAmount = 100;

    // Step 1: Create Campaign with Short Deadline
    let campaignId: string;
    await test.step('Create Campaign with Short Deadline', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 4; // 4 seconds from now
      const response = await request.post('http://localhost:3001/api/campaigns', {
        data: {
          creator,
          title: campaignTitle,
          description: 'This is a test campaign for refund lifecycle testing.',
          acceptedTokens: ['USDC'],
          targetAmount,
          deadline,
        },
      });
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      campaignId = data.data.id;
      console.log('Created campaign:', campaignId);
    });

    // Step 2: Submit Pledge via API
    await test.step('Submit Partial Pledge', async () => {
      const response = await request.post(`http://localhost:3001/api/campaigns/${campaignId}/pledges`, {
        data: {
          contributor,
          amount: pledgeAmount,
          assetCode: 'USDC',
          transactionHash: 'test-tx-hash-123',
          confirmedAt: Math.floor(Date.now() / 1000),
        },
      });
      expect(response.ok()).toBeTruthy();
      console.log('Pledge submitted');
    });

    // Step 3: Verify Progress shows partial funding
    await test.step('Verify Progress shows partial funding', async () => {
      const response = await request.get(`http://localhost:3001/api/campaigns/${campaignId}`);
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      const campaign = data.data;
      expect(campaign.pledgedAmount).toBe(pledgeAmount);
      expect(campaign.targetAmount).toBe(targetAmount);
      expect(campaign.progress.status).toBe('open');
      console.log('Progress verified:', campaign.progress);
    });

    // Step 4: Wait for Deadline to Pass (Campaign Fails)
    await test.step('Wait for Deadline to Pass (Campaign Fails)', async () => {
      // Wait for the short deadline to pass (4 seconds)
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify campaign status changed to Failed
      const response = await request.get(`http://localhost:3001/api/campaigns/${campaignId}`);
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      const campaign = data.data;
      expect(campaign.progress.status).toBe('failed');
      console.log('Campaign failed as expected');
    });

    // Note: Refund step is skipped because it requires valid Soroban RPC verification
    // with a real transaction hash. The refund endpoint calls verifyRefundTransaction()
    // which makes an actual RPC call to the Soroban network. Backend unit tests
    // (api.test.ts) cover the refund logic comprehensively with mocked RPC calls.
    console.log('Refund step skipped - requires real Soroban RPC verification (covered by backend unit tests)');
  });
});
