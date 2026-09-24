import { describe, expect, it } from 'vitest';

import type { Campaign } from '../types/campaign';
import { appendUniqueCampaigns } from './campaignListPagination';

function makeCampaign(id: string): Campaign {
  return {
    id,
    creator: `G${'A'.repeat(55)}`,
    title: `Campaign ${id}`,
    description: 'Campaign used to verify bounded chunk merging for the list.',
    acceptedTokens: ['USDC'],
    assetCode: 'USDC',
    targetAmount: 100,
    pledgedAmount: 10,
    deadline: 1_700_000_000,
    createdAt: 1_699_000_000,
    progress: {
      status: 'open',
      percentFunded: 10,
      remainingAmount: 90,
      pledgeCount: 1,
      hoursLeft: 24,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    },
  };
}

describe('appendUniqueCampaigns', () => {
  it('appends unseen campaigns in the order the API returned them', () => {
    const current = [makeCampaign('1'), makeCampaign('2')];
    const incoming = [makeCampaign('3'), makeCampaign('4')];

    const merged = appendUniqueCampaigns(current, incoming);

    expect(merged.map((campaign) => campaign.id)).toEqual(['1', '2', '3', '4']);
  });

  it('drops campaigns that are already loaded so chunks never duplicate', () => {
    const current = [makeCampaign('1'), makeCampaign('2')];
    // Page 2 shifts: campaign 2 appears again while campaign 3 is genuinely new.
    const incoming = [makeCampaign('2'), makeCampaign('3')];

    const merged = appendUniqueCampaigns(current, incoming);

    expect(merged.map((campaign) => campaign.id)).toEqual(['1', '2', '3']);
    expect(new Set(merged.map((campaign) => campaign.id)).size).toBe(merged.length);
  });

  it('keeps the position of an already-loaded campaign', () => {
    const current = [makeCampaign('1'), makeCampaign('2'), makeCampaign('3')];
    const incoming = [makeCampaign('3')];

    const merged = appendUniqueCampaigns(current, incoming);

    expect(merged.map((campaign) => campaign.id)).toEqual(['1', '2', '3']);
  });

  it('returns the existing list unchanged when there is nothing new', () => {
    const current = [makeCampaign('1')];

    expect(appendUniqueCampaigns(current, [])).toBe(current);
    expect(appendUniqueCampaigns(current, [makeCampaign('1')])).toBe(current);
  });

  it('preserves ordering and correctness across several sequential chunks', () => {
    const pages = [
      [makeCampaign('1'), makeCampaign('2')],
      [makeCampaign('3'), makeCampaign('4')],
      [makeCampaign('5')],
    ];

    const merged = pages.reduce<Campaign[]>(
      (accumulated, page) => appendUniqueCampaigns(accumulated, page),
      [],
    );

    expect(merged.map((campaign) => campaign.id)).toEqual(['1', '2', '3', '4', '5']);
  });
});
