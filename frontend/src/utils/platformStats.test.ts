import { describe, it, expect } from 'vitest';
import { computeSuccessRate, formatSuccessRate, isPlatformStatsEmpty } from './platformStats';

describe('platformStats utils', () => {
  it('computes success rate from funded and claimed campaigns', () => {
    expect(
      computeSuccessRate({
        totalCampaigns: 10,
        openCampaigns: 3,
        fundedCampaigns: 4,
        claimedCampaigns: 2,
        failedCampaigns: 1,
        totalPledgeVolume: 100,
        uniqueContributors: 5,
      }),
    ).toBe(60);
  });

  it('returns zero success rate when there are no campaigns', () => {
    expect(
      computeSuccessRate({
        totalCampaigns: 0,
        openCampaigns: 0,
        fundedCampaigns: 0,
        claimedCampaigns: 0,
        failedCampaigns: 0,
        totalPledgeVolume: 0,
        uniqueContributors: 0,
      }),
    ).toBe(0);
  });

  it('formats success rate for display', () => {
    expect(formatSuccessRate(50)).toBe('50%');
    expect(formatSuccessRate(33.333)).toBe('33%');
    expect(formatSuccessRate(8.25)).toBe('8.3%');
  });

  it('detects empty platform stats', () => {
    expect(
      isPlatformStatsEmpty({
        totalCampaigns: 0,
        openCampaigns: 0,
        fundedCampaigns: 0,
        claimedCampaigns: 0,
        failedCampaigns: 0,
        totalPledgeVolume: 0,
        uniqueContributors: 0,
      }),
    ).toBe(true);
  });
});
