import {
  buildCampaignComparisonMatrix,
  MAX_COMPARED_CAMPAIGNS,
  toggleComparedCampaignId,
} from './campaignComparison';

describe('campaignComparison (#609)', () => {
  it('enforces the maximum of 3 compared campaigns and supports deselection', () => {
    const s1 = toggleComparedCampaignId([], 'c1');
    const s2 = toggleComparedCampaignId(s1.ids, 'c2');
    const s3 = toggleComparedCampaignId(s2.ids, 'c3');
    expect(s3.ids).toEqual(['c1', 'c2', 'c3']);
    expect(s3.ids).toHaveLength(MAX_COMPARED_CAMPAIGNS);

    const s4 = toggleComparedCampaignId(s3.ids, 'c4');
    expect(s4.limitReached).toBe(true);
    expect(s4.ids).toEqual(['c1', 'c2', 'c3']);

    const removed = toggleComparedCampaignId(s3.ids, 'c2');
    expect(removed.ids).toEqual(['c1', 'c3']);
  });

  it('computes side-by-side comparison metrics and highlights leader badges', () => {
    const matrix = buildCampaignComparisonMatrix([
      { id: 'c1', title: 'Solar Grid', targetAmount: 1000, pledgedAmount: 800, contributorsCount: 16, deadlineIso: '2026-12-01T00:00:00Z' },
      { id: 'c2', title: 'Clean Water', targetAmount: 500, pledgedAmount: 450, contributorsCount: 9, deadlineIso: '2026-12-01T00:00:00Z' },
    ]);
    expect(matrix).toHaveLength(2);
    expect(matrix[0].percentFunded).toBe(80);
    expect(matrix[1].percentFunded).toBe(90);
    expect(matrix[1].isHighestFundedPct).toBe(true);
    expect(matrix[1].isLowestRemainingAmount).toBe(true);
  });
});
