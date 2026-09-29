import { describe, expect, it } from 'vitest';

import type { Campaign, CampaignStatus } from '../types/campaign';
import { applyFilters, searchCampaigns, sortCampaigns } from './campaignsTableUtils';
import { appendUniqueCampaigns } from '../lib/campaignListPagination';

/**
 * Large-dataset regression coverage for campaign list rendering (issue #995).
 *
 * Deterministic, in-process, no network or mutable external data.
 * Exercises the CampaignsTable pipeline (search → filter → sort → virtualized
 * append) with a realistic larger fixture (1,000 campaigns) and records a
 * stable performance signal with a generous budget to avoid flaky timing.
 */

const ASSETS = ['USDC', 'XLM', 'EURC'] as const;
const STATUSES: CampaignStatus[] = ['open', 'funded', 'claimed', 'failed'];
const BASE_TIME = 1_700_000_000;
const CAMPAIGN_COUNT = 1_000;
const PAGE_SIZE = 20;
const GENEROUS_BUDGET_MS = 5_000;

function makeCampaign(index: number): Campaign {
  const asset = ASSETS[index % ASSETS.length];
  return {
    id: `campaign-${index}`,
    creator: `G${'A'.repeat(55)}`,
    title: `Campaign ${index}`,
    description: `Deterministic campaign ${index} for large-dataset regression.`,
    acceptedTokens: [asset],
    assetCode: asset,
    targetAmount: 1000 + (index % 50) * 100,
    pledgedAmount: (index * 7) % 5000,
    deadline: BASE_TIME + 86400 + index,
    createdAt: BASE_TIME - index,
    progress: {
      status: STATUSES[index % STATUSES.length],
      percentFunded: (index * 3) % 100,
      remainingAmount: (index * 5) % 1000,
      pledgeCount: index % 25,
      hoursLeft: index % 72,
      canPledge: index % 2 === 0,
      canClaim: index % 3 === 0,
      canRefund: index % 5 === 0,
    },
  };
}

function makeCampaigns(count: number): Campaign[] {
  return Array.from({ length: count }, (_, i) => makeCampaign(i));
}

describe('campaign list large-dataset regression', () => {
  const campaigns = makeCampaigns(CAMPAIGN_COUNT);

  it('keeps search + filter + sort correct at scale', () => {
    // Search correctness: "Campaign 42" should match indices containing 42 substring
    const searched = searchCampaigns(campaigns, 'Campaign 42');
    expect(searched.length).toBeGreaterThan(0);
    expect(searched.every((c) => c.title.includes('42'))).toBe(true);

    // Filter correctness: USDC + open intersection
    const filtered = applyFilters(campaigns, 'USDC', 'open');
    const expected = campaigns.filter((c) => c.assetCode === 'USDC' && c.progress.status === 'open');
    expect(filtered).toHaveLength(expected.length);
    expect(new Set(filtered.map((c) => c.id)).size).toBe(filtered.length);

    // Sort stability: descending pledgedAmount
    const sorted = sortCampaigns(filtered, 'pledgedAmount');
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1].pledgedAmount).toBeGreaterThanOrEqual(sorted[i].pledgedAmount);
    }
  });

  it('preserves ordering and correctness across paginated chunks at scale', () => {
    const pages: Campaign[][] = [];
    for (let i = 0; i < CAMPAIGN_COUNT; i += PAGE_SIZE) {
      pages.push(campaigns.slice(i, i + PAGE_SIZE));
    }
    expect(pages).toHaveLength(Math.ceil(CAMPAIGN_COUNT / PAGE_SIZE));

    const merged = pages.reduce<Campaign[]>((acc, page) => appendUniqueCampaigns(acc, page), []);
    expect(merged).toHaveLength(CAMPAIGN_COUNT);
    expect(new Set(merged.map((c) => c.id)).size).toBe(CAMPAIGN_COUNT);
    // Order preserved: first page first, last page last
    expect(merged[0].id).toBe('campaign-0');
    expect(merged[CAMPAIGN_COUNT - 1].id).toBe(`campaign-${CAMPAIGN_COUNT - 1}`);

    // Simulate page-boundary duplicate: re-append page 2 with duplicate from page 1
    const dupPage = [makeCampaign(1), makeCampaign(CAMPAIGN_COUNT)];
    const withDup = appendUniqueCampaigns(merged, dupPage);
    expect(withDup).toHaveLength(CAMPAIGN_COUNT + 1);
    expect(withDup[withDup.length - 1].id).toBe(`campaign-${CAMPAIGN_COUNT}`);
  });

  it('records a stable performance signal for the pipeline at scale', () => {
    const start = Date.now();
    const iterations = 20;
    for (let i = 0; i < iterations; i += 1) {
      const filtered = applyFilters(searchCampaigns(campaigns, ''), 'USDC', 'open');
      sortCampaigns(filtered, 'pledgedAmount');
    }
    const elapsed = Date.now() - start;
    const perIter = elapsed / iterations;
    console.info(
      `[campaign-list-scale] ${CAMPAIGN_COUNT} campaigns x${iterations} (search+filter+sort) ${elapsed}ms (${perIter.toFixed(3)}ms/iter, ${Math.round((CAMPAIGN_COUNT * iterations) / (elapsed / 1000) || 0)}/s)`,
    );
    expect(elapsed).toBeLessThan(GENEROUS_BUDGET_MS);
  });
});
