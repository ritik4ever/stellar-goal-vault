import { test, expect } from './fixtures';
import { deadlineInHours, TEST_CONTRIBUTORS } from './fixtures';

test.describe('Deterministic pledge accounting', () => {
  test('accumulates pledges and reports contributor totals', async ({ campaign, pledge }) => {
    const open = await campaign.create({ state: 'open', targetAmount: 100 });

    const funded = await pledge.addMany(open.id, [
      { contributor: TEST_CONTRIBUTORS.dave, amount: 40 },
      { contributor: TEST_CONTRIBUTORS.eve, amount: 35 },
      { contributor: TEST_CONTRIBUTORS.frank, amount: 25 },
    ]);

    expect(funded.pledgedAmount).toBe(100);
    expect(funded.progress.remainingAmount).toBe(0);

    const contributors = await pledge.contributors(open.id);
    const totals = Object.fromEntries(
      contributors.map((summary) => [summary.contributor, summary.totalPledged]),
    );
    expect(totals[TEST_CONTRIBUTORS.dave]).toBe(40);
    expect(totals[TEST_CONTRIBUTORS.eve]).toBe(35);
    expect(totals[TEST_CONTRIBUTORS.frank]).toBe(25);
  });

  test('rejects over-cap and unaccepted-asset pledges deterministically', async ({
    campaign,
    request,
  }) => {
    const funded = await campaign.create({ state: 'funded', targetAmount: 50 });

    const cap = await request.post(`/api/campaigns/${funded.id}/pledges`, {
      data: { contributor: TEST_CONTRIBUTORS.eve, amount: 1, assetCode: 'USDC' },
    });
    expect(cap.status()).toBe(400);
    expect((await cap.json()).error.code).toBe('CAMPAIGN_FUNDING_CAP_EXCEEDED');

    const xlm = await campaign.create({
      state: 'open',
      acceptedTokens: ['XLM'],
      targetAmount: 50,
    });

    const asset = await request.post(`/api/campaigns/${xlm.id}/pledges`, {
      data: { contributor: TEST_CONTRIBUTORS.eve, amount: 10, assetCode: 'USDC' },
    });
    expect(asset.status()).toBe(400);
    expect((await asset.json()).error.code).toBe('INVALID_ASSET');

    const closed = await campaign.create({
      state: 'funded',
      targetAmount: 30,
      deadline: deadlineInHours(0.002),
    });
    await campaign.waitForClaimable(closed.id);

    const deadline = await request.post(`/api/campaigns/${closed.id}/pledges`, {
      data: { contributor: TEST_CONTRIBUTORS.eve, amount: 1, assetCode: 'USDC' },
    });
    expect(deadline.status()).toBe(400);
    expect((await deadline.json()).error.code).toBe('INVALID_CAMPAIGN_STATE');
  });
});
