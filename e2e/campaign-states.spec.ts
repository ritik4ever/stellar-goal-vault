import { test, expect } from './fixtures';
import { DashboardPage } from './dashboard';
import { nowInSeconds, TEST_CONTRIBUTORS, TEST_CREATORS } from './fixtures';

test.describe('Deterministic campaign state fixtures', () => {
  test('creates open, funded, and claimed campaigns declaratively', async ({ campaign }) => {
    const open = await campaign.create({ state: 'open', targetAmount: 500 });

    expect(open.progress).toEqual(
      expect.objectContaining({ status: 'open', remainingAmount: 500, canPledge: true }),
    );
    expect(open.deadline).toBeGreaterThan(nowInSeconds());

    const funded = await campaign.create({ state: 'funded', targetAmount: 250 });

    expect(funded.pledgedAmount).toBe(250);
    expect(funded.progress).toEqual(
      expect.objectContaining({ status: 'funded', remainingAmount: 0 }),
    );

    const claimed = await campaign.create({
      state: 'claimed',
      targetAmount: 100,
      creator: TEST_CREATORS.alice,
    });

    expect(claimed.claimedAt).toBeDefined();
    expect(claimed.progress).toEqual(
      expect.objectContaining({ status: 'claimed', canPledge: false, canClaim: false }),
    );
    expect(claimed.deadline).toBeLessThan(nowInSeconds());
  });

  test('creates a failed campaign after its deadline passes and rejects further pledges', async ({
    campaign,
    request,
  }) => {
    const failed = await campaign.create({
      state: 'failed',
      targetAmount: 1000,
      pledgedAmount: 50,
      creator: TEST_CREATORS.bob,
    });

    expect(failed.deadline).toBeLessThan(nowInSeconds());
    expect(failed.pledgedAmount).toBe(50);
    expect(failed.progress).toEqual(
      expect.objectContaining({ status: 'failed', canPledge: false, canRefund: true }),
    );

    const rejected = await request.post(`/api/campaigns/${failed.id}/pledges`, {
      data: { contributor: TEST_CONTRIBUTORS.eve, amount: 1, assetCode: 'USDC' },
    });
    expect(rejected.status()).toBe(400);
    expect((await rejected.json()).error.code).toBe('INVALID_CAMPAIGN_STATE');
  });

  test('renders a fixture-created campaign in the dashboard UI', async ({ page, campaign }) => {
    const created = await campaign.create({ state: 'open', targetAmount: 90 });
    const dashboard = new DashboardPage(page);

    await dashboard.goto();
    await expect(page.locator(`text=${created.title}`)).toBeVisible();
    await dashboard.selectCampaign(created.title);
    await expect(page.locator('.detail-panel h2')).toHaveText(created.title);
  });
});
